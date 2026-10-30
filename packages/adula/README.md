# adula

<div dir="rtl" lang="ar">

**عدولة (AdulaJS)** إطار عمل عربي أولًا لبناء أنظمة الأعمال. تنشئ كل شركة **نظامًا** واحدًا، وفي داخله **تطبيقات** لكل مجال عمل، مثل الإجازات أو الأصول أو الصيانة. تتشارك التطبيقات المستخدمين والأدوار والهيكل التنظيمي والإشعارات وصندوق المهام.

تكتب تعريف المورد (الجدول وحقوله) مرة واحدة في ملف واحد، فيُبنى منه تلقائيًا كل ما يلي:

• أعمدة قاعدة البيانات وترحيلاتها (ملفات تغيير بنية الجداول).

• التحقق من صحة كل إدخال.

• نماذج الإدخال وصفحات القوائم والعرض باتجاه من اليمين إلى اليسار.

• واجهة برمجة التطبيقات (API) ووصفها بمعيار OpenAPI.

• الصلاحيات حسب الدور والوحدة التنظيمية.

هذه الحزمة هي نواة الإطار. لإنشاء نظام جديد استخدم الأمر `npm create adulajs`.

</div>

`adula` is the core of AdulaJS, a resource framework for business systems on AdonisJS 7 and
PostgreSQL 17. One `defineResource` file decides a table's columns, validation, forms,
pages, API and authorization, and the package adds workflows, approvals, lists, dashboards,
imports and integration on top.

Node.js 24 or later. MIT licensed. The public API in `api/adula-api.json` follows semantic
versioning; published versions are listed in the
[releases](https://github.com/adulash/adulajs/blob/main/docs/releases.md) and the
[changelog](https://github.com/adulash/adulajs/blob/main/CHANGELOG.md).

## Quick start

```sh
npm create adulajs my-system
cd my-system
node ace adula:app leave_requests --label-ar="طلبات الإجازة" --label-en="Leave requests"
```

`create-adulajs` builds a complete system (AdonisJS host, sign-in, administration, the
Arabic UI, PostgreSQL and Redis); `adula:app` adds an application to it. A resource is one
file under `app/modules/<module>/resources/`:

```ts
import { defineResource } from 'adula'

export default defineResource({
  name: 'leave_requests',
  label: { ar: 'طلبات الإجازة', en: 'Leave requests' },
  recordLabel: { ar: 'طلب إجازة', en: 'Leave request' },
  scoped: true,
  submittable: true,
  fields: {
    title: { type: 'string', required: true, searchable: true, label: { ar: 'موضوع الطلب' } },
    employee: { type: 'user', required: true, label: { ar: 'الموظف' } },
    leaveType: {
      type: 'enum',
      required: true,
      default: 'annual',
      filterable: true,
      options: [
        { value: 'annual', label: { ar: 'سنوية' } },
        { value: 'sick', label: { ar: 'مرضية' } },
      ],
      label: { ar: 'نوع الإجازة' },
    },
    startDate: { type: 'date', required: true, label: { ar: 'تاريخ البداية' } },
    days: { type: 'decimal', scale: 1, required: true, label: { ar: 'عدد الأيام' } },
    medicalCertificate: {
      type: 'attachment',
      visibleWhen: { leaveType: 'sick' },
      label: { ar: 'التقرير الطبي' },
    },
  },
  // Names the record in pickers, "My tasks" and approvals.
  title: ['title'],
  list: ['title', 'employee', 'leaveType', 'startDate', 'days'],
  form: ['title', 'employee', 'leaveType', 'startDate', 'days', 'medicalCertificate'],
  show: ['title', 'employee', 'leaveType', 'startDate', 'days', 'medicalCertificate'],
  actions: ['view', 'create', 'update', 'delete', 'submit', 'cancel', 'amend'],
})
```

The [leave-requests tutorial](https://github.com/adulash/adulajs/blob/main/docs/tutorial-leave-requests.md)
builds this application end to end: migrations, roles, an approval workflow with delegation
and SLA, list filters, saved views and a dashboard.

## Features

* **Definition as the source of truth** (ADR 045). Field types `string`, `text`, `email`,
  `phone`, `url`, `integer`, `money`, `decimal`, `percent`, `boolean`, `date`, `datetime`,
  `json`, `enum`, `multiSelect`, `lookup`, `belongsTo`, `user`, `attachment`, `hasMany`
  (inline child rows) and `manyToMany`; constraints, defaults, `visibleWhen`, unique
  combinations. `adula:resource:migration` writes the additive migration a table lacks and
  `adula:doctor` reports drift.
* **Authorization.** CASL role rules with conditions and field levels, organizational scope
  over an org tree, and the same rules in every list, export, API call and dashboard.
* **Documents and workflows.** Draft, submit, cancel and amend-by-copy; versioned workflows
  with condition, update, notify, approval, decision, delay, HTTP and end steps; approval
  delegation while out of office; SLA deadlines with reminders and escalation (ADR 044).
* **Lists.** Range, multi-value and empty filters, saved views, filtered CSV export, bulk
  actions, deleted records and restore, and dashboards computed as the viewer (ADR 046).
* **Files and printing.** One or several files per attachment field, with in-page preview of
  images, PDF and text (ADR 047); print templates in code or written by administrators, printed
  as HTML or PDF with the reader's permissions (ADR 048).
* **Collaboration.** Comments with mentions, followers, tags, field history, assignments and
  one "my tasks" inbox, notifications by template with e-mail, realtime updates, SMS or
  WhatsApp through a signed HTTP provider.
* **Integration.** A Bearer-token API under `/api/v1` with an OpenAPI document and a generated
  TypeScript client, signed outgoing and inbound webhooks, CSV imports (dry run, upsert),
  sync jobs, and an optional MCP adapter.
* **Sign-in.** Optional SSO through Google, GitHub and Microsoft Entra ID, and TOTP two-factor
  authentication with recovery codes, which administrators can be required to use (ADR 042).
* **Arabic first.** Arabic is the base language of every screen and message; English and
  other languages are optional per system (ADR 041).
* **Operations.** Outbox worker, scheduler, backups with restore drills, upload pruning,
  runtime health, and `adula:doctor`.

## Documentation

| Topic | Guide |
| --- | --- |
| Create a system | [Installation](https://github.com/adulash/adulajs/blob/main/docs/installation.md) |
| Build an application step by step | [Leave-requests tutorial](https://github.com/adulash/adulajs/blob/main/docs/tutorial-leave-requests.md) |
| Applications in a system | [Applications](https://github.com/adulash/adulajs/blob/main/docs/applications.md) |
| Fields, validation, migrations | [Resource definitions](https://github.com/adulash/adulajs/blob/main/docs/resources.md), [defineResource reference](https://github.com/adulash/adulajs/blob/main/docs/reference/define-resource.md) |
| Workflows, lists, collaboration, printing | [Business features](https://github.com/adulash/adulajs/blob/main/docs/business-features.md) |
| Sign-in, SSO, two-factor | [Authentication](https://github.com/adulash/adulajs/blob/main/docs/authentication.md) |
| API client, imports, sync jobs, webhooks | [Integration](https://github.com/adulash/adulajs/blob/main/docs/integration.md) |
| Languages | [Languages](https://github.com/adulash/adulajs/blob/main/docs/languages.md) |
| Deploy, back up, restore | [Operations](https://github.com/adulash/adulajs/blob/main/docs/operations.md) |
| What exists, what is missing | [Implementation status](https://github.com/adulash/adulajs/blob/main/docs/implementation-status.md), [Gaps](https://github.com/adulash/adulajs/blob/main/GAPS.md) |
| Why a design was chosen | [Architecture decisions](https://github.com/adulash/adulajs/tree/main/docs/decisions) |

## Install into an existing AdonisJS application

Follow the canonical [installation guide](https://github.com/adulash/adulajs/blob/main/docs/installation.md). For a new system, the separate `create-adulajs` initializer (`npm create adulajs my-system`) installs the AdonisJS host and system screens from an empty directory. For an existing official AdonisJS 7 React/PostgreSQL application, install the core/UI archives and documented UI prerequisites, configure AdulaJS, migrate and create the intended administrator before `node ace adula:install`. The Ace command completes initialization inside that host. No educational customers/orders/tasks modules are installed by either path.

The managed rules require the bundled `.agents/skills/adula-frontend-design/SKILL.md` for UI work. It is tailored to business workflows, asks for missing company identity at project kickoff, and uses project-owned shadcn components with modal forms and record details by default. User-requested presentation exceptions remain supported. Company identity belongs in `docs/design-identity.md`, which installation never overwrites. Doctor verifies the design skill along with the idea-review skill.

## Contracts

`defineResource` declares fields, forms, serialization, actions and scope, and is the source of truth (ADR 045): without a `validator`, writes use the VineJS validator derived from the fields (`definitionValidator`; extend it through `definitionSchema`), every stored value is checked against its field again (422 `E_FIELD_VALUE`), `model` is optional and never read, and `resourceSchema` gives the expected table that `createResourceTable` builds and `adula:doctor` (`resources.schema`) compares with the database. Field types, props and resource options are listed in the [resource definitions guide](https://github.com/adulash/adulajs/blob/main/docs/resources.md) and the [defineResource reference](https://github.com/adulash/adulajs/blob/main/docs/reference/define-resource.md). `@vinejs/vine` ^4.0.0 is a peer dependency. `ResourceRegistry` validates module ownership and dependencies. `ResourceService` applies CASL and organizational scope to JSON operations, serialization, editor options and atomic inline reconciliation. Money is a canonical string of integer minor units within PostgreSQL bigint range; decimal and percent values are decimal strings with the field's scale; calendar dates are YYYY-MM-DD (the provider registers a DATE parser so every PostgreSQL query returns that text); timestamps are canonical UTC ISO strings with milliseconds. Versioned updates require the current version and stale writes return 409.

Use `buildAbility(rules, registry.all())` for schema-aware money conditions. The SQL adapter rejects ordered money predicates without schemas. Browser code may import the same matcher through `adula/auth`. Organizational restrictions remain a separate AND condition.

`defineWorkflow` declares versioned workflows that `WorkflowEngine` runs from the step table (ADR 044); `WorkflowDefinition.machine` is deprecated and, with the `xstate` dependency, leaves in the next major version. `WorkflowDelegations` manages out-of-office delegation, and the `sla:evaluate` command runs SLA reminders and escalations. `defineDashboard`/`Dashboards`, `defineBulkActions`/`BulkActions` and `SavedViews` form the list layer (ADR 046).

Other exports include `ActorStore`, schema helpers, organizational moves, settings, sequences, notifications, jobs/outbox interfaces, packed rules, `TwoFactor`, `defineSyncJob`, the API client generator and the generic controller factory. Commands include `adula:app` (an application: module, example resource, default roles and a smoke test), `adula:resource` (`--validator` and `--model` opt in to those files), `adula:resource:migration` (an additive migration of the columns, join tables and unique indexes a table lacks, applied with `alterResourceTable`), the deprecated `adula:resource:snapshot`, `adula:install`, `adula:doctor`, `adula:module:add`, `adula:module:remove`, `adula:ui add`, `adula:client`, `sla:evaluate` and `adula:capabilities`.

The optional `adula/mcp` entry exports `createResourceTools`. Install @jrmc/adonis-mcp 2.0.0 and supply an authenticated actor resolver. Cookie-authenticated MCP routes must keep CSRF protection enabled. Tool inputs cannot supply identity or organizational scope.

## Generated HTTP contracts

Generated tests call the copied `resourceContract(name, fixture)` helper. Extend the application-owned fixture whenever fields or validation change. Supply `input` and a valid `update`, plus `expected` and `updated` values after normalization. Every form field needs an input fixture; every written scalar needs a storage expectation, and every manyToMany field the ascending list of linked ids. Use `stored`/`updatedStored` for writable fields excluded from the response, and `inline`/`updatedInline` for the complete live child rows in ID order. Dates use YYYY-MM-DD, timestamps canonical UTC strings, and money integer-minor-unit strings in expectations. Fixture callbacks receive `userId`, `orgUnitId` and a unique suffix for creating real related records.

The harness creates database-backed roles and organization memberships, checks existing-record isolation across reads and writes, central-resource visibility, serialization, mapped storage, forbidden fields, stale versions, unique constraints and soft deletion. It refuses non-test databases. Configuration preserves existing copied helpers: consumers with the old one-argument helper must review and merge the new template before generating tests that use fixtures.

Doctor measures the deployment's `storage/uploads` directory and warns above 5 decimal GB. When copied UI hashes or AdulaJS compatibility change, it inventories project pages for review. This conservative check does not prove import compatibility, completed page review or attachment restoration.

## Current limitations

* Impersonation was reviewed by automated adversarial and black-box tests only, not by
  a human security review; two-factor authentication has had no written human ASVS review
  yet.
* XLSX import is not available; CSV is (format adapters are the registration point).
* SLA hours are wall-clock hours (no business calendar) and an overdue step escalates once.
* Dashboards are defined in code and show tiles and ranked bars; there are no time-series
  charts.

See [implementation status](https://github.com/adulash/adulajs/blob/main/docs/implementation-status.md) and [gaps](https://github.com/adulash/adulajs/blob/main/GAPS.md).
