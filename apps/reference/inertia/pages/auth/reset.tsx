import { Head } from '@inertiajs/react'
import { Form, Link } from '@adonisjs/inertia/react'
import { TriangleAlert } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'

type Props = { token: string; valid: boolean }

export default function Reset({ token, valid }: Props) {
  return (
    <>
      <Head title="كلمة مرور جديدة" />
      <div dir="rtl" className="mx-auto w-full max-w-md py-10">
        <Card>
          <CardHeader>
            <CardTitle>كلمة مرور جديدة</CardTitle>
            <CardDescription>اختر كلمة مرور جديدة لحسابك. ستُنهى جلساتك السابقة كلها.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {valid ? (
              <Form route="password_reset.update" routeParams={{ token }} className="space-y-5">
                {({ errors, processing }) => (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="password">كلمة المرور الجديدة</Label>
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
                      حفظ كلمة المرور
                    </Button>
                  </>
                )}
              </Form>
            ) : (
              <Alert variant="destructive">
                <TriangleAlert />
                <AlertTitle>الرابط غير صالح</AlertTitle>
                <AlertDescription>
                  رابط إعادة التعيين غير صالح أو انتهت صلاحيته أو استُخدم من قبل. اطلب رابطاً
                  جديداً.
                </AlertDescription>
              </Alert>
            )}
            <p className="text-center text-sm text-muted-foreground">
              <Link route="password_reset.forgot" className="font-medium text-primary">
                طلب رابط جديد
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
