import { useState, type ReactElement } from 'react'
import { Head } from '@inertiajs/react'
import { Settings2, TriangleAlert } from 'lucide-react'
import Workspace from '~/layouts/workspace'
import { AdminHeader } from '~/components/admin-nav'
import { MailSetupDialog } from '~/components/mail-setup'
import { MailTest, type MailTestProps } from '~/components/mail-test'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'

const SECURITY = { tls: 'TLS', starttls: 'STARTTLS', none: 'بلا تشفير' } as const

/**
 * The «البريد» tab of «الإعدادات» (owner decisions 16 and 22): the SMTP settings in force, the
 * form that saves them without a restart, and «إرسال بريد تجريبي». The password is write-only.
 */
export default function AdminMail(props: MailTestProps) {
  const { mailSettings: settings, mailReadiness, mailPresets, mailSettingsApply } = props
  const [setup, setSetup] = useState(false)
  const preset = mailPresets.find((item) => item.id === settings.preset)
  const rows: [string, ReactElement | string][] = [
    ['المزود', preset?.name ?? 'خادم آخر'],
    [
      'الخادم',
      <span key="host" dir="ltr">
        {settings.host}:{settings.port}
      </span>,
    ],
    ['الأمان', SECURITY[settings.security]],
    [
      'اسم المستخدم',
      settings.username ? (
        <span key="user" dir="ltr">
          {settings.username}
        </span>
      ) : (
        'بلا تسجيل دخول'
      ),
    ],
    [
      'كلمة المرور',
      <Badge
        key="password"
        variant={
          settings.passwordUnreadable ? 'destructive' : settings.hasPassword ? 'default' : 'outline'
        }
      >
        {settings.passwordUnreadable
          ? 'تعذّر فتحها'
          : settings.hasPassword
            ? 'محفوظة'
            : 'غير محفوظة'}
      </Badge>,
    ],
    [
      'المرسل',
      <span key="from" dir="ltr">
        {settings.fromName
          ? `${settings.fromName} <${settings.fromAddress}>`
          : settings.fromAddress}
      </span>,
    ],
  ]
  return (
    <>
      <Head title="البريد" />
      <AdminHeader
        title="البريد"
        description="اضبط خادم SMTP لدى مزودك من هنا، ويُطبَّق الحفظ على الرسالة التالية دون إعادة تشغيل. متغيرات البيئة بديل حين لا يوجد إعداد محفوظ."
      >
        <Button onClick={() => setSetup(true)}>
          <Settings2 />
          إعداد البريد
        </Button>
      </AdminHeader>
      {settings.passwordUnreadable && (
        <Alert variant="destructive" className="mb-6">
          <TriangleAlert />
          <AlertTitle>أدخل كلمة مرور البريد من جديد</AlertTitle>
          <AlertDescription>
            تعذّر فتح كلمة المرور المحفوظة، غالبًا بعد تغيير مفتاح التطبيق{' '}
            <code dir="ltr" className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
              APP_KEY
            </code>
            . لن يرسل النظام البريد دون تسجيل الدخول؛ افتح «إعداد البريد» وأدخل كلمة المرور، ثم
            احفظ.
          </AlertDescription>
        </Alert>
      )}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>الإعداد الحالي</CardTitle>
          <CardDescription>
            {mailReadiness.source === 'settings' ? (
              'يرسل النظام بالإعداد المحفوظ هنا.'
            ) : settings.configured && !mailSettingsApply ? (
              <>
                يرسل النظام بمتغيرات البيئة، لأن مسؤول الخادم ضبط{' '}
                <code dir="ltr" className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                  MAIL_SETTINGS_SOURCE=environment
                </code>
                .
              </>
            ) : (
              'لا إعداد محفوظ بعد، فيرسل النظام بمتغيرات البيئة.'
            )}
          </CardDescription>
        </CardHeader>
        {settings.configured && (
          <CardContent>
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
              {rows.map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="min-w-0 break-words">{value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        )}
      </Card>
      <MailTest {...props} setupButton={false} />
      <MailSetupDialog
        open={setup}
        onOpenChange={setSetup}
        mailReadiness={mailReadiness}
        mailPresets={mailPresets}
        mailSettings={settings}
        mailSettingsApply={mailSettingsApply}
      />
    </>
  )
}
AdminMail.layout = (page: ReactElement) => <Workspace>{page}</Workspace>
