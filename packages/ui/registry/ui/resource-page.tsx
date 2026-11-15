import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Head, usePage } from '@inertiajs/react'
import { Link } from '@adonisjs/inertia/react'
import { Plus, Save } from 'lucide-react'
import type {
  RecordPermissions,
  ResourceActivity,
  ResourceChildren,
  ResourceDescription,
  ResourceEditor,
  ResourceList,
  ResourceLookups,
  SavedView,
  ResourceShow as Show,
} from 'adula'
import { Button } from '~/components/ui/button'
import { DialogClose } from '~/components/ui/dialog'
import { Card, CardContent, CardHeader } from '~/components/ui/card'
import { Skeleton } from '~/components/ui/skeleton'
import { DataTable } from '~/components/ui/data-table'
import type { BulkAction } from '~/components/ui/resource-bulk'
import { ResourceForm } from '~/components/ui/resource-form'
import { ResourceShow } from '~/components/ui/resource-show'
import { ResourceImport } from '~/components/ui/resource-import'
import {
  RecordFooter,
  RecordFooterClose,
  ResourceSurface,
  closeCreated,
  closeRecord,
  fetchListRow,
  openCreate,
  openRecord,
  plainClick,
  prefetchCreate,
  useOverlayShell,
  useOverlayView,
  type RecordOverlay,
  type ResourcePresentation,
} from '~/components/ui/resource-surface'
import { useMessages, type Translate } from '~/components/ui/messages'

/** The discriminated view stays nested: Inertia's page typing flattens top-level unions. */
export type ResourceView =
  | {
      mode: 'index'
      resource: ResourceDescription
      lookups: ResourceLookups
      savedViews: SavedView[]
      /** The actor's bulk actions, sent with the list so its selection column renders at once (#108). */
      bulkActions?: BulkAction[]
      /** `/resources/:name/trash`: the soft-deleted records, offered for restore (ADR 046). */
      trashed?: boolean
    }
  | { mode: 'form'; editor: ResourceEditor; permissions: RecordPermissions }
  | {
      mode: 'show'
      resource: ResourceDescription
      result: Show
      lookups: ResourceLookups
      childResources: Record<string, ResourceDescription>
    }
export type ResourcePageProps = {
  view: ResourceView
  /** Index pages receive the list as a top-level `inertia.scroll` prop so pages merge into `result.data`. */
  result?: ResourceList
  childrenData?: ResourceChildren
  activity?: ResourceActivity
  /** Set to page only when the user requests a non-modal form/detail override. */
  presentation?: ResourcePresentation
}
type RecordView = Exclude<ResourceView, { mode: 'index' }>

/** Title of a record dialog: «إضافة حساب», «تعديل · الحسابات» or «تفاصيل · الحسابات». */
function recordTitle(view: RecordView, t: Translate) {
  if (view.mode === 'show') return t('تفاصيل · {resource}', { resource: view.resource.label })
  const create = view.editor.mode === 'create'
  // A singular record noun («حساب») reads better than the plural list label (#37).
  if (view.editor.recordLabel)
    return create
      ? t('إضافة {record}', { record: view.editor.recordLabel })
      : t('تعديل {record}', { record: view.editor.recordLabel })
  return create
    ? t('إضافة · {resource}', { resource: view.editor.label })
    : t('تعديل · {resource}', { resource: view.editor.label })
}

/**
 * The title of a dialog whose view is still loading: from the list's own description, else
 * from the label the opener gave.
 */
function openingTitle(
  opening: NonNullable<RecordOverlay['opening']>,
  resource: ResourceDescription | undefined,
  t: Translate
) {
  const label = resource?.label ?? opening.label ?? ''
  if (opening.mode === 'show') return t('تفاصيل · {resource}', { resource: label })
  const noun = resource?.recordLabel
  if (opening.mode === 'create')
    return noun
      ? t('إضافة {record}', { record: noun })
      : t('إضافة · {resource}', { resource: label })
  return noun ? t('تعديل {record}', { record: noun }) : t('تعديل · {resource}', { resource: label })
}

/**
 * The body of a dialog whose view is still loading: the dialog is already open, with its fixed
 * footer and the close control it will keep, so nothing moves when the view arrives. Without
 * the skeleton, the first frame of a dialog whose view is at hand (AfterFirstPaint).
 */
function RecordLoading({ form, skeleton = true }: { form: boolean; skeleton?: boolean }) {
  const { t } = useMessages()
  return (
    <>
      <RecordFooter>
        {/* Where the record's own actions will sit, as in the loaded footer. */}
        <div className="me-auto" />
        {form ? (
          <>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('إلغاء')}
              </Button>
            </DialogClose>
            <Button type="button" disabled>
              <Save size={16} />
              {t('حفظ السجل')}
            </Button>
          </>
        ) : (
          <RecordFooterClose />
        )}
      </RecordFooter>
      {/* While it shows, the dialog holds the focus itself (ResourceSurface). */}
      <span hidden data-record-pending="" />
      {skeleton && <RecordSkeleton />}
    </>
  )
}

/** What Radix focuses when a dialog opens: the first tabbable control, links aside. */
function firstTabbable(container: Element) {
  for (const element of container.querySelectorAll<HTMLElement>(
    'button, input, select, textarea, [tabindex]'
  )) {
    const disabled = (element as HTMLButtonElement).disabled
    const hidden = element instanceof HTMLInputElement && element.type === 'hidden'
    if (element.tabIndex >= 0 && !disabled && !hidden && element.getClientRects().length)
      return element
  }
  return undefined
}

/**
 * A record body mounted after the dialog's first paint (decision 25). The click paints the
 * dialog at once, at its final size, with the footer it keeps; a long form's first render and
 * what follows it (style and layout forced by Radix's presence, size and focus handling) would
 * otherwise run inside the click and hold that first frame back (some 250 ms for the sample
 * form the first time it renders). One frame later the body takes its place, no skeleton in
 * between, and the focus goes to its first control as it would have at opening, unless the
 * user already moved it. Until then the dialog itself holds the focus (not «إلغاء», which a
 * screen reader would announce and Enter would press).
 */
function AfterFirstPaint({ form, children }: { form: boolean; children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const marker = useRef<HTMLSpanElement>(null)
  const opened = useRef<Element | null>(null)
  useEffect(() => {
    // A frame callback runs before that frame's paint; the timeout after it runs after.
    let timer: ReturnType<typeof setTimeout> | undefined
    const frame = requestAnimationFrame(() => {
      timer = setTimeout(() => {
        opened.current = document.activeElement
        setReady(true)
      }, 0)
    })
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(timer)
    }
  }, [])
  useEffect(() => {
    if (!ready || document.activeElement !== opened.current) return
    const dialog = marker.current?.closest('[role=dialog]')
    if (dialog) firstTabbable(dialog)?.focus()
  }, [ready])
  if (!ready) return <RecordLoading form={form} skeleton={false} />
  return (
    <>
      <span ref={marker} hidden />
      {children}
    </>
  )
}

/** The record's card as the form and the details draw it: a header, then two columns of fields. */
function RecordSkeleton() {
  const { t } = useMessages()
  return (
    <Card
      role="status"
      aria-label={t('جارٍ التحميل...')}
      data-slot="record-loading"
      className="gap-0 py-0 shadow-none"
    >
      <CardHeader className="border-b px-7 py-5 [.border-b]:pb-5">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-3 w-48" />
      </CardHeader>
      <CardContent className="grid gap-6 p-7 md:grid-cols-2">
        {[0, 1, 2, 3].map((field) => (
          <div key={field} className="min-w-0 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function RecordBody({
  view,
  childrenData,
  activity,
  onSaved,
  onCancel,
  onEdit,
  onAction,
}: {
  view: RecordView
  childrenData?: ResourceChildren
  activity?: ResourceActivity
  onSaved?: (id: number) => void
  onCancel?: () => void
  onEdit?: () => void
  onAction?: (action: string) => void
}) {
  return view.mode === 'form' ? (
    <ResourceForm
      key={`${view.editor.name}:${view.editor.record?.id ?? 'new'}`}
      editor={view.editor}
      permissions={view.permissions}
      onSaved={onSaved}
      onCancel={onCancel}
      onAction={onAction}
    />
  ) : (
    <ResourceShow
      key={`${view.resource.name}:${view.result.data.id}`}
      resource={view.resource}
      result={view.result}
      lookups={view.lookups}
      childResources={view.childResources}
      childrenData={childrenData}
      activity={activity}
      onEdit={onEdit}
      onAction={onAction}
    />
  )
}

/**
 * A record or create form opened over the current page by openRecord() or openCreate(); the
 * page stays mounted behind it. ResourcePage renders it over the generic list; another page
 * that opens records with openRecord() (for example «مهامي») renders it too. `resource`, the
 * list's description, titles the dialog while its body loads.
 */
export function RecordOverlayDialog({ resource }: { resource?: ResourceDescription }) {
  const { t } = useMessages()
  // A client-only prop set by openRecord()/openCreate(), never sent by the server.
  const props = usePage<{
    overlay?: RecordOverlay
    childrenData?: ResourceChildren
    activity?: ResourceActivity
  }>().props
  // The click shows the dialog from the shell before the page carries it (useOverlayShell).
  const shell = useOverlayShell()
  const overlay = props.overlay ?? shell ?? undefined
  const { childrenData, activity } = props
  useOverlayView(props.overlay)
  // What closing does next: after a create, the list with the new row pinned first.
  const next = useRef<(() => void) | null>(null)
  const dismiss = useRef<(() => void) | null>(null)
  const name = overlay?.resource
  if (!overlay || !name || !(overlay.view || overlay.opening)) return null
  const view = overlay.view as RecordView | undefined
  const record = view?.mode === 'form' ? view.editor.record?.id : view?.result.data.id
  const id = record === undefined || record === null ? overlay.opening?.id : String(record)
  const mode = view
    ? view.mode === 'form'
      ? 'edit'
      : 'view'
    : overlay.opening?.mode === 'show'
      ? 'view'
      : 'edit'
  return (
    // Keyed by the opening, so the dialog that opened stays on screen while its body loads,
    // and saving switches the same dialog from the form to the details.
    <ResourceSurface
      key={`overlay:${name}:${overlay.record}`}
      mode={mode}
      title={view ? recordTitle(view, t) : openingTitle(overlay.opening!, resource, t)}
      description={
        mode === 'edit'
          ? t('أكمل الحقول المطلوبة ثم احفظ السجل.')
          : t('راجع التفاصيل المتاحة لك وأكمل عملك.')
      }
      backHref={overlay.list}
      onClose={() => (next.current ? next.current() : closeRecord(overlay))}
      dismissRef={dismiss}
    >
      {view ? (
        <AfterFirstPaint form={mode === 'edit'}>
          <RecordBody
            view={view}
            childrenData={childrenData}
            activity={activity}
            onSaved={(saved) => {
              if (view.mode === 'form' && view.editor.mode === 'create') {
                // A new record returns to the list, pinned first and highlighted there (owner,
                // 2.3.0); the toast's «عرض» opens it.
                const row = fetchListRow(name, saved)
                next.current = () => void closeCreated(overlay, saved, row)
                dismiss.current?.()
                return
              }
              // A saved edit shows the record's details in the same dialog.
              void openRecord(name, saved, 'show', { replace: true, changed: true })
            }}
            onCancel={() =>
              id === undefined
                ? closeRecord(overlay)
                : void openRecord(name, id, 'show', { replace: true })
            }
            onEdit={() => id !== undefined && void openRecord(name, id, 'edit', { replace: true })}
            onAction={(action) =>
              action === 'delete' || id === undefined
                ? closeRecord({ ...overlay, changed: true })
                : void openRecord(name, id, 'show', { replace: true, changed: true })
            }
          />
        </AfterFirstPaint>
      ) : (
        <RecordLoading form={mode === 'edit'} />
      )}
    </ResourceSurface>
  )
}

export function ResourcePage({
  view,
  result,
  childrenData,
  activity,
  presentation,
}: ResourcePageProps) {
  const { t } = useMessages()
  const name = view.mode === 'form' ? view.editor.name : view.resource.name
  const label = view.mode === 'form' ? view.editor.label : view.resource.label
  const trashed = view.mode === 'index' && view.trashed === true
  const title =
    view.mode === 'index'
      ? trashed
        ? t('المحذوفات · {resource}', { resource: label })
        : label
      : recordTitle(view, t)
  const noun = view.mode === 'index' ? view.resource.recordLabel : null
  const createText =
    view.mode === 'index'
      ? (view.resource.createLabel ??
        (noun ? t('إضافة {record}', { record: noun }) : t('إضافة سجل')))
      : ''
  const canCreate = view.mode === 'index' && view.resource.canCreate && !trashed
  // The create form is the same for every opening: fetched once the list is idle, so «إضافة»
  // opens it complete.
  useEffect(() => {
    if (!canCreate) return
    const idle = window.requestIdleCallback ?? ((run: () => void) => window.setTimeout(run, 200))
    const cancel = window.cancelIdleCallback ?? window.clearTimeout
    const handle = idle(() => prefetchCreate(name))
    return () => cancel(handle)
  }, [canCreate, name])
  return (
    <>
      <Head title={title} />
      {view.mode === 'index' && (
        <div className="mb-8 flex flex-wrap items-start justify-between gap-5">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
            <p className="mt-3 text-sm text-muted-foreground">
              {trashed
                ? t('السجلات المحذوفة ضمن نطاقك؛ استعد ما تحتاجه منها إلى السجلات النشطة.')
                : t('سجلاتك ومتابعتك اليومية في مكان واحد.')}
            </p>
          </div>
          {canCreate && (
            <div className="flex flex-wrap gap-2">
              <ResourceImport resource={name} label={label} />
              <Button asChild>
                <Link
                  href={`/resources/${name}/create`}
                  // The form opens in a dialog over this list, which stays mounted; modified
                  // clicks (new tab, new window) keep the link's own behavior.
                  onPointerEnter={() => prefetchCreate(name)}
                  onFocus={() => prefetchCreate(name)}
                  onClick={(event) => {
                    if (!plainClick(event)) return
                    event.preventDefault()
                    void openCreate(name)
                  }}
                >
                  <Plus size={16} />
                  {createText}
                </Link>
              </Button>
            </div>
          )}
        </div>
      )}
      {view.mode === 'index' ? (
        <>
          {result ? (
            <DataTable
              key={`${name}:${trashed ? 'trash' : 'active'}`}
              resource={view.resource}
              result={result}
              lookups={view.lookups}
              savedViews={view.savedViews}
              trashed={trashed}
              bulkActions={view.bulkActions}
            />
          ) : null}
          <RecordOverlayDialog resource={view.resource} />
        </>
      ) : (
        <ResourceSurface
          // Keyed by record, not mode: saving an edit shows the details in the same dialog.
          key={`${name}:${view.mode === 'form' ? (view.editor.record?.id ?? 'new') : view.result.data.id}`}
          mode={view.mode === 'form' ? 'edit' : 'view'}
          title={title}
          description={
            view.mode === 'form'
              ? t('أكمل الحقول المطلوبة ثم احفظ السجل.')
              : t('راجع التفاصيل المتاحة لك وأكمل عملك.')
          }
          backHref={`/resources/${name}`}
          presentation={presentation}
        >
          <RecordBody view={view} childrenData={childrenData} activity={activity} />
        </ResourceSurface>
      )}
    </>
  )
}
