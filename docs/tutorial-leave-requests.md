# Tutorial: build a leave-requests application

النسخة العربية: [درس تطبيقي: بناء تطبيق طلبات الإجازة](ar/tutorial-leave-requests.md)

This tutorial builds one **application** (تطبيق), «طلبات الإجازة», inside a new **system**
(نظام). An employee files a leave request; the line manager approves or rejects it through
a workflow with a deadline (SLA) and an escalation; a manager who is away delegates the
approvals to a colleague; people filter the list and save views; a dashboard counts the
requests.

What you use:

| Feature | Where it is explained |
| --- | --- |
| `npm create adulajs`, services | [Installation](installation.md) |
| `adula:app`, default roles, `adula:install` | [Applications](applications.md) |
| `defineResource`, field types, `adula:resource:migration` | [Resource definitions](resources.md) and the generated [defineResource reference](reference/define-resource.md) (every option and field prop) |
| Workflows, delegation, SLA | [Business features](business-features.md#documents-and-workflows), [ADR 044](decisions/044-workflow-engine.md) |
| List filters, saved views, dashboards | [Business features](business-features.md#lists-filters-export-bulk-actions-and-deleted-records), [ADR 046](decisions/046-list-layer.md) |

Several files in one attachment field with in-page preview
([ADR 047](decisions/047-multiple-attachments-and-preview.md)) and print templates
([ADR 048](decisions/048-print-templates.md)) are outside this tutorial; see
[Resource definitions](resources.md).

Each step ends with **You should see**, the result to check before going on.

## Before you start

* Node.js 24 or later and npm.
* For the default services: Docker with Compose, installed and running. Otherwise, a
  PostgreSQL 17 server (a role with `CREATEDB`) and Redis 7 of your own (step 1, option B).
* All commands run in the system's folder. With the default Docker services, keep
  `npm run services` running in a second terminal while you use `node ace …`, or write
  `npm run ace -- …` instead of `node ace …`; that form starts the services itself.

<!-- step:1 -->
## Step 1: create the system

**Option A, default (Docker).** Interactive:

```sh
npm create adulajs leave-demo
```

or without questions:

```sh
npx create-adulajs@latest leave-demo --company "شركة المثال" --admin-email admin@example.com --yes
```

**Option B, existing services.** Write a private `local.json` outside the project:

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

then:

```sh
npx create-adulajs@latest leave-demo --company "شركة المثال" --admin-email admin@example.com --services existing --connection ./local.json --yes
```

The creator refuses a destination folder that has content and a database name that already
exists. All options are listed in the [creator README](../packages/create-adulajs/README.md).

Start it:

```sh
cd leave-demo
npm run dev
```

**You should see:** six installation stages ending without an error; the administrator's
e-mail and generated password in `tmp/dev-admin.txt`; after `npm run dev`, the sign-in page at
the address printed in the terminal (the `APP_URL` of the system, also written in its
README). Sign in as the administrator: the side menu shows «نظرة عامة» and «مهامي» and the
administration screens, and no business application yet.

<!-- step:2 -->
## Step 2: scaffold the application

```sh
node ace adula:app leave_requests --label-ar="طلبات الإجازة" --label-en="Leave requests" --dry-run
node ace adula:app leave_requests --label-ar="طلبات الإجازة" --label-en="Leave requests"
```

The application name is also the name of its example resource, its table and its two
default roles, so naming the application `leave_requests` gives the `leave_requests`
resource directly. (With `adula:app leave` you would get a resource named `leave` and
add `leave_requests` with `node ace adula:resource leave_requests --module=leave`; the
generated smoke test expects the example resource, so this tutorial keeps one name.)

**You should see:** the dry run lists the folders and files and creates nothing. The real
run prints these files and `Registered module_leave_requests in start/modules.ts`:

```text
app/modules/leave_requests/module.ts
app/modules/leave_requests/resources/leave_requests.ts
app/modules/leave_requests/migrations/<timestamp>_create_leave_requests.ts
tests/functional/leave_requests.spec.ts
tests/functional/leave_requests/smoke.spec.ts
```

Do **not** run `migration:run` yet: step 4 changes the create-migration first.

<!-- step:3 -->
## Step 3: define the resource

Replace `app/modules/leave_requests/resources/leave_requests.ts` with:

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

What the field types do (full list of props in the [reference](reference/define-resource.md)):

* `user`: a foreign key to `users`; the picker offers active members of the record's
  organization unit or its ancestors, and readers see only the display name.
* `enum`: one of `options`; `default` fills the create form and the column default.
* `date`: `YYYY-MM-DD`; `decimal`: a string with exactly `scale` decimals (`"3.0"`).
* `attachment` with `visibleWhen`: hidden and stored as null unless `leaveType` is `sick`.

**You should see:** nothing yet; `defineResource` checks the definition when the system
boots in the next step (a mistake stops the command with a message naming the field).

<!-- step:4 -->
## Step 4: create and extend the table

`adula:resource:migration` adds field columns, join tables and unique indexes, but not the
document columns of `submittable`/`version` (`doc_status`, `amended_from_id`, `version`).
Declare those in the scaffolded create-migration **before it runs**. Open
`app/modules/leave_requests/migrations/<timestamp>_create_leave_requests.ts` and add the two
lines after `"scoped": true,`, so the file reads:

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

Never edit a migration that already ran. Then:

```sh
node ace migration:run
node ace adula:resource:migration leave_requests
```

**You should see:** `adula:resource:migration` lists what the table lacks and writes one file
(after Lucid's `Schema classes generated` line):

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

Review that file (it embeds only the new fields and calls `alterResourceTable`), then:

```sh
node ace migration:run
node ace adula:resource:migration leave_requests
node ace adula:doctor
```

**You should see:** the second `adula:resource:migration` answers
`leave_requests: the database already has every column, join table and unique index.`, and
`adula:doctor` reports `PASS resources.schema: Every resource table matches its definition`.
Columns added to an existing table are `NOT NULL` only when the field is required and has
a default (`leave_type`); `status` gets the column default `pending` but stays nullable, the
others are nullable too, and `required` is still enforced on every write.

<!-- step:5 -->
## Step 5: the approval workflow

Create `app/modules/leave_requests/workflows/leave_approval.ts`:

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

Names to know:

* `assignees: { role: 'leave_requests_manager' }` names the role's stable **key**, not its
  Arabic name; administrators can rename the role without breaking the workflow.
* `sla.escalate.action` is `'overdue'` (default: tell the approvers), `'notify'` (also tell
  `to`) or `'reassign'` (move the approval to `to`). `to` may also be
  `{ manager: roleKey }`: people holding that role granted for the approver's
  organizational unit or its nearest ancestor unit (a role granted without a unit, for the
  whole system, does not count).
* Other step types: `condition`, `decision`, `delay`, `http`.
* Add a second definition with `version: 2` and keep version 1 in `workflows`. New runs use
  the newest version; running requests keep theirs.

**You should see:** nothing yet; the workflow is registered in the next step.

<!-- step:6 -->
## Step 6: register the workflow and the roles

Replace `app/modules/leave_requests/module.ts` with:

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

The `submit` rule is needed because the resource is submittable: without it nobody but an
administrator can submit. The user role's `view` rule carries
`conditions: { createdBy: ACTOR_ID }` because a leave request can hold a medical
certificate, which is health data: without it every employee of the unit could read the
requests of colleagues. The manager and HR roles read all requests of their unit.

Create the roles (the address is the administrator's, from `tmp/dev-admin.txt`):

```sh
node ace adula:install --admin-email=admin@example.com
```

`adula:install` adds roles and lookup values that are missing and never changes one that
exists. If you ran it before editing `defaultRoles`, change the existing roles on
`/admin/roles` instead.

**You should see:** a line
`Module defaults: 0 lookup rows added; roles created: leave_requests_manager, leave_requests_user, leave_requests_hr; adopted by name: none`
followed by `Core installation complete. Run adula:doctor.` On `/admin/roles` the three roles
appear with their rules. Running the command again reports `roles created: none`.

<!-- step:7 -->
## Step 7: update the generated contract test

`tests/functional/leave_requests.spec.ts` checks the resource's security contract over HTTP
(isolation between units, hidden fields, stale versions, soft deletion, foreign
attachments). Its fixture must list every form field. Replace the file with:

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

Run the application's tests:

```sh
npm test -- functional --files=leave_requests --files=leave_requests/smoke
```

**You should see:** `PASSED` and `Tests  16 passed (16)`: the groups
`HTTP security contract: leave_requests` and `leave_requests application smoke test` pass (the
default reporter prints a dot per test and names a group only when one of its tests fails).
Tests use the separate `_test` database.

<!-- step:8 -->
## Step 8: file and approve a request in the browser

Restart `npm run dev` (it also runs the worker that starts workflows). You need three
accounts besides the administrator:

| Person | Role | Organization unit |
| --- | --- | --- |
| Employee | `مستخدم طلبات الإجازة` | the same unit for all three |
| Line manager | `مدير طلبات الإجازة` | |
| HR officer | `الموارد البشرية - الإجازات` | |

Add people from `/admin/users` → «إضافة مستخدم» (an e-mail invitation). Invitations need
SMTP: in development the system sends to `127.0.0.1:1025`, so run a local mail catcher
there, for example `docker run -d --name mailpit -p 127.0.0.1:1025:1025 -p 127.0.0.1:8025:8025 axllent/mailpit`,
and open the invitation link from its inbox at `http://127.0.0.1:8025`.

Without a mail catcher, open self-signup for this development session instead (it is closed
once an administrator exists): start the server with `SIGNUP_ENABLED=true npm run dev`
(PowerShell: `$env:SIGNUP_ENABLED='true'; npm run dev`), let each person register at
`/signup`, then restart `npm run dev` without it. Notifications still appear in the system
(the bell); only their e-mail copy fails without SMTP.

After each person has an account, open them on `/admin/users` and give them their role
(«الأدوار») and organizational unit («الوحدات التنظيمية»).

1. As the employee, open «طلبات الإجازة» → «إضافة طلب إجازة». «نوع الإجازة» starts at
   «سنوية». Choose «مرضية»: the field «التقرير الطبي» appears; choose «سنوية»: it
   disappears. Fill the required fields and choose «حفظ السجل».
2. On the record, choose «اعتماد المستند» and confirm with «تأكيد» to submit it.
3. As the line manager, open «مهامي» (`/my-tasks?tab=approvals`), choose «موافقة» on the
   request and confirm with «موافقة» in the dialog (the note is optional).

**You should see:** after step 1 the record shows the badge «مسودة» and «حالة الاعتماد» =
«قيد الاعتماد». After step 2 the document badge reads «معتمد» (the document is submitted;
the approval is still open), the record's «سير العمل» panel shows «بانتظار موافقة», the step
«موافقة المدير المباشر» and the deadline state «في الموعد», and the manager's «مهامي» shows the
approval. After step 3 «حالة الاعتماد» reads «موافق عليه» and the employee receives a
notification.
A rejected request gets «حالة الاعتماد» = «مرفوض» and its document is cancelled. Failed runs
are listed for administrators at `/admin/workflows`.

<!-- step:9 -->
## Step 9: delegate approvals while away

As the line manager, open the account menu → «التفويض أثناء الغياب»
(`/account/delegations`) → «تفويض جديد». In «المفوَّض إليه» pick the HR officer (type at
least two letters of the name), choose «من تاريخ» and «إلى تاريخ» so the range includes today,
and choose «حفظ التفويض»; the page then reads «موافقاتك مفوّضة الآن إلى …». Then, as the
employee, submit a new request.

* Approvals that open for the manager after the delegation starts are routed to the
  delegate and marked «نيابة عن ...», provided the delegate can view the record (here
  through the HR role's `view` rule).
* While the delegation runs, the delegate can also decide the manager's approvals that were
  already open; those are not routed and carry no «نيابة عن» mark.
* The manager still sees and can decide them all; the run's history names who decided and
  on whose behalf.
* Delegation never widens record access, never covers manual tasks and never lets anyone
  approve a request they submitted. Routing is one hop.
* Days are calendar days of the system time zone, `timeZone` in `config/adula.ts`
  (`Asia/Riyadh` in a new system). Administrators manage everyone's delegations at
  `/admin/delegations`.

**You should see:** the delegate's «مهامي» lists the new approval «نيابة عن» the manager; the
delegate approves or rejects it, and the record's history shows both names. Revoking the
delegation returns only the open routed approvals to the manager.

More: [delegation while out of office](business-features.md#delegation-while-out-of-office).

<!-- step:10 -->
## Step 10: deadlines and escalation (SLA)

The `sla:` job sends the due-soon reminder and runs the escalation. `start/scheduler.ts` of
a new system already schedules it every minute; `npm run dev` does not run the scheduler.
Run one pass by hand:

```sh
node ace sla:evaluate
```

In production run exactly one `node ace scheduler:run` next to the worker.

**You should see:** `SLA: 0 reminders, 0 escalations` while every approval is on time. An
approval 20 hours old reports one reminder (template `workflow.sla_due_soon`) and shows
«يقترب الموعد»; after 24 hours it shows «متأخر» and the HR role is notified
(`workflow.sla_overdue`, `workflow.sla_escalated`). Each pass is idempotent: repeating it
sends nothing twice. SLA hours are wall-clock hours; there is no business calendar.

More: [SLA deadlines and escalation](business-features.md#sla-deadlines-and-escalation).

<!-- step:11 -->
## Step 11: filters and saved views

Every `filterable` field is offered under «تصفية» on the list, by type: «أيٌّ من» for the
enum and user fields, «من / إلى» for the dates and the decimal days, «فارغ / غير فارغ» for
all. The same filters work in the URL:

```text
/resources/leave_requests?filters[leaveType][in]=sick,emergency&filters[startDate][gte]=2026-11-01
/resources/leave_requests?filters[days][gte]=5&filters[status][in]=pending
/resources/leave_requests?filters[reason][empty]=true
```

A filter on a field that is not `filterable` (here `reason`), an unknown operator or an
invalid value is refused with 422 `E_FILTER`; add `filterable: true` to `reason` to allow
the last line.

Try this as the line manager or the HR officer. Any conditional rule on a resource closes
filtering, sorting and search by field for that actor (ADR 032: a condition cannot safely
authorize a query over every record). The employee role's rules are conditional
(`createdBy: ACTOR_ID`), so an employee's list shows only their own requests, and for an
employee every filter is refused with 422 `E_FILTER`, a sort by a field with 403
`E_FIELD_FORBIDDEN` and saving a view with 403 `E_FIELD_FORBIDDEN`.

With a filter applied, choose «حفظ العرض الحالي», name it («المرضية هذا الشهر»), and tick
«مشترك» to share it with everyone who can open the list. «تصدير النتائج» downloads a CSV of
every matching record; more than 5000 is refused with 422 `E_EXPORT_LIMIT`. The CSV holds
the columns you may read. Selecting rows offers
bulk «اعتماد», delete and, under «المحذوفات», restore.

**You should see:** the list narrows to matching requests, the chips under «التصفية
المطبقة» name each filter, and the saved view appears under «العروض المحفوظة» after a page
reload (marked «مشترك» for colleagues).

<!-- step:12 -->
## Step 12: a dashboard

Create `app/modules/leave_requests/dashboards/leave_overview.ts`:

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

Register it in `start/dashboards.ts`:

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

A widget sums an `integer`, `money`, `decimal` or `percent` field; `groupBy` takes one field
that is not hasMany, manyToMany, json or attachment (or `docStatus`, `orgUnitId`); `filters` keys must be
`filterable`. A bad definition stops the system at boot.

**You should see:** once `npm run dev` has reloaded the changed files (or after a restart),
«لوحات المؤشرات» in the side menu
(`/dashboards` opens the first dashboard you may see) and `/dashboards/leave_overview` with
the five indicators. Each person sees numbers for the records they may read; a widget they
cannot read is left out, and a dashboard with nothing readable is 404. For the reason given
in step 11, the employee sees only «عدد الطلبات»: the sum, the groupings and the filtered
widget need field queries that the employee's conditional rules close. Dashboards show tiles
and ranked bars; there are no time-series charts and no dashboard editor.

<!-- step:13 -->
## Step 13: an end-to-end test

Create `tests/functional/leave_requests/workflow.spec.ts`. It files, submits, approves,
filters, saves a view, reads the dashboard and decides as a delegate, all over HTTP on
PostgreSQL:

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

**You should see:** the three tests pass.

<!-- step:14 -->
## Verify

Run in the system's folder (with the default Docker services, `npm test` starts them):

```sh
node ace adula:doctor
npm run typecheck
npm run format
npm run lint
npm test
npm run build
```

`npm run format` applies the project's Prettier style to the generated and pasted files, so
`npm run lint` checks code rather than layout.

**You should see:** `adula:doctor` with `PASS resources.schema` and `PASS workflows.roles`
(the `WARN backup.*` lines are expected until offsite backup is configured); type checking,
lint and build without errors; `npm test` ends with `PASSED` and `Tests  21 passed (21)` in a
new system: every test group passes, including `HTTP security contract: leave_requests`,
`leave_requests application smoke test` and
`Leave requests: workflow, delegation, lists and dashboard`.

## Where to go next

* Add a second resource to the application:
  `node ace adula:resource leave_balances --module=leave_requests`.
* Every option and field prop: [defineResource reference](reference/define-resource.md).
* Connect other software (API, webhooks, imports): [Integration](integration.md).
