# Business features

How to use AdulaJS's business features in a system and its applications (an application
is a business area such as assets or HR, implemented as a module under `app/modules`).
Every feature is an AdulaJS service plus an additive migration; the reference system
(`apps/reference`) shows the wiring (routes, controllers, pages) that `create-adulajs`
copies into new systems.
All record features call `ResourceService.access`, so they can never reach a
record the user could not open.

## Collaboration around a record

`RecordCollaboration` (`adula().collaboration`) provides comments with mentions,
followers, tags and field history. ResourceShow renders the `record-collaboration`
panel automatically.

- Mentions and follower notifications only reach users who can read the record;
  mentioning anyone else is refused.
- Tags require update permission; lists filter with `?tag=<name>`.
- Every update stores before/after values in `field_changes` inside the save
  transaction. Readers only see changes of fields they may read.
- `followerListeners(registry, () => adula().collaboration)` notifies followers of
  updates and document transitions.

## Assignments and "my tasks"

`Assignments` assigns work on a record (update permission required; the assignee
must be able to read the record). `/my-tasks` lists the user's tasks; only the
assignee completes and only the assigner cancels. Approval steps of workflows
create assignments of kind `approval`.

## Notifications, templates, e-mail and realtime

- `notifyWithTemplate(db, userId, key, variables)` writes a notification from a
  message template. Defaults live in AdulaJS (`DEFAULT_TEMPLATES`); administrators
  edit wording at `/admin/templates` (placeholders are validated).
- Templates with mail enabled are e-mailed by the worker
  (`deliverNotificationMail`, three attempts), and sent to the SMS/WhatsApp provider
  for users who enabled it ([notification channels](integration.md#notification-channels)).
- A database trigger NOTIFYs on commit; each web process forwards the signal over
  SSE (`@adonisjs/transmit`, channel `notifications/<userId>`), and the bell
  refreshes without a page reload.

## Outgoing webhooks

Administrators subscribe HTTPS endpoints to domain events at `/admin/webhooks`.
Deliveries are queued once per event, carry the event envelope only (never record
fields), and are signed:

```
X-Adula-Signature: sha256=HMAC_SHA256(secret, "<X-Adula-Timestamp>.<raw body>")
X-Adula-Delivery: <uuid>   # deduplicate on this
```

Failures retry for six attempts with growing delays; the creator is notified on
final failure and can retry from the delivery log. Private and loopback targets
are refused in production.

## Inbound webhooks

Administrators add inbound sources at `/admin/webhooks` (section «الروابط الواردة»).
Each source has a key, a generated secret (shown once, rotatable) and header names
that default to GitHub's. Senders post to `POST /webhooks/in/<key>`:

```
X-Hub-Signature-256: sha256=HMAC_SHA256(secret, <raw body>)
X-GitHub-Event: pull_request          # the event name
X-GitHub-Delivery: <id>               # deduplicated per source
```

A missing or wrong signature is refused before anything is stored. Each delivery
is stored once and raised through the outbox as `inbound.<key>.<event>` with the
payload `{ source, delivery, event, body }`. Applications react with an idempotent
listener in `start/listeners.ts`, for example:

```ts
{
  name: 'projects.link_pull_requests',
  event: 'inbound.github.pull_request',
  handle: async (event, trx) => {
    const body = event.payload.body as { pull_request?: { title?: string } }
    // Find TSK-000123 in the title and move the task, inside trx.
  },
}
```

The delivery log shows every stored delivery and can raise it again.

## API tokens and OpenAPI

Users create read or read-write tokens under their account menu. `/api/v1`
accepts `Authorization: Bearer <token>` only (no cookies, no CSRF) and exposes the
same resource operations with the token owner's current permissions.
`GET /api/v1/openapi.json` describes the resources and actions the caller may use, and
`GET /api/v1/client.ts` returns a typed TypeScript client generated from it
([Integration](integration.md#resource-api-and-the-generated-client)).

## Lists: filters, export, bulk actions and deleted records

Generic index pages filter each filterable field by its type: «أيٌّ من» (several values)
for lookups, texts and relations, «من / إلى» for numbers, amounts and dates, and
«فارغ / غير فارغ» for every field. Saved views keep these filters. The URL form is
`filters[status][in]=open,closed`, `filters[total][gte]=1000`, `filters[notes][empty]=true`.

«تصدير النتائج» downloads a CSV of every record matching the current search and filters,
not just the loaded rows, with the columns the user may read. Exports above 5000 rows are
refused with a request to narrow the filters.

Selecting rows shows a bulk bar with the actions the user may take: delete, submit,
cancel, restore in «المحذوفات», and actions the application defines in `start/bulk_actions.ts`:

```ts
defineBulkActions('tasks', [
  { key: 'markDone', label: { ar: 'تعليم كمنجزة' }, values: { done: true } },
])
```

Each selected record is checked separately against the user's permissions; the result
lists the records that could not be changed and why. Users who may delete a resource see
«المحذوفات» and can restore deleted records (ADR 046).

## Dashboards

`start/dashboards.ts` declares indicator pages served at `/dashboards/:name`:

```ts
defineDashboard({
  name: 'orders_overview',
  label: { ar: 'لوحة الطلبات' },
  widgets: [
    { key: 'orders', label: { ar: 'عدد الطلبات' }, resource: 'orders', measure: 'count' },
    { key: 'total', label: { ar: 'الإجمالي' }, resource: 'orders', measure: { sum: 'total' } },
    { key: 'byStatus', label: { ar: 'حسب الحالة' }, resource: 'orders', measure: 'count', groupBy: 'status' },
  ],
})
```

Every number is computed as the viewer through `aggregate()`, within the viewer's scope;
a widget over data the viewer cannot read is not shown.

## CSV import

Generic index pages offer "استيراد CSV" to users who may create records. Columns
are matched to writable fields, the worker saves each row through
`ResourceService` with the importer's permissions, and `/imports` shows progress
and row errors. Templates, dry-run checks, upsert by a unique field, the import API and
format adapters are described in [Integration](integration.md#imports). XLSX is not
supported yet ([GAPS](../GAPS.md)).

## Printing

`GET /resources/<name>/<id>/print` renders an RTL A4 page with the fields the user
may see. Set `GOTENBERG_URL` (see `docker-compose.pdf.yml`) to add `?format=pdf`.

## Two-factor authentication

Not available yet (ADR 027); see [GAPS](../GAPS.md).

## Documents and workflows

Submittable resources support submit, cancel and amend-by-copy (a cancelled
document is copied with its inline lines into a new draft).

Workflows are code in the application's `app/modules/<module>/workflows/` and are
listed in its module's `workflows` array:

```ts
export default defineWorkflow({
  name: 'order_approval',
  version: 1,
  resource: 'orders',
  label: 'اعتماد الطلبات',
  start: 'size',
  steps: {
    size: { type: 'condition', when: (o) => BigInt(o.total ?? '0') >= 1000000n, then: 'manager', else: 'done' },
    manager: { type: 'approval', label: 'موافقة المدير', assignees: { role: 'department_manager' }, approve: 'mark', reject: 'rejected' },
    mark: { type: 'update', values: { status: 'approved' }, next: 'tell' },
    tell: { type: 'notify', to: 'submitter', next: 'done' },
    done: { type: 'end', outcome: 'approved' },
    rejected: { type: 'end', outcome: 'rejected', cancelDocument: true },
  },
})
```

Step types: `condition`, `update`, `notify`, `approval`, `decision`, `delay`, `http`, `end`.
`{ role }` recipients name the role's stable key (`roles.key`, set when the role is
created or once in the roles screen). Administrators can rename the Arabic display
name without detaching approvers. A role without a key is still matched by its
name, and `adula:doctor` (`workflows.roles`) warns about such references.
Submitting a document starts the newest version; the run keeps that version.
Change a workflow by adding a new version; move unfinished runs explicitly with
`WorkflowEngine.migrateRuns`. The worker advances due runs; approvers decide in
`/approvals`; failed runs are retried from `/admin/workflows`. HTTP steps send a
stable `Idempotency-Key` because a crash may repeat the call. Transitions are resolved
from the step table itself (ADR 044); `WorkflowDefinition.machine` is deprecated.

### Delegation while out of office

A user delegates their workflow approvals to a colleague for a date range in
`/account/delegations` («التفويض أثناء الغياب»); administrators manage anyone's in
`/admin/delegations`. While the delegation is in force:

* new approvals for the user open for the delegate («نيابة عن ...»), provided the
  delegate can view the record; the user still sees and can decide them;
* the user's pending approvals appear in the delegate's My tasks and can be decided
  there;
* the run's history names who decided and on whose behalf.

Delegation never widens record access (the delegate's own rights still apply), never
covers manual tasks, and never lets anyone approve a request they submitted. It ends at
its last date or when revoked; revoking returns the routed approvals to the approver.
Routing is one hop: if the delegate is away too, the approval stays with its approver.
Ranges are inclusive calendar days of the system time zone (`timeZone` in
`config/adula.ts`, an IANA name such as `Asia/Riyadh`; UTC when unset). With
`Asia/Riyadh`, a delegation dated 1 to 3 November runs from local midnight on
1 November to the end of 3 November. One delegation per user at a time. Code:
`WorkflowDelegations`.

Due dates (`dueInDays`, and the date of an SLA deadline) are calendar days of the same
zone. Pass the zone to `WorkflowEngine`, `Assignments` and `WorkflowDelegations`
(`timeZone` option); the reference `app/services/adula.ts` does.

### SLA deadlines and escalation

Approval and decision steps may declare a deadline in hours and what happens when it
passes:

```ts
manager: {
  type: 'approval',
  label: 'موافقة مدير القسم',
  assignees: { role: 'department_manager' },
  sla: {
    hours: 48,
    dueSoonHours: 8, // reminder; default a quarter of hours, 0 for none
    // 'overdue' (default) tells the approvers; 'notify' also tells the target;
    // 'reassign' moves the approval to the target.
    escalate: { action: 'notify', to: { manager: 'general_manager' } },
  },
  approve: 'director',
  reject: 'rejected',
},
```

`to` is any recipient (`{ role }`, `{ users }`, `'submitter'`, a function) or
`{ manager: roleKey }`: holders of that role scoped to the approver's organizational
unit, or to the nearest ancestor unit. Schedule the `sla:` job family
(`node ace sla:evaluate`, every minute; the reference `start/scheduler.ts` does).
Each pass sends one reminder per approval and escalates each overdue step once
(`workflow_escalations`), through the message templates `workflow.sla_due_soon`,
`workflow.sla_overdue` and `workflow.sla_escalated`. My tasks and the record's
workflow panel show the state: «في الموعد»، «يقترب الموعد»، «متأخر». SLA hours are
wall-clock hours (no business calendar).
