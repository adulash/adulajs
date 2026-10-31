import { useState, type ReactElement } from 'react'
import { Head, router } from '@inertiajs/react'
import axios from 'axios'
import { Copy, History, Plus, RotateCcw, Trash2 } from 'lucide-react'
import type { InboundSource, Webhook, WebhookDelivery } from 'adula'
import { InboundWebhooks } from '~/components/inbound-webhooks'
import Workspace from '~/layouts/workspace'
import { useDateTimeFormatter } from '~/components/admin-nav'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Switch } from '~/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'

type EventOption = { key: string; resource: string; verb: string }
type Props = { webhooks: Webhook[]; events: EventOption[]; inbound: InboundSource[] }

const json = { headers: { Accept: 'application/json' }, withXSRFToken: true }
const verbs: Record<string, string> = {
  created: 'إنشاء',
  updated: 'تعديل',
  deleted: 'حذف',
  submitted: 'اعتماد',
  cancelled: 'إلغاء',
  amended: 'تعديل بالنسخ',
}
const deliveryLabel: Record<WebhookDelivery['status'], string> = {
  pending: 'بانتظار الإرسال',
  delivered: 'سُلّم',
  failed: 'فشل',
}
const errorLabel: Record<string, string> = {
  'dns': 'تعذّر العثور على العنوان',
  'connect': 'تعذّر الاتصال',
  'tls': 'خطأ في شهادة الاتصال الآمن',
  'timeout': 'انتهت مهلة الاتصال',
  'blocked-target': 'العنوان غير مسموح',
  'secret': 'تعذّر فتح مفتاح التوقيع',
}

/** Stored delivery errors are categories; older rows may still hold free text. */
function deliveryError(error: string | null) {
  if (!error) return '—'
  const status = error.match(/^http-status:(\d+)$/)
  if (status) return `استجابة HTTP ${status[1]}`
  return errorLabel[error] ?? error
}

function message(error: unknown, fallback: string) {
  return axios.isAxiosError(error) && error.response?.data?.error?.message
    ? String(error.response.data.error.message)
    : fallback
}

export default function WebhooksIndex({ webhooks, events, inbound }: Props) {
  const formatDateTime = useDateTimeFormatter()
  const [editing, setEditing] = useState<Webhook | 'new' | null>(null)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [active, setActive] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [secret, setSecret] = useState<string | null>(null)
  const [log, setLog] = useState<{ webhook: Webhook; rows: WebhookDelivery[] } | null>(null)

  const open = (webhook: Webhook | 'new') => {
    setEditing(webhook)
    setError('')
    setName(webhook === 'new' ? '' : webhook.name)
    setUrl(webhook === 'new' ? 'https://' : webhook.url)
    setSelected(webhook === 'new' ? [] : webhook.events)
    setActive(webhook === 'new' ? true : webhook.active)
  }
  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (editing === 'new') {
        const response = await axios.post(
          '/admin/webhooks',
          { name, url, events: selected },
          json
        )
        setSecret(response.data.data.secret)
      } else if (editing) {
        await axios.put(
          `/admin/webhooks/${editing.id}`,
          { name, url, events: selected, active },
          json
        )
      }
      setEditing(null)
      router.reload({ only: ['webhooks'] })
    } catch (caught) {
      setError(message(caught, 'تعذر حفظ الربط.'))
    } finally {
      setBusy(false)
    }
  }
  const showLog = async (webhook: Webhook) => {
    const response = await axios.get<{ data: WebhookDelivery[] }>(
      `/admin/webhooks/${webhook.id}/deliveries`,
      json
    )
    setLog({ webhook, rows: response.data.data })
  }
  return (
    <>
      <Head title="الربط الخارجي" />
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">الربط الخارجي</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Webhooks موقّعة بـ HMAC تُرسل عند وقوع الأحداث، وتُعاد المحاولة تلقائياً عند الفشل.
          </p>
        </div>
        <Button onClick={() => open('new')}>
          <Plus size={16} />
          إضافة ربط
        </Button>
      </div>
      <ul className="space-y-3">
        {webhooks.map((webhook) => (
          <li
            key={webhook.id}
            className="flex flex-wrap items-start justify-between gap-3 rounded-xl border bg-white px-5 py-4"
          >
            <div className="min-w-0 flex-1 space-y-1">
              <p className="flex flex-wrap items-center gap-2 font-semibold">
                {webhook.name}
                <Badge variant={webhook.active ? 'default' : 'secondary'}>
                  {webhook.active ? 'مفعّل' : 'متوقف'}
                </Badge>
                {webhook.failing > 0 && (
                  <Badge variant="outline" className="border-red-300 text-red-800">
                    {webhook.failing} فشل نهائي
                  </Badge>
                )}
              </p>
              <p className="truncate text-xs text-muted-foreground" dir="ltr">
                {webhook.url}
              </p>
              <p className="text-xs text-muted-foreground">
                {webhook.events.length} حدث · آخر تسليم:{' '}
                {webhook.lastDeliveryAt ? formatDateTime(webhook.lastDeliveryAt) : 'لا يوجد'}
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => showLog(webhook)}>
                <History size={14} />
                المحاولات
              </Button>
              <Button size="sm" variant="outline" onClick={() => open(webhook)}>
                تعديل
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`حذف ${webhook.name}`}
                onClick={async () => {
                  await axios.delete(`/admin/webhooks/${webhook.id}`, json)
                  router.reload({ only: ['webhooks'] })
                }}
              >
                <Trash2 size={14} />
              </Button>
            </div>
          </li>
        ))}
        {webhooks.length === 0 && (
          <li className="rounded-xl border border-dashed p-12 text-center text-muted-foreground">
            لا يوجد ربط خارجي بعد.
          </li>
        )}
      </ul>
      <InboundWebhooks sources={inbound} />

      <Dialog open={editing !== null} onOpenChange={(value) => !value && setEditing(null)}>
        <DialogContent dir="rtl" className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing === 'new' ? 'إضافة ربط خارجي' : 'تعديل الربط'}</DialogTitle>
            <DialogDescription>
              يُرسل النظام طلب POST بصيغة JSON يحمل نوع الحدث ومعرّف السجل فقط.
            </DialogDescription>
          </DialogHeader>
          <form id="webhook-form" className="space-y-4" onSubmit={save}>
            <div className="space-y-2">
              <Label htmlFor="webhook-name">الاسم</Label>
              <Input
                id="webhook-name"
                value={name}
                maxLength={100}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="webhook-url">عنوان الاستقبال</Label>
              <Input
                id="webhook-url"
                dir="ltr"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
              />
            </div>
            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-medium">الأحداث</legend>
              <div className="grid max-h-56 gap-2 overflow-y-auto rounded-lg border p-3 sm:grid-cols-2">
                {events.map((option) => (
                  <label key={option.key} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={selected.includes(option.key)}
                      onCheckedChange={(checked) =>
                        setSelected((current) =>
                          checked
                            ? [...current, option.key]
                            : current.filter((key) => key !== option.key)
                        )
                      }
                    />
                    {option.resource}: {verbs[option.verb] ?? option.verb}
                  </label>
                ))}
              </div>
            </fieldset>
            {editing !== 'new' && (
              <div className="flex items-center gap-3">
                <Switch id="webhook-active" checked={active} onCheckedChange={setActive} />
                <Label htmlFor="webhook-active">مفعّل</Label>
              </div>
            )}
            {error && (
              <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">
                {error}
              </p>
            )}
          </form>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditing(null)}>
              إلغاء
            </Button>
            <Button type="submit" form="webhook-form" disabled={busy}>
              حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={secret !== null} onOpenChange={(value) => !value && setSecret(null)}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>مفتاح التوقيع</DialogTitle>
            <DialogDescription>
              انسخ المفتاح الآن؛ لن يظهر مرة أخرى. تحقّق من الترويسة X-Adula-Signature بحساب
              HMAC-SHA256 على «الطابع الزمني.النص».
            </DialogDescription>
          </DialogHeader>
          <code dir="ltr" className="block break-all rounded-lg bg-muted px-3 py-2 text-xs">
            {secret}
          </code>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => secret && navigator.clipboard?.writeText(secret)}
            >
              <Copy size={14} />
              نسخ
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
            <DialogTitle>سجل المحاولات</DialogTitle>
            <DialogDescription>{log?.webhook.name}</DialogDescription>
          </DialogHeader>
          <div className="max-h-96 overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-start font-medium">الحدث</th>
                  <th className="px-3 py-2 text-start font-medium">الحالة</th>
                  <th className="px-3 py-2 text-start font-medium">المحاولات</th>
                  <th className="px-3 py-2 text-start font-medium">آخر خطأ</th>
                  <th className="px-3 py-2">
                    <span className="sr-only">إجراء</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {log?.rows.map((row) => (
                  <tr key={row.id} className="border-b last:border-0">
                    <td className="px-3 py-2" dir="ltr">
                      {row.event}
                    </td>
                    <td className="px-3 py-2">{deliveryLabel[row.status]}</td>
                    <td className="px-3 py-2 tabular-nums">{row.attempts}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {deliveryError(row.lastError)}
                    </td>
                    <td className="px-3 py-2">
                      {row.status === 'failed' && log && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            await axios.post(`/admin/webhooks/deliveries/${row.id}/retry`, {}, json)
                            await showLog(log.webhook)
                          }}
                        >
                          <RotateCcw size={13} />
                          إعادة
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
                {log?.rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                      لا محاولات بعد.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
WebhooksIndex.layout = (page: ReactElement) => <Workspace>{page}</Workspace>
