import { Head, usePage } from '@inertiajs/react'
import { Link } from '@adonisjs/inertia/react'
import type { ResourceNavigation } from 'adula'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { useMessages } from '~/components/ui/messages'
import Workspace from '~/layouts/workspace'
import Layout from '~/layouts/default'

export default function Home() {
  const { user, isAdmin, navigation } = usePage<{
    user?: { email: string }
    isAdmin: boolean
    navigation: ResourceNavigation
  }>().props
  const { t, dir } = useMessages()
  return (
    <>
      <Head title={t('مساحة العمل · {app}', { app: 'AdulaJS' })} />
      <div className="mx-auto max-w-5xl space-y-6 px-6 py-12" dir={dir}>
        <Card>
          <CardHeader>
            <CardTitle>
              <h1 className="text-3xl">{t('مساحة العمل')}</h1>
            </CardTitle>
            <CardDescription>{t('وحدات أعمالك وإعدادات حسابك في مكان واحد.')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            {user ? (
              <>
                <Button asChild>
                  <Link href="/account/profile">{t('حسابي')}</Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/notifications">{t('الإشعارات')}</Link>
                </Button>
                {isAdmin && (
                  <Button asChild variant="outline">
                    <Link href="/admin/setup">{t('بدء الإعداد الأولي')}</Link>
                  </Button>
                )}
                {isAdmin && (
                  <Button asChild variant="outline">
                    <Link href="/admin/users">{t('إدارة النظام')}</Link>
                  </Button>
                )}
              </>
            ) : (
              <Button asChild>
                <Link href="/login">{t('تسجيل الدخول')}</Link>
              </Button>
            )}
          </CardContent>
        </Card>
        {(navigation ?? []).length ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {navigation.map((entry) => (
              <Card key={entry.href}>
                <CardHeader>
                  <CardTitle>{entry.label}</CardTitle>
                </CardHeader>
                <CardContent>
                  <Button asChild variant="outline">
                    <Link href={entry.href}>{t('فتح {resource}', { resource: entry.label })}</Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t('ستظهر هنا وحدات العمل المتاحة لحسابك.')}
          </p>
        )}
      </div>
    </>
  )
}

Home.layout = (props: { user?: unknown }) => (props.user ? Workspace : Layout)
