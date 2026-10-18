import { Head, usePage } from '@inertiajs/react'
import { Form } from '@adonisjs/inertia/react'
import type { ReactElement } from 'react'
import { CircleCheck, KeyRound, OctagonX, UserRound } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Alert, AlertDescription } from '~/components/ui/alert'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import Workspace from '~/layouts/workspace'
import { LanguageSetting } from '~/components/language-setting'

export default function Profile() {
  const { props, flash } = usePage<{ user?: { fullName: string | null; email: string } }>()
  const user = props.user
  return (
    <>
      <Head title="الملف الشخصي" />
      <div className="mb-8">
        <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
          <UserRound size={15} />
          <span>حسابي</span>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">الملف الشخصي</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          اسمك كما يظهر للزملاء، وكلمة المرور التي تحمي حسابك.
        </p>
      </div>

      {typeof flash.success === 'string' && (
        <Alert className="mb-6" data-flash-message={flash.success}>
          <CircleCheck />
          <AlertDescription>{flash.success}</AlertDescription>
        </Alert>
      )}
      {typeof flash.error === 'string' && (
        <Alert variant="destructive" className="mb-6" data-flash-message={flash.error}>
          <OctagonX />
          <AlertDescription>{flash.error}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>البيانات الأساسية</CardTitle>
            <CardDescription>البريد الإلكتروني هو معرّف الدخول ولا يتغير من هنا.</CardDescription>
          </CardHeader>
          <CardContent>
            <Form route="profile.update" className="space-y-5">
              {({ errors, processing }) => (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="email">البريد الإلكتروني</Label>
                    <Input id="email" dir="ltr" value={user?.email ?? ''} readOnly disabled />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="fullName">الاسم الكامل</Label>
                    <Input
                      id="fullName"
                      name="fullName"
                      defaultValue={user?.fullName ?? ''}
                      autoComplete="name"
                      required
                      aria-invalid={errors.fullName ? true : undefined}
                    />
                    {errors.fullName && (
                      <p className="text-sm text-destructive" role="alert">
                        {errors.fullName}
                      </p>
                    )}
                  </div>
                  <Button type="submit" disabled={processing}>
                    حفظ البيانات
                  </Button>
                </>
              )}
            </Form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound size={16} />
              كلمة المرور
            </CardTitle>
            <CardDescription>
              تغيير كلمة المرور يُنهي جلساتك الأخرى على بقية الأجهزة.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form route="profile.password" className="space-y-5" resetOnSuccess>
              {({ errors, processing }) => (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="currentPassword">كلمة المرور الحالية</Label>
                    <Input
                      type="password"
                      id="currentPassword"
                      name="currentPassword"
                      dir="ltr"
                      autoComplete="current-password"
                      required
                      aria-invalid={errors.currentPassword ? true : undefined}
                    />
                    {errors.currentPassword && (
                      <p className="text-sm text-destructive" role="alert">
                        {errors.currentPassword}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">كلمة المرور الجديدة</Label>
                    <Input
                      type="password"
                      id="password"
                      name="password"
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
                    <Label htmlFor="passwordConfirmation">تأكيد كلمة المرور الجديدة</Label>
                    <Input
                      type="password"
                      id="passwordConfirmation"
                      name="passwordConfirmation"
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
                  <Button type="submit" variant="outline" disabled={processing}>
                    تغيير كلمة المرور
                  </Button>
                </>
              )}
            </Form>
          </CardContent>
        </Card>
      </div>
      <LanguageSetting />
    </>
  )
}
Profile.layout = (page: ReactElement) => <Workspace>{page}</Workspace>
