import { Head } from '@inertiajs/react'
import { Form, Link } from '@adonisjs/inertia/react'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'

type Props = { socialProviders: { name: string; label: string }[]; signupEnabled: boolean }

export default function Login({ socialProviders, signupEnabled }: Props) {
  return (
    <>
      <Head title="تسجيل الدخول" />
      <div dir="rtl" className="mx-auto w-full max-w-md py-10">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">تسجيل الدخول</CardTitle>
            <CardDescription>أدخل بيانات حسابك للمتابعة إلى مساحة العمل</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <Form route="session.store" className="space-y-5">
              {({ errors, processing }) => (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="email">البريد الإلكتروني</Label>
                    <Input
                      type="email"
                      name="email"
                      id="email"
                      dir="ltr"
                      autoComplete="username"
                      required
                      aria-invalid={errors.email ? true : undefined}
                    />
                    {errors.email && (
                      <p className="text-sm text-destructive" role="alert">
                        {errors.email}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="password">كلمة المرور</Label>
                      <Link
                        route="password_reset.forgot"
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >
                        نسيت كلمة المرور؟
                      </Link>
                    </div>
                    <Input
                      type="password"
                      name="password"
                      id="password"
                      dir="ltr"
                      autoComplete="current-password"
                      required
                      aria-invalid={errors.password ? true : undefined}
                    />
                    {errors.password && (
                      <p className="text-sm text-destructive" role="alert">
                        {errors.password}
                      </p>
                    )}
                  </div>

                  <Button type="submit" className="w-full" disabled={processing}>
                    دخول
                  </Button>
                </>
              )}
            </Form>

            {socialProviders.length > 0 && (
              <div className="space-y-3" aria-label="الدخول عبر مزوّد خارجي">
                <p className="text-center text-xs text-muted-foreground">أو تابع عبر</p>
                {socialProviders.map((provider) => (
                  <Button key={provider.name} asChild variant="outline" className="w-full">
                    {/* A full navigation: the provider redirect must leave the Inertia app. */}
                    <a href={`/oauth/${provider.name}/redirect`}>الدخول عبر {provider.label}</a>
                  </Button>
                ))}
              </div>
            )}

            {signupEnabled && (
              <p className="text-center text-sm text-muted-foreground">
                ليس لديك حساب؟{' '}
                <Link route="new_account.create" className="font-medium text-primary">
                  إنشاء حساب
                </Link>
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  )
}
