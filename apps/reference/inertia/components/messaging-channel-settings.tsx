import { useState, type FormEvent } from 'react'
import { router } from '@inertiajs/react'
import axios from 'axios'
import { toast } from 'sonner'
import { Copy, KeyRound, MessageSquareText, Send, Settings2 } from 'lucide-react'
import type { HttpChannelConfig, HttpChannelKind } from 'adula'
import { useConfirmAction } from '~/components/ui/confirm-action'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { RadioGroup, RadioGroupItem } from '~/components/ui/radio-group'
import { Switch } from '~/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { failure, json } from '~/components/account/request'

/** Settings page prop `messagingChannel` (HttpChannelSettings.read); null until configured. */
export type MessagingChannelProps = HttpChannelConfig | null
type Draft = { enabled: boolean; kind: HttpChannelKind; url: string }

const KINDS: [HttpChannelKind, string][] = [
  ['sms', 'رسالة نصية'],
  ['whatsapp', 'واتساب'],
]
const kindLabel = (kind: HttpChannelKind) => KINDS.find(([value]) => value === kind)?.[1] ?? kind
const reload = () => router.reload({ only: ['messagingChannel'] })

export function MessagingChannelSettings({ channel }: { channel: MessagingChannelProps }) {
  const { confirm, confirmation } = useConfirmAction()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [testing, setTesting] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!draft) return
    setBusy(true)
    setError('')
    try {
      const response = await axios.put('/admin/settings/channels', draft, json)
      setDraft(null)
      if (response.data.data.secret) setSecret(response.data.data.secret)
      else toast.success('تم حفظ قناة الرسائل.')
      reload()
    } catch (caught) {
      setError(failure(caught, 'تعذر حفظ قناة الرسائل.'))
    } finally {
      setBusy(false)
    }
  }

  const sendTest = async (event: FormEvent) => {
    event.preventDefault()
    if (testing === null) return
    setBusy(true)
    setError('')
    try {
      const response = await axios.post('/admin/settings/channels/test', { to: testing }, json)
      if (response.data.data.sent) {
        toast.success('قبل المزوّد الرسالة التجريبية.')
        setTesting(null)
      } else setError(`رفض المزوّد الرسالة أو تعذر الوصول إليه (${response.data.data.error}).`)
    } catch (caught) {
      setError(failure(caught, 'تعذر إرسال الرسالة التجريبية.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquareText size={16} />
          قناة الرسائل النصية
        </CardTitle>
        <CardDescription>
          مزوّد HTTP يرسل الإشعارات المهمة برسالة نصية أو واتساب إلى من فعّل القناة برقم هاتفه.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {channel ? (
          <dl className="grid gap-3 rounded-lg border px-4 py-3 text-sm sm:grid-cols-3">
            <div className="space-y-1">
              <dt className="text-xs text-muted-foreground">الحالة</dt>
              <dd>
                {channel.enabled ? (
                  <Badge>مفعّلة</Badge>
                ) : (
                  <Badge variant="outline">موقوفة</Badge>
                )}
              </dd>
            </div>
            <div className="space-y-1">
              <dt className="text-xs text-muted-foreground">النوع</dt>
              <dd>{kindLabel(channel.kind)}</dd>
            </div>
            <div className="space-y-1">
              <dt className="text-xs text-muted-foreground">عنوان المزوّد</dt>
              <dd dir="ltr" className="truncate text-end font-mono text-xs">
                {channel.url}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            لم تُضبط القناة بعد؛ تصل الإشعارات داخل التطبيق وبالبريد فقط.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setError('')
              setDraft(
                channel
                  ? { enabled: channel.enabled, kind: channel.kind, url: channel.url }
                  : { enabled: true, kind: 'sms', url: '' }
              )
            }}
          >
            <Settings2 size={14} />
            {channel ? 'تعديل القناة' : 'ضبط القناة'}
          </Button>
          {channel && (
            <>
              <Button
                variant="outline"
                onClick={() =>
                  confirm({
                    title: 'تدوير سر التوقيع؟',
                    description: 'يتوقف السر الحالي فوراً؛ حدّثه عند المزوّد بعد ذلك.',
                    action: async () => {
                      const response = await axios.post('/admin/settings/channels/rotate', {}, json)
                      setSecret(response.data.data.secret)
                      reload()
                    },
                  })
                }
              >
                <KeyRound size={14} />
                تدوير السر
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setError('')
                  setTesting('')
                }}
              >
                <Send size={14} />
                إرسال رسالة تجريبية
              </Button>
            </>
          )}
        </div>
      </CardContent>

      <Dialog open={draft !== null} onOpenChange={(open) => !open && !busy && setDraft(null)}>
        <DialogContent>
          <form onSubmit={save} className="space-y-5">
            <DialogHeader>
              <DialogTitle>قناة الرسائل النصية</DialogTitle>
              <DialogDescription>
                يستقبل المزوّد طلب POST موقّعًا بصيغة JSON لكل رسالة؛ يظهر سر التوقيع مرة واحدة عند
                الحفظ الأول.
              </DialogDescription>
            </DialogHeader>
            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-medium">نوع القناة</legend>
              <RadioGroup
                value={draft?.kind}
                onValueChange={(kind) =>
                  setDraft((current) =>
                    current ? { ...current, kind: kind as HttpChannelKind } : current
                  )
                }
                className="flex gap-6"
              >
                {KINDS.map(([value, label]) => (
                  <div key={value} className="flex items-center gap-2">
                    <RadioGroupItem id={`channel-kind-${value}`} value={value} />
                    <Label htmlFor={`channel-kind-${value}`}>{label}</Label>
                  </div>
                ))}
              </RadioGroup>
              <p className="text-xs text-muted-foreground">
                تغيير النوع يتطلب من المستخدمين تفعيل القناة الجديدة من ملفهم الشخصي.
              </p>
            </fieldset>
            <div className="space-y-1">
              <Label htmlFor="channel-url">عنوان المزوّد</Label>
              <Input
                id="channel-url"
                type="url"
                dir="ltr"
                placeholder="https://sms.example.com/adula"
                value={draft?.url ?? ''}
                onChange={(event) =>
                  setDraft((current) =>
                    current ? { ...current, url: event.target.value } : current
                  )
                }
                required
              />
            </div>
            <div className="flex items-center justify-between gap-4 rounded-lg border px-4 py-3">
              <div className="space-y-0.5">
                <Label htmlFor="channel-enabled">تفعيل القناة</Label>
                <p className="text-xs text-muted-foreground">
                  عند الإيقاف لا تُرسل أي رسالة، وتُلغى الرسائل المنتظرة.
                </p>
              </div>
              <Switch
                id="channel-enabled"
                checked={Boolean(draft?.enabled)}
                onCheckedChange={(enabled) =>
                  setDraft((current) => (current ? { ...current, enabled } : current))
                }
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setDraft(null)}
              >
                إلغاء
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? 'جارٍ الحفظ…' : 'حفظ القناة'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={testing !== null} onOpenChange={(open) => !open && !busy && setTesting(null)}>
        <DialogContent>
          <form onSubmit={sendTest} className="space-y-5">
            <DialogHeader>
              <DialogTitle>إرسال رسالة تجريبية</DialogTitle>
              <DialogDescription>
                تُرسل رسالة واحدة عبر المزوّد الآن، حتى لو كانت القناة موقوفة.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1">
              <Label htmlFor="channel-test-to">رقم الهاتف</Label>
              <Input
                id="channel-test-to"
                type="tel"
                dir="ltr"
                inputMode="tel"
                placeholder="+966500000000"
                value={testing ?? ''}
                onChange={(event) => setTesting(event.target.value)}
                required
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setTesting(null)}
              >
                إلغاء
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? 'جارٍ الإرسال…' : 'إرسال'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={secret !== null} onOpenChange={(open) => !open && setSecret(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>سر التوقيع للمزوّد</DialogTitle>
            <DialogDescription>
              انسخ السر الآن وضعه عند المزوّد للتحقق من ترويسة X-Adula-Signature؛ لن يظهر مرة
              أخرى.
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
              نسخ السر
            </Button>
            <Button type="button" onClick={() => setSecret(null)}>
              تم
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {confirmation}
    </Card>
  )
}
