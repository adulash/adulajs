import { useState, type FormEvent } from 'react'
import { router } from '@inertiajs/react'
import axios from 'axios'
import { Copy, History, KeyRound, Plus, RotateCcw, Trash2 } from 'lucide-react'
import type { InboundDelivery, InboundSource } from 'adula'
import { useDateTimeFormatter } from '~/components/admin-nav'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Switch } from '~/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'
import { ResourceSelect } from '~/components/ui/resource-field'
import { useConfirmAction } from '~/components/ui/confirm-action'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { LongDialogContent } from '~/components/ui/long-dialog'
import { useEntityDialog } from '~/components/ui/dialog_param'

const json = { headers: { Accept: 'application/json' }, withXSRFToken: true }
type Draft = {
  key: string
  name: string
  algorithm: string
  signatureHeader: string
  signaturePrefix: string
  eventHeader: string
  deliveryHeader: string
  dedupeBody: boolean
  active: boolean
}
const blank: Draft = {
  key: '',
  name: '',
  algorithm: 'sha256',
  signatureHeader: 'x-hub-signature-256',
  signaturePrefix: 'sha256=',
  eventHeader: 'x-github-event',
  deliveryHeader: 'x-github-delivery',
  dedupeBody: true,
  active: true,
}

function message(error: unknown, fallback: string) {
  return axios.isAxiosError(error) && error.response?.data?.error?.message
    ? String(error.response.data.error.message)
    : fallback
}

/**
 * Signed inbound webhooks (#30): senders such as a Git host post to the source URL with
 * an HMAC signature; each accepted delivery raises inbound.<key>.<event> for modules.
 */
export function InboundWebhooks({ sources }: { sources: InboundSource[] }) {
  const formatDateTime = useDateTimeFormatter()
  const { confirm, confirmation } = useConfirmAction()
  const [draft, setDraft] = useState<Draft>(blank)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [secret, setSecret] = useState<{ source: InboundSource; value: string } | null>(null)
  const [log, setLog] = useState<{ source: InboundSource; rows: InboundDelivery[] } | null>(null)
  const address = (source: InboundSource) => `${window.location.origin}${source.path}`
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }))
  const reload = () => router.reload({ only: ['inbound'] })
  // `?new-source=1` and `?edit-source=<id>` open the source's dialog (decision 30); the
  // outgoing webhooks on the same page use `new` and `edit`.
  const dialog = useEntityDialog({
    names: { create: 'new-source', edit: 'edit-source' },
    find: (id) => sources.find((source) => String(source.id) === id),
    onOpen: (source) => {
      setError('')
      setDraft(source === 'new' ? blank : { ...source, key: source.key })
    },
  })
  const editing = dialog.item
  const save = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      let created: { source: InboundSource; value: string } | null = null
      if (editing === 'new') {
        const response = await axios.post('/admin/inbound-webhooks', draft, json)
        created = { source: response.data.data.source, value: response.data.data.secret }
      } else if (editing) await axios.put(`/admin/inbound-webhooks/${editing.id}`, draft, json)
      // The list refreshes before the dialog closes, so closing returns to the current rows.
      await new Promise<void>((resolve) =>
        router.reload({ only: ['inbound'], onFinish: () => resolve() })
      )
      dialog.close()
      if (created) setSecret(created)
    } catch (caught) {
      setError(message(caught, 'تعذر حفظ المصدر.'))
    } finally {
      setBusy(false)
    }
  }
  const showLog = async (source: InboundSource) => {
    const response = await axios.get<{ data: InboundDelivery[] }>(
      `/admin/inbound-webhooks/${source.id}/deliveries`,
      json
    )
    setLog({ source, rows: response.data.data })
  }

  return (
    <section aria-labelledby="inbound-title" className="mt-12">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="inbound-title" className="text-xl font-semibold">
            الروابط الواردة
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            يستقبل النظام طلبات موقّعة من الأنظمة الخارجية، ويتحقق من التوقيع، ويسجّل كل استلام مرة
            واحدة ثم يطلق حدثاً تعالجه التطبيقات.
          </p>
        </div>
        <Button variant="outline" onClick={() => dialog.openCreate()}>
          <Plus size={16} />
          إضافة مصدر وارد
        </Button>
      </div>
      <ul className="space-y-3">
        {sources.map((source) => (
          <li
            key={source.id}
            className="flex flex-wrap items-start justify-between gap-3 rounded-xl border bg-card px-5 py-4"
          >
            <div className="min-w-0 flex-1 space-y-1">
              <p className="flex flex-wrap items-center gap-2 font-semibold">
                {source.name}
                <Badge variant={source.active ? 'default' : 'secondary'}>
                  {source.active ? 'يستقبل' : 'متوقف'}
                </Badge>
              </p>
              <p className="truncate text-xs text-muted-foreground" dir="ltr">
                POST {address(source)}
              </p>
              <p className="text-xs text-muted-foreground">
                الحدث: <bdi dir="ltr">inbound.{source.key}.*</bdi> · آخر استلام:{' '}
                {source.lastReceivedAt ? formatDateTime(source.lastReceivedAt) : 'لا يوجد'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => showLog(source)}>
                <History size={14} />
                المستلمات
              </Button>
              <Button size="sm" variant="outline" onClick={() => dialog.openEdit(source.id)}>
                تعديل
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  confirm({
                    title: 'تدوير مفتاح التوقيع؟',
                    description: `يتوقف المفتاح الحالي لـ${source.name} فوراً. حدّثه عند المرسل بعد ذلك.`,
                    action: async () => {
                      const response = await axios.post(
                        `/admin/inbound-webhooks/${source.id}/rotate`,
                        {},
                        json
                      )
                      setSecret({ source, value: response.data.data.secret })
                    },
                  })
                }
              >
                <KeyRound size={14} />
                تدوير المفتاح
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`حذف ${source.name}`}
                onClick={() =>
                  confirm({
                    title: 'حذف المصدر؟',
                    description: `سيُحذف ${source.name} وسجل مستلماته، وتُرفض طلباته بعد ذلك.`,
                    destructive: true,
                    action: async () => {
                      await axios.delete(`/admin/inbound-webhooks/${source.id}`, json)
                      reload()
                    },
                  })
                }
              >
                <Trash2 size={14} />
              </Button>
            </div>
          </li>
        ))}
        {sources.length === 0 && (
          <li className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">
            لا مصادر واردة بعد.
          </li>
        )}
      </ul>

      <Dialog
        open={editing !== null}
        onOpenChange={(value) => !value && dialog.close()}
        value={draft}
      >
        <LongDialogContent
          dir="rtl"
          width="2xl"
          title={editing === 'new' ? 'إضافة مصدر وارد' : 'تعديل المصدر'}
          description="القيم الافتراضية تناسب GitHub. غيّر الترويسات لمرسل يستخدم أسماء أخرى."
          footer={
            <>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  إلغاء
                </Button>
              </DialogClose>
              <Button type="submit" form="inbound-form" disabled={busy}>
                حفظ
              </Button>
            </>
          }
        >
          <form id="inbound-form" className="grid gap-4 sm:grid-cols-2" onSubmit={save}>
            <div className="space-y-2">
              <Label htmlFor="inbound-name">الاسم</Label>
              <Input
                id="inbound-name"
                value={draft.name}
                maxLength={100}
                onChange={(event) => set({ name: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="inbound-key">المفتاح في العنوان</Label>
              <Input
                id="inbound-key"
                dir="ltr"
                placeholder="github"
                value={draft.key}
                disabled={editing !== 'new'}
                onChange={(event) => set({ key: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="inbound-algorithm">خوارزمية التوقيع</Label>
              <ResourceSelect
                id="inbound-algorithm"
                value={draft.algorithm}
                options={[
                  { value: 'sha256', label: 'HMAC-SHA256' },
                  { value: 'sha512', label: 'HMAC-SHA512' },
                ]}
                onChange={(algorithm) => set({ algorithm })}
              />
            </div>
            {(
              [
                ['signatureHeader', 'ترويسة التوقيع'],
                ['signaturePrefix', 'بادئة التوقيع'],
                ['eventHeader', 'ترويسة نوع الحدث'],
                ['deliveryHeader', 'ترويسة معرّف الاستلام'],
              ] as const
            ).map(([field, label]) => (
              <div key={field} className="space-y-2">
                <Label htmlFor={`inbound-${field}`}>{label}</Label>
                <Input
                  id={`inbound-${field}`}
                  dir="ltr"
                  value={draft[field]}
                  onChange={(event) => set({ [field]: event.target.value })}
                />
              </div>
            ))}
            <div className="flex items-start gap-3 sm:col-span-2">
              <Switch
                id="inbound-dedupe"
                checked={draft.dedupeBody}
                onCheckedChange={(dedupeBody) => set({ dedupeBody })}
              />
              <div className="space-y-1">
                <Label htmlFor="inbound-dedupe">رفض المحتوى المكرر</Label>
                <p className="text-xs text-muted-foreground">
                  يرفض أي محتوى سبق استلامه من هذا المصدر ولو بمعرّف استلام آخر، لأن المرسل يوقّع
                  المحتوى وحده. أوقفه فقط إن كان المرسل يعيد المحتوى نفسه لأحداث مختلفة.
                </p>
              </div>
            </div>
            {editing !== 'new' && (
              <div className="flex items-center gap-3">
                <Switch
                  id="inbound-active"
                  checked={draft.active}
                  onCheckedChange={(active) => set({ active })}
                />
                <Label htmlFor="inbound-active">يستقبل</Label>
              </div>
            )}
            {error && (
              <p
                role="alert"
                className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive sm:col-span-2"
              >
                {error}
              </p>
            )}
          </form>
        </LongDialogContent>
      </Dialog>

      <Dialog open={secret !== null} onOpenChange={(value) => !value && setSecret(null)}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>مفتاح التوقيع للمرسل</DialogTitle>
            <DialogDescription>
              انسخ المفتاح الآن وضعه عند المرسل مع العنوان أدناه؛ لن يظهر مرة أخرى. اختر نوع المحتوى{' '}
              <bdi dir="ltr">application/json</bdi> عند المرسل، فالصيغة الافتراضية في GitHub لا
              تُقبل.
            </DialogDescription>
          </DialogHeader>
          {secret && (
            <div className="space-y-2">
              <code dir="ltr" className="block break-all rounded-lg bg-muted px-3 py-2 text-xs">
                {address(secret.source)}
              </code>
              <code dir="ltr" className="block break-all rounded-lg bg-muted px-3 py-2 text-xs">
                {secret.value}
              </code>
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => secret && navigator.clipboard?.writeText(secret.value)}
            >
              <Copy size={14} />
              نسخ المفتاح
            </Button>
            <Button type="button" onClick={() => setSecret(null)}>
              تم
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog mode="view" open={log !== null} onOpenChange={(value) => !value && setLog(null)}>
        <LongDialogContent
          dir="rtl"
          width="3xl"
          title="المستلمات"
          description={log?.source.name}
          footer={
            <DialogClose asChild>
              <Button type="button" variant="outline">
                إغلاق
              </Button>
            </DialogClose>
          }
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الحدث</TableHead>
                <TableHead>معرّف الاستلام</TableHead>
                <TableHead>الوقت</TableHead>
                <TableHead>الإطلاق</TableHead>
                <TableHead>
                  <span className="sr-only">إجراء</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {log?.rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell dir="ltr">{row.eventName}</TableCell>
                  <TableCell className="max-w-48 truncate text-xs" dir="ltr">
                    {row.deliveryId}
                  </TableCell>
                  <TableCell className="text-xs">{formatDateTime(row.receivedAt)}</TableCell>
                  <TableCell className="tabular-nums">{row.dispatches}</TableCell>
                  <TableCell>
                    {log && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          await axios.post(
                            `/admin/inbound-webhooks/deliveries/${row.id}/redispatch`,
                            {},
                            json
                          )
                          await showLog(log.source)
                        }}
                      >
                        <RotateCcw size={13} />
                        إعادة الإطلاق
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {log?.rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                    لا مستلمات بعد.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </LongDialogContent>
      </Dialog>
      {confirmation}
    </section>
  )
}
