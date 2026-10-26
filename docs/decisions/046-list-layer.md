# ADR 046 — List layer: filter operators, server export, bulk actions, restore, dashboards

Date: 2026-10-18. Status: proposed (Phase 3 of the post-review programme); the points
marked «owner» need the owner's confirmation.

## Context

GAPS.md listed five list gaps: equality-only filters, a browser CSV of the loaded rows,
no bulk actions, no restore of soft-deleted records and no dashboards although
`ResourceService.aggregate()` exists. The resource type (`src/resource/types.ts`) is
being extended in parallel by the field-types work, so this layer must not depend on new
keys of `Resource` or `Module`.

## Decision

### Filter operators

A list or aggregate filter value is either a scalar (equality, unchanged) or one
operator object:

| Object                      | Meaning                              | Field types                                   |
| --------------------------- | ------------------------------------ | --------------------------------------------- |
| `{ in: [v, …] }` (1–50)     | any of the values                    | string, text, lookup, integer, belongsTo, user |
| `{ gte: v }`, `{ lte: v }`, both | inclusive range                 | integer, money, date, datetime                |
| `{ empty: true \| false }`  | IS NULL / IS NOT NULL (empty text too) | every filterable field                       |

In the query string: `filters[total][gte]=10&filters[total][lte]=99`,
`filters[status][in]=open,closed` (or `filters[status][in][]=…`),
`filters[notes][empty]=true`. Every operand goes through the field's coercion, so an
invalid value is the same 422 `E_FILTER` as today; an unknown operator, mixed operators
other than gte+lte, an operator on a field type outside the table, or more than 50 `in`
values is 422 `E_FILTER`. Saved views store the same shapes and validate them on save
(strict) and on read (dropped). The keyset cursor is unchanged: it encodes only sort,
direction and the last row, while filters stay in the URL.

### Server export

`GET /resources/:resource/export?…list query…` returns `text/csv; charset=utf-8` (BOM,
CRLF) of the currently filtered set — search, filters, tag and sort as in the list —
read page by page through `list()`, so the actor's rules, organization scope, field
redaction and soft-delete filter are exactly the list's. Columns are the resource's list
fields the actor may read (hidden fields are left out, not blanked). Values are display
values: lookup labels, related record titles, user names, «نعم/لا», ISO dates. The limit is
`EXPORT_ROW_LIMIT` = 5000 rows; above it the request is 422 `E_EXPORT_LIMIT` with
«عدد السجلات المطابقة يتجاوز حد التصدير (5000 سجل). ضيّق التصفية ثم أعد المحاولة.» and nothing
is written. Exports are audited in the activity log (`core.exports`, action
`exported`, with the query and row count). There is no background job: the bounded
synchronous export needs no file storage or retention policy, and a job-delivered export
can be added behind the same limit later.

### Bulk actions

`POST /resources/:resource/bulk` with `{ action, ids: number[1..100], versions?: {id: v} }`
returns `{ data: { succeeded: number[], failed: [{ id, code, message }] } }`. Built-in
actions: `delete`, `restore`, `submit`, `cancel`. Resource-defined actions are declared with
`defineBulkActions(resource, [{ key, label, values, confirm? }])` and registered on the
`BulkActions` service; such an action is an update with fixed `values` through
`ResourceService.save`, so validation, field write rules, hooks, versioning and audit are
the ordinary update's. Every row runs in its own transaction with the actor's per-row
policy check, so one refused row does not undo the others. Failures carry the Arabic
message of the error. `GET /resources/:resource/bulk` lists the actions the actor may
offer (resource-level permission); per-row refusal is still decided per row.

### Restore and «المحذوفات»

`ResourceService.restore(name, id, actor)` clears `deleted_at` of a soft-deleted record and
records a `restore` activity and a `<module>.<resource>.restored` event. «owner»: restore is
authorized by the actor's **delete** rule (conditions, fields and organization scope
evaluated on the deleted record) instead of a new `restore` action, so existing roles keep
working and nobody gains a new power. `list(…, { trashed: true })` lists deleted records to
actors with the delete permission (403 otherwise); the reference list shows a
«المحذوفات» toggle only when the description says `trash: true`.

### Dashboards

`defineDashboard({ name, label, widgets })` declares an indicators page outside the resource
type. A widget is `{ key, label, resource, measure: 'count' | { sum: field }, groupBy?,
filters?, where? }`; the `Dashboards` service runs each widget through
`ResourceService.aggregate()` as the viewer, so every number is limited to what that viewer
may see; a widget the viewer cannot read is omitted, not failed. Grouped values come back
with display labels (lookup labels, record titles, «نعم/لا»).

### Implementation notes

- Filter operators on a field the actor may not query are refused exactly like equality
  filters on it: 422 `E_FILTER` in list/aggregate (unchanged behaviour), 403
  `E_FIELD_FORBIDDEN` when saving a view.
- Services: `new BulkActions(registry, resources, sets)` and
  `new Dashboards(db, registry, resources, definitions)` (the database is needed for user,
  lookup and organization-unit labels of grouped values).
- A resource-defined bulk action resubmits the stored form values the actor may write,
  with the action's values on top, so validators that require other fields still pass.
  The row is locked (SELECT … FOR UPDATE) for the read and the save in one transaction,
  so a concurrent edit is not overwritten. Known limitation: resubmitting stored values
  fails on a lookup that became inactive or a related record the actor can no longer
  view; a partial-update path would need the write module (owner decision).
- Row failures carry the error's code and Arabic message; validation errors are
  `E_VALIDATION` with the first message; anything unexpected is reported to the
  application logger and returned as `E_BULK_ROW`.
- Restore clears `deleted_at` and records the audit only: it runs no validator or hooks
  and does not re-check related records or lookups. The `restored` event is not consumed
  yet by followers and live updates (record collaboration) or by outbound webhooks.
- A dashboard widget that totals, groups, filters or conditions on a field the viewer may
  not query is omitted. Filter and condition keys are checked against the resource when
  the definitions are validated (`Dashboards.validate`, `BulkActions.validate` at boot).
- An export first runs one bounded count (at most EXPORT_ROW_LIMIT + 1 rows of the same
  authorized query), so an oversized export costs one query; the reference application
  also throttles exports to 10 per minute per user.
- Exported money is a plain decimal amount (`1500.00`); range operands on money fields
  are canonical minor units, as stored.
- A dashboard whose widgets are all hidden from the viewer is 404 for that viewer.

## Consequences

The list layer adds no migration. Systems keep their resources unchanged; dashboards and
bulk actions are opt-in definitions registered in the application's services. Restore
reuses delete permissions until the owner decides otherwise.
