import { Head } from '@inertiajs/react'
import { Form, Link } from '@adonisjs/inertia/react'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'

export default function Forgot() {
  return (
    <>
      <Head title="استعادة كلمة المرور" />
      <div dir="rtl" className="mx-auto w-full max-w-md py-10">
        <Card>
          <CardHeader>
            <CardTitle>استعادة كلمة المرور</CardTitle>
            <CardDescription>
              أدخل بريدك الإلكتروني وسنرسل إليك رابطاً صالحاً لساعة واحدة لاختيار كلمة مرور
              جديدة.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <Form route="password_reset.send" className="space-y-5">
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
                  <Button type="submit" className="w-full" disabled={processing}>
                    إرسال رابط إعادة التعيين
                  </Button>
                </>
              )}
            </Form>
            <p className="text-center text-sm text-muted-foreground">
              تذكرت كلمة المرور؟{' '}
              <Link route="session.create" className="font-medium text-primary">
                العودة إلى تسجيل الدخول
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
