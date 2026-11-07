import { useState, type FormEvent } from 'react'
import { router } from '@inertiajs/react'
import axios from 'axios'
import { toast } from 'sonner'
import { KeyRound, Trash2, TriangleAlert } from 'lucide-react'
import type { MailSecurity, MailSettingsView } from 'adula'
import type { MailPreset, MailReadiness } from '#services/mail_setup'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { CopyButton } from '~/components/ui/copy-button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import { useConfirmAction } from '~/components/ui/confirm-action'
import { Dialog, DialogClose } from '~/components/ui/dialog'
import { LongDialogContent } from '~/components/ui/long-dialog'
import { failure, json } from '~/components/account/request'

export type MailSource = 'settings' | 'environment'
export type MailSetupProps = {
  mailReadiness: MailReadiness & { source: MailSource }
  mailPresets: (MailPreset & { env: string })[]
  mailSettings: MailSettingsView
  mailSettingsApply: boolean
}

type Draft = Pick<
  MailSettingsView,
  'preset' | 'host' | 'port' | 'security' | 'username' | 'fromName' | 'fromAddress'
>

const SECURITIES: [MailSecurity, string][] = [
  ['tls', 'TLS (منفذ 465 عادةً)'],
  ['starttls', 'STARTTLS (منفذ 587 عادةً)'],
  ['none', 'بلا تشفير (خادم داخلي فقط)'],
]

// The names the settings form shows for each variable the readiness check reports.
const FIELD_LABELS: Record<string, string> = {
  SMTP_HOST: 'خادم SMTP',
  SMTP_USERNAME: 'اسم المستخدم',
  SMTP_PASSWORD: 'كلمة المرور',
  MAIL_FROM_ADDRESS: 'عنوان المرسل',
}

const warnings: Record<MailSource, Record<MailReadiness['warnings'][number], string>> = {
  environment: {
    development_default:
      'لم يُضبط SMTP_HOST، لذلك يرسل النظام إلى خادم التطوير المحلي 127.0.0.1:1025.',
    loopback_in_production: 'يشير SMTP_HOST إلى الخادم نفسه؛ تأكد من تشغيل خادم بريد محلي عليه.',
    port_security_mismatch: 'قيمة SMTP_SECURE لا تناسب المنفذ: استخدم true مع 465، وfalse مع 587.',
  },
  settings: {
    development_default: '',
    loopback_in_production: 'يشير خادم SMTP إلى الخادم نفسه؛ تأكد من تشغيل خادم بريد محلي عليه.',
    port_security_mismatch: 'نوع الأمان لا يناسب المنفذ: استخدم TLS مع 465، وSTARTTLS مع 587.',
  },
}

function Names({ names, source }: { names: string[]; source: MailSource }) {
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      {names.map((name) =>
        source === 'settings' ? (
          <Badge key={name} variant="outline">
            {FIELD_LABELS[name] ?? name}
          </Badge>
        ) : (
          <code key={name} dir="ltr" className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
            {name}
          </code>
        )
      )}
    </span>
  )
}

/**
 * Readiness by field: what is missing or invalid, and what deserves a second look. The names
 * are the form's labels when the stored settings apply, and variable names otherwise.
 */
export function MailReadinessNotice({
  readiness,
}: {
  readiness: MailReadiness & { source: MailSource }
}) {
  if (readiness.configured && readiness.warnings.length === 0) return null
  const source = readiness.source
  return (
    <Alert variant={readiness.configured ? 'default' : 'destructive'}>
      <TriangleAlert />
      <AlertTitle>
        {readiness.configured ? 'راجع إعداد البريد' : 'إعداد البريد غير مكتمل'}
      </AlertTitle>
      <AlertDescription className="space-y-1.5">
        {readiness.missing.length > 0 && (
          <p>
            {source === 'settings' ? 'حقول ناقصة:' : 'متغيرات ناقصة:'}{' '}
            <Names names={readiness.missing} source={source} />
          </p>
        )}
        {readiness.invalid.length > 0 && (
          <p>
            قيم غير صالحة: <Names names={readiness.invalid} source={source} />
          </p>
        )}
        {readiness.warnings.map((warning) => (
          <p key={warning}>{warnings[source][warning]}</p>
        ))}
      </AlertDescription>
    </Alert>
  )
}

function draftOf(settings: MailSettingsView, presets: MailPreset[]): Draft {
  if (settings.configured)
    return {
      preset: settings.preset,
      host: settings.host,
      port: settings.port,
      security: settings.security,
      username: settings.username,
      fromName: settings.fromName,
      fromAddress: settings.fromAddress,
    }
  const preset = presets[0]
  return {
    preset: preset?.id ?? 'custom',
    host: preset?.host ?? '',
    port: preset?.port ?? 587,
    security: preset?.secure ? 'tls' : 'starttls',
    username: preset?.username ?? '',
    fromName: '',
    fromAddress: '',
  }
}

const reload = () =>
  router.reload({ only: ['mailSettings', 'mailReadiness', 'mailTest', 'mailSettingsApply'] })

/**
 * Mail settings saved in the administration (ADR 020 amendment): pick a provider, complete
 * the server, the account and the sender, and save. The change applies to the next message
 * without a restart. The password is write-only: sent once, sealed, never shown again.
 */
export function MailSetupDialog({
  open,
  onOpenChange,
  mailPresets,
  mailSettings,
  mailSettingsApply,
}: MailSetupProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { confirm, confirmation } = useConfirmAction()
  const [initial, setInitial] = useState(() => draftOf(mailSettings, mailPresets))
  const [draft, setDraft] = useState(initial)
  const [password, setPassword] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const preset = mailPresets.find((item) => item.id === draft.preset)

  // Each opening starts from the saved values, which change after a save.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      const next = draftOf(mailSettings, mailPresets)
      setInitial(next)
      setDraft(next)
      setPassword('')
      setChangingPassword(false)
      setError('')
    }
  }
  const change = (next: boolean) => {
    if (!busy) onOpenChange(next)
  }

  // Typing and then restoring a value is clean; a typed password is a change.
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial) || password !== ''
  const hostChanged =
    mailSettings.hasPassword && draft.host.trim().toLowerCase() !== mailSettings.host
  const showPassword =
    !mailSettings.hasPassword || changingPassword || hostChanged || mailSettings.passwordUnreadable

  const update = <K extends keyof Draft>(name: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [name]: value }))
  const choose = (id: string) => {
    const next = mailPresets.find((item) => item.id === id)
    if (!next) return
    setDraft((current) => {
      // The previous provider's fixed username (SendGrid's apikey) does not carry over.
      const fixed = mailPresets.find((item) => item.id === current.preset)?.username
      return {
        ...current,
        preset: next.id,
        // A custom provider keeps what the administrator already typed.
        ...(next.host
          ? { host: next.host, port: next.port, security: next.secure ? 'tls' : 'starttls' }
          : {}),
        username: next.username ?? (fixed && current.username === fixed ? '' : current.username),
      }
    })
  }

  const save = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    // The settings first, since the password needs a saved server and a new server clears it.
    let saved = false
    try {
      await axios.put('/admin/settings/mail', draft, json)
      saved = true
      if (password) await axios.put('/admin/settings/mail/password', { password }, json)
      setPassword('')
      onOpenChange(false)
      toast.success('تم حفظ إعداد البريد، ويُطبَّق على الرسالة التالية دون إعادة تشغيل.')
      reload()
    } catch (caught) {
      if (saved) {
        setInitial(draft)
        setError(`حُفظ الإعداد، وتعذر حفظ كلمة المرور: ${failure(caught, 'خطأ غير متوقع.')}`)
        reload()
      } else setError(failure(caught, 'تعذر حفظ إعداد البريد.'))
    } finally {
      setBusy(false)
    }
  }

  // Takes effect at once, apart from the form's unsaved values.
  const removePassword = () =>
    confirm({
      title: 'حذف كلمة مرور البريد؟',
      description: 'يتوقف الإرسال الذي يحتاج تسجيل الدخول حتى تُدخل كلمة مرور جديدة.',
      destructive: true,
      label: 'حذف كلمة المرور',
      action: async () => {
        try {
          await axios.delete('/admin/settings/mail/password', json)
          toast.success('تم حذف كلمة مرور البريد.')
          reload()
        } catch (caught) {
          toast.error(failure(caught, 'تعذر حذف كلمة المرور.'))
        }
      },
    })

  return (
    <>
      <Dialog mode="edit" open={open} onOpenChange={change}>
        <LongDialogContent
          title="إعداد البريد"
          description="يرسل النظام البريد عبر خادم SMTP لدى مزودك. احفظ الإعداد هنا ليُطبَّق فورًا على الخادم والعامل دون إعادة تشغيل."
          footer={
            <>
              <DialogClose asChild>
                <Button type="button" variant="outline" disabled={busy}>
                  إلغاء
                </Button>
              </DialogClose>
              <Button type="submit" form="mail-settings" disabled={busy}>
                حفظ
              </Button>
            </>
          }
        >
          <form
            id="mail-settings"
            onSubmit={save}
            className="space-y-5 text-sm"
            autoComplete="off"
            data-dirty={dirty ? 'true' : 'false'}
          >
            {!mailSettingsApply && (
              <Alert>
                <TriangleAlert />
                <AlertTitle>يرسل النظام بمتغيرات البيئة</AlertTitle>
                <AlertDescription>
                  ضبط مسؤول الخادم MAIL_SETTINGS_SOURCE=environment، فلا يُطبَّق ما تحفظه هنا حتى
                  يُزال هذا المتغير.
                </AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label htmlFor="mail-preset">مزود البريد</Label>
              <Select value={draft.preset} onValueChange={choose}>
                <SelectTrigger id="mail-preset" className="w-full">
                  <SelectValue placeholder="اختر مزودًا" />
                </SelectTrigger>
                <SelectContent>
                  {mailPresets.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {preset && <p className="text-xs text-muted-foreground">{preset.note}</p>}
            </div>
            <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
              <div className="space-y-2">
                <Label htmlFor="mail-host">خادم SMTP</Label>
                <Input
                  id="mail-host"
                  dir="ltr"
                  required
                  spellCheck={false}
                  placeholder="smtp.example.com"
                  value={draft.host}
                  onChange={(event) => update('host', event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mail-port">المنفذ</Label>
                <Input
                  id="mail-port"
                  type="number"
                  dir="ltr"
                  required
                  min={1}
                  max={65535}
                  value={String(draft.port)}
                  onChange={(event) => update('port', Number(event.target.value))}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="mail-security">نوع الأمان</Label>
              <Select
                value={draft.security}
                onValueChange={(value) => update('security', value as MailSecurity)}
              >
                <SelectTrigger id="mail-security" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SECURITIES.map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="mail-username">اسم المستخدم</Label>
              <Input
                id="mail-username"
                dir="ltr"
                spellCheck={false}
                autoComplete="off"
                value={draft.username}
                onChange={(event) => update('username', event.target.value)}
              />
            </div>
            <div className="space-y-2">
              {/* Labels the field only while it is shown; otherwise it names the group. */}
              <Label htmlFor={showPassword ? 'mail-password' : undefined} id="mail-password-label">
                كلمة المرور
              </Label>
              {showPassword ? (
                <>
                  <Input
                    id="mail-password"
                    type="password"
                    dir="ltr"
                    autoComplete="new-password"
                    spellCheck={false}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    {mailSettings.passwordUnreadable
                      ? 'تعذّر فتح كلمة المرور المحفوظة؛ أدخلها من جديد.'
                      : hostChanged
                        ? 'تغيير الخادم يحذف كلمة المرور المحفوظة؛ أدخل كلمة مرور الخادم الجديد.'
                        : mailSettings.hasPassword
                          ? 'أدخل كلمة المرور الجديدة، أو اتركها فارغة لإبقاء المحفوظة.'
                          : 'تُحفظ مشفّرة ولا تُعرض مرة أخرى.'}
                  </p>
                </>
              ) : (
                <div
                  role="group"
                  aria-labelledby="mail-password-label"
                  className="flex flex-wrap items-center gap-2"
                >
                  <Badge>كلمة مرور محفوظة</Badge>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => setChangingPassword(true)}
                  >
                    <KeyRound size={14} />
                    تغيير
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={removePassword}
                  >
                    <Trash2 size={14} />
                    حذف
                  </Button>
                </div>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="mail-from-name">اسم المرسل</Label>
                <Input
                  id="mail-from-name"
                  maxLength={100}
                  value={draft.fromName}
                  onChange={(event) => update('fromName', event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mail-from-address">عنوان المرسل</Label>
                <Input
                  id="mail-from-address"
                  type="email"
                  dir="ltr"
                  required
                  placeholder="no-reply@example.com"
                  value={draft.fromAddress}
                  onChange={(event) => update('fromAddress', event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  استخدم عنوانًا موثّقًا لدى مزودك، وإلا رُفضت الرسائل أو وصلت إلى البريد غير
                  المرغوب.
                </p>
              </div>
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {preset && (
              <div className="space-y-2 border-t pt-4">
                <p className="font-medium">بديل: متغيرات البيئة</p>
                <p className="text-muted-foreground">
                  يستخدم النظام هذه المتغيرات ما دام لا يوجد إعداد محفوظ هنا، وتحتاج إعادة تشغيل
                  الخادم والعامل:
                </p>
                <pre
                  dir="ltr"
                  data-testid="mail-env-lines"
                  className="overflow-x-auto rounded-md border bg-muted/40 p-3 font-mono text-xs"
                >
                  {preset.env}
                </pre>
                <CopyButton value={preset.env} label="نسخ الأسطر" />
              </div>
            )}
          </form>
        </LongDialogContent>
      </Dialog>
      {confirmation}
    </>
  )
}
