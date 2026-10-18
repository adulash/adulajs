import { Head, usePage } from '@inertiajs/react'
import { Link } from '@adonisjs/inertia/react'
import { Plus } from 'lucide-react'
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
import { DataTable } from '~/components/ui/data-table'
import { ResourceForm } from '~/components/ui/resource-form'
import { ResourceShow } from '~/components/ui/resource-show'
import { ResourceImport } from '~/components/ui/resource-import'
import {
  ResourceSurface,
  closeRecord,
  openRecord,
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

export function ResourcePage({
  view,
  result,
  childrenData,
  activity,
  presentation,
}: ResourcePageProps) {
  // A record opened over this list by openRecord(); a client-only prop, never sent by the server.
  const overlay = usePage<{ overlay?: RecordOverlay }>().props.overlay
  const { t } = useMessages()
  const name = view.mode === 'form' ? view.editor.name : view.resource.name
  const label = view.mode === 'form' ? view.editor.label : view.resource.label
  const title = view.mode === 'index' ? label : recordTitle(view, t)
  const noun = view.mode === 'index' ? view.resource.recordLabel : null
  const createText =
    view.mode === 'index'
      ? (view.resource.createLabel ??
        (noun ? t('إضافة {record}', { record: noun }) : t('إضافة سجل')))
      : ''
  const overlayView = view.mode === 'index' ? (overlay?.view as RecordView | undefined) : undefined
  const overlayRecord =
    overlayView?.mode === 'form' ? overlayView.editor.record?.id : overlayView?.result.data.id
  const overlayId =
    overlayRecord === undefined || overlayRecord === null ? undefined : String(overlayRecord)
  return (
    <>
      <Head title={title} />
      {view.mode === 'index' && (
        <div className="mb-8 flex flex-wrap items-start justify-between gap-5">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
            <p className="mt-3 text-sm text-muted-foreground">
              {t('سجلاتك ومتابعتك اليومية في مكان واحد.')}
            </p>
          </div>
          {view.mode === 'index' && view.resource.canCreate && (
            <div className="flex flex-wrap gap-2">
              <ResourceImport resource={name} label={label} />
              <Button asChild>
                <Link href={`/resources/${name}/create`}>
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
              key={name}
              resource={view.resource}
              result={result}
              lookups={view.lookups}
              savedViews={view.savedViews}
            />
          ) : null}
          {overlay && overlayView && overlayId !== undefined && (
            // Keyed by record, so saving an edit switches the same dialog to the details.
            <ResourceSurface
              key={`overlay:${name}:${overlayId}`}
              mode={overlayView.mode === 'form' ? 'edit' : 'view'}
              title={recordTitle(overlayView, t)}
              description={
                overlayView.mode === 'form'
                  ? t('أكمل الحقول المطلوبة ثم احفظ السجل.')
                  : t('راجع التفاصيل المتاحة لك وأكمل عملك.')
              }
              backHref={overlay.list}
              onClose={() => closeRecord(overlay)}
            >
              <RecordBody
                view={overlayView}
                childrenData={childrenData}
                activity={activity}
                onSaved={(id) =>
                  void openRecord(name, id, 'show', { replace: true, changed: true })
                }
                onCancel={() => void openRecord(name, overlayId, 'show', { replace: true })}
                onEdit={() => void openRecord(name, overlayId, 'edit', { replace: true })}
                onAction={(action) =>
                  action === 'delete'
                    ? closeRecord({ ...overlay, changed: true })
                    : void openRecord(name, overlayId, 'show', { replace: true, changed: true })
                }
              />
            </ResourceSurface>
          )}
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
