import { useState, type FormEvent } from 'react'
import { router } from '@inertiajs/react'
import axios from 'axios'
import { toast } from 'sonner'
import { BellRing, Lock } from 'lucide-react'
import type { ChannelPreference } from 'adula'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
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
import { failure, json } from './request'

/** Profile prop `notificationChannels` (NotificationChannels.preferences). */
export type NotificationChannelsProps = ChannelPreference[]
type Draft = Record<string, { enabled: boolean; address: string }>

const DESCRIPTIONS: Record<ChannelPreference['delivery'], string> = {
  always: 'كل إشعار يظهر في الجرس داخل التطبيق، ولا يمكن إيقافه.',
  template: 'الإشعارات المهمة تصل أيضًا إلى بريدك الإلكتروني.',
  'opt-in': 'الإشعارات المهمة تصل إلى رقم هاتفك بعد تفعيل القناة.',
}

function draftOf(channels: NotificationChannelsProps): Draft {
  return Object.fromEntries(
    channels.map((channel) => [
      channel.key,
      { enabled: channel.enabled, address: channel.address ?? '' },
    ])
  )
}

export function NotificationChannelsCard({ channels }: { channels: NotificationChannelsProps }) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const editable = channels.filter((channel) => !channel.locked)

  const change = (key: string, value: Partial<Draft[string]>) =>
    setDraft((current) => (current ? { ...current, [key]: { ...current[key], ...value } } : current))

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!draft) return
    setBusy(true)
    setError('')
    try {
      await axios.put(
        '/account/notification-channels',
        {
          channels: editable.map((channel) => ({
            key: channel.key,
            enabled: draft[channel.key].enabled,
            ...(channel.delivery === 'opt-in' ? { address: draft[channel.key].address } : {}),
          })),
        },
        json
      )
      toast.success('تم حفظ قنوات الإشعارات.')
      setDraft(null)
      router.reload({ only: ['notificationChannels'] })
    } catch (caught) {
      setError(failure(caught, 'تعذر حفظ قنوات الإشعارات. حاول مرة أخرى.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BellRing size={16} />
          قنوات الإشعارات
        </CardTitle>
        <CardDescription>اختر أين تصلك الإشعارات المهمة إلى جانب التطبيق.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="divide-y rounded-lg border" data-testid="notification-channels">
          {channels.map((channel) => (
            <li key={channel.key} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">{channel.label.ar}</p>
                {channel.address && (
                  <p className="text-xs text-muted-foreground tabular-nums" dir="ltr">
                    {channel.address}
                  </p>
                )}
              </div>
              {channel.locked ? (
                <Badge variant="secondary">
                  <Lock size={11} />
                  دائمًا
                </Badge>
              ) : channel.enabled ? (
                <Badge>مفعّلة</Badge>
              ) : (
                <Badge variant="outline">موقوفة</Badge>
              )}
            </li>
          ))}
        </ul>
        <Button
          variant="outline"
          onClick={() => {
            setError('')
            setDraft(draftOf(channels))
          }}
        >
          تعديل القنوات
        </Button>
      </CardContent>
      <Dialog open={draft !== null} onOpenChange={(open) => !open && !busy && setDraft(null)}>
        <DialogContent>
          <form onSubmit={save} className="space-y-5">
            <DialogHeader>
              <DialogTitle>قنوات الإشعارات</DialogTitle>
              <DialogDescription>
                الإشعارات داخل التطبيق تصل دائمًا؛ فعّل القنوات الأخرى أو أوقفها هنا.
              </DialogDescription>
            </DialogHeader>
            <ul className="divide-y rounded-lg border">
              {channels.map((channel) => {
                const value = draft?.[channel.key]
                const id = `channel-${channel.key}`
                return (
                  <li key={channel.key} className="space-y-3 px-4 py-3">
                    <div className="flex items-center justify-between gap-4">
                      <div className="space-y-0.5">
                        <Label htmlFor={id}>{channel.label.ar}</Label>
                        <p className="text-xs text-muted-foreground">
                          {DESCRIPTIONS[channel.delivery]}
                        </p>
                      </div>
                      <Switch
                        id={id}
                        checked={channel.locked || Boolean(value?.enabled)}
                        disabled={channel.locked || busy}
                        onCheckedChange={(enabled) => change(channel.key, { enabled })}
                      />
                    </div>
                    {channel.delivery === 'opt-in' && (
                      <div className="space-y-1">
                        <Label htmlFor={`${id}-address`}>رقم الهاتف</Label>
                        <Input
                          id={`${id}-address`}
                          type="tel"
                          dir="ltr"
                          inputMode="tel"
                          autoComplete="tel"
                          placeholder="+966500000000"
                          value={value?.address ?? ''}
                          required={Boolean(value?.enabled)}
                          disabled={busy}
                          onChange={(event) =>
                            change(channel.key, { address: event.target.value })
                          }
                        />
                        <p className="text-xs text-muted-foreground">
                          بالصيغة الدولية مع رمز الدولة.
                        </p>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
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
                {busy ? 'جارٍ الحفظ…' : 'حفظ القنوات'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
