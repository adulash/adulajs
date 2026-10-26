# ADR 045 — The resource definition as the source of truth

Date: 2026-10-25. Status: Accepted (Phase 3 of the owner's post-review plan). Amends
ADR 001 (resource framework) and ADR 009 (typed fields).

## Context

A resource was described four times: the `defineResource` fields, a hand-written VineJS
validator, a Lucid model the framework never read, and the create-migration snapshot.
They drifted. A validator could accept a value the column or the field rejected, a
hook or `systemSave` could store anything the type check allowed, and once a
create-migration had run nothing reported a table that no longer matched its
definition. The field vocabulary also stopped at 13 types, so systems hand-built
e-mail, phone, URL, decimal, percent, choice and many-to-many fields (GAPS.md). The
`customFields` flag created a JSONB column that nothing read or wrote.

## Decision

* **Validator and model are optional.** Without `validator`, writes use a VineJS
  validator derived from the form fields: `definitionValidator(resource)`, compiled once
  per definition (WeakMap) and using the messages provider installed when it is first
  used, so catalog messages apply. `definitionSchema(resource)` returns its object
  properties so an application extends instead of restating them:
  `vine.create(vine.object({ ...definitionSchema(r), extra: vine.string() }))`. A given
  `validator` replaces the derived one (backwards compatible). `model` is accepted and
  never read; persistence is Knex.
* **`fieldValue` is the hard guarantee.** Every stored value passes `fieldValue`
  (`normalizeValues`), after the validator and again after `beforeSave`, so hooks,
  custom validators and system writes cannot store what a field forbids: length, anchored
  pattern, format, options, numeric range, decimal scale and precision. Violations are
  422 `E_FIELD_VALUE` with an Arabic catalog message. The derived validator runs the same
  function as a VineJS rule, so both layers agree; the validator only adds per-field
  messages.
* **New field vocabulary.** Common `default` and `visibleWhen`; `min`/`max`/`pattern`
  (and `format` on string) on text types; `min`/`max` on integer, money (minor units),
  decimal and percent; new types `decimal`, `percent`, `email`, `phone`, `url`, `enum`,
  `multiSelect`, `manyToMany`; resource-level composite `unique` (keys may include
  `orgUnitId`). Definitions are validated by `defineResource` (patterns compile, option
  values are unique, defaults are canonical, `visibleWhen` names stored scalar siblings,
  collections are not sortable, searchable or unique) and by the registry (manyToMany
  targets and module dependencies, join table names).
* **Semantics chosen.** A hidden field (`visibleWhen` false) is stored as null (an
  empty list for manyToMany) on create and on update, and `required` does not apply, so
  a stored record never contradicts its rule; the one exception is an update, which keeps
  the stored value or links of a hidden field the actor may not write. `visibleWhen`
  values are canonical values of the controlling field (`'12.50'` for a scale-2 decimal,
  options for enum and multiSelect), checked by `defineResource`, and the record value is
  made canonical before it is compared. A composite unique index treats NULLs as equal
  (`NULLS NOT DISTINCT`), so a combination with an empty member still names one record. A
  `required` field with `visibleWhen` is a
  nullable column. Declared defaults fill keys a create leaves out before validation;
  they are not field writes by the actor. A manyToMany write syncs by difference inside
  the record's transaction; every newly linked record must be viewable (404/403 like
  belongsTo); links kept unchanged are not re-checked. Unique violations (single or
  composite) stay 409 `E_DUPLICATE`, the status the released resource contract pins, now
  with a message naming the fields.
* **Schema from the definition.** `resourceSchema(resource)` returns the expected table:
  columns with types, nullability and defaults, unique indexes and join tables.
  `createResourceTable` builds exactly that. The doctor check `resources.schema`
  compares every registered resource with the live database (missing table, columns,
  unique indexes by column set, join tables; different types). `node ace
  adula:resource:migration <name>` writes an additive migration embedding only what is
  missing and applying it with the new `alterResourceTable(db, name, addition)`; a
  column added to a table that may hold rows is NOT NULL only with a default, and types
  are never changed automatically. Released migrations stay immutable.
* **Snapshot deprecated.** `adula:resource:snapshot` still rewrites a pending
  create-migration but prints a deprecation notice pointing to
  `adula:resource:migration`; the `resources.snapshots` doctor check is unchanged.
  `adula:resource` and `adula:app` no longer write a validator, model or factory
  (`--validator` and `--model` opt in).
* **Dependency.** `@vinejs/vine` becomes a peerDependency of `adula` (`^4.0.0`, every
  AdonisJS application has it) and a devDependency (4.4.0) for the core tests. No other
  dependency is added.
* **`customFields` removed.** `defineResource` refuses the option with a clear message;
  `createResourceTable` keeps a deprecated `customFields` parameter so released
  create-migrations replay unchanged. Existing `custom_fields` columns are left alone.

## Consequences

Definitions shrink to one file per resource and new systems start from it. A
constraint added to an existing field also applies to records saved before it: an edit
of such a record fails until the stored value is corrected, which is the intended hard
guarantee. Conditions (role rules, aggregate filters) are refused on multiSelect and
manyToMany; CSV import does not map them yet; inline child rows and related rows are
read without their manyToMany links. The search vector is not changed by
`alterResourceTable`: making a field searchable later needs a hand-written migration.
The generic UI widgets for the new types follow in a separate step; until then the
editor payload carries options, constraints, defaults, visibility and relation choices.
