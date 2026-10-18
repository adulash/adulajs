import {
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentRef,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { InfiniteScroll, router, usePage } from '@inertiajs/react'
import { Link } from '@adonisjs/inertia/react'
import { tableFeatures, useTable } from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import axios from 'axios'
import {
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  Check,
  ChevronsUpDown,
  Download,
  Inbox,
  Loader2,
  Bookmark,
  BookmarkPlus,
  Search,
  SlidersHorizontal,
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
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { useUiPreferences } from '~/components/ui/ui-preferences'
import { useMessages } from '~/components/ui/messages'
import { Can } from '~/components/ui/can'
import { Input } from '~/components/ui/input'
import { ResourceActions } from '~/components/ui/resource-actions'
import { openRecord, rememberListView } from '~/components/ui/resource-surface'
import { FieldControl, ResourceSelect } from '~/components/ui/resource-field'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '~/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import {
  csvCell,
  displayValue,
  parseValue,
  relationLabel,
  type LookupOptions,
  type Option,
} from '~/components/ui/resource-value'

/** Rows above this count render through the virtualizer (plan section 13). */
export const VIRTUAL_ROWS = 200
const ROW_HEIGHT = 52
const PAGE_SIZE = 100
const features = tableFeatures({})
type Query = Record<string, string | undefined>

export function DataTable({
  resource,
  result,
  lookups = {},
  savedViews = [],
}: {
  resource: ResourceDescription
  result: ResourceList
  lookups?: LookupOptions
  savedViews?: SavedView[]
}) {
  const { calendar } = useUiPreferences()
  const { t, label } = useMessages()
  const { url } = usePage()
  const query = new URL(url, 'http://localhost').searchParams
  const [search, setSearch] = useState(query.get('search') ?? '')
  const [failure, setFailure] = useState('')
  const container = useRef<HTMLDivElement>(null)
  const scroller = useRef<ComponentRef<typeof InfiniteScroll>>(null)
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
  const table = useTable({
    features,
    data: result.data,
    columns: fields.map((field) => ({ accessorKey: field.key, id: field.key })),
    getRowId: (row) => String(row.id),
  })
  const rows = table.getRowModel().rows
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
  const navigate = (changes: Query) => {
    const next = new URLSearchParams(query)
    next.delete('cursor')
    for (const [key, value] of Object.entries(changes))
      value ? next.set(key, value) : next.delete(key)
    const suffix = next.toString()
    router.get(
      `/resources/${resource.name}${suffix ? `?${suffix}` : ''}`,
      {},
      { preserveScroll: true }
    )
  }
  const sort = query.get('sort')
  const direction = query.get('direction') === 'desc' ? 'desc' : 'asc'
  const activeFilters = filterable.filter((field) => query.get(`filters[${field.key}]`))
  const csv = () => {
    const content = [
      fields.map((field) => label(field.label)),
      ...result.data.map((row) =>
        fields.map((field) => displayValue(field, row, related, lookups, calendar, t))
      ),
    ]
    const href = URL.createObjectURL(
      new Blob(['﻿' + content.map((row) => row.map(csvCell).join(',')).join('\r\n')], {
        type: 'text/csv;charset=utf-8',
      })
    )
    const link = document.createElement('a')
    link.href = href
    link.download = `${resource.label}.csv`
    link.click()
    URL.revokeObjectURL(href)
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
    const filters: Record<string, string> = {}
    for (const field of filterable) {
      const value = query.get(`filters[${field.key}]`)
      if (value) filters[field.key] = value
    }
    if (Object.keys(filters).length) view.filters = filters
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
      if (value !== null) next.set(`filters[${key}]`, String(value))
    setSearch(view.query.search ?? '')
    const suffix = next.toString()
    router.get(
      `/resources/${resource.name}${suffix ? `?${suffix}` : ''}`,
      {},
      { preserveScroll: true }
    )
  }
  return (
    <section
      aria-label={t('قائمة {resource}', { resource: resource.label })}
      className="min-w-0 overflow-hidden rounded-xl border border-border bg-white shadow-[0_2px_10px_#1c302804]"
    >
      <div className="flex flex-wrap items-center justify-between gap-4 border-b px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold">
            {t('سجل {resource}', { resource: resource.label })}
          </h2>
          <Badge variant="secondary" className="font-normal tabular-nums">
            {t('{count} معروض', { count: rows.length })}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {result.meta.estimatedTotal !== undefined
              ? t('نحو {count} سجل ضمن نطاقك', { count: result.meta.estimatedTotal })
              : t('حسب نطاق صلاحياتك')}
          </span>
        </div>
        <Button variant="outline" size="sm" onClick={csv} disabled={!rows.length}>
          <Download size={15} />
          {t('تصدير المعروض')}
        </Button>
      </div>
      {(resource.searchable || filterable.length > 0) && (
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
        <div className="flex flex-wrap items-end gap-3 border-b px-5 py-4">
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
            <Filter
              key={field.key}
              resource={resource.name}
              field={field}
              value={query.get(`filters[${field.key}]`) ?? ''}
              options={lookups[field.key]}
              related={related[field.key]}
              onApply={(value) => navigate({ [`filters[${field.key}]`]: value })}
            />
          ))}
          {activeFilters.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                navigate(
                  Object.fromEntries(
                    activeFilters.map((field) => [`filters[${field.key}]`, undefined])
                  )
                )
              }
            >
              <X size={14} />
              {t('مسح التصفية')}
            </Button>
          )}
        </div>
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
                  <td colSpan={fields.length + 1} style={{ height: items[0].start }} />
                </tr>
              )}
              {items.map(({ index }) => {
                const row = rows[index].original
                const id = String(row.id)
                return (
                  <tr
                    key={id}
                    aria-rowindex={index + 2}
                    className="group border-b last:border-0 hover:bg-background"
                    style={{ height: ROW_HEIGHT }}
                  >
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
                      </span>
                    </td>
                  </tr>
                )
              })}
              {virtualized && (
                <tr aria-hidden="true">
                  <td
                    colSpan={fields.length + 1}
                    style={{
                      height: Math.max(0, virtual.getTotalSize() - (items.at(-1)?.end ?? 0)),
                    }}
                  />
                </tr>
              )}
              {!rows.length && (
                <tr>
                  <td colSpan={fields.length + 1} className="py-16 text-center">
                    <Inbox
                      className="mx-auto mb-3 text-muted-foreground"
                      size={30}
                      strokeWidth={1.3}
                    />
                    <p className="text-sm font-medium">{t('لا توجد سجلات مطابقة')}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {query.get('search') || activeFilters.length
                        ? t('غيّر البحث أو التصفية لعرض سجلات أخرى.')
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
            <input
              type="checkbox"
              checked={shared}
              onChange={(event) => setShared(event.target.checked)}
            />
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
  const { t } = useMessages()
  const text = displayValue(field, row, related, lookups, calendar, t)
  const numeric = ['money', 'integer', 'date', 'datetime'].includes(field.type)
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

function Filter({
  resource,
  field,
  value,
  options,
  related,
  onApply,
}: {
  resource: string
  field: ResourceField
  value: string
  options?: Option[]
  related?: SerializedRecord[]
  onApply: (value: string | undefined) => void
}): ReactNode {
  const { t, label } = useMessages()
  const [draft, setDraft] = useState(value)
  const id = `filter-${field.key}`
  const select = (choices: Option[]) => (
    <ResourceSelect
      id={id}
      className="h-9 w-44 text-xs"
      value={value}
      placeholder={t('الكل')}
      options={choices}
      onChange={(next) => onApply(next || undefined)}
    />
  )
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label(field.label)}
      {field.type === 'lookup' ? (
        select(options ?? [])
      ) : field.type === 'boolean' ? (
        select([
          { value: 'true', label: t('نعم') },
          { value: 'false', label: t('لا') },
        ])
      ) : field.type === 'belongsTo' || field.type === 'user' ? (
        <RelationFilter
          resource={resource}
          field={field}
          value={value}
          related={related}
          onApply={onApply}
        />
      ) : field.type === 'date' ? (
        <div className="w-56">
          <FieldControl
            field={field}
            id={id}
            value={draft}
            label={t('تصفية {field}', { field: label(field.label) })}
            onChange={(next) => {
              setDraft(next)
              try {
                const parsed = parseValue(field, next)
                onApply(parsed ? String(parsed) : undefined)
              } catch {
                // Keep partial or invalid input without issuing an invalid date query.
              }
            }}
          />
        </div>
      ) : (
        <Input
          id={id}
          className="h-9 w-44 text-xs"
          value={draft}
          placeholder={t('اضغط Enter للتطبيق')}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              onApply(draft || undefined)
            }
          }}
        />
      )}
    </label>
  )
}

/**
 * Filters by a related record through the target list route, which enforces the target's
 * own rules. User fields list users through the field's options route instead.
 */
function RelationFilter({
  resource,
  field,
  value,
  related = [],
  onApply,
}: {
  resource: string
  field: ResourceField & { type: 'belongsTo' | 'user' }
  value: string
  /** Related rows already loaded with the list; they label the active filter after a reload. */
  related?: SerializedRecord[]
  onApply: (value: string | undefined) => void
}) {
  const { t, label } = useMessages()
  const [open, setOpen] = useState(false)
  const [term, setTerm] = useState('')
  const [choices, setChoices] = useState<Option[]>([])
  const [selected, setSelected] = useState<Option | null>(null)
  const [busy, setBusy] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const listId = useId()
  const load = async (search: string) => {
    setBusy(true)
    try {
      if (field.type === 'user') {
        const users = await axios.get<{ data: Option[] }>(
          `/resources/${resource}/options/${field.key}`,
          {
            params: { purpose: 'filter', ...(search ? { search } : {}) },
            headers: { Accept: 'application/json' },
          }
        )
        setChoices(users.data.data)
        return
      }
      const response = await axios.get<ResourceList>(`/resources/${field.resource}`, {
        params: {
          limit: 50,
          estimate: 'false',
          ...(search ? { search } : {}),
        },
        headers: { Accept: 'application/json' },
      })
      setChoices(
        response.data.data.map((row) => ({
          value: String(row.id),
          label: relationLabel(row, row.id),
        }))
      )
    } catch {
      setChoices([])
    } finally {
      setBusy(false)
    }
  }
  const loaded = related.find((row) => String(row.id) === value)
  const current =
    choices.find((choice) => choice.value === value) ??
    (selected?.value === value ? selected : null) ??
    (loaded ? { value, label: relationLabel(loaded, value) } : null)
  const choose = (option: Option | null) => {
    setSelected(option)
    setOpen(false)
    onApply(option?.value)
  }
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next && !choices.length) void load(term)
      }}
    >
      <PopoverTrigger asChild>
        <Button
          id={`filter-${field.key}`}
          type="button"
          role="combobox"
          variant="outline"
          aria-expanded={open}
          aria-controls={listId}
          className={`h-9 w-44 justify-between bg-transparent text-xs font-normal ${value ? '' : 'text-muted-foreground'}`}
        >
          <span className="truncate">{value ? (current?.label ?? `#${value}`) : t('الكل')}</span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={t('ابحث في السجلات المرتبطة')}
            aria-label={t('البحث في {field}', { field: label(field.label) })}
            value={term}
            onValueChange={(next) => {
              setTerm(next)
              clearTimeout(timer.current)
              timer.current = setTimeout(() => void load(next), 300)
            }}
          />
          <CommandList id={listId}>
            <CommandEmpty>{busy ? t('جارٍ البحث...') : t('لا توجد سجلات مطابقة')}</CommandEmpty>
            <CommandGroup>
              <CommandItem value="__all__" onSelect={() => choose(null)}>
                <Check className={value ? 'opacity-0' : 'opacity-100'} />
                {t('الكل')}
              </CommandItem>
              {choices.map((choice) => (
                <CommandItem
                  key={choice.value}
                  value={choice.value}
                  onSelect={() => choose(choice)}
                >
                  <Check className={choice.value === value ? 'opacity-100' : 'opacity-0'} />
                  {choice.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
