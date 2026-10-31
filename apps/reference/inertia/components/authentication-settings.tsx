import { useState, type FormEvent } from 'react'
import { router } from '@inertiajs/react'
import { ShieldCheck } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Label } from '~/components/ui/label'
import { Switch } from '~/components/ui/switch'

/** Settings page prop `authentication` (admin/authentication_settings_controller.ts). */
export type AuthenticationSettingsProps = {
  providers: {
    name: string
    label: string
    configured: boolean
    enabled: boolean
    /** The administrator's switch, kept even while credentials are missing. */
    disabled: boolean
  }[]
  twoFactorRequiredForAdministrators: boolean
}

export function AuthenticationSettings({
  authentication,
}: {
  authentication: AuthenticationSettingsProps
}) {
  const [enabled, setEnabled] = useState(
    () =>
      new Set(
        authentication.providers.filter((provider) => provider.enabled).map(({ name }) => name)
      )
  )
  const [required, setRequired] = useState(authentication.twoFactorRequiredForAdministrators)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const toggle = (name: string, on: boolean) =>
    setEnabled((current) => {
      const next = new Set(current)
      if (on) next.add(name)
      else next.delete(name)
      return next
    })

  const save = (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setErrors({})
    router.put(
      '/admin/settings/authentication',
      {
        // Switched off, or disabled earlier and not configured now (no switch to change).
        disabledProviders: authentication.providers
          .filter((provider) =>
            provider.configured ? !enabled.has(provider.name) : provider.disabled
          )
          .map(({ name }) => name),
        twoFactorRequiredForAdministrators: required,
      },
      {
        preserveScroll: true,
        onError: (failed) => setErrors(failed as Record<string, string>),
        onFinish: () => setBusy(false),
      }
    )
  }

  const message = Object.values(errors)[0]
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck size={16} />
          المصادقة
        </CardTitle>
        <CardDescription>
          مزوّدو الدخول الخارجي المعروضون في صفحة الدخول، وإلزام المديرين بالتحقق بخطوتين.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="space-y-6">
          <fieldset className="space-y-3">
            <legend className="mb-2 text-sm font-medium">الدخول عبر مزوّد خارجي</legend>
            <ul className="divide-y rounded-lg border">
              {authentication.providers.map((provider) => (
                <li
                  key={provider.name}
                  className="flex items-center justify-between gap-4 px-4 py-3"
                >
                  <div className="space-y-0.5">
                    <Label htmlFor={`provider-${provider.name}`} dir="ltr">
                      {provider.label}
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {provider.configured
                        ? enabled.has(provider.name)
                          ? 'يظهر في صفحة الدخول ويمكن ربطه من الملف الشخصي'
                          : 'موقوف؛ لا يظهر ولا يقبل الدخول'
                        : 'غير مهيأ: بيانات اعتماد المزوّد غير مضبوطة في متغيرات البيئة'}
                    </p>
                  </div>
                  <Switch
                    id={`provider-${provider.name}`}
                    checked={provider.configured && enabled.has(provider.name)}
                    disabled={!provider.configured}
                    onCheckedChange={(on) => toggle(provider.name, on)}
                  />
                </li>
              ))}
            </ul>
          </fieldset>
          <div className="flex items-center justify-between gap-4 rounded-lg border px-4 py-3">
            <div className="space-y-0.5">
              <Label htmlFor="two-factor-required">إلزام المديرين بالتحقق بخطوتين</Label>
              <p className="text-xs text-muted-foreground">
                من يملك صلاحية الإدارة الكاملة يُحوَّل إلى ملفه الشخصي لتفعيله قبل فتح صفحات
                الإدارة.
              </p>
            </div>
            <Switch id="two-factor-required" checked={required} onCheckedChange={setRequired} />
          </div>
          {message && (
            <p role="alert" className="text-sm text-destructive">
              {message}
            </p>
          )}
          <Button type="submit" disabled={busy}>
            حفظ إعدادات المصادقة
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
