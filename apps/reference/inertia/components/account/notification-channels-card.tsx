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
type Draft = Record<string, { enabled: boolean }>
/** A number being confirmed: entered, then the code sent to it. */
type Verification = { phone: string; sentTo: string | null; code: string }

const DESCRIPTIONS: Record<ChannelPreference['delivery'], string> = {
  always: 'كل إشعار يظهر في الجرس داخل التطبيق، ولا يمكن إيقافه.',
  template: 'الإشعارات المهمة تصل أيضًا إلى بريدك الإلكتروني.',
  'opt-in': 'الإشعارات المهمة تصل إلى رقم هاتفك بعد تأكيده برمز تحقق.',
}

function draftOf(channels: NotificationChannelsProps): Draft {
  return Object.fromEntries(
    channels.map((channel) => [channel.key, { enabled: channel.enabled }])
  )
}

export function NotificationChannelsCard({ channels }: { channels: NotificationChannelsProps }) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [verify, setVerify] = useState<Record<string, Verification>>({})
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
          // Opt-in channels keep their confirmed number; a new one goes through the code.
          channels: editable.map((channel) => ({
            key: channel.key,
            enabled: draft[channel.key].enabled,
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

  const verification = (key: string) => verify[key] ?? { phone: '', sentTo: null, code: '' }
  const setVerification = (key: string, value: Partial<Verification>) =>
    setVerify((current) => ({
      ...current,
      [key]: { ...(current[key] ?? { phone: '', sentTo: null, code: '' }), ...value },
    }))

  const sendCode = async (key: string) => {
    const phone = verification(key).phone
    setBusy(true)
    setError('')
    try {
      await axios.post(`/account/notification-channels/${key}/code`, { address: phone }, json)
      setVerification(key, { sentTo: phone, code: '' })
      toast.success('أُرسل رمز التحقق إلى الرقم.')
    } catch (caught) {
      setError(failure(caught, 'تعذر إرسال رمز التحقق. حاول بعد قليل.'))
    } finally {
      setBusy(false)
    }
  }

  const confirmCode = async (key: string) => {
    setBusy(true)
    setError('')
    try {
      await axios.post(
        `/account/notification-channels/${key}/confirm`,
        { code: verification(key).code },
        json
      )
      toast.success('تم تأكيد الرقم وتفعيل القناة.')
      setVerify((current) => ({ ...current, [key]: { phone: '', sentTo: null, code: '' } }))
      // The Dialog stays open with the other unsaved switches as they were.
      change(key, { enabled: true })
      router.reload({ only: ['notificationChannels'] })
    } catch (caught) {
      setError(failure(caught, 'تعذر تأكيد الرمز. حاول مرة أخرى.'))
    } finally {
      setBusy(false)
    }
  }

  /** Removes the confirmed number at once; the channel turns off with it. */
  const removeNumber = async (key: string) => {
    setBusy(true)
    setError('')
    try {
      await axios.put(
        '/account/notification-channels',
        { channels: [{ key, enabled: false, address: '' }] },
        json
      )
      toast.success('حُذف الرقم وأُوقفت القناة.')
      change(key, { enabled: false })
      router.reload({ only: ['notificationChannels'] })
    } catch (caught) {
      setError(failure(caught, 'تعذر حذف الرقم. حاول مرة أخرى.'))
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
            setVerify({})
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
                        disabled={
                          channel.locked ||
                          busy ||
                          (channel.delivery === 'opt-in' && !channel.address)
                        }
                        onCheckedChange={(enabled) => change(channel.key, { enabled })}
                      />
                    </div>
                    {channel.delivery === 'opt-in' && (
                      <div className="space-y-3 rounded-md bg-muted/40 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs text-muted-foreground">
                            {channel.address ? (
                              <>
                                الرقم المؤكد:{' '}
                                <bdi dir="ltr" className="tabular-nums">
                                  {channel.address}
                                </bdi>
                              </>
                            ) : (
                              'لا رقم مؤكدًا بعد؛ أكّد رقمك لتفعيل القناة.'
                            )}
                          </p>
                          {channel.address && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              disabled={busy}
                              onClick={() => removeNumber(channel.key)}
                            >
                              حذف الرقم
                            </Button>
                          )}
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor={`${id}-phone`}>
                            {channel.address ? 'رقم جديد' : 'رقم الهاتف'}
                          </Label>
                          <div className="flex gap-2">
                            <Input
                              id={`${id}-phone`}
                              type="tel"
                              dir="ltr"
                              inputMode="tel"
                              autoComplete="tel"
                              placeholder="+966500000000"
                              value={verification(channel.key).phone}
                              disabled={busy}
                              onChange={(event) =>
                                setVerification(channel.key, { phone: event.target.value })
                              }
                            />
                            <Button
                              type="button"
                              variant="outline"
                              disabled={busy || !verification(channel.key).phone.trim()}
                              onClick={() => sendCode(channel.key)}
                            >
                              إرسال رمز التحقق
                            </Button>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            بالصيغة الدولية مع رمز الدولة. يصلك رمز من 6 أرقام صالح 10 دقائق.
                          </p>
                        </div>
                        {verification(channel.key).sentTo && (
                          <div className="space-y-1">
                            <Label htmlFor={`${id}-code`}>رمز التحقق</Label>
                            <div className="flex gap-2">
                              <Input
                                id={`${id}-code`}
                                dir="ltr"
                                inputMode="numeric"
                                autoComplete="one-time-code"
                                maxLength={6}
                                placeholder="123456"
                                className="tabular-nums"
                                value={verification(channel.key).code}
                                disabled={busy}
                                onChange={(event) =>
                                  setVerification(channel.key, {
                                    code: event.target.value.replace(/\D/g, ''),
                                  })
                                }
                              />
                              <Button
                                type="button"
                                disabled={busy || verification(channel.key).code.length !== 6}
                                onClick={() => confirmCode(channel.key)}
                              >
                                تأكيد
                              </Button>
                            </div>
                          </div>
                        )}
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
