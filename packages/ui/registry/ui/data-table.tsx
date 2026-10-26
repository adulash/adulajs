import { useEffect, useRef, useState, type ComponentRef, type MouseEvent } from 'react'
import { InfiniteScroll, router, usePage } from '@inertiajs/react'
import { Link } from '@adonisjs/inertia/react'
import { tableFeatures, useTable } from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import axios from 'axios'
import {
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  Download,
  Inbox,
  ListChecks,
  Loader2,
  Bookmark,
  BookmarkPlus,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react'
import type {
  ResourceDescription,
  ResourceField,
  ResourceList,
  SavedView,
  SavedViewQuery,
  SerializedRecord,
} from 'adula'
import { Alert, AlertDescription } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
import { useUiPreferences } from '~/components/ui/ui-preferences'
import { useMessages } from '~/components/ui/messages'
import { Can } from '~/components/ui/can'
import { Input } from '~/components/ui/input'
import { ResourceActions } from '~/components/ui/resource-actions'
import { openRecord, rememberListView } from '~/components/ui/resource-surface'
import { displayValue, type LookupOptions, type Option } from '~/components/ui/resource-value'
import {
  FilterControl,
  describeFilter,
  filterValueLabel,
  type FilterLabels,
} from '~/components/ui/list-filters'
import { BulkBar, RestoreAction, actionScope, useBulkActions } from '~/components/ui/resource-bulk'
import {
  clearFilter,
  exportHref,
  fromSavedFilter,
  readFilters,
  selectionState,
  serverMessage,
  toSavedFilter,
  toggleSelection,
  writeFilter,
  type FieldFilter,
} from '~/components/ui/list_query'

/** Rows above this count render through the virtualizer (plan section 13). */
export const VIRTUAL_ROWS = 200
const ROW_HEIGHT = 52
const PAGE_SIZE = 100
const features = tableFeatures({})

/**
 * List-layer keys of the description (ADR 046). Older servers omit them: no «المحذوفات»
 * toggle, and the server export stays available.
 */
type ListDescription = ResourceDescription & {
  trash?: boolean
  exportable?: boolean
  bulk?: boolean
}

/** The file name from `Content-Disposition`, or null. */
function attachmentName(header: unknown) {
  if (typeof header !== 'string') return null
  const encoded = header.match(/filename\*=UTF-8''([^;]+)/i)
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1])
    } catch {
      // Fall through to the plain name.
    }
  }
  return header.match(/filename="?([^";]+)"?/i)?.[1] ?? null
}

export function DataTable({
  resource,
  result,
  lookups = {},
  savedViews = [],
  trashed = false,
}: {
  resource: ResourceDescription
  result: ResourceList
  lookups?: LookupOptions
  savedViews?: SavedView[]
  /** The «المحذوفات» list of `/resources/:name/trash`: rows offer restore only. */
  trashed?: boolean
}) {
  const { calendar } = useUiPreferences()
  const { t, label } = useMessages()
  const { url } = usePage()
  const description = resource as ListDescription
  const query = new URL(url, 'http://localhost').searchParams
  const listPath = `/resources/${resource.name}${trashed ? '/trash' : ''}`
  const [search, setSearch] = useState(query.get('search') ?? '')
  const [failure, setFailure] = useState('')
  const [queryFailure, setQueryFailure] = useState('')
  const [exporting, setExporting] = useState(false)
  const [exportFailure, setExportFailure] = useState('')
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const labels = useRef<FilterLabels>({})
  const container = useRef<HTMLDivElement>(null)
  const scroller = useRef<ComponentRef<typeof InfiniteScroll>>(null)
  const offered = useBulkActions(resource.name, description.bulk !== false)
  // The «المحذوفات» list offers restore only; the active list everything else.
  const bulkActions = offered.filter(
    (action) => actionScope(action) === (trashed ? 'trash' : 'records')
  )
  // Opening one of this list's records remembers the view, so closing the dialog returns to it.
  useEffect(
    () =>
      router.on('before', (event) => {
        const { pathname } = event.detail.visit.url
        if (pathname.startsWith(`/resources/${resource.name}/`)) rememberListView(pathname)
      }),
    [resource.name]
  )
  // Inertia merges `result.data` page by page; permissions and labels of earlier pages accumulate here.
  const store = useRef<{
    source: ResourceList | null
    permissions: ResourceList['permissions']
    related: ResourceList['related']
  }>({ source: null, permissions: {}, related: {} })
  if (store.current.source !== result) {
    const related = { ...store.current.related }
    for (const [key, rows] of Object.entries(result.related))
      related[key] = [
        ...new Map([...(related[key] ?? []), ...rows].map((row) => [String(row.id), row])).values(),
      ]
    store.current = {
      source: result,
      permissions: { ...store.current.permissions, ...result.permissions },
      related,
    }
  }
  const { permissions, related } = store.current
  const fields = resource.fields.filter(
    (field) => resource.list.includes(field.key) && field.type !== 'hasMany'
  )
  const filterable = fields.filter((field) => field.filterable)
  const filters = readFilters(
    query,
    filterable.map((field) => field.key)
  )
  const activeFilters = filterable.filter((field) => filters[field.key])
  const table = useTable({
    features,
    data: result.data,
    columns: fields.map((field) => ({ accessorKey: field.key, id: field.key })),
    getRowId: (row) => String(row.id),
  })
  const rows = table.getRowModel().rows
  const loadedIds = rows.map((row) => row.id)
  const selectable = bulkActions.length > 0
  const columns = fields.length + 1 + (selectable ? 1 : 0)
  const virtualized = rows.length > VIRTUAL_ROWS
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => container.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
    enabled: virtualized,
    getItemKey: (index) => rows[index].id,
  })
  const items = virtualized
    ? virtual.getVirtualItems()
    : rows.map((_, index) => ({ index, start: 0, end: 0 }))
  const go = (next: URLSearchParams) => {
    next.delete('cursor')
    setQueryFailure('')
    setSelected(new Set())
    const suffix = next.toString()
    router.get(
      `${listPath}${suffix ? `?${suffix}` : ''}`,
      {},
      {
        preserveScroll: true,
        // An invalid filter is 422 E_FILTER; show the server's message instead of the error page.
        onHttpException: (response) => {
          if (response.status !== 422) return
          setQueryFailure(
            serverMessage(response.data) ?? t('تعذر تطبيق التصفية. راجع القيم ثم أعد المحاولة.')
          )
          return false
        },
      }
    )
  }
  const navigate = (changes: Record<string, string | undefined>) => {
    const next = new URLSearchParams(query)
    for (const [key, value] of Object.entries(changes))
      value ? next.set(key, value) : next.delete(key)
    go(next)
  }
  const applyFilter = (key: string, filter: FieldFilter | null) => {
    const next = new URLSearchParams(query)
    writeFilter(next, key, filter)
    go(next)
  }
  const clearFilters = () => {
    const next = new URLSearchParams(query)
    for (const field of activeFilters) clearFilter(next, field.key)
    go(next)
  }
  const sort = query.get('sort')
  const direction = query.get('direction') === 'desc' ? 'desc' : 'asc'
  const valueLabel = (field: ResourceField) => (raw: string) =>
    filterValueLabel(field, raw, {
      options: lookups[field.key],
      related: related[field.key],
      labels: labels.current[field.key],
      calendar,
      t,
    })
  const remember = (key: string) => (choices: Option[]) => {
    labels.current[key] = {
      ...labels.current[key],
      ...Object.fromEntries(choices.map((choice) => [choice.value, choice.label])),
    }
  }
  // The server export reads the same filtered set as this list, page by page, up to its limit.
  const exportResults = async () => {
    setExporting(true)
    setExportFailure('')
    try {
      const response = await axios.get<Blob>(exportHref(resource.name, query), {
        responseType: 'blob',
        headers: { Accept: 'text/csv, application/json' },
      })
      const href = URL.createObjectURL(response.data)
      const link = document.createElement('a')
      link.href = href
      link.download =
        attachmentName(response.headers['content-disposition']) ?? `${resource.label}.csv`
      link.click()
      // Revoking right after click can cancel the download in some browsers.
      setTimeout(() => URL.revokeObjectURL(href), 60_000)
    } catch (error) {
      const body = axios.isAxiosError(error) ? error.response?.data : null
      const message = body instanceof Blob ? serverMessage(await body.text().catch(() => '')) : null
      setExportFailure(message ?? t('تعذر تصدير النتائج. حاول مجدداً.'))
    } finally {
      setExporting(false)
    }
  }
  const refresh = () => router.visit(url, { preserveScroll: true })
  // Records open in a dialog over this list, which stays mounted (#31); modified clicks
  // (new tab, new window) keep the link's own behavior.
  const overlay = (event: MouseEvent, id: string, mode: 'show' | 'edit') => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return
    event.preventDefault()
    void openRecord(resource.name, id, mode)
  }
  const currentQuery = (): SavedViewQuery => {
    const view: SavedViewQuery = {}
    const text = query.get('search')
    if (text) view.search = text
    if (sort) {
      view.sort = sort
      view.direction = direction
    }
    const saved: Record<string, unknown> = {}
    for (const field of activeFilters) saved[field.key] = toSavedFilter(filters[field.key])
    // Saved views store operator objects too (ADR 046); older type declarations list scalars.
    if (Object.keys(saved).length) view.filters = saved as SavedViewQuery['filters']
    return view
  }
  const applyView = (view: SavedView) => {
    const next = new URLSearchParams()
    if (view.query.search) next.set('search', view.query.search)
    if (view.query.sort) {
      next.set('sort', view.query.sort)
      next.set('direction', view.query.direction ?? 'asc')
    }
    for (const [key, value] of Object.entries(view.query.filters ?? {}))
      writeFilter(next, key, fromSavedFilter(value))
    setSearch(view.query.search ?? '')
    go(next)
  }
  const allState = selectionState(selected, loadedIds)
  const chosen = loadedIds.filter((id) => selected.has(id))
  return (
    <section
      aria-label={t('قائمة {resource}', { resource: resource.label })}
      className="min-w-0 overflow-hidden rounded-xl border border-border bg-white shadow-[0_2px_10px_#1c302804]"
    >
      <div className="flex flex-wrap items-center justify-between gap-4 border-b px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold">
            {trashed
              ? t('المحذوفات من {resource}', { resource: resource.label })
              : t('سجل {resource}', { resource: resource.label })}
          </h2>
          <Badge variant="secondary" className="font-normal tabular-nums">
            {t('{count} معروض', { count: rows.length })}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {result.meta.estimatedTotal !== undefined
              ? t('نحو {count} سجل ضمن نطاقك', {
                  count: result.meta.estimatedTotal,
                })
              : t('حسب نطاق صلاحياتك')}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {description.trash && (
            <Button variant="outline" size="sm" asChild>
              <Link
                href={trashed ? `/resources/${resource.name}` : `/resources/${resource.name}/trash`}
              >
                {trashed ? <ListChecks size={15} /> : <Trash2 size={15} />}
                {trashed ? t('السجلات النشطة') : t('المحذوفات')}
              </Link>
            </Button>
          )}
          {!trashed && description.exportable !== false && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void exportResults()}
              disabled={!rows.length || exporting}
            >
              {exporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
              {exporting ? t('جارٍ التصدير...') : t('تصدير النتائج')}
            </Button>
          )}
        </div>
      </div>
      {exportFailure && (
        <div className="border-b px-5 py-3">
          <Alert variant="destructive">
            <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
              {exportFailure}
              <Button variant="ghost" size="sm" onClick={() => setExportFailure('')}>
                {t('إغلاق')}
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      )}
      {/* Saved views belong to the active list; «المحذوفات» has none. */}
      {!trashed && (resource.searchable || filterable.length > 0) && (
        <SavedViewsBar
          resource={resource}
          views={savedViews}
          current={currentQuery}
          onApply={applyView}
          onChanged={refresh}
          onFailure={setFailure}
        />
      )}
      {(resource.searchable || filterable.length > 0) && (
        <div className="grid gap-3 border-b px-5 py-4">
          <div className="flex flex-wrap items-center gap-3">
            {resource.searchable && (
              <form
                role="search"
                className="relative w-full max-w-sm"
                onSubmit={(event) => {
                  event.preventDefault()
                  navigate({ search })
                }}
              >
                <Search
                  className="pointer-events-none absolute start-3 top-2.5 text-muted-foreground"
                  size={16}
                />
                <Input
                  aria-label={t('البحث في {field}', { field: resource.label })}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t('ابحث في السجلات...')}
                  className="h-9 bg-background/60 ps-10 text-xs"
                />
              </form>
            )}
            {filterable.length > 0 && (
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <SlidersHorizontal size={15} />
                {t('تصفية')}
              </span>
            )}
            {filterable.map((field) => (
              <FilterControl
                key={field.key}
                resource={resource.name}
                field={field}
                filter={filters[field.key]}
                options={lookups[field.key]}
                related={related[field.key]}
                labels={labels.current[field.key]}
                onRemember={remember(field.key)}
                onApply={(filter) => applyFilter(field.key, filter)}
              />
            ))}
          </div>
          {activeFilters.length > 0 && (
            <ul aria-label={t('التصفية المطبقة')} className="flex flex-wrap items-center gap-2">
              {activeFilters.map((field) => (
                <li key={field.key}>
                  <Badge
                    variant="secondary"
                    className="h-7 gap-1.5 ps-3 pe-1.5 text-xs font-normal"
                  >
                    <span className="font-medium">{label(field.label)}:</span>
                    <span className="max-w-[260px] truncate">
                      {describeFilter(filters[field.key], valueLabel(field), t)}
                    </span>
                    <button
                      type="button"
                      aria-label={t('إزالة تصفية {field}', {
                        field: label(field.label),
                      })}
                      className="rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
                      onClick={() => applyFilter(field.key, null)}
                    >
                      <X size={13} />
                    </button>
                  </Badge>
                </li>
              ))}
              <li>
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={clearFilters}>
                  <X size={14} />
                  {t('مسح التصفية')}
                </Button>
              </li>
            </ul>
          )}
          {queryFailure && (
            <Alert variant="destructive">
              <AlertDescription>{queryFailure}</AlertDescription>
            </Alert>
          )}
        </div>
      )}
      {selectable && (
        <BulkBar
          resource={resource.name}
          actions={bulkActions}
          selected={chosen}
          rows={result.data}
          onClear={() => setSelected(new Set())}
          onDone={(outcome) => {
            // Refused rows stay selected so they can be reviewed or retried.
            const failed = new Set(outcome.failed.map((entry) => String(entry.id)))
            setSelected((current) => new Set([...current].filter((id) => failed.has(id))))
            refresh()
          }}
        />
      )}
      <InfiniteScroll
        ref={(instance) => {
          scroller.current = instance
        }}
        data="result"
        manual
        onlyNext
        preserveUrl
        params={{
          data: { limit: PAGE_SIZE },
          onBefore: () => {
            setFailure('')
          },
          onHttpException: () => {
            setFailure(t('تعذر تحميل السجلات التالية. أعد المحاولة.'))
            return false
          },
          onNetworkError: () => {
            setFailure(t('تعذر الاتصال بالخادم. تحقق من الاتصال ثم أعد المحاولة.'))
            return false
          },
        }}
        next={({ fetch, loading, hasMore }) => (
          <div className="flex flex-wrap items-center justify-center gap-4 border-t px-5 py-3 text-xs text-muted-foreground">
            {failure && (
              <p role="alert" className="text-destructive">
                {failure}
              </p>
            )}
            {loading ? (
              <span role="status" className="inline-flex items-center gap-2">
                <Loader2 size={14} className="animate-spin" />
                {t('جارٍ تحميل المزيد...')}
              </span>
            ) : hasMore ? (
              <Button variant="ghost" size="sm" onClick={fetch}>
                {t('تحميل المزيد')}
              </Button>
            ) : (
              <span>{rows.length ? t('نهاية السجلات') : ''}</span>
            )}
          </div>
        )}
      >
        <div
          ref={container}
          data-slot="table-scroll"
          className="max-h-[600px] overflow-auto"
          onScroll={(event) => {
            const element = event.currentTarget
            if (
              !failure &&
              element.scrollHeight - element.scrollTop - element.clientHeight < 200 &&
              scroller.current?.hasNext()
            )
              scroller.current.fetchNext()
          }}
        >
          <table
            className="w-full min-w-[720px] text-start text-sm"
            aria-rowcount={rows.length + 1}
            aria-label={resource.label}
          >
            <thead className="sticky top-0 z-10 bg-muted text-xs text-muted-foreground">
              <tr>
                {selectable && (
                  <th scope="col" className="h-11 w-10 ps-5 pe-1 text-start">
                    <Checkbox
                      aria-label={t('تحديد كل السجلات المعروضة')}
                      checked={allState}
                      disabled={!rows.length}
                      onCheckedChange={(value) =>
                        setSelected(value === true ? new Set(loadedIds) : new Set())
                      }
                    />
                  </th>
                )}
                {fields.map((field) => (
                  <th
                    key={field.key}
                    scope="col"
                    className="h-11 whitespace-nowrap px-5 text-start font-medium"
                    aria-sort={
                      sort === field.key
                        ? direction === 'desc'
                          ? 'descending'
                          : 'ascending'
                        : undefined
                    }
                  >
                    {field.sortable ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-2 hover:text-foreground"
                        onClick={() =>
                          navigate({
                            sort: field.key,
                            direction: sort === field.key && direction === 'asc' ? 'desc' : 'asc',
                          })
                        }
                      >
                        {label(field.label)}
                        {sort === field.key ? (
                          direction === 'desc' ? (
                            <ArrowDown size={12} />
                          ) : (
                            <ArrowUp size={12} />
                          )
                        ) : (
                          <ArrowDownUp size={12} className="opacity-60" />
                        )}
                      </button>
                    ) : (
                      label(field.label)
                    )}
                  </th>
                ))}
                <th
                  scope="col"
                  className="sticky end-0 border-s bg-muted px-5 text-start font-medium"
                >
                  {t('الإجراءات')}
                </th>
              </tr>
            </thead>
            <tbody>
              {virtualized && items[0] && items[0].start > 0 && (
                <tr aria-hidden="true">
                  <td colSpan={columns} style={{ height: items[0].start }} />
                </tr>
              )}
              {items.map(({ index }) => {
                const row = rows[index].original
                const id = String(row.id)
                const checked = selected.has(id)
                return (
                  <tr
                    key={id}
                    aria-rowindex={index + 2}
                    aria-selected={selectable ? checked : undefined}
                    className={`group border-b last:border-0 hover:bg-background ${checked ? 'bg-accent/40' : ''}`}
                    style={{ height: ROW_HEIGHT }}
                  >
                    {selectable && (
                      <td className="w-10 ps-5 pe-1">
                        <Checkbox
                          aria-label={t('تحديد السجل {id}', { id })}
                          checked={checked}
                          onCheckedChange={(value) =>
                            setSelected((current) => toggleSelection(current, id, value === true))
                          }
                        />
                      </td>
                    )}
                    {fields.map((field) => (
                      <Cell
                        key={field.key}
                        field={field}
                        row={row}
                        related={related}
                        lookups={lookups}
                      />
                    ))}
                    {/* Pinned at the inline end so wide tables keep their row actions in view. */}
                    <td className="sticky end-0 whitespace-nowrap border-s bg-card px-5 text-xs group-hover:bg-background">
                      <span className="inline-flex items-center gap-1">
                        {trashed ? (
                          // Restore is authorized by the delete rule on the deleted record (ADR 046).
                          (permissions[id] as Record<string, boolean | undefined> | undefined)
                            ?.restore === true && (
                            <RestoreAction
                              resource={resource.name}
                              id={id}
                              version={row.version ?? undefined}
                              label={t('السجل {id}', { id })}
                              onDone={refresh}
                            />
                          )
                        ) : (
                          <>
                            <Button variant="ghost" size="sm" asChild>
                              <Link
                                href={`/resources/${resource.name}/${id}`}
                                aria-label={t('عرض السجل {id}', { id })}
                                onClick={(event) => overlay(event, id, 'show')}
                              >
                                {t('عرض')}
                              </Link>
                            </Button>
                            <Can permissions={permissions[id] ?? {}} action="update">
                              <Button variant="ghost" size="sm" asChild>
                                <Link
                                  href={`/resources/${resource.name}/${id}/edit`}
                                  aria-label={t('تعديل السجل {id}', { id })}
                                  onClick={(event) => overlay(event, id, 'edit')}
                                >
                                  {t('تعديل')}
                                </Link>
                              </Button>
                            </Can>
                            <ResourceActions
                              resource={resource.name}
                              id={id}
                              version={row.version ?? undefined}
                              permissions={permissions[id] ?? {}}
                              label={t('السجل {id}', { id })}
                              size="sm"
                              variant="ghost"
                              onDone={refresh}
                            />
                          </>
                        )}
                      </span>
                    </td>
                  </tr>
                )
              })}
              {virtualized && (
                <tr aria-hidden="true">
                  <td
                    colSpan={columns}
                    style={{
                      height: Math.max(0, virtual.getTotalSize() - (items.at(-1)?.end ?? 0)),
                    }}
                  />
                </tr>
              )}
              {!rows.length && (
                <tr>
                  <td colSpan={columns} className="py-16 text-center">
                    {trashed ? (
                      <Trash2
                        className="mx-auto mb-3 text-muted-foreground"
                        size={30}
                        strokeWidth={1.3}
                      />
                    ) : (
                      <Inbox
                        className="mx-auto mb-3 text-muted-foreground"
                        size={30}
                        strokeWidth={1.3}
                      />
                    )}
                    <p className="text-sm font-medium">
                      {trashed && !query.get('search') && !activeFilters.length
                        ? t('لا توجد سجلات محذوفة')
                        : t('لا توجد سجلات مطابقة')}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {query.get('search') || activeFilters.length
                        ? t('غيّر البحث أو التصفية لعرض سجلات أخرى.')
                        : trashed
                          ? t('تظهر هنا السجلات المحذوفة ضمن نطاقك لتستعيدها.')
                          : t('لم تُضف سجلات ضمن نطاقك بعد.')}
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </InfiniteScroll>
    </section>
  )
}

/** Presets over the same query keys the list already accepts; AdulaJS validates every one. */
function SavedViewsBar({
  resource,
  views,
  current,
  onApply,
  onChanged,
  onFailure,
}: {
  resource: ResourceDescription
  views: SavedView[]
  current: () => SavedViewQuery
  onApply: (view: SavedView) => void
  onChanged: () => void
  onFailure: (message: string) => void
}) {
  const { t } = useMessages()
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const [shared, setShared] = useState(false)
  const [busy, setBusy] = useState(false)
  const base = `/resources/${resource.name}/views`
  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    onFailure('')
    try {
      await axios.post(
        base,
        { name, query: current(), shared },
        { headers: { Accept: 'application/json' }, withXSRFToken: true }
      )
      setNaming(false)
      setName('')
      setShared(false)
      onChanged()
    } catch (error) {
      onFailure(
        axios.isAxiosError(error) && error.response?.data?.error?.message
          ? String(error.response.data.error.message)
          : t('تعذر حفظ العرض.')
      )
    } finally {
      setBusy(false)
    }
  }
  const remove = async (view: SavedView) => {
    setBusy(true)
    onFailure('')
    try {
      await axios.delete(`${base}/${view.id}`, {
        headers: { Accept: 'application/json' },
        withXSRFToken: true,
      })
      onChanged()
    } catch {
      onFailure(t('تعذر حذف العرض.'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3">
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        <Bookmark size={15} />
        {t('العروض المحفوظة')}
      </span>
      {views.length === 0 && (
        <span className="text-xs text-muted-foreground">{t('لا عروض بعد')}</span>
      )}
      {views.map((view) => (
        <span
          key={view.id}
          className="flex items-center gap-1 rounded-full border border-border bg-background/60 ps-1 pe-3"
        >
          <Button
            variant="ghost"
            size="sm"
            className="h-7 rounded-full px-2 text-xs"
            onClick={() => onApply(view)}
          >
            {view.name}
            {!view.own && <span className="text-muted-foreground"> · {t('مشترك')}</span>}
          </Button>
          {view.own && (
            <button
              type="button"
              aria-label={t('حذف العرض {name}', { name: view.name })}
              disabled={busy}
              onClick={() => remove(view)}
              className="text-muted-foreground transition-colors hover:text-destructive"
            >
              <X size={13} />
            </button>
          )}
        </span>
      ))}
      {naming ? (
        <form onSubmit={save} className="flex flex-wrap items-center gap-2">
          <Input
            aria-label={t('اسم العرض')}
            value={name}
            autoFocus
            maxLength={60}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('اسم العرض')}
            className="h-8 w-44 text-xs"
          />
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            <Checkbox checked={shared} onCheckedChange={(value) => setShared(value === true)} />
            {t('مشترك')}
          </label>
          <Button type="submit" size="sm" className="h-8" disabled={busy || !name.trim()}>
            {t('حفظ')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8"
            onClick={() => setNaming(false)}
          >
            {t('إلغاء')}
          </Button>
        </form>
      ) : (
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setNaming(true)}>
          <BookmarkPlus size={14} />
          {t('حفظ العرض الحالي')}
        </Button>
      )}
    </div>
  )
}

function Cell({
  field,
  row,
  related,
  lookups,
}: {
  field: ResourceField
  row: SerializedRecord
  related: ResourceList['related']
  lookups: LookupOptions
}) {
  const { calendar } = useUiPreferences()
  const { t, locale } = useMessages()
  const text = displayValue(field, row, related, lookups, calendar, t, locale)
  const numeric = ['money', 'integer', 'decimal', 'percent', 'date', 'datetime'].includes(
    field.type
  )
  return (
    <td
      className={`max-w-[280px] truncate px-5 ${numeric ? 'tabular-nums' : ''}`}
      dir={numeric ? 'ltr' : undefined}
      title={text}
    >
      {field.type === 'boolean' && row[field.key] !== null && row[field.key] !== undefined ? (
        <Badge variant={row[field.key] ? 'default' : 'secondary'}>{text}</Badge>
      ) : (
        text
      )}
    </td>
  )
}
