import { TriangleAlert } from 'lucide-react'
import { Alert, AlertDescription } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { CopyButton } from '~/components/ui/copy-button'

/** One environment variable: its name, what to put in it and whether it can stay empty. */
export type GuideVariable = { name: string; value?: string; hint: string; optional?: boolean }

/** One numbered step: a short sentence, then optional variables or a command to copy. */
export type GuideStep = { text: string; variables?: GuideVariable[]; command?: string }

/** A setup guide shown in a dialog: one intro sentence, numbered steps and an optional warning. */
export type SetupGuide = { title: string; intro: string; steps: GuideStep[]; warning?: string }

export const setupGuides = {
  identity: {
    title: 'هوية الشركة',
    intro: 'الهوية المثبتة ملك للمشروع، والاعتماد هنا يسجل موافقتك عليها ولا يغيّر ملفاتها.',
    steps: [
      { text: 'راجع اسم الشركة وشعارها وألوانها وخطوطها كما تظهر في النظام.' },
      {
        text: 'لتعديل الهوية، يحدّثها فريق المشروع في هذه الملفات ثم يعيد بناء النظام:',
        variables: [
          { name: 'docs/design-identity.md', hint: 'وصف الهوية وحالة كل عنصر' },
          { name: 'company-identity.json', hint: 'الاسم والألوان والخطوط' },
          { name: 'inertia/css/brand.css', hint: 'ألوان الواجهة' },
        ],
      },
      { text: 'اضغط «أعتمد الهوية الحالية» عندما تطابق الهوية المعروضة ما تريده.' },
    ],
  },
  storage: {
    title: 'إعداد الملفات',
    intro:
      'يحفظ النظام الملفات محليًا افتراضيًا، ويلزم أن يكون مجلدها على مساحة دائمة. لاستخدام S3 اتبع الخطوات التالية.',
    steps: [
      {
        text: 'أضف المتغيرات التالية إلى بيئة النظام:',
        variables: [
          { name: 'DRIVE_DISK', value: 's3', hint: 'يحوّل التخزين إلى S3' },
          { name: 'AWS_ACCESS_KEY_ID', hint: 'مفتاح الوصول' },
          { name: 'AWS_SECRET_ACCESS_KEY', hint: 'المفتاح السري' },
          { name: 'AWS_REGION', hint: 'منطقة الحاوية' },
          { name: 'S3_BUCKET', hint: 'اسم الحاوية' },
          {
            name: 'AWS_ENDPOINT',
            hint: 'عنوان الخدمة لمزودي S3 من غير Amazon',
            optional: true,
          },
        ],
      },
      { text: 'أعد تشغيل الخادم والعامل.' },
      { text: 'اضغط «فحص التخزين» وتأكد من نجاحه.' },
      {
        text: 'انقل الملفات القائمة إلى S3، وجرّب الأمر أولًا مع --dry-run:',
        command: 'node ace adula:storage:migrate local s3',
      },
    ],
    warning: 'تغيير الإعداد وحده لا ينقل الملفات القائمة، والنقل لا يحذف النسخ الأصلية.',
  },
  runtime: {
    title: 'تشغيل الخدمات الخلفية',
    intro: 'يحتاج النظام قاعدة البيانات وRedis وعاملًا ومجدولًا يعملون باستمرار.',
    steps: [
      {
        text: 'تحقق من بيانات الاتصال في بيئة النظام:',
        variables: [
          { name: 'DB_HOST', hint: 'خادم PostgreSQL' },
          { name: 'REDIS_HOST', hint: 'خادم Redis' },
        ],
      },
      { text: 'شغّل العامل باستمرار تحت مدير عمليات:', command: 'node ace adula:worker' },
      { text: 'شغّل نسخة واحدة فقط من المجدول:', command: 'node ace scheduler:run' },
      { text: 'اضغط «فحص الاتصال»، ثم راقب النبضات والطابور في صفحة «تشغيل النظام».' },
    ],
    warning: 'نجاح الاتصال لا يثبت تنفيذ المهام؛ النبضات الحديثة وحدها تثبته.',
  },
  backup: {
    title: 'النسخ الاحتياطي والاستعادة',
    intro: 'يحفظ النظام نسخه في مخزن S3 خارجي، ويثبت صلاحيتها باختبار استعادة.',
    steps: [
      {
        text: 'أضف بيانات المخزن الخارجي إلى بيئة التشغيل:',
        variables: [
          { name: 'BACKUP_S3_ENDPOINT', hint: 'عنوان خدمة المخزن' },
          { name: 'BACKUP_S3_BUCKET', hint: 'اسم الحاوية' },
          { name: 'BACKUP_S3_REGION', hint: 'منطقة الحاوية' },
          { name: 'BACKUP_S3_ACCESS_KEY_ID', hint: 'مفتاح الوصول' },
          { name: 'BACKUP_S3_SECRET_ACCESS_KEY', hint: 'المفتاح السري' },
        ],
      },
      { text: 'شغّل خدمة النسخ المرفقة، وحدد مدة الاحتفاظ بالنسخ.' },
      { text: 'افحص النسخة:', command: 'node ace backup:verify' },
      {
        text: 'اختبر الاستعادة على نسخة محمّلة من المخزن الخارجي:',
        command: 'node ace backup:restore-test',
      },
    ],
    warning:
      'وجود الملفات لا يثبت إمكانية الاستعادة. لا تبدأ الاستعادة على قاعدة بيانات النظام الحالية.',
  },
  oauth: {
    title: 'الدخول الخارجي — اختياري',
    intro: 'يمكن للمستخدمين الدخول بحساب Google أو GitHub أو Microsoft.',
    steps: [
      {
        text: 'تأكد من ضبط عنوان النظام، ثم أضف بيانات مزود واحد أو أكثر:',
        variables: [
          { name: 'APP_URL', hint: 'عنوان النظام العام' },
          { name: 'GOOGLE_CLIENT_ID', hint: 'Google', optional: true },
          { name: 'GOOGLE_CLIENT_SECRET', hint: 'Google', optional: true },
          { name: 'GITHUB_CLIENT_ID', hint: 'GitHub', optional: true },
          { name: 'GITHUB_CLIENT_SECRET', hint: 'GitHub', optional: true },
          { name: 'MICROSOFT_CLIENT_ID', hint: 'Microsoft', optional: true },
          { name: 'MICROSOFT_CLIENT_SECRET', hint: 'Microsoft', optional: true },
          { name: 'MICROSOFT_TENANT_ID', hint: 'Microsoft', optional: true },
        ],
      },
      {
        text: 'سجّل عنوان الرجوع لدى المزود، واستبدل <provider> بـ google أو github أو microsoft:',
        command: 'APP_URL/oauth/<provider>/callback',
      },
      { text: 'أعد تشغيل الخادم.' },
      { text: 'جرّب الدخول في نافذة أخرى، وأبقِ جلسة المدير مفتوحة.' },
    ],
    warning: 'لا يُعد المزود جاهزًا حتى ينجح دخول فعلي به.',
  },
} satisfies Record<string, SetupGuide>

export type SetupGuideKey = keyof typeof setupGuides

function Variable({ variable }: { variable: GuideVariable }) {
  const text = variable.value ? `${variable.name}=${variable.value}` : variable.name
  return (
    <li className="flex items-center gap-2">
      <code dir="ltr" className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
        {text}
      </code>
      <span className="text-muted-foreground">{variable.hint}</span>
      {variable.optional && <Badge variant="outline">اختياري</Badge>}
      <CopyButton
        value={text}
        iconOnly
        ariaLabel={`نسخ ${text}`}
        className="ms-auto size-7 shrink-0"
      />
    </li>
  )
}

/** Renders a guide as an ordered list of steps; dialogs place it in their body. */
export function SetupGuideSteps({ guide }: { guide: SetupGuide }) {
  return (
    <div className="space-y-4 text-sm">
      <ol className="list-decimal space-y-3 ps-5" data-testid="setup-guide-steps">
        {guide.steps.map((step) => (
          <li key={step.text} className="space-y-2 ps-1">
            <p>{step.text}</p>
            {step.variables && (
              <ul className="space-y-1.5" aria-label="المتغيرات">
                {step.variables.map((variable) => (
                  <Variable key={variable.name} variable={variable} />
                ))}
              </ul>
            )}
            {step.command && (
              <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-2">
                <code dir="ltr" className="flex-1 font-mono text-xs break-all">
                  {step.command}
                </code>
                <CopyButton
                  value={step.command}
                  iconOnly
                  ariaLabel={`نسخ ${step.command}`}
                  className="size-7 shrink-0"
                />
              </div>
            )}
          </li>
        ))}
      </ol>
      {guide.warning && (
        <Alert>
          <TriangleAlert />
          <AlertDescription>{guide.warning}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}
