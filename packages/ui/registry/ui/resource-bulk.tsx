import { useEffect, useState } from 'react'
import axios from 'axios'
import { toast } from 'sonner'
import { CircleAlert, CircleCheck, X } from 'lucide-react'
import type { SerializedRecord } from 'adula'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { failureMessage } from '~/components/ui/resource-actions'
import { useMessages } from '~/components/ui/messages'
import { relationLabel } from '~/components/ui/resource-value'
import { BULK_LIMIT, bulkPayload } from '~/components/ui/list_query'

/** An action offered by `GET /resources/:name/bulk` (the server's BulkActionOption). */
export type BulkAction = {
  key: string
  label?: string | null
  confirm?: string | null
  builtIn?: boolean
  /** `trash` actions (restore) belong to «المحذوفات»; `records` to the active list. */
  scope?: 'records' | 'trash'
  destructive?: boolean
}
export type BulkFailure = {
  id: number | string
  code?: string
  message: string
}
export type BulkResult = {
  succeeded: (number | string)[]
  failed: BulkFailure[]
}

const builtInLabels: Record<string, string> = {
  delete: 'حذف',
  restore: 'استعادة',
  submit: 'اعتماد',
  cancel: 'إلغاء المستند',
}
const builtInDescriptions: Record<string, string> = {
  delete: 'سيُحذف {count} سجل محدد ويُخفى من القوائم.',
  restore: 'سيُستعاد {count} سجل محذوف إلى السجلات النشطة.',
  submit: 'سيُعتمد {count} مستند محدد ولن يمكن تعديله بعد الاعتماد.',
  cancel: 'سيُلغى اعتماد {count} مستند محدد ولن يُحتسب.',
}

const asList = (data: unknown): BulkAction[] => {
  const list = Array.isArray(data) ? data : (data as { data?: unknown } | null)?.data
  return Array.isArray(list)
    ? list.filter(
        (entry): entry is BulkAction =>
          Boolean(entry) && typeof (entry as BulkAction).key === 'string'
      )
    : []
}

/** Whether an action belongs to the active list or to «المحذوفات». */
export function actionScope(action: BulkAction) {
  return action.scope ?? (action.key === 'restore' ? 'trash' : 'records')
}

/** Loads the bulk actions the actor may offer; refusals and failures mean none. */
export function useBulkActions(resource: string, enabled = true) {
  const [actions, setActions] = useState<BulkAction[]>([])
  useEffect(() => {
    let live = true
    if (!enabled) {
      setActions([])
      return
    }
    axios
      .get(`/resources/${resource}/bulk`, {
        headers: { Accept: 'application/json' },
      })
      .then((response) => live && setActions(asList(response.data)))
      .catch(() => live && setActions([]))
    return () => {
      live = false
    }
  }, [resource, enabled])
  return actions
}

/**
 * The sticky bar of a selection: one button per offered action, each confirmed in a Dialog
 * that then shows which rows succeeded and which were refused, with the server's message.
 */
export function BulkBar({
  resource,
  actions,
  selected,
  rows,
  onClear,
  onDone,
}: {
  resource: string
  actions: BulkAction[]
  selected: string[]
  rows: SerializedRecord[]
  onClear: () => void
  onDone: (result: BulkResult) => void
}) {
  const { t } = useMessages()
  const [pending, setPending] = useState<BulkAction | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  const [result, setResult] = useState<BulkResult | null>(null)
  const [ids, setIds] = useState<string[]>([])
  const over = selected.length > BULK_LIMIT
  const name = (action: BulkAction) =>
    action.label ? action.label : t(builtInLabels[action.key] ?? action.key)
  const describe = (action: BulkAction, count: number) =>
    action.confirm
      ? action.confirm
      : builtInDescriptions[action.key]
        ? t(builtInDescriptions[action.key], { count })
        : t('سيُنفذ الإجراء «{action}» على {count} سجل محدد.', {
            action: name(action),
            count,
          })
  const destructive = (action: BulkAction) => action.destructive ?? action.key === 'delete'
  const titles = new Map(rows.map((row) => [String(row.id), relationLabel(row, row.id)]))
  const execute = async () => {
    if (!pending) return
    setBusy(true)
    setFailure('')
    try {
      const response = await axios.post<{ data: BulkResult }>(
        `/resources/${resource}/bulk`,
        bulkPayload(pending.key, ids, rows),
        { headers: { Accept: 'application/json' }, withXSRFToken: true }
      )
      const outcome = response.data.data
      setResult(outcome)
      if (!outcome.failed.length)
        toast.success(t('نُفذ على {count} سجل', { count: outcome.succeeded.length }))
    } catch (error) {
      setFailure(failureMessage(error, t('تعذر تنفيذ الإجراء. تحقق من صلاحياتك وحاول مجدداً.'), t))
    } finally {
      setBusy(false)
    }
  }
  // The list refreshes once the summary is closed: a refresh remounts the page, which would
  // otherwise dismiss the summary before it is read.
  const close = () => {
    if (busy) return
    if (result) onDone(result)
    setPending(null)
    setResult(null)
    setFailure('')
  }
  if (!selected.length && !pending) return null
  return (
    <>
      {selected.length > 0 && (
        <div
          role="region"
          aria-label={t('الإجراءات الجماعية')}
          className="sticky top-0 z-20 flex flex-wrap items-center gap-2 border-b bg-accent px-5 py-2.5 text-sm"
        >
          <span className="font-medium tabular-nums">
            {t('تم تحديد {count}', { count: selected.length })}
          </span>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onClear}>
            <X size={13} />
            {t('إلغاء التحديد')}
          </Button>
          <span className="ms-auto flex flex-wrap items-center gap-2">
            {over && (
              <span className="text-xs text-destructive">
                {t('يمكن تنفيذ الإجراء على {count} سجل كحد أقصى في كل مرة.', {
                  count: BULK_LIMIT,
                })}
              </span>
            )}
            {actions.map((action) => (
              <Button
                key={action.key}
                type="button"
                size="sm"
                variant="outline"
                disabled={over}
                className={`h-8 bg-background ${destructive(action) ? 'text-destructive' : ''}`}
                onClick={() => {
                  setIds(selected)
                  setResult(null)
                  setFailure('')
                  setPending(action)
                }}
              >
                {name(action)}
              </Button>
            ))}
          </span>
        </div>
      )}
      <Dialog open={pending !== null} onOpenChange={(open) => !open && close()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{pending ? name(pending) : ''}</DialogTitle>
            <DialogDescription>
              {pending ? describe(pending, ids.length) : ''}{' '}
              {!result && t('يُتحقق من صلاحيتك لكل سجل على حدة.')}
            </DialogDescription>
          </DialogHeader>
          {result && (
            <div className="grid gap-3">
              {result.succeeded.length > 0 && (
                <Alert>
                  <CircleCheck />
                  <AlertTitle>
                    {t('نُفذ على {count} سجل', {
                      count: result.succeeded.length,
                    })}
                  </AlertTitle>
                </Alert>
              )}
              {result.failed.length > 0 && (
                <Alert variant="destructive">
                  <CircleAlert />
                  <AlertTitle>
                    {t('تعذر تنفيذ الإجراء على {count} سجل', {
                      count: result.failed.length,
                    })}
                  </AlertTitle>
                  <AlertDescription>
                    <ul className="max-h-48 w-full space-y-1 overflow-y-auto text-xs">
                      {result.failed.map((entry) => (
                        <li key={String(entry.id)}>
                          <span className="font-medium">
                            {titles.get(String(entry.id)) ?? `#${entry.id}`}
                          </span>{' '}
                          <span dir="ltr" className="tabular-nums">
                            (#{entry.id})
                          </span>
                          {t('، ')}
                          {entry.message}
                        </li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}
          {failure && (
            <p role="alert" className="text-sm text-destructive">
              {failure}
            </p>
          )}
          <DialogFooter>
            {result ? (
              <Button type="button" onClick={close}>
                {t('إغلاق')}
              </Button>
            ) : (
              <>
                <Button type="button" variant="outline" disabled={busy} onClick={close}>
                  {t('تراجع')}
                </Button>
                <Button
                  type="button"
                  variant={pending && destructive(pending) ? 'destructive' : 'default'}
                  disabled={busy}
                  onClick={() => void execute()}
                >
                  {busy ? t('جارٍ التنفيذ...') : t('تأكيد')}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** «استعادة» of one deleted record, confirmed in a Dialog; restore is authorized by delete. */
export function RestoreAction({
  resource,
  id,
  version,
  label,
  onDone,
}: {
  resource: string
  id: string
  version?: unknown
  label: string
  onDone: () => void
}) {
  const { t } = useMessages()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  const restore = async () => {
    setBusy(true)
    setFailure('')
    try {
      await axios.post(
        `/resources/${resource}/${id}/restore`,
        version === undefined || version === null ? {} : { version },
        { headers: { Accept: 'application/json' }, withXSRFToken: true }
      )
      toast.success(t('تمت استعادة السجل'))
      setOpen(false)
      onDone()
    } catch (error) {
      setFailure(failureMessage(error, t('تعذر استعادة السجل. تحقق من صلاحياتك وحاول مجدداً.'), t))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={t('استعادة {record}', { record: label })}
        onClick={() => {
          setFailure('')
          setOpen(true)
        }}
      >
        {t('استعادة')}
      </Button>
      <Dialog open={open} onOpenChange={(next) => !next && !busy && setOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('استعادة السجل')}</DialogTitle>
            <DialogDescription>
              {t('سيعود {record} إلى السجلات النشطة ويظهر في القوائم.', {
                record: label,
              })}
            </DialogDescription>
          </DialogHeader>
          {failure && (
            <p role="alert" className="text-sm text-destructive">
              {failure}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>
              {t('تراجع')}
            </Button>
            <Button type="button" disabled={busy} onClick={() => void restore()}>
              {busy ? t('جارٍ التنفيذ...') : t('استعادة')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
