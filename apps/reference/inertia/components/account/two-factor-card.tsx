import { useEffect, useState, type FormEvent } from 'react'
import { router, usePage } from '@inertiajs/react'
import axios from 'axios'
import { toast } from 'sonner'
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  KeyRound,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
} from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Skeleton } from '~/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { failure, json } from './request'

/** Profile prop `twoFactor` (app/services/two_factor.ts profileTwoFactor). */
export type TwoFactorProps = {
  enabled: boolean
  pending: boolean
  recoveryRemaining: number
  required: boolean
}
type Enrolment = {
  otpauthUrl: string
  secret: string
  issuer: string
  account: string
  qrDataUri: string | null
}
type Panel = 'enrol' | 'regenerate' | 'disable' | null

const ENROL_QUERY = 'two-factor'
const RECOVERY_TOTAL = 10

/** Groups a base32 secret in fours so it can be typed into an authenticator by hand. */
const grouped = (secret: string) => secret.match(/.{1,4}/g)?.join(' ') ?? secret

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        } catch {
          toast.error('تعذر النسخ؛ حدّد النص وانسخه يدويًا.')
        }
      }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
      {copied ? 'تم النسخ' : label}
    </Button>
  )
}

/** A six-digit authenticator code; `allowRecovery` widens it to recovery codes. */
function CodeField({
  id,
  value,
  onChange,
  allowRecovery = false,
  autoFocus = false,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  allowRecovery?: boolean
  autoFocus?: boolean
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>
        {allowRecovery ? 'رمز التطبيق أو رمز استرداد' : 'الرمز من تطبيق المصادقة'}
      </Label>
      <Input
        id={id}
        dir="ltr"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        inputMode={allowRecovery ? 'text' : 'numeric'}
        autoComplete="one-time-code"
        pattern={allowRecovery ? undefined : '[0-9]{6}'}
        maxLength={allowRecovery ? 23 : 6}
        placeholder="000000"
        className="font-mono tracking-widest tabular-nums"
        autoFocus={autoFocus}
        required
      />
      {allowRecovery && (
        <p className="text-xs text-muted-foreground">
          ستة أرقام من التطبيق، أو رمز استرداد بالشكل XXXXX-XXXXX-XXXXX-XXXXX.
        </p>
      )}
    </div>
  )
}

function ErrorLine({ message }: { message: string }) {
  if (!message) return null
  return (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  )
}

/** The new recovery codes, shown once, with copy and a plain-text download. */
function RecoveryCodes({ codes, account }: { codes: string[]; account: string }) {
  const text = codes.join('\n')
  const download = () => {
    const header = [
      'رموز استرداد التحقق بخطوتين',
      account,
      `أُنشئت: ${new Date().toISOString()}`,
      'يُستخدم كل رمز مرة واحدة فقط.',
      '',
    ].join('\n')
    const url = URL.createObjectURL(
      new Blob([`${header}${text}\n`], { type: 'text/plain;charset=utf-8' })
    )
    const link = document.createElement('a')
    link.href = url
    link.download = 'recovery-codes.txt'
    link.click()
    URL.revokeObjectURL(url)
  }
  return (
    <div className="space-y-4">
      <Alert variant="destructive">
        <ShieldAlert />
        <AlertTitle>احفظ هذه الرموز الآن</AlertTitle>
        <AlertDescription>
          لن تظهر مرة أخرى. خزّنها في مدير كلمات المرور أو مكان آمن بعيدًا عن هاتفك؛ ستحتاجها للدخول
          إذا فقدت تطبيق المصادقة. يُستخدم كل رمز مرة واحدة.
        </AlertDescription>
      </Alert>
      <ol
        dir="ltr"
        aria-label="رموز الاسترداد"
        className="grid gap-x-6 gap-y-1.5 rounded-lg border bg-muted/40 px-4 py-3 font-mono text-sm tabular-nums sm:grid-cols-2"
      >
        {codes.map((code) => (
          <li key={code} className="select-all">
            {code}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <CopyButton value={text} label="نسخ الرموز" />
        <Button type="button" size="sm" variant="outline" onClick={download}>
          <Download size={14} />
          تنزيل ملف نصي
        </Button>
      </div>
    </div>
  )
}

export function TwoFactorCard({ twoFactor }: { twoFactor: TwoFactorProps }) {
  const account = usePage<{ user?: { email: string } }>().props.user?.email ?? ''
  const [panel, setPanel] = useState<Panel>(null)
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null)
  const [codes, setCodes] = useState<string[] | null>(null)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // begin needs a recent sign-in; otherwise the current password (E_REAUTH_REQUIRED).
  const [reauth, setReauth] = useState(false)

  const reset = () => {
    setReauth(false)
    setEnrolment(null)
    setCodes(null)
    setCode('')
    setPassword('')
    setError('')
    setBusy(false)
  }

  const begin = async (withPassword?: string) => {
    if (withPassword === undefined) {
      reset()
      setPanel('enrol')
    }
    setError('')
    setBusy(true)
    try {
      const response = await axios.post(
        '/account/two-factor/begin',
        withPassword === undefined ? {} : { password: withPassword },
        json
      )
      setEnrolment(response.data.data as Enrolment)
      setReauth(false)
      setPassword('')
    } catch (caught) {
      const code = axios.isAxiosError(caught) ? caught.response?.data?.error?.code : undefined
      if (code === 'E_REAUTH_REQUIRED' || (code === 'E_PASSWORD' && withPassword !== undefined)) {
        setReauth(true)
        // The first refusal only asks for the password; a wrong one shows the server's message.
        if (withPassword !== undefined) setError(failure(caught, 'كلمة المرور غير صحيحة'))
      } else setError(failure(caught, 'تعذر بدء تفعيل التحقق بخطوتين.'))
    } finally {
      setBusy(false)
    }
  }

  // Forced enrolment: the admin middleware redirects administrators here with ?enrol=two-factor.
  useEffect(() => {
    const query = new URLSearchParams(window.location.search)
    if (query.get('enrol') === ENROL_QUERY && !twoFactor.enabled) void begin()
    // Mount only: the query is the entry point, not a state to follow.
  }, [])

  const close = () => {
    const changed = codes !== null || panel === 'disable'
    setPanel(null)
    reset()
    if (!changed && panel !== 'enrol') return
    const enrolQuery = new URLSearchParams(window.location.search).has('enrol')
    if (enrolQuery)
      router.get(
        window.location.pathname,
        {},
        { only: ['twoFactor'], replace: true, preserveState: true, preserveScroll: true }
      )
    else router.reload({ only: ['twoFactor'] })
  }

  const submit = (run: () => Promise<void>, fallback: string) => async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      await run()
    } catch (caught) {
      setError(failure(caught, fallback))
    } finally {
      setBusy(false)
    }
  }

  const confirm = submit(async () => {
    const response = await axios.post('/account/two-factor/confirm', { code }, json)
    setCodes(response.data.data.recoveryCodes as string[])
    setCode('')
  }, 'تعذر تأكيد الرمز.')

  const regenerate = submit(async () => {
    const response = await axios.post('/account/two-factor/recovery-codes', { code }, json)
    setCodes(response.data.data.recoveryCodes as string[])
    setCode('')
  }, 'تعذر إنشاء رموز استرداد جديدة.')

  const disable = submit(async () => {
    await axios.delete('/account/two-factor', { ...json, data: { password, code } })
    toast.success('أُوقف التحقق بخطوتين لحسابك.')
    close()
  }, 'تعذر إيقاف التحقق بخطوتين.')

  const low = twoFactor.enabled && twoFactor.recoveryRemaining <= 3

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck size={16} />
          التحقق بخطوتين
        </CardTitle>
        <CardDescription>
          يطلب رمزًا من تطبيق مصادقة على هاتفك بعد كلمة المرور أو الدخول الخارجي.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {twoFactor.required && !twoFactor.enabled && (
          <Alert variant="destructive">
            <ShieldAlert />
            <AlertTitle>مطلوب لحسابات المديرين</AlertTitle>
            <AlertDescription>فعّل التحقق بخطوتين لتتمكن من فتح صفحات الإدارة.</AlertDescription>
          </Alert>
        )}
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-3 text-sm">
          <dt className="text-muted-foreground">الحالة</dt>
          <dd>
            {twoFactor.enabled ? (
              <Badge>
                <ShieldCheck size={12} />
                مفعّل
              </Badge>
            ) : (
              <Badge variant="secondary">
                <ShieldOff size={12} />
                غير مفعّل
              </Badge>
            )}
          </dd>
          {twoFactor.enabled && (
            <>
              <dt className="text-muted-foreground">رموز الاسترداد</dt>
              <dd className={low ? 'font-medium text-destructive' : undefined}>
                <span className="tabular-nums">{twoFactor.recoveryRemaining}</span> من{' '}
                <span className="tabular-nums">{RECOVERY_TOTAL}</span> متبقية
                {low && ' — أنشئ رموزًا جديدة قريبًا'}
              </dd>
            </>
          )}
        </dl>
        <div className="flex flex-wrap gap-2">
          {twoFactor.enabled ? (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  reset()
                  setPanel('regenerate')
                }}
              >
                <KeyRound size={16} />
                رموز استرداد جديدة
              </Button>
              <Button
                variant="outline"
                className="text-destructive"
                onClick={() => {
                  reset()
                  setPanel('disable')
                }}
              >
                <ShieldOff size={16} />
                إيقاف التحقق بخطوتين
              </Button>
            </>
          ) : (
            <Button onClick={() => void begin()}>
              <ShieldCheck size={16} />
              تفعيل التحقق بخطوتين
            </Button>
          )}
        </div>
      </CardContent>

      <Dialog
        mode={codes ? 'view' : 'edit'}
        open={panel === 'enrol'}
        onOpenChange={(open) => !open && close()}
      >
        <DialogContent dir="rtl" className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{codes ? 'رموز الاسترداد' : 'تفعيل التحقق بخطوتين'}</DialogTitle>
            <DialogDescription>
              {codes
                ? 'فُعّل التحقق بخطوتين. سيُطلب الرمز من تطبيقك في كل دخول قادم.'
                : 'أضف الحساب إلى تطبيق مصادقة (مثل Microsoft Authenticator أو Google Authenticator) ثم أدخل الرمز الذي يظهر فيه.'}
            </DialogDescription>
          </DialogHeader>
          {codes ? (
            <RecoveryCodes codes={codes} account={account} />
          ) : enrolment ? (
            <form id="two-factor-enrol" onSubmit={confirm} className="space-y-5">
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
                <dt className="text-muted-foreground">الجهة</dt>
                <dd dir="ltr" className="text-start font-medium">
                  {enrolment.issuer}
                </dd>
                <dt className="text-muted-foreground">الحساب</dt>
                <dd dir="ltr" className="text-start font-medium">
                  {enrolment.account}
                </dd>
              </dl>
              {enrolment.qrDataUri && (
                <img
                  src={enrolment.qrDataUri}
                  alt="رمز QR لإضافة الحساب إلى تطبيق المصادقة"
                  className="mx-auto size-48 rounded-lg border bg-white p-2"
                />
              )}
              <section className="space-y-2" aria-labelledby="two-factor-secret-label">
                <p id="two-factor-secret-label" className="text-sm font-medium">
                  المفتاح للإدخال اليدوي
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <code
                    dir="ltr"
                    className="flex-1 rounded-lg bg-muted px-3 py-2 font-mono text-sm tracking-wider break-all select-all"
                  >
                    {grouped(enrolment.secret)}
                  </code>
                  <CopyButton value={enrolment.secret} label="نسخ المفتاح" />
                </div>
                <p className="text-xs text-muted-foreground">
                  اختر «مفتاح إعداد» أو «إدخال يدوي» في التطبيق، والنوع «حسب الوقت».
                </p>
              </section>
              <section className="space-y-2" aria-labelledby="two-factor-link-label">
                <p id="two-factor-link-label" className="text-sm font-medium">
                  رابط الإعداد
                </p>
                <code
                  dir="ltr"
                  className="block rounded-lg bg-muted px-3 py-2 font-mono text-xs break-all select-all"
                >
                  {enrolment.otpauthUrl}
                </code>
                <div className="flex flex-wrap gap-2">
                  <Button asChild size="sm" variant="outline">
                    <a href={enrolment.otpauthUrl}>
                      <ExternalLink size={14} />
                      فتح في تطبيق المصادقة
                    </a>
                  </Button>
                  <CopyButton value={enrolment.otpauthUrl} label="نسخ الرابط" />
                </div>
                <p className="text-xs text-muted-foreground">
                  على الهاتف يفتح الرابط تطبيق المصادقة مباشرة.
                </p>
              </section>
              <CodeField id="two-factor-enrol-code" value={code} onChange={setCode} />
              <ErrorLine message={error} />
            </form>
          ) : reauth ? (
            <form
              id="two-factor-reauth"
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault()
                void begin(password)
              }}
            >
              <p className="text-sm text-muted-foreground">
                مضى على دخولك أكثر من 10 دقائق. أكّد كلمة المرور الحالية لعرض مفتاح الإعداد.
              </p>
              <div className="space-y-2">
                <Label htmlFor="two-factor-reauth-password">كلمة المرور الحالية</Label>
                <Input
                  id="two-factor-reauth-password"
                  type="password"
                  dir="ltr"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoFocus
                  required
                />
              </div>
              <p className="text-xs text-muted-foreground">
                دخلت عبر مزوّد خارجي ولا تعرف كلمة المرور؟ سجّل الخروج وادخل مجددًا، ثم فعّل التحقق
                خلال 10 دقائق.
              </p>
              <ErrorLine message={error} />
            </form>
          ) : busy ? (
            <div className="space-y-3" role="status" aria-label="جارٍ تجهيز المفتاح">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <ErrorLine message={error} />
          )}
          <DialogFooter>
            {codes ? (
              <Button type="button" onClick={close}>
                حفظت الرموز
              </Button>
            ) : (
              <>
                <Button type="button" variant="outline" onClick={close}>
                  إلغاء
                </Button>
                {reauth && !enrolment ? (
                  <Button type="submit" form="two-factor-reauth" disabled={busy}>
                    متابعة
                  </Button>
                ) : (
                  <Button type="submit" form="two-factor-enrol" disabled={!enrolment || busy}>
                    {busy && enrolment ? 'جارٍ التحقق…' : 'تأكيد وتفعيل'}
                  </Button>
                )}
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        mode={codes ? 'view' : 'edit'}
        open={panel === 'regenerate'}
        onOpenChange={(open) => !open && close()}
      >
        <DialogContent dir="rtl" className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {codes ? 'رموز الاسترداد الجديدة' : 'إنشاء رموز استرداد جديدة'}
            </DialogTitle>
            <DialogDescription>
              {codes
                ? 'أُلغيت الرموز السابقة كلها؛ هذه وحدها صالحة الآن.'
                : 'تُلغى الرموز الحالية كلها فور الإنشاء. أدخل الرمز الحالي من تطبيق المصادقة (لا يُقبل رمز استرداد هنا).'}
            </DialogDescription>
          </DialogHeader>
          {codes ? (
            <RecoveryCodes codes={codes} account={account} />
          ) : (
            <form id="two-factor-regenerate" onSubmit={regenerate} className="space-y-4">
              <CodeField
                id="two-factor-regenerate-code"
                value={code}
                onChange={setCode}
                autoFocus
              />
              <ErrorLine message={error} />
            </form>
          )}
          <DialogFooter>
            {codes ? (
              <Button type="button" onClick={close}>
                حفظت الرموز
              </Button>
            ) : (
              <>
                <Button type="button" variant="outline" onClick={close}>
                  إلغاء
                </Button>
                <Button type="submit" form="two-factor-regenerate" disabled={busy}>
                  إنشاء الرموز
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog mode="edit" open={panel === 'disable'} onOpenChange={(open) => !open && close()}>
        <DialogContent dir="rtl" className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>إيقاف التحقق بخطوتين؟</DialogTitle>
            <DialogDescription>
              سيكفي بعدها كلمة المرور أو الدخول الخارجي وحده، وتُحذف رموز الاسترداد. أكّد بكلمة
              المرور ورمز من التطبيق أو رمز استرداد.
            </DialogDescription>
          </DialogHeader>
          <form id="two-factor-disable" onSubmit={disable} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="two-factor-disable-password">كلمة المرور الحالية</Label>
              <Input
                id="two-factor-disable-password"
                type="password"
                dir="ltr"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoFocus
                required
              />
            </div>
            <CodeField id="two-factor-disable-code" value={code} onChange={setCode} allowRecovery />
            <ErrorLine message={error} />
          </form>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              تراجع
            </Button>
            <Button type="submit" form="two-factor-disable" variant="destructive" disabled={busy}>
              إيقاف التحقق
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
