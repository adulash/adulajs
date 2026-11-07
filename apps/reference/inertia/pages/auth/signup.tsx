import { Head } from '@inertiajs/react'
import { Form, Link } from '@adonisjs/inertia/react'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'

export default function Signup() {
  return (
    <>
      <Head title="إنشاء حساب" />
      <div dir="rtl" className="mx-auto w-full max-w-md py-10">
        <Card>
          <CardHeader>
            <CardTitle>إنشاء حساب</CardTitle>
            <CardDescription>
              أدخل بياناتك. يمنحك مدير النظام صلاحيات العمل بعد إنشاء الحساب.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <Form route="new_account.store" className="space-y-5">
              {({ errors, processing }) => (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="fullName">الاسم الكامل</Label>
                    <Input
                      type="text"
                      name="fullName"
                      id="fullName"
                      autoComplete="name"
                      aria-invalid={errors.fullName ? true : undefined}
                    />
                    {errors.fullName && (
                      <p className="text-sm text-destructive" role="alert">
                        {errors.fullName}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="email">البريد الإلكتروني</Label>
                    <Input
                      type="email"
                      name="email"
                      id="email"
                      dir="ltr"
                      autoComplete="email"
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
                    <Label htmlFor="password">كلمة المرور</Label>
                    <Input
                      type="password"
                      name="password"
                      id="password"
                      dir="ltr"
                      autoComplete="new-password"
                      required
                      aria-invalid={errors.password ? true : undefined}
                    />
                    {errors.password && (
                      <p className="text-sm text-destructive" role="alert">
                        {errors.password}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="passwordConfirmation">تأكيد كلمة المرور</Label>
                    <Input
                      type="password"
                      name="passwordConfirmation"
                      id="passwordConfirmation"
                      dir="ltr"
                      autoComplete="new-password"
                      required
                      aria-invalid={errors.passwordConfirmation ? true : undefined}
                    />
                    {errors.passwordConfirmation && (
                      <p className="text-sm text-destructive" role="alert">
                        {errors.passwordConfirmation}
                      </p>
                    )}
                  </div>

                  <Button type="submit" className="w-full" disabled={processing}>
                    إنشاء الحساب
                  </Button>
                </>
              )}
            </Form>

            <p className="text-center text-sm text-muted-foreground">
              لديك حساب بالفعل؟{' '}
              <Link route="session.create" className="font-medium text-primary">
                تسجيل الدخول
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
