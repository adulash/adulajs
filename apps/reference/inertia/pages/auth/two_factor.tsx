import { useState } from 'react'
import { Head } from '@inertiajs/react'
import { Form, Link } from '@adonisjs/inertia/react'
import { ShieldCheck } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'

/**
 * Second sign-in step. The password or provider identity is already verified; the user id
 * stays in the session, so the page receives no props. The step cannot be dismissed: the
 * only ways out are a valid code or returning to the login page.
 */
export default function TwoFactorChallenge() {
  const [recovery, setRecovery] = useState(false)
  const keep = (event: Event) => event.preventDefault()
  return (
    <>
      <Head title="التحقق بخطوتين" />
      <Dialog open mode="view" onOpenChange={() => {}}>
        <DialogContent
          dir="rtl"
          showCloseButton={false}
          className="sm:max-w-md"
          onEscapeKeyDown={keep}
          onInteractOutside={keep}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck size={18} />
              التحقق بخطوتين
            </DialogTitle>
            <DialogDescription>
              {recovery
                ? 'أدخل أحد رموز الاسترداد التي حفظتها عند تفعيل التحقق. يُستخدم كل رمز مرة واحدة.'
                : 'أدخل الرمز المكوّن من ستة أرقام الظاهر الآن في تطبيق المصادقة على جهازك.'}
            </DialogDescription>
          </DialogHeader>
          <Form route="two_factor.verify" className="space-y-5" resetOnError>
            {({ errors, processing }) => {
              // The route reads `code` without a validator, so its error bag is untyped.
              const codeError = (errors as { code?: string }).code
              return (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="code">{recovery ? 'رمز الاسترداد' : 'رمز التحقق'}</Label>
                    {recovery ? (
                      <Input
                        key="recovery"
                        id="code"
                        name="code"
                        dir="ltr"
                        autoComplete="off"
                        autoCapitalize="characters"
                        spellCheck={false}
                        placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
                        className="font-mono tracking-wider"
                        autoFocus
                        required
                        aria-invalid={codeError ? true : undefined}
                        aria-describedby={codeError ? 'code-error' : undefined}
                      />
                    ) : (
                      <Input
                        key="totp"
                        id="code"
                        name="code"
                        dir="ltr"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        pattern="[0-9]{6}"
                        maxLength={6}
                        placeholder="000000"
                        title="ستة أرقام"
                        className="text-center font-mono text-lg tracking-[0.5em] tabular-nums"
                        autoFocus
                        required
                        aria-invalid={codeError ? true : undefined}
                        aria-describedby={codeError ? 'code-error' : undefined}
                      />
                    )}
                    {codeError && (
                      <p id="code-error" className="text-sm text-destructive" role="alert">
                        {codeError}
                      </p>
                    )}
                  </div>
                  <Button type="submit" className="w-full" disabled={processing}>
                    {processing ? 'جارٍ التحقق…' : 'تحقق ومتابعة'}
                  </Button>
                </>
              )
            }}
          </Form>
          <DialogFooter className="items-center sm:justify-between">
            <Button
              type="button"
              variant="link"
              className="px-0"
              onClick={() => setRecovery((value) => !value)}
            >
              {recovery
                ? 'استخدام رمز تطبيق المصادقة'
                : 'لا أستطيع الوصول إلى التطبيق؟ استخدم رمز استرداد'}
            </Button>
            <Link
              route="session.create"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              العودة إلى تسجيل الدخول
            </Link>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
