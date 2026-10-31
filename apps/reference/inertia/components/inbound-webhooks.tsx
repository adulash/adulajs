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
import { ResourceSelect } from '~/components/ui/resource-field'
import { useConfirmAction } from '~/components/ui/confirm-action'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'

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
  const [editing, setEditing] = useState<InboundSource | 'new' | null>(null)
  const [draft, setDraft] = useState<Draft>(blank)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [secret, setSecret] = useState<{ source: InboundSource; value: string } | null>(null)
  const [log, setLog] = useState<{ source: InboundSource; rows: InboundDelivery[] } | null>(null)
  const address = (source: InboundSource) => `${window.location.origin}${source.path}`
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }))
  const reload = () => router.reload({ only: ['inbound'] })

  const open = (source: InboundSource | 'new') => {
    setEditing(source)
    setError('')
    setDraft(source === 'new' ? blank : { ...source, key: source.key })
  }
  const save = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (editing === 'new') {
        const response = await axios.post('/admin/inbound-webhooks', draft, json)
        setSecret({ source: response.data.data.source, value: response.data.data.secret })
      } else if (editing) await axios.put(`/admin/inbound-webhooks/${editing.id}`, draft, json)
      setEditing(null)
      reload()
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
            يستقبل النظام طلبات موقّعة من الأنظمة الخارجية، ويتحقق من التوقيع، ويسجّل كل استلام
            مرة واحدة ثم يطلق حدثاً تعالجه التطبيقات.
          </p>
        </div>
        <Button variant="outline" onClick={() => open('new')}>
          <Plus size={16} />
          إضافة مصدر وارد
        </Button>
      </div>
      <ul className="space-y-3">
        {sources.map((source) => (
          <li
            key={source.id}
            className="flex flex-wrap items-start justify-between gap-3 rounded-xl border bg-white px-5 py-4"
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
              <Button size="sm" variant="outline" onClick={() => open(source)}>
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

      <Dialog open={editing !== null} onOpenChange={(value) => !value && setEditing(null)}>
        <DialogContent dir="rtl" className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing === 'new' ? 'إضافة مصدر وارد' : 'تعديل المصدر'}</DialogTitle>
            <DialogDescription>
              القيم الافتراضية تناسب GitHub. غيّر الترويسات لمرسل يستخدم أسماء أخرى.
            </DialogDescription>
          </DialogHeader>
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
                className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800 sm:col-span-2"
              >
                {error}
              </p>
            )}
          </form>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditing(null)}>
              إلغاء
            </Button>
            <Button type="submit" form="inbound-form" disabled={busy}>
              حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={secret !== null} onOpenChange={(value) => !value && setSecret(null)}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>مفتاح التوقيع للمرسل</DialogTitle>
            <DialogDescription>
              انسخ المفتاح الآن وضعه عند المرسل مع العنوان أدناه؛ لن يظهر مرة أخرى. اختر نوع
              المحتوى <bdi dir="ltr">application/json</bdi> عند المرسل، فالصيغة الافتراضية في
              GitHub لا تُقبل.
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

      <Dialog open={log !== null} onOpenChange={(value) => !value && setLog(null)}>
        <DialogContent dir="rtl" className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>المستلمات</DialogTitle>
            <DialogDescription>{log?.source.name}</DialogDescription>
          </DialogHeader>
          <div className="max-h-96 overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-start font-medium">الحدث</th>
                  <th className="px-3 py-2 text-start font-medium">معرّف الاستلام</th>
                  <th className="px-3 py-2 text-start font-medium">الوقت</th>
                  <th className="px-3 py-2 text-start font-medium">الإطلاق</th>
                  <th className="px-3 py-2">
                    <span className="sr-only">إجراء</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {log?.rows.map((row) => (
                  <tr key={row.id} className="border-b last:border-0">
                    <td className="px-3 py-2" dir="ltr">
                      {row.eventName}
                    </td>
                    <td className="max-w-48 truncate px-3 py-2 text-xs" dir="ltr">
                      {row.deliveryId}
                    </td>
                    <td className="px-3 py-2 text-xs">{formatDateTime(row.receivedAt)}</td>
                    <td className="px-3 py-2 tabular-nums">{row.dispatches}</td>
                    <td className="px-3 py-2">
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
                    </td>
                  </tr>
                ))}
                {log?.rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                      لا مستلمات بعد.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>
      {confirmation}
    </section>
  )
}
