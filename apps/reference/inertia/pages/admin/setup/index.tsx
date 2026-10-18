import { Link } from '@adonisjs/inertia/react'
import { useState, type ReactElement } from 'react'
import { Head, router } from '@inertiajs/react'
import type { setupSnapshot } from '#services/initial_setup'
import Workspace from '~/layouts/workspace'
import { AdminHeader } from '~/components/admin-nav'
import { MailTest } from '~/components/mail-test'
import { Button } from '~/components/ui/button'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '~/components/ui/card'
import { Badge } from '~/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '~/components/ui/dialog'

type Props = Awaited<ReturnType<typeof setupSnapshot>>
const guides = {
  identity: {
    title: 'هوية الشركة',
    text: 'راجع الاسم والشعار والألوان والخطوط قبل الاعتماد. الهوية المثبتة مملوكة للمشروع؛ تُستكمل في docs/design-identity.md وcompany-identity.json وملفات brand. الاعتماد هنا يسجل موافقتك على الهوية المعروضة ولا يغيّر ملفاتها.',
  },
  mail: {
    title: 'إعداد البريد',
    text: 'اضبط SMTP_HOST وSMTP_PORT وSMTP_USERNAME وSMTP_PASSWORD وMAIL_FROM_NAME وMAIL_FROM_ADDRESS في بيئة النظام، ثم أعد تشغيل الخادم والعامل. استخدم عنوان مرسل موثقًا لدى مزودك واتبع تعليماته لتوثيق النطاق. لا تضع كلمات المرور في الإعدادات العامة أو مستودع المشروع. بعد ذلك أرسل تجربة وأكد استلامها.',
  },
  storage: {
    title: 'إعداد الملفات',
    text: 'التخزين المحلي متاح افتراضيًا ويحتاج مساحة دائمة. لاستخدام S3 اضبط DRIVE_DISK=s3 وAWS_ACCESS_KEY_ID وAWS_SECRET_ACCESS_KEY وAWS_REGION وS3_BUCKET وAWS_ENDPOINT عند الحاجة. أعد التشغيل ثم افحص التخزين. نقل الملفات القائمة يحتاج أمر adula:storage:migrate الموثق؛ تغيير الإعداد وحده لا ينقلها.',
  },
  runtime: {
    title: 'تشغيل الخدمات الخلفية',
    text: 'تحقق من اتصالات PostgreSQL وRedis في بيئة النظام. شغّل node ace adula:worker باستمرار، وعملية واحدة فقط من node ace scheduler:run تحت مدير عمليات أو خدمات النشر. نجاح الاتصال لا يثبت تنفيذ المهام؛ راقب نبضات التشغيل والطابور في صفحة تشغيل النظام.',
  },
  backup: {
    title: 'النسخ الاحتياطي والاستعادة',
    text: 'اضبط BACKUP_S3_ENDPOINT وBACKUP_S3_BUCKET وBACKUP_S3_REGION وBACKUP_S3_ACCESS_KEY_ID وBACKUP_S3_SECRET_ACCESS_KEY في بيئة التشغيل. شغّل خدمة النسخ المرفقة وحدد سياسة الاحتفاظ وفق احتياجك. افحص النسخة عبر node ace backup:verify، ثم نفّذ backup:restore-test على نسخة محمّلة من المخزن الخارجي. وجود الملفات لا يثبت استعادة سجل ومرفقه. لا تبدأ الاستعادة على قاعدة بيانات النظام الحالية.',
  },
  oauth: {
    title: 'الدخول الخارجي — اختياري',
    text: 'اضبط APP_URL ثم بيانات GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET أو GITHUB_CLIENT_ID/GITHUB_CLIENT_SECRET. سجل عنوان الرجوع APP_URL/oauth/google/callback أو APP_URL/oauth/github/callback لدى المزود. أعد التشغيل وجرّب الدخول في جلسة أخرى مع إبقاء جلسة المدير متاحة. لا يُعد المزود مختبرًا حتى ينجح الدخول الفعلي.',
  },
}

export default function SetupIndex(props: Props) {
  const [guide, setGuide] = useState<keyof typeof guides | null>(null)
  const [busy, setBusy] = useState(false)
  const post = (path: string, data = {}) => {
    setBusy(true)
    router.post(path, data, {
      preserveScroll: true,
      onFinish: () => setBusy(false),
      onSuccess: () => setGuide(null),
    })
  }
  const checkLabel = (check: Props['storage']) =>
    !check
      ? 'لم يُختبر'
      : !check.fresh
        ? 'يلزم فحص حديث'
        : check.status === 'passed'
          ? 'نجح الفحص'
          : check.status === 'failed'
            ? 'فشل الفحص'
            : 'الفحص جارٍ أو انقطع؛ يمكن إعادته بعد خمس دقائق'
  const runtimeReady =
    props.health.heartbeats.worker.healthy && props.health.heartbeats.scheduler.healthy
  return (
    <>
      <Head title="الإعداد الأولي" />
      <AdminHeader
        title="الإعداد الأولي"
        description="أكمل الخطوات واختبر نتائجها. تُحفظ حالتك لتتابع لاحقًا؛ اكتمال هذه الصفحة لا يحل محل قبول بيئة الإنتاج."
      >
        <Button variant="outline" disabled={busy} onClick={() => router.reload()}>
          تحديث الحالة
        </Button>
      </AdminHeader>
      <div className="mb-6 rounded-lg border bg-muted/30 p-4 text-sm">
        {props.environment === 'development'
          ? 'بيئة تطوير: يمكنك تجربة النظام قبل ربط الخدمات الخارجية.'
          : 'بيئة إنتاج: عالج الخدمات غير المختبرة أو المتعطلة قبل الاعتماد على وظائفها.'}{' '}
        بيانات الاتصال والأسرار تُضبط في بيئة النظام، ولا تظهر هنا.
      </div>
      <div className="mb-6 grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>١. هوية الشركة وتجربة الاستخدام</CardTitle>
            <CardDescription>{props.brand.company}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Badge variant="secondary">
              {props.identityConfirmed ? 'اعتمد المدير الهوية الحالية' : 'تحتاج مراجعة المدير'}
            </Badge>
            <p className="text-sm">
              {props.brand.logo
                ? 'يوجد شعار ضمن الهوية المثبتة.'
                : 'لم يُقدّم شعار؛ راجع الهوية المؤقتة قبل اعتمادها.'}
            </p>
            <div className="flex gap-3">
              <Button onClick={() => setGuide('identity')}>مراجعة الهوية</Button>
              <Button variant="outline" asChild>
                <Link href="/admin/settings">التقويم وتفضيلات الواجهة</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>٢. الإشعارات داخل النظام</CardTitle>
            <CardDescription>تحقق من وصول إشعار لحسابك وظهور حالة القراءة.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Badge variant="secondary">
              {props.notification?.read
                ? 'تمت قراءة الإشعار التجريبي'
                : props.notification
                  ? 'بانتظار قراءة الإشعار'
                  : 'لم يُختبر'}
            </Badge>
            <p className="text-sm">
              الإشعارات الداخلية متاحة. تفعيل البريد لا يحوّل كل إشعار تلقائيًا إلى رسالة بريدية.
            </p>
            <div className="flex gap-3">
              <Button disabled={busy} onClick={() => post('/admin/setup/notification')}>
                إرسال إشعار تجريبي
              </Button>
              <Button variant="outline" asChild>
                <Link href="/notifications">فتح الإشعارات</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
      <MailTest mailTest={props.mailTest} mailRecipient={props.mailRecipient} returnTo="setup" />
      <Button variant="link" className="mb-6" onClick={() => setGuide('mail')}>
        كيفية ضبط البريد بأمان
      </Button>
      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>٣. الملفات والمرفقات</CardTitle>
            <CardDescription>
              {props.storageDisk === 'local' ? 'التخزين المحلي' : 'تخزين S3'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Badge variant="secondary">{checkLabel(props.storage)}</Badge>
            <p className="text-sm">
              الفحص يكتب ملفًا تجريبيًا صغيرًا، يقرأه ويتحقق من مطابقته، ثم يحذفه.
            </p>
            {props.storage && (
              <p className="text-xs" dir="ltr">
                {props.storage.checkedAt}
              </p>
            )}
            <div className="flex gap-3">
              <Button disabled={busy} onClick={() => post('/admin/setup/check/storage')}>
                فحص التخزين
              </Button>
              <Button variant="outline" onClick={() => setGuide('storage')}>
                إعداد التخزين
              </Button>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>٤. الاتصال والخدمات الخلفية</CardTitle>
            <CardDescription>قاعدة البيانات وRedis والعامل والمجدول</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p>الاتصال: {checkLabel(props.infrastructure)}</p>
            <p>العامل: {props.health.heartbeats.worker.healthy ? 'نشط' : 'لا توجد نبضة حديثة'}</p>
            <p>
              المجدول: {props.health.heartbeats.scheduler.healthy ? 'نشط' : 'لا توجد نبضة حديثة'}
            </p>
            <Badge variant="secondary">
              {runtimeReady ? 'نبضات التشغيل حديثة' : 'تحتاج تشغيلًا أو فحصًا'}
            </Badge>
            <div className="flex flex-wrap gap-3">
              <Button disabled={busy} onClick={() => post('/admin/setup/check/infrastructure')}>
                فحص الاتصال
              </Button>
              <Button variant="outline" onClick={() => setGuide('runtime')}>
                تعليمات التشغيل
              </Button>
              <Button variant="link" asChild>
                <Link href="/admin/jobs">تشغيل النظام</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>٥. النسخ الاحتياطي</CardTitle>
            <CardDescription>نسخة خارجية مع اختبار استعادة مستقل</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p>
              {props.backup.configured ? 'بيانات المخزن الخارجي موجودة' : 'المخزن الخارجي غير مهيأ'}
            </p>
            <p>
              {props.backup.inspection?.healthy &&
              Date.now() - Date.parse(props.backup.inspection.checkedAt) < 86_400_000
                ? 'فحص ملفات النسخة حديث وناجح'
                : 'لا يوجد فحص حديث ناجح لملفات النسخة'}
            </p>
            <p>
              اختبار الاستعادة:{' '}
              {props.backup.restore?.status === 'passed' && props.backup.restore.fileVerified
                ? 'نجحت استعادة سجل ومرفقه؛ يلزم التأكد من أن مصدر النسخة خارجي'
                : props.backup.restore?.status === 'failed'
                  ? 'فشل آخر اختبار استعادة'
                  : 'لم تُثبت استعادة سجل ومرفقه'}
            </p>
            <Button variant="outline" onClick={() => setGuide('backup')}>
              إعداد النسخ والتحقق من الاستعادة
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>٦. الدخول الخارجي</CardTitle>
            <CardDescription>اختياري؛ تسجيل الدخول المحلي يبقى متاحًا</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {props.oauth.map((provider) => (
              <p key={provider.provider}>
                <span dir="ltr">{provider.provider}</span>:{' '}
                {provider.verifiedAt
                  ? `نجح دخول فعلي بتاريخ ${provider.verifiedAt}`
                  : provider.configured
                    ? 'مهيأ ولم يُثبت الدخول'
                    : 'غير مفعّل'}
              </p>
            ))}
            <Button variant="outline" onClick={() => setGuide('oauth')}>
              إعداد الدخول الخارجي
            </Button>
          </CardContent>
        </Card>
      </div>
      <Dialog mode="view" open={guide !== null} onOpenChange={(open) => !open && setGuide(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{guide ? guides[guide].title : ''}</DialogTitle>
            <DialogDescription>{guide ? guides[guide].text : ''}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            {guide === 'identity' && (
              <Button
                disabled={busy}
                onClick={() => post('/admin/setup/identity', { confirmed: true })}
              >
                أعتمد الهوية الحالية
              </Button>
            )}
            <Button variant="outline" onClick={() => setGuide(null)}>
              إغلاق
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
SetupIndex.layout = (page: ReactElement) => <Workspace>{page}</Workspace>
