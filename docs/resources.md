# Resource definitions

A resource is one `defineResource({ … })` file under `app/modules/<module>/resources/`. The
definition is the source of truth ([ADR 045](decisions/045-definition-as-source-of-truth.md)):
its fields decide the table columns, the validation of every write, the generated forms and
pages, the API document and the authorization schema. There is no separate validator, model
or snapshot to keep in step.

## Workflow

1. `node ace adula:resource <name> --module=<module>` writes the definition, its
   create-migration and a security contract test (`tests/functional/<name>.spec.ts`).
   `--validator` also writes a VineJS validator file and `--model` a Lucid model and factory,
   for code of your own; AdulaJS reads neither.
2. Fill the labels and fields, then `node ace migration:run`. The create-migration embeds
   the definition as it was scaffolded.
3. After adding fields, unique combinations or manyToMany links to a table that already
   exists, run `node ace adula:resource:migration <name>`. It compares the definition with
   the live database and writes `<module migrations>/<timestamp>_alter_<name>.ts`, an
   additive migration that embeds only the missing pieces and applies them with
   `alterResourceTable(db, name, addition)`. Review it, then `node ace migration:run`. A
   column added to a table that may hold rows is `NOT NULL` only when the field has a
   default; a column whose type differs is reported and never changed automatically (write
   an expand/contract migration by hand). Making an existing field `searchable` also needs
   a hand-written migration: the generated search vector is not changed. The migration
   also applies two relaxing changes: `dropNotNull` removes `NOT NULL` from a column the
   definition now lets be empty (for example a required field that gained `visibleWhen`;
   until then saving it hidden is 422 `E_NOT_NULL`), and `recreateUnique` drops and
   recreates, in the same migration, a unique index of a submittable table that still
   counts cancelled documents. `NOT NULL` is never added to an existing column.
4. `node ace adula:doctor` runs the `resources.schema` check: for every registered resource
   it reports a missing table, missing columns, different column types, `NOT NULL` columns
   the definition lets be empty, missing unique indexes, unique indexes that still count
   cancelled documents and missing join tables, and names the `adula:resource:migration`
   command to run.

`node ace adula:resource:snapshot <name>` is deprecated. It still rewrites a pending
create-migration from the current definition and prints a notice pointing to
`adula:resource:migration`; the `resources.snapshots` doctor check is unchanged (the
snapshot records `visibleWhen` and the resolved `precision`/`scale`).

## Example

```ts
import { defineResource } from 'adula'

export default defineResource({
  name: 'suppliers',
  label: { ar: 'الموردون' },
  recordLabel: { ar: 'مورد' },
  scoped: true,
  fields: {
    code: { type: 'string', label: { ar: 'رمز المورد' }, required: true, pattern: 'SUP-\\d{4}' },
    name: { type: 'string', label: { ar: 'اسم المورد' }, required: true, min: 2, max: 120 },
    email: { type: 'email', label: { ar: 'البريد الإلكتروني' } },
    kind: {
      type: 'enum',
      label: { ar: 'نوع المورد' },
      required: true,
      default: 'local',
      options: [
        { value: 'local', label: { ar: 'محلي' } },
        { value: 'international', label: { ar: 'دولي' } },
      ],
    },
    commercialRegister: {
      type: 'string',
      label: { ar: 'السجل التجاري' },
      required: true,
      pattern: '\\d{10}',
      visibleWhen: { kind: 'local' },
    },
    discountRate: { type: 'percent', label: { ar: 'نسبة الخصم' }, min: 0, max: 100, default: '0.00' },
    categories: { type: 'manyToMany', resource: 'supply_categories', label: { ar: 'فئات التوريد' } },
  },
  unique: [['orgUnitId', 'code']],
  list: ['code', 'name', 'kind'],
  form: ['code', 'name', 'kind', 'commercialRegister', 'email', 'discountRate', 'categories'],
  show: ['code', 'name', 'kind', 'commercialRegister', 'email', 'discountRate', 'categories'],
  actions: ['view', 'create', 'update', 'delete'],
})
```

The test fixture `apps/reference/tests/fixtures/modules/suppliers` uses every field type
below and is exercised by `apps/reference/tests/functional/field_types.spec.ts`.

## Field reference

### Field types

| Type | Column | Value on the wire | Type-specific props | List filter (`filters[key]=v`) |
|---|---|---|---|---|
| `string` | varchar(255) | trimmed string | `min`, `max` (length), `pattern`, `format: 'email' \| 'url' \| 'phone'` | equality |
| `text` | text | string (not trimmed) | `min`, `max`, `pattern` | equality |
| `email` | varchar(254) | trimmed, lower-case address | `min`, `max`, `pattern` | equality (normalized) |
| `phone` | varchar(32) | `+?digits`, 7 to 15 digits, e.g. `+966551234567`; input may contain spaces, `-`, `.`, `()` and Arabic-Indic digits | `min`, `max`, `pattern` | equality (normalized) |
| `url` | varchar(2048) | absolute `http://` or `https://` URL; `javascript:`, `data:` and relative URLs are refused | `min`, `max`, `pattern` | equality |
| `integer` | integer | number | `min`, `max` | equality |
| `money` | bigint | integer string of minor units, e.g. `"150000"` | `min`, `max` in minor units (string or safe integer) | equality |
| `decimal` | numeric(precision, scale) | decimal string with exactly `scale` digits, e.g. `"12.50"`; numbers and shorter strings are accepted and normalized. A JSON number of magnitude `Number.MAX_SAFE_INTEGER` or more, or with more than 15 significant digits, is refused (422 `unsafeNumber`): send such values as strings | `precision` (default 18, 1 to 1000), `scale` (default 2, 0 to precision), `min`, `max` | equality |
| `percent` | numeric(precision, scale) | like decimal; `"12.50"` means 12.5 % | as decimal, defaults precision 7 and scale 2 | equality |
| `boolean` | boolean | boolean | | equality |
| `date` | date | `YYYY-MM-DD` | | equality |
| `datetime` | timestamptz | UTC ISO string with milliseconds | | equality |
| `json` | jsonb | JSON value | | none |
| `enum` | varchar(255) | one option `value` | `options` (required) | equality |
| `multiSelect` | jsonb | distinct option values in `options` order | `options` (required), `min`, `max` (count) | contains the value; `null` = empty |
| `lookup` | varchar(255) | a key of the lookup group | `group` (required) | equality |
| `belongsTo` | integer foreign key (restrict) | target id | `resource` (required) | equality |
| `user` | integer foreign key to users (restrict) | user id; readers see `{ id, fullName }` | | equality |
| `attachment` | integer (attachments row) | attachment id | `accept` (extensions or `'any'`), `maxSize` (default `'20mb'`) | equality |
| `hasMany` | none (child resource) | child rows | `resource`, `foreignKey` (required), `inline` | none |
| `manyToMany` | none: join table | ascending array of linked ids, `[]` when none | `resource` (required), `table` | has the target id; `null` = no links |

`options` is a list of `{ value: string; label: Label }`, values unique and at most 255
characters. Option labels follow the same rules as field labels: `ar` required, other
languages optional.

`pattern` is a regular expression source matched against the whole (trimmed) value: it is
wrapped in `^(?:…)$`, so `'\\d{10}'` means exactly ten digits. Text lengths are capped by
the column (255 for string, 254 for email, 32 for phone, 2048 for url); a longer value is
refused with 422 instead of a database error.

A `manyToMany` field stores no column. Its join table is `table`, or
`<owner table>_<field key in snake_case>`, with the columns `<owner>_id` and `<target>_id`
(`related_id` when a resource links itself), both foreign keys `RESTRICT`, primary key on the
pair and an index on the target. `joinTable(owner, key, field)` returns those names. A write
replaces the whole list (at most 500 ids) and the server syncs it by difference inside the
record's transaction; every newly linked record must be live and viewable by the actor
(scope and role rules), checked with one query per field: 404 when any of them is not. Links
kept unchanged are not re-checked. Amend-by-copy links the same records, on the document and
on its copied inline lines (a line's links are copied only when the actor may create that
field, like its other values).

### Common field props

| Prop | Meaning |
|---|---|
| `label` | Required `Label` (`{ ar, en?, … }`). |
| `required` | A value is needed (at least one for multiSelect and manyToMany). The column is `NOT NULL` unless the field has `visibleWhen`; optional fields are nullable columns. A column created `NOT NULL` before `visibleWhen` was added keeps the constraint until `adula:resource:migration` drops it (the doctor reports it); meanwhile a save that hides the field is 422 `E_NOT_NULL` naming the field. |
| `default` | Applied on create when the input omits the key (before validation), prefilled in the create form (`editor.defaults`) and the column default for scalar types. Must be a canonical value of the type (`'0.00'` for a scale-2 percent); an array only for multiSelect. Not allowed on belongsTo, user, attachment, json, hasMany, manyToMany or sequence fields. A default is the definition's value, not a field write by the actor. |
| `visibleWhen` | `{ sibling: value \| value[] }`: the field applies only while every named sibling equals the value or one of the listed values (a multiSelect sibling must contain it; `null` matches an empty value, and for a multiSelect sibling no selection). A field whose sibling is itself hidden is evaluated with that sibling cleared, repeated until stable, on the server and in the generated form (inline rows included). Each value must be a canonical value of the controlling field (`'12.50'` for a scale-2 decimal, an option value for enum and multiSelect), checked by `defineResource`; the server makes the record's value canonical before comparing. While the field does not apply the form hides it, `required` is not enforced and the server stores null (an empty list for manyToMany) on create and on update, whatever was submitted, except that an update keeps the stored value or links of a field the actor may not write. Siblings must exist and cannot be hasMany, manyToMany, json or attachment. |
| `unique` | Partial unique index over live rows (`WHERE deleted_at IS NULL`). On a submittable resource cancelled documents do not count (`AND doc_status <> 2`), so an amended copy keeps the value of its cancelled original. |
| `sortable` | Allowed in `sort`. Not on multiSelect, manyToMany or hasMany. |
| `searchable` | Part of the generated full-text vector. Only string, text, email, url, phone, enum and lookup. |
| `filterable` | Offered as a list filter. |
| `permissionLevel` | Field-level access level for role rules. |
| `sequence` | Numbering sequence key; the value is assigned on create. |
| `column` | Column name when it is not the snake_case key. |

multiSelect, manyToMany and hasMany fields cannot be `unique`, `sortable` or `searchable`,
and role rule conditions cannot use them. Role rule conditions ($eq, $ne, $in, $lt, $gt,
$like; there is no $gte or $lte) on decimal and percent fields take canonical decimal strings
with exactly `scale` decimals and compare numerically; ordered rules ($lt, $gt), like money
ones, need `buildAbility(rules, registry.all())` so the field schemas are known. CSV import
reads decimal and percent cells with thousands grouping (`1,234.5`) and the Arabic decimal
point (`٫`); a comma as the decimal point (`12,5`) is refused. CSV import does not map multiSelect or
manyToMany yet.

### Resource options

| Option | Meaning |
|---|---|
| `name` | Table name: lower-case letters, digits and `_`. |
| `label`, `recordLabel`, `createLabel` | List heading (plural), record noun («إضافة مورد»), full create-button text. |
| `scoped` | Required. `true` adds `org_unit_id` and organizational scope. `scope: { from }` copies the unit from a required belongsTo parent. |
| `fields`, `list`, `form`, `show`, `serialize`, `hidden`, `title` | Field definitions and the keys each surface uses. `title` names the record in relations, pickers, tasks and approvals. |
| `unique` | Composite unique combinations, for example `[['orgUnitId', 'code']]`: a partial unique index over live rows (not cancelled documents on a submittable resource) per combination that treats NULLs as equal (`NULLS NOT DISTINCT`: two rows with the same code and both empty in another member conflict). Adding a combination with `adula:resource:migration` fails while live rows already repeat it, null members included: correct those rows first. Each needs two or more distinct stored fields; `orgUnitId` is allowed on a scoped resource (a code unique per unit). |
| `submittable`, `version` | Draft/submit/cancel/amend-by-copy; optimistic versions (default with submittable). |
| `actions` | `view`, `create`, `update`, `delete`, and `submit`, `cancel`, `amend` when submittable. |
| `hooks` | `beforeSave` / `afterSave`, inside the write transaction. |
| `validator` | Optional; see below. |
| `model` | Optional and never read: AdulaJS persists through Knex. Keep it if your own code uses the Lucid model. |

`defineResource` refuses invalid definitions with a message naming the field: an invalid
pattern, duplicate option values, a non-canonical default, `visibleWhen` naming an unknown
field or using a non-canonical value, unknown unique keys. `customFields` was removed and is refused.

## Validation

Without `validator`, every write is validated by the VineJS validator derived from the
form fields, `definitionValidator(resource)` (compiled once per definition). Its messages
come from the message catalog (Arabic by default): for example `phone`, `decimalScale`,
`decimalPrecision` and `relation`, next to VineJS rules such as `regex`, `minLength`,
`maxLength`, `email`, `url`, `min`, `max` and `in`. Errors are the usual 422
`E_VALIDATION_ERROR` with per-field messages.

To add or tighten rules, extend the derived schema instead of restating the fields (here
`name` gets a stricter rule; the definition still applies when the value is stored):

```ts
import vine from '@vinejs/vine'
import { defineResource, definitionSchema } from 'adula'

const fields = { /* … */ } as const
const base = { fields, form: ['code', 'name'] as const }

export default defineResource({
  // …
  ...base,
  validator: vine.create(
    vine.object({ ...definitionSchema(base), name: vine.string().trim().minLength(3) })
  ),
})
```

A given `validator` replaces the derived one. Whatever it returns, and whatever a
`beforeSave` hook or `systemSave` writes, every stored value is checked again against the
field (length, pattern, format, options, range, decimal scale and precision): a violation
is 422 `E_FIELD_VALUE` with an Arabic message. This also covers records saved before a
constraint existed: after adding `max` or `pattern` to a field, an edit of a row whose value
violates it fails with 422 until the value is corrected. A unique violation, single or composite, is
409 `E_DUPLICATE` with a message naming the fields, for example «هذه القيمة مستخدمة في سجل
آخر: الوحدة التنظيمية، رمز المورد».

`@vinejs/vine` (`^4.0.0`) is a peer dependency of `adula`; every AdonisJS application
already has it.
