# درس تطبيقي: بناء تطبيق طلبات الإجازة

النسخة الإنجليزية: [Tutorial: build a leave-requests application](../tutorial-leave-requests.md)

في هذا الدرس نبني **تطبيقًا** واحدًا هو «طلبات الإجازة» داخل **نظام** جديد. القصة كالتالي: موظف في «شركة المثال» يقدّم طلب إجازة مرضية لثلاثة أيام؛ يوافق عليه مديره المباشر أو يرفضه عبر سير عمل له موعد نهائي، أي اتفاقية مستوى الخدمة (SLA)، وتصعيد إن تأخر؛ وحين يسافر المدير يفوّض موافقاته إلى زميل؛ ويصفّي الموظفون القائمة ويحفظون طرق العرض؛ وتعرض لوحة مؤشرات عدد الطلبات.

ما ستستخدمه:

| الميزة | أين تُشرح |
| --- | --- |
| `npm create adulajs` والخدمات | [التثبيت](installation.md) |
| `adula:app` والأدوار الافتراضية و`adula:install` | [التطبيقات](applications.md) |
| `defineResource` وأنواع الحقول و`adula:resource:migration` | [تعريف الموارد](resources.md) والمرجع المولَّد بالإنجليزية [defineResource reference](../reference/define-resource.md) (كل خيار وكل خاصية حقل) |
| سير العمل والتفويض ومواعيد SLA | [Business features](../business-features.md#documents-and-workflows)، [ADR 044](../decisions/044-workflow-engine.md) |
| مرشّحات القوائم وطرق العرض المحفوظة ولوحات المؤشرات | [Business features](../business-features.md#lists-filters-export-bulk-actions-and-deleted-records)، [ADR 046](../decisions/046-list-layer.md) |

تعدد الملفات في حقل المرفق مع المعاينة داخل الصفحة ([ADR 047](../decisions/047-multiple-attachments-and-preview.md))، وقوالب الطباعة ([ADR 048](../decisions/048-print-templates.md))، خارج نطاق هذا الدرس؛ راجع [تعريف الموارد](resources.md).

تنتهي كل خطوة بفقرة **ما يجب أن تراه**، وهي النتيجة التي تتحقق منها قبل الانتقال إلى الخطوة التالية.

## قبل أن تبدأ

* Node.js الإصدار 24 أو أحدث، ومعه npm.
* للخدمات الافتراضية: Docker مع Compose، مثبّتًا ويعمل. أو بدلًا منه خادم PostgreSQL 17 (بدور يملك صلاحية `CREATEDB`) وRedis 7 خاصّان بك (الخطوة 1، الخيار ب).
* كل الأوامر تُشغَّل في مجلد النظام. مع خدمات Docker الافتراضية أبقِ `npm run services` يعمل في طرفية ثانية ما دمت تستخدم `node ace …`، أو اكتب `npm run ace -- …` بدل `node ace …`؛ فهذه الصيغة تشغّل الخدمات بنفسها.

<!-- step:1 -->
## الخطوة 1: إنشاء النظام

**الخيار أ، الافتراضي (Docker).** بطريقة تفاعلية:

```sh
npm create adulajs leave-demo
```

أو دون أسئلة:

```sh
npx create-adulajs@latest leave-demo --company "شركة المثال" --admin-email admin@example.com --yes
```

**الخيار ب، خدمات قائمة.** اكتب ملفًا خاصًّا `local.json` خارج مجلد المشروع:

```json
{
  "postgres": {
    "host": "127.0.0.1",
    "port": 5432,
    "user": "adula",
    "password": "YOUR_LOCAL_PASSWORD"
  },
  "redis": { "host": "127.0.0.1", "port": 6379 }
}
```

ثم:

```sh
npx create-adulajs@latest leave-demo --company "شركة المثال" --admin-email admin@example.com --services existing --connection ./local.json --yes
```

يرفض المُنشئ مجلد وجهة فيه محتوى، واسم قاعدة بيانات موجودًا مسبقًا. كل الخيارات مذكورة في [ملف README للمُنشئ](../../packages/create-adulajs/README.md).

شغّل النظام:

```sh
cd leave-demo
npm run dev
```

**ما يجب أن تراه:** ست مراحل تثبيت تنتهي دون خطأ؛ بريد المدير وكلمة مروره المولَّدة في `tmp/dev-admin.txt`؛ وبعد `npm run dev` صفحة تسجيل الدخول على العنوان المطبوع في الطرفية (وهو `APP_URL` للنظام، ومكتوب أيضًا في ملف README الخاص به). سجّل الدخول بحساب المدير: تعرض القائمة الجانبية «نظرة عامة» و«مهامي» وشاشات الإدارة، ولا يوجد أي تطبيق عمل بعد.

<!-- step:2 -->
## الخطوة 2: توليد هيكل التطبيق

```sh
node ace adula:app leave_requests --label-ar="طلبات الإجازة" --label-en="Leave requests" --dry-run
node ace adula:app leave_requests --label-ar="طلبات الإجازة" --label-en="Leave requests"
```

اسم التطبيق هو أيضًا اسم المورد المثال وجدوله ودوريه الافتراضيين، فتسمية التطبيق `leave_requests` تعطيك المورد `leave_requests` مباشرة. (لو استخدمت `adula:app leave` لحصلت على مورد اسمه `leave`، ولاحتجت إلى إضافة `leave_requests` بالأمر `node ace adula:resource leave_requests --module=leave`؛ واختبار الفحص السريع (smoke test) المولَّد يتوقع المورد المثال، لذلك يُبقي هذا الدرس اسمًا واحدًا.)

**ما يجب أن تراه:** التشغيل التجريبي (`--dry-run`) يسرد المجلدات والملفات ولا ينشئ شيئًا. والتشغيل الفعلي يطبع هذه الملفات والسطر `Registered module_leave_requests in start/modules.ts`:

```text
app/modules/leave_requests/module.ts
app/modules/leave_requests/resources/leave_requests.ts
app/modules/leave_requests/migrations/<timestamp>_create_leave_requests.ts
tests/functional/leave_requests.spec.ts
tests/functional/leave_requests/smoke.spec.ts
```

**لا** تشغّل `migration:run` بعد: الخطوة 4 تعدّل ترحيل الإنشاء أولًا.

<!-- step:3 -->
## الخطوة 3: تعريف المورد

استبدل محتوى `app/modules/leave_requests/resources/leave_requests.ts` بما يلي:

```ts
import { defineResource } from 'adula'

const options = <const T extends string>(entries: [T, string, string][]) =>
  entries.map(([value, ar, en]) => ({ value, label: { ar, en } }))

// The fields are the source of truth: validation, columns and forms derive from them (ADR 045).
export default defineResource({
  name: 'leave_requests',
  label: { ar: 'طلبات الإجازة', en: 'Leave requests' },
  recordLabel: { ar: 'طلب إجازة', en: 'Leave request' },
  scoped: true,
  // A document: draft, submit (starts the workflow), cancel, amend by copy.
  submittable: true,
  version: true,
  fields: {
    // Kept from the scaffold: its column already exists and is required.
    title: {
      type: 'string',
      required: true,
      searchable: true,
      max: 120,
      label: { ar: 'موضوع الطلب', en: 'Subject' },
    },
    employee: {
      type: 'user',
      required: true,
      filterable: true,
      sortable: true,
      label: { ar: 'الموظف', en: 'Employee' },
    },
    leaveType: {
      type: 'enum',
      required: true,
      default: 'annual',
      filterable: true,
      sortable: true,
      options: options([
        ['annual', 'سنوية', 'Annual'],
        ['sick', 'مرضية', 'Sick'],
        ['emergency', 'اضطرارية', 'Emergency'],
        ['unpaid', 'بدون راتب', 'Unpaid'],
      ]),
      label: { ar: 'نوع الإجازة', en: 'Leave type' },
    },
    startDate: {
      type: 'date',
      required: true,
      filterable: true,
      sortable: true,
      label: { ar: 'تاريخ البداية', en: 'Start date' },
    },
    endDate: {
      type: 'date',
      required: true,
      filterable: true,
      sortable: true,
      label: { ar: 'تاريخ النهاية', en: 'End date' },
    },
    days: {
      type: 'decimal',
      precision: 5,
      scale: 1,
      min: '0.5',
      max: '365',
      required: true,
      filterable: true,
      sortable: true,
      label: { ar: 'عدد الأيام', en: 'Days' },
    },
    // Shown, accepted and stored only while the leave type is sick; null otherwise.
    medicalCertificate: {
      type: 'attachment',
      accept: ['pdf', 'jpg', 'jpeg', 'png'],
      maxSize: '5mb',
      visibleWhen: { leaveType: 'sick' },
      label: { ar: 'التقرير الطبي', en: 'Medical certificate' },
    },
    reason: { type: 'text', max: 2000, label: { ar: 'السبب', en: 'Reason' } },
    // Not in the form: set to pending on create, then by the workflow (step 5).
    status: {
      type: 'enum',
      default: 'pending',
      filterable: true,
      options: options([
        ['pending', 'قيد الاعتماد', 'Pending'],
        ['approved', 'موافق عليه', 'Approved'],
        ['rejected', 'مرفوض', 'Rejected'],
      ]),
      label: { ar: 'حالة الاعتماد', en: 'Approval status' },
    },
  },
  list: ['title', 'employee', 'leaveType', 'startDate', 'endDate', 'days', 'status'],
  form: [
    'title',
    'employee',
    'leaveType',
    'startDate',
    'endDate',
    'days',
    'medicalCertificate',
    'reason',
  ],
  show: [
    'title',
    'employee',
    'leaveType',
    'startDate',
    'endDate',
    'days',
    'medicalCertificate',
    'reason',
    'status',
  ],
  actions: ['view', 'create', 'update', 'delete', 'submit', 'cancel', 'amend'],
})
```

ماذا تفعل أنواع الحقول هنا (القائمة الكاملة للخصائص في [المرجع](../reference/define-resource.md)):

* `user`: مفتاح أجنبي إلى `users`؛ تعرض أداة الاختيار الأعضاء النشطين في الوحدة التنظيمية للسجل أو في الوحدات الأعلى منها، ولا يرى القارئ إلا اسم العرض.
* `enum`: قيمة واحدة من `options`؛ و`default` تملأ نموذج الإنشاء وتصبح القيمة الافتراضية للعمود.
* `date`: بالصيغة `YYYY-MM-DD`؛ و`decimal`: نص فيه عدد `scale` من المنازل العشرية بالضبط (`"3.0"`).
* `attachment` مع `visibleWhen`: مخفي ويُخزَّن فارغًا (null) إلا إذا كان `leaveType` يساوي `sick`. مثال: تختار الموظفة «مرضية» فيظهر حقل التقرير الطبي، وتعود إلى «سنوية» فيختفي.

**ما يجب أن تراه:** لا شيء بعد؛ يفحص `defineResource` التعريف حين يبدأ النظام في الخطوة التالية (وأي خطأ يوقف الأمر برسالة تذكر اسم الحقل).

<!-- step:4 -->
## الخطوة 4: إنشاء الجدول وتوسيعه

يضيف `adula:resource:migration` أعمدة الحقول وجداول الربط والفهارس الفريدة، لكنه لا يضيف أعمدة المستند الخاصة بـ `submittable`/`version` (`doc_status` و`amended_from_id` و`version`). أعلن هذه في ترحيل الإنشاء المولَّد **قبل تشغيله**. افتح `app/modules/leave_requests/migrations/<timestamp>_create_leave_requests.ts` وأضف السطرين بعد `"scoped": true,`، فيصبح الملف هكذا:

```ts
import { BaseSchema } from '@adonisjs/lucid/schema'
import { createResourceTable } from 'adula'
export default class extends BaseSchema {
  async up() { await createResourceTable(this.db.getWriteClient(), {
  "name": "leave_requests",
  "scoped": true,
  "version": true,
  "submittable": true,
  "fields": {
    "title": {
      "type": "string",
      "label": {
        "ar": "العنوان",
        "en": "Title"
      },
      "required": true,
      "searchable": true
    }
  }
}) }
  async down() { throw new Error('Use an expand/contract migration or restore a backup') }
}
```

لا تعدّل أبدًا ترحيلًا سبق تشغيله. ثم:

```sh
node ace migration:run
node ace adula:resource:migration leave_requests
```

**ما يجب أن تراه:** يسرد `adula:resource:migration` ما ينقص الجدول ويكتب ملفًا واحدًا (بعد سطر Lucid `Schema classes generated`):

```text
[ info ] leave_requests.employee: column is missing
[ info ] leave_requests.leave_type: column is missing
[ info ] leave_requests.start_date: column is missing
[ info ] leave_requests.end_date: column is missing
[ info ] leave_requests.days: column is missing
[ info ] leave_requests.medical_certificate: column is missing
[ info ] leave_requests.reason: column is missing
[ info ] leave_requests.status: column is missing
[ success ] app/modules/leave_requests/migrations/<timestamp>_alter_leave_requests.ts
[ info ] Review the migration, then run migration:run after the deployment backup.
```

راجع ذلك الملف (يحمل الحقول الجديدة فقط ويستدعي `alterResourceTable`)، ثم:

```sh
node ace migration:run
node ace adula:resource:migration leave_requests
node ace adula:doctor
```

**ما يجب أن تراه:** يجيب التشغيل الثاني لـ `adula:resource:migration` بـ `leave_requests: the database already has every column, join table and unique index.`، ويبلّغ `adula:doctor` عن `PASS resources.schema: Every resource table matches its definition`. الأعمدة المضافة إلى جدول موجود لا تكون `NOT NULL` إلا إذا كان الحقل مطلوبًا وله قيمة افتراضية (`leave_type`)؛ أما `status` فيحصل على القيمة الافتراضية `pending` للعمود لكنه يبقى قابلًا للفراغ، وكذلك بقية الأعمدة، ويبقى شرط `required` مفروضًا في كل عملية كتابة.

<!-- step:5 -->
## الخطوة 5: سير عمل الموافقة

أنشئ الملف `app/modules/leave_requests/workflows/leave_approval.ts`:

```ts
import { defineWorkflow } from 'adula'

/**
 * Every submitted leave request needs the line manager's approval within 24 hours.
 * Four hours before the deadline the approvers get a reminder; once it passes, the HR
 * role is told as well (ADR 044). Rejection cancels the document.
 */
export default defineWorkflow({
  name: 'leave_approval',
  version: 1,
  resource: 'leave_requests',
  label: 'اعتماد طلبات الإجازة',
  start: 'manager',
  steps: {
    manager: {
      type: 'approval',
      label: 'موافقة المدير المباشر',
      assignees: { role: 'leave_requests_manager' },
      sla: {
        hours: 24,
        dueSoonHours: 4,
        escalate: { action: 'notify', to: { role: 'leave_requests_hr' } },
      },
      approve: 'mark_approved',
      reject: 'mark_rejected',
    },
    mark_approved: {
      type: 'update',
      label: 'تعليم الطلب كمعتمد',
      values: { status: 'approved' },
      next: 'tell_approved',
    },
    tell_approved: { type: 'notify', label: 'إبلاغ مقدم الطلب', to: 'submitter', next: 'approved' },
    approved: { type: 'end', label: 'معتمد', outcome: 'approved' },
    mark_rejected: {
      type: 'update',
      label: 'تعليم الطلب كمرفوض',
      values: { status: 'rejected' },
      next: 'tell_rejected',
    },
    tell_rejected: { type: 'notify', label: 'إبلاغ مقدم الطلب', to: 'submitter', next: 'rejected' },
    rejected: { type: 'end', label: 'مرفوض', outcome: 'rejected', cancelDocument: true },
  },
})
```

أسماء ينبغي معرفتها:

* `assignees: { role: 'leave_requests_manager' }` يذكر **المفتاح** الثابت للدور، لا اسمه العربي؛ فيستطيع المديرون إعادة تسمية الدور دون أن يتعطل سير العمل.
* `sla.escalate.action` قيمته `'overdue'` (الافتراضي: إبلاغ المعتمِدين)، أو `'notify'` (إبلاغ `to` أيضًا)، أو `'reassign'` (نقل الموافقة إلى `to`). ويمكن أن تكون `to` أيضًا `{ manager: roleKey }`: أي حاملي ذلك الدور الممنوح لوحدة المعتمِد التنظيمية أو لأقرب وحدة أعلى منها (الدور الممنوح دون وحدة، للنظام كله، لا يُحتسب).
* أنواع الخطوات الأخرى: `condition` و`decision` و`delay` و`http`.
* لتغيير سير العمل أضف تعريفًا ثانيًا بـ `version: 2` وأبقِ الإصدار 1 في `workflows`. التشغيلات الجديدة تستخدم أحدث إصدار، والطلبات الجارية تحتفظ بإصدارها.

**ما يجب أن تراه:** لا شيء بعد؛ يُسجَّل سير العمل في الخطوة التالية.

<!-- step:6 -->
## الخطوة 6: تسجيل سير العمل والأدوار

استبدل محتوى `app/modules/leave_requests/module.ts` بما يلي:

```ts
import { ACTOR_ID, type Module } from 'adula'
import resource_leave_requests from './resources/leave_requests.js'
import leaveApproval from './workflows/leave_approval.js'
// adula:imports
export default {
  name: 'leave_requests',
  label: {
    ar: 'طلبات الإجازة',
    en: 'Leave requests',
  },
  dependsOn: [],
  resources: [resource_leave_requests /* adula:resources */],
  workflows: [leaveApproval],
  // Created by `node ace adula:install` when missing; administrators own them afterwards.
  defaultRoles: [
    {
      key: 'leave_requests_manager',
      name: 'مدير طلبات الإجازة',
      permissionLevel: 1,
      rules: [
        { subject: 'leave_requests', action: 'view' },
        { subject: 'leave_requests', action: 'create' },
        { subject: 'leave_requests', action: 'update' },
        { subject: 'leave_requests', action: 'delete' },
        { subject: 'leave_requests', action: 'submit' },
        { subject: 'leave_requests', action: 'cancel' },
        { subject: 'leave_requests', action: 'amend' },
      ],
    },
    {
      key: 'leave_requests_user',
      name: 'مستخدم طلبات الإجازة',
      rules: [
        // Each user reads, edits and submits only the requests they created.
        {
          subject: 'leave_requests',
          action: 'view',
          conditions: { createdBy: ACTOR_ID },
        },
        { subject: 'leave_requests', action: 'create' },
        {
          subject: 'leave_requests',
          action: 'update',
          conditions: { createdBy: ACTOR_ID },
        },
        {
          subject: 'leave_requests',
          action: 'submit',
          conditions: { createdBy: ACTOR_ID },
        },
      ],
    },
    {
      // Told when an approval passes its deadline (the SLA escalation in step 5).
      key: 'leave_requests_hr',
      name: 'الموارد البشرية - الإجازات',
      rules: [{ subject: 'leave_requests', action: 'view' }],
    },
  ],
} satisfies Module
```

قاعدة `submit` لازمة لأن المورد قابل للاعتماد (submittable): دونها لا يستطيع أحد غير المدير اعتماد الطلب. وقاعدة `view` في دور المستخدم تحمل `conditions: { createdBy: ACTOR_ID }` لأن طلب الإجازة قد يحتوي تقريرًا طبيًا، وهو بيانات صحية: دون هذا الشرط يستطيع كل موظف في الوحدة قراءة طلبات زملائه. أما دورا المدير والموارد البشرية فيقرآن كل طلبات وحدتهما.

أنشئ الأدوار (العنوان هو بريد المدير من `tmp/dev-admin.txt`):

```sh
node ace adula:install --admin-email=admin@example.com
```

يضيف `adula:install` الأدوار وقيم القوائم المرجعية الناقصة، ولا يغيّر أبدًا ما هو موجود. إذا شغّلته قبل تعديل `defaultRoles` فعدّل الأدوار الموجودة من `/admin/roles` بدلًا من ذلك.

**ما يجب أن تراه:** السطر
`Module defaults: 0 lookup rows added; roles created: leave_requests_manager, leave_requests_user, leave_requests_hr; adopted by name: none`
ثم `Core installation complete. Run adula:doctor.` وفي `/admin/roles` تظهر الأدوار الثلاثة بقواعدها. وتشغيل الأمر مرة أخرى يبلّغ عن `roles created: none`.

<!-- step:7 -->
## الخطوة 7: تحديث اختبار العقد المولَّد

يفحص `tests/functional/leave_requests.spec.ts` عقد الأمان للمورد عبر بروتوكول نقل النص التشعبي (HTTP) (العزل بين الوحدات، والحقول المخفية، والإصدارات القديمة، والحذف المؤقت، والمرفقات التي تخص سجلات أخرى). يجب أن تسرد بياناته كل حقول النموذج. استبدل محتوى الملف بما يلي:

```ts
import { resourceContract } from '#tests/helpers/resource_contract'

// Extend this fixture whenever the resource form or its validator changes.
resourceContract('leave_requests', ({ userId, unique }) => {
  const values = {
    title: `إجازة مرضية ${unique}`,
    employee: userId,
    leaveType: 'sick',
    startDate: '2026-11-01',
    endDate: '2026-11-03',
    days: '3.0',
    // Optional, and accepted only while leaveType is sick.
    medicalCertificate: null,
    reason: 'مراجعة طبية',
  }
  const changed = { ...values, endDate: '2026-11-04', days: '4.0' }
  return {
    input: values,
    // status is not in the form: the definition's default fills it.
    expected: { ...values, status: 'pending' },
    update: changed,
    updated: { ...changed, status: 'pending' },
  }
})
```

شغّل اختبارات التطبيق:

```sh
npm test -- functional --files=leave_requests --files=leave_requests/smoke
```

**ما يجب أن تراه:** `PASSED` و`Tests  16 passed (16)`: تنجح المجموعتان `HTTP security contract: leave_requests` و`leave_requests application smoke test` (يطبع المُبلِّغ الافتراضي نقطة لكل اختبار، ولا يذكر اسم مجموعة إلا إذا فشل أحد اختباراتها). تستخدم الاختبارات قاعدة البيانات المنفصلة `_test`.

<!-- step:8 -->
## الخطوة 8: تقديم طلب واعتماده في المتصفح

أعد تشغيل `npm run dev` (فهو يشغّل أيضًا العامل الذي يبدأ سير العمل). تحتاج إلى ثلاثة حسابات غير حساب المدير:

| الشخص | الدور | الوحدة التنظيمية |
| --- | --- | --- |
| الموظف | `مستخدم طلبات الإجازة` | الوحدة نفسها للثلاثة |
| المدير المباشر | `مدير طلبات الإجازة` | |
| موظف الموارد البشرية | `الموارد البشرية - الإجازات` | |

أضف الأشخاص من `/admin/users` ← «إضافة مستخدم» (دعوة بالبريد). الدعوات تحتاج خادم بريد (SMTP): في بيئة التطوير يرسل النظام إلى `127.0.0.1:1025`، فشغّل هناك أداة محلية لالتقاط البريد، مثل `docker run -d --name mailpit -p 127.0.0.1:1025:1025 -p 127.0.0.1:8025:8025 axllent/mailpit`، وافتح رابط الدعوة من صندوقها على `http://127.0.0.1:8025`.

إن لم تكن لديك أداة لالتقاط البريد، فافتح التسجيل الذاتي لجلسة التطوير هذه بدلًا من ذلك (فهو مغلق ما دام يوجد مدير): شغّل الخادم بالأمر `SIGNUP_ENABLED=true npm run dev` (وفي PowerShell: `$env:SIGNUP_ENABLED='true'; npm run dev`)، ودع كل شخص يسجّل من `/signup`، ثم أعد تشغيل `npm run dev` دون هذا المتغير. تظل الإشعارات تظهر داخل النظام (الجرس)؛ وإنما تفشل نسختها البريدية فقط دون SMTP.

بعد أن يصبح لكل شخص حساب، افتحه في `/admin/users` وأعطه دوره («الأدوار») ووحدته التنظيمية («الوحدات التنظيمية»).

1. بصفتك الموظف، افتح «طلبات الإجازة» ← «إضافة طلب إجازة». يبدأ «نوع الإجازة» بالقيمة «سنوية». اختر «مرضية»: يظهر الحقل «التقرير الطبي»؛ اختر «سنوية»: يختفي. املأ الحقول المطلوبة (مثلًا: من 2026-11-01 إلى 2026-11-03، وعدد الأيام 3) واختر «حفظ السجل».
2. في صفحة السجل اختر «اعتماد المستند» وأكّد بـ «تأكيد» لتقديمه.
3. بصفتك المدير المباشر، افتح «مهامي» (`/my-tasks?tab=approvals`)، واختر «موافقة» على الطلب، وأكّد بـ «موافقة» في النافذة (الملاحظة اختيارية).

**ما يجب أن تراه:** بعد الخطوة 1 يعرض السجل الشارة «مسودة» و«حالة الاعتماد» = «قيد الاعتماد». بعد الخطوة 2 تصبح شارة المستند «معتمد» (أي قُدِّم المستند، والموافقة ما زالت مفتوحة)، وتعرض لوحة «سير العمل» في السجل «بانتظار موافقة» والخطوة «موافقة المدير المباشر» وحالة الموعد «في الموعد»، وتظهر الموافقة في «مهامي» لدى المدير. بعد الخطوة 3 تصبح «حالة الاعتماد» = «موافق عليه» ويتلقى الموظف إشعارًا.
أما الطلب المرفوض فتصبح «حالة الاعتماد» فيه «مرفوض» ويُلغى مستنده. والتشغيلات الفاشلة يجدها المديرون في `/admin/workflows`.

<!-- step:9 -->
## الخطوة 9: تفويض الموافقات أثناء الغياب

بصفتك المدير المباشر، افتح قائمة الحساب ← «التفويض أثناء الغياب» (`/account/delegations`) ← «تفويض جديد». في «المفوَّض إليه» اختر موظف الموارد البشرية (اكتب حرفين على الأقل من اسمه)، واختر «من تاريخ» و«إلى تاريخ» بحيث يشمل المدى اليوم، ثم اختر «حفظ التفويض»؛ فتعرض الصفحة «موافقاتك مفوّضة الآن إلى …». بعدها، بصفتك الموظف، قدّم طلبًا جديدًا.

* الموافقات التي تُفتح للمدير بعد بدء التفويض تُحوَّل إلى المفوَّض إليه وتُعلَّم «نيابة عن ...»، بشرط أن يستطيع المفوَّض إليه عرض السجل (هنا عبر قاعدة `view` في دور الموارد البشرية).
* ما دام التفويض ساريًا يستطيع المفوَّض إليه أيضًا البت في موافقات المدير التي كانت مفتوحة مسبقًا؛ وهذه لا تُحوَّل ولا تحمل علامة «نيابة عن».
* يظل المدير يرى كل الموافقات ويستطيع البت فيها؛ ويذكر سجل التشغيل من قرر ونيابة عن من.
* التفويض لا يوسّع الوصول إلى السجلات أبدًا، ولا يشمل المهام اليدوية، ولا يسمح لأحد باعتماد طلب قدّمه هو. والتحويل مرحلة واحدة فقط (لا يُحوَّل التفويض مرة ثانية).
* الأيام أيام تقويمية في المنطقة الزمنية للنظام، `timeZone` في `config/adula.ts` (`Asia/Riyadh` في النظام الجديد). ويدير المديرون تفويضات الجميع من `/admin/delegations`.

**ما يجب أن تراه:** تعرض «مهامي» لدى المفوَّض إليه الموافقة الجديدة «نيابة عن» المدير؛ يوافق عليها المفوَّض إليه أو يرفضها، ويعرض سجل الطلب الاسمين معًا. وإلغاء التفويض يعيد إلى المدير الموافقات المحوَّلة المفتوحة فقط.

للمزيد: [Delegation while out of office](../business-features.md#delegation-while-out-of-office).

<!-- step:10 -->
## الخطوة 10: المواعيد النهائية والتصعيد (SLA)

المهمة `sla:` ترسل التذكير بقرب الموعد وتنفّذ التصعيد. الملف `start/scheduler.ts` في النظام الجديد يجدولها كل دقيقة، لكن `npm run dev` لا يشغّل المجدول. شغّل دورة واحدة يدويًا:

```sh
node ace sla:evaluate
```

في بيئة الإنتاج شغّل نسخة واحدة بالضبط من `node ace scheduler:run` بجوار العامل.

**ما يجب أن تراه:** `SLA: 0 reminders, 0 escalations` ما دامت كل الموافقات في موعدها. الموافقة التي مضى عليها 20 ساعة تُبلَّغ بتذكير واحد (القالب `workflow.sla_due_soon`) وتعرض «يقترب الموعد»؛ وبعد 24 ساعة تعرض «متأخر» ويُبلَّغ دور الموارد البشرية (`workflow.sla_overdue` و`workflow.sla_escalated`). كل دورة لا يضرها التكرار: إعادتها لا ترسل شيئًا مرتين. ساعات SLA ساعات فعلية متصلة؛ لا يوجد تقويم لأيام العمل.

للمزيد: [SLA deadlines and escalation](../business-features.md#sla-deadlines-and-escalation).

<!-- step:11 -->
## الخطوة 11: المرشّحات وطرق العرض المحفوظة

كل حقل `filterable` يُعرض تحت «تصفية» في القائمة حسب نوعه: «أيٌّ من» لحقول enum وuser، و«من / إلى» للتواريخ وعدد الأيام العشري، و«فارغ / غير فارغ» للجميع. والمرشّحات نفسها تعمل في الرابط (URL):

```text
/resources/leave_requests?filters[leaveType][in]=sick,emergency&filters[startDate][gte]=2026-11-01
/resources/leave_requests?filters[days][gte]=5&filters[status][in]=pending
/resources/leave_requests?filters[reason][empty]=true
```

المرشّح على حقل ليس `filterable` (هنا `reason`)، أو بعامل غير معروف، أو بقيمة غير صحيحة، يُرفض بالخطأ 422 `E_FILTER`؛ أضف `filterable: true` إلى `reason` لتسمح بالسطر الأخير.

جرّب ذلك بصفتك المدير المباشر أو موظف الموارد البشرية. أي قاعدة مشروطة على المورد تغلق التصفية والترتيب والبحث حسب الحقول لذلك المستخدم (ADR 032: الشرط لا يستطيع أن يصرّح بأمان باستعلام على كل السجلات). قواعد دور الموظف مشروطة (`createdBy: ACTOR_ID`)، لذلك لا تعرض قائمة الموظف إلا طلباته هو، ويُرفض له كل مرشّح بالخطأ 422 `E_FILTER`، والترتيب حسب حقل بالخطأ 403 `E_FIELD_FORBIDDEN`، وحفظ طريقة عرض بالخطأ 403 `E_FIELD_FORBIDDEN`.

بعد تطبيق مرشّح اختر «حفظ العرض الحالي»، وسمّه («المرضية هذا الشهر»)، وعلّم «مشترك» لمشاركته مع كل من يستطيع فتح القائمة. «تصدير النتائج» ينزّل ملف قيم مفصولة بفواصل (CSV) بكل السجلات المطابقة؛ وما زاد على 5000 سجل يُرفض بالخطأ 422 `E_EXPORT_LIMIT`. يحتوي ملف CSV الأعمدة التي يحق لك قراءتها. وتحديد الصفوف يتيح «اعتماد» جماعيًا، والحذف، والاستعادة تحت «المحذوفات».

**ما يجب أن تراه:** تضيق القائمة إلى الطلبات المطابقة، وتذكر الشرائح تحت «التصفية المطبقة» كل مرشّح، وتظهر طريقة العرض المحفوظة تحت «العروض المحفوظة» بعد إعادة تحميل الصفحة (معلَّمة «مشترك» للزملاء).

<!-- step:12 -->
## الخطوة 12: لوحة مؤشرات

أنشئ الملف `app/modules/leave_requests/dashboards/leave_overview.ts`:

```ts
import { defineDashboard } from 'adula'

/** Served at /dashboards/leave_overview; every number is computed as the viewer (ADR 046). */
export default defineDashboard({
  name: 'leave_overview',
  label: { ar: 'لوحة الإجازات', en: 'Leave overview' },
  description: { ar: 'طلبات الإجازة التي يحق لك الاطلاع عليها', en: 'Leave requests you can see' },
  widgets: [
    {
      key: 'requests',
      label: { ar: 'عدد الطلبات', en: 'Requests' },
      resource: 'leave_requests',
      measure: 'count',
    },
    {
      key: 'days',
      label: { ar: 'مجموع الأيام', en: 'Total days' },
      resource: 'leave_requests',
      measure: { sum: 'days' },
    },
    {
      key: 'byType',
      label: { ar: 'حسب نوع الإجازة', en: 'By leave type' },
      resource: 'leave_requests',
      measure: 'count',
      groupBy: 'leaveType',
    },
    {
      key: 'byStatus',
      label: { ar: 'حسب حالة الاعتماد', en: 'By approval status' },
      resource: 'leave_requests',
      measure: 'count',
      groupBy: 'status',
    },
    {
      key: 'sick',
      label: { ar: 'الإجازات المرضية', en: 'Sick leave' },
      resource: 'leave_requests',
      measure: 'count',
      filters: { leaveType: 'sick' },
    },
  ],
})
```

وسجّلها في `start/dashboards.ts`:

```ts
import type { DashboardDefinition } from 'adula'
import leaveOverview from '#modules/leave_requests/dashboards/leave_overview'
// adula:imports
/** Indicator pages (ADR 046), served at /dashboards/:name; each widget is read as the viewer. */
export const dashboards: DashboardDefinition[] = [
  leaveOverview,
  /* adula:dashboards */
]
```

يجمع المؤشر حقلًا من نوع `integer` أو `money` أو `decimal` أو `percent`؛ و`groupBy` يأخذ حقلًا واحدًا ليس hasMany أو manyToMany أو json أو attachment (أو `docStatus` أو `orgUnitId`)؛ ومفاتيح `filters` يجب أن تكون `filterable`. التعريف الخاطئ يوقف النظام عند بدئه.

**ما يجب أن تراه:** بعد أن يعيد `npm run dev` تحميل الملفات المعدّلة (أو بعد إعادة التشغيل)، يظهر «لوحات المؤشرات» في القائمة الجانبية (`/dashboards` يفتح أول لوحة يحق لك رؤيتها)، و`/dashboards/leave_overview` بمؤشراته الخمسة. يرى كل شخص أرقامًا للسجلات التي يحق له قراءتها؛ والمؤشر الذي لا يستطيع قراءته يُحذف من العرض، واللوحة التي لا شيء فيها قابل للقراءة تجيب بـ 404. وللسبب المذكور في الخطوة 11 لا يرى الموظف إلا «عدد الطلبات»: فالمجموع والتجميعات والمؤشر المصفّى تحتاج استعلامات على الحقول تغلقها القواعد المشروطة للموظف. تعرض اللوحات بطاقات وأشرطة مرتبة؛ لا توجد رسوم بيانية زمنية ولا محرر للوحات.

<!-- step:13 -->
## الخطوة 13: اختبار شامل من البداية إلى النهاية

أنشئ `tests/functional/leave_requests/workflow.spec.ts`. يقدّم الاختبار طلبًا ويعتمده ويوافق عليه، ويصفّي، ويحفظ طريقة عرض، ويقرأ لوحة المؤشرات، ويقرر بصفته مفوَّضًا إليه، وكل ذلك عبر HTTP على PostgreSQL:

```ts
import { test } from '@japa/runner'
import { randomUUID } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import { consumeEvent, seedModules, type DomainEvent } from 'adula'
import User from '#models/user'
import adulaConfig from '#config/adula'
import { registry } from '#start/modules'
import { listeners } from '#start/listeners'

const json = { Accept: 'application/json' }
const knex = () => db.connection().getWriteClient()

/** Today as a calendar day of the system time zone, which delegation ranges use. */
const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: adulaConfig.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())

/** Publishes pending outbox events to the listeners, as the worker does. */
async function drainOutbox() {
  const rows = await knex()('outbox').whereNull('published_at').orderBy('created_at')
  for (const row of rows) {
    const event: DomainEvent = { id: row.id, event: row.event, payload: row.payload }
    for (const listener of listeners) await consumeEvent(knex(), listener, event)
    await knex()('outbox').where('id', row.id).update({ published_at: knex().fn.now() })
  }
}

async function person(fullName: string) {
  return User.create({
    fullName,
    email: `leave-${randomUUID()}@example.test`,
    password: 'leave-test-password-123',
  })
}

/** Gives a user a module default role (by its key) and membership of the unit. */
async function grant(user: User, roleKey: string, orgUnitId: number) {
  const role = await knex()('roles').where('key', roleKey).first()
  await knex()('user_roles').insert({ user_id: user.id, role_id: role.id })
  await knex()('user_org_units').insert({ user_id: user.id, org_unit_id: orgUnitId })
}

test.group('Leave requests: workflow, delegation, lists and dashboard', (group) => {
  let unitId: number
  let employee: User
  let manager: User
  let hr: User

  group.setup(async () => {
    const unique = randomUUID().replaceAll('-', '_')
    const [unit] = await knex()('org_units')
      .insert({ name: 'وحدة اختبار الإجازات', type: 'root', path: `leave_${unique}` })
      .returning('id')
    unitId = Number(unit.id)
    employee = await person('موظف الإجازات')
    manager = await person('المدير المباشر')
    hr = await person('موظف الموارد البشرية')
    // The test database has no adula:install run: create the module's default roles.
    await seedModules(knex(), registry, employee.id)
    await grant(employee, 'leave_requests_user', unitId)
    await grant(manager, 'leave_requests_manager', unitId)
    await grant(hr, 'leave_requests_hr', unitId)
  })

  async function submitRequest(client: any, values: Record<string, unknown>) {
    const created = await client
      .post('/resources/leave_requests')
      .loginAs(employee)
      .withCsrfToken()
      .headers(json)
      .json({
        title: `طلب ${randomUUID()}`,
        employee: employee.id,
        orgUnitId: unitId,
        ...values,
      })
    created.assertStatus(201)
    const record = created.body().data
    const submitted = await client
      .post(`/resources/leave_requests/${record.id}/submit`)
      .loginAs(employee)
      .withCsrfToken()
      .headers(json)
      .json({ version: record.version })
    submitted.assertStatus(200)
    await drainOutbox()
    const run = await knex()('workflow_runs')
      .where({ resource: 'leave_requests', record_id: record.id })
      .first()
    return { id: Number(record.id), runId: String(run.id) }
  }

  function decide(client: any, user: User, runId: string, decision: string) {
    return client
      .post(`/workflows/${runId}/decide`)
      .loginAs(user)
      .withCsrfToken()
      .headers(json)
      .json({ decision })
  }

  test('the line manager approves a submitted request', async ({ client, assert }) => {
    const { id, runId } = await submitRequest(client, {
      leaveType: 'sick',
      startDate: '2026-11-01',
      endDate: '2026-11-03',
      days: '3',
    })
    const approval = await knex()('assignments')
      .where({ workflow_run_id: runId, status: 'open', assignee_id: manager.id })
      .first()
    assert.exists(approval, 'the approval opens for the line manager')

    const decided = await decide(client, manager, runId, 'approve')
    decided.assertStatus(200)
    assert.equal(decided.body().data.status, 'completed')
    assert.equal(decided.body().data.outcome, 'approved')

    const shown = await client
      .get(`/resources/leave_requests/${id}`)
      .loginAs(employee)
      .headers(json)
    shown.assertStatus(200)
    assert.equal(shown.body().data.status, 'approved')
    assert.equal(shown.body().data.days, '3.0')
    assert.equal(shown.body().data.docStatus, 1)
  })

  test('filters, a saved view and the dashboard see the request', async ({ client, assert }) => {
    // Its own request, so the test also passes when run alone.
    const { id } = await submitRequest(client, {
      leaveType: 'emergency',
      startDate: '2026-11-15',
      endDate: '2026-11-16',
      days: '2',
    })
    const listed = await client
      .get(
        '/resources/leave_requests?filters[leaveType][in]=sick,emergency&filters[startDate][gte]=2026-11-01'
      )
      .loginAs(manager)
      .headers(json)
    listed.assertStatus(200)
    assert.include(
      listed.body().data.map((row: { id: number }) => Number(row.id)),
      id
    )

    const saved = await client
      .post('/resources/leave_requests/views')
      .loginAs(manager)
      .withCsrfToken()
      .headers(json)
      .json({
        name: 'الإجازات المرضية والاضطرارية',
        query: { filters: { leaveType: { in: ['sick', 'emergency'] } } },
      })
    saved.assertStatus(200)
    assert.isTrue(saved.body().data.own)

    const dashboard = await client.get('/dashboards/leave_overview').loginAs(manager).headers(json)
    dashboard.assertStatus(200)
    const widgets = Object.fromEntries(
      dashboard.body().data.widgets.map((widget: { key: string }) => [widget.key, widget])
    )
    assert.isAtLeast(widgets.requests.value, 1)
    assert.equal(widgets.days.format, 'decimal')
    assert.equal(widgets.byStatus.kind, 'grouped')
    const emergency = widgets.byType.rows.find(
      (row: { value: string }) => row.value === 'emergency'
    )
    assert.isAtLeast(emergency.measure, 1)
  })

  test('a delegate decides while the manager is away', async ({ client, assert }) => {
    const delegation = await client
      .post('/account/delegations')
      .loginAs(manager)
      .withCsrfToken()
      .headers(json)
      .json({ delegateId: hr.id, startsOn: today(), endsOn: today(), note: 'إجازة المدير' })
    delegation.assertStatus(200)

    const { id, runId } = await submitRequest(client, {
      leaveType: 'annual',
      startDate: '2026-12-01',
      endDate: '2026-12-02',
      days: '2',
    })
    const routed = await knex()('assignments')
      .where({ workflow_run_id: runId, status: 'open', assignee_id: hr.id })
      .first()
    assert.exists(routed, 'the approval opens for the delegate')
    assert.equal(routed.on_behalf_of, manager.id)

    const decided = await decide(client, hr, runId, 'reject')
    decided.assertStatus(200)
    assert.equal(decided.body().data.outcome, 'rejected')
    const shown = await client
      .get(`/resources/leave_requests/${id}`)
      .loginAs(employee)
      .headers(json)
    assert.equal(shown.body().data.status, 'rejected')
    assert.equal(shown.body().data.docStatus, 2, 'rejection cancels the document')

    const revoked = await client
      .delete(`/account/delegations/${delegation.body().data.id}`)
      .loginAs(manager)
      .withCsrfToken()
      .headers(json)
    revoked.assertStatus(200)
  })
})
```

```sh
npm test -- functional --files=leave_requests/workflow
```

**ما يجب أن تراه:** تنجح الاختبارات الثلاثة.

<!-- step:14 -->
## التحقق النهائي

شغّل في مجلد النظام (مع خدمات Docker الافتراضية يشغّلها `npm test` بنفسه):

```sh
node ace adula:doctor
npm run typecheck
npm run format
npm run lint
npm test
npm run build
```

يطبّق `npm run format` أسلوب Prettier الخاص بالمشروع على الملفات المولَّدة والملصقة، فيفحص `npm run lint` الشيفرة لا تنسيقها.

**ما يجب أن تراه:** `adula:doctor` مع `PASS resources.schema` و`PASS workflows.roles` (أسطر `WARN backup.*` متوقعة حتى يُضبط النسخ الاحتياطي خارج الموقع)؛ وفحص الأنواع والفحص الأسلوبي (lint) والبناء دون أخطاء؛ وينتهي `npm test` بـ `PASSED` و`Tests  21 passed (21)` في نظام جديد: تنجح كل مجموعات الاختبار، ومنها `HTTP security contract: leave_requests` و`leave_requests application smoke test` و`Leave requests: workflow, delegation, lists and dashboard`.

## إلى أين بعد ذلك

* أضف موردًا ثانيًا إلى التطبيق، مثل أرصدة الإجازات:
  `node ace adula:resource leave_balances --module=leave_requests`.
* كل خيار وكل خاصية حقل: [defineResource reference](../reference/define-resource.md).
* ربط النظام ببرامج أخرى (واجهة برمجة التطبيقات API، والإشعارات الآلية webhooks، والاستيراد): [Integration](../integration.md).
