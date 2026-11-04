# ADR 029 — System writes, inherited scope and managed assignments (1.1.0)

Date: 2026-09-29. Status: accepted by the owner for 1.1.0. After the decisions were explained, the owner
stated in conversation: "موافق، ادمج #53 بعد نجاح CI" (agreed; merge #53 after CI passes).
The closing-note rule in decision 3 was also set by the owner.

Issues #44, #45 and #51 came from an independent consumer: clinic supervisory-visit
modules with 20 resources, 14 listeners and 9 custom pages. Each workaround in those
issues reimplemented kit rules in module code. All three are additive minor changes.

## Decisions

1. **`ResourceService.systemSave(name, values, id, { actorId, trx, reason, version })`.**
   Module code sometimes decides a write itself: a state transition, a snapshot, or a
   listener update. That write goes through the same `persist` path as `save()`: the
   validator, hooks, required, lookup, relation and attachment-ownership checks,
   sequences, versioning, the activity log with field history, and the outbox event.
   It skips only the actor's role rules and organization scope. It may write any
   stored field except sequences and inline children, and updates are merged into the
   stored record before the validator runs. Submitted documents stay locked.
   The activity entry records `system: true` and the reason. The result is the full
   stored record; module code must not send it to users unfiltered. There is no bulk
   variant yet: one event per row keeps the listener contract unchanged.
2. **`scope: { from: '<belongsTo field>' }`.** A scoped record can inherit its unit
   from a required parent that is itself scoped. The unit is copied from the parent
   before authorization. The actor must be able to view the parent, and must be allowed
   to create or update in its unit. The unit is recomputed after `beforeSave`, because
   a hook may change the parent. `orgUnitId` is not writable for such resources: the
   API refuses it, the editor returns `scopeFrom` and no unit options, the generated
   form hides the picker, imports and OpenAPI omit the unit, and the contract helper
   does not send it. `ResourceService.rehome(parent, id, options)` moves the children
   of a moved parent through `systemSave`. It is idempotent and meant for a listener
   on the parent's `updated` event.
3. **Managed assignments and closing notes.** `Assignments.create(db, { managed: true })`
   marks a task that represents open work on the record. Module code closes it with
   `Assignments.close(resource, recordId, { actorId, outcome, reason, trx })`. The close
   is recorded in the record's activity log (`assignment_closed`) with the reason, and
   the assigner or the assignee is notified as for a manual close.
   The owner then decided: "يجب اضافة ملاحظة على الاقل لأغلاقها وليس فور ضغط الزر" and
   "للمستخدم حرية ابقائها اختيارية او الزامية حسب تطبيقه او وجهة نظره". So pressing
   «تم الإنجاز» or «إلغاء المهمة» never closes a task at once: a dialog asks for a
   closing note, and `complete(id, actor, outcome, { note })` stores it as the close
   reason. Each application sets the policy with
   `new Assignments(db, resources, actors, { closeNote: 'optional' | 'required' })`.
   The default is `optional`, which keeps 1.0 behavior for API clients. A managed task
   may also be closed by hand, but only with a note, and that note goes to the
   record's activity log.
   The additive kit migration `1770000000011_kit_managed_assignments` adds `managed`
   and `close_reason`.

## Consequences

- `pnpm check:api` reports the widened `Resource`, `ResourceEditor`, `Assignment`,
  `createResourceController` and `recordMutation` types as changed. Each change only
  adds optional input or new output, so it is a minor change, and the snapshot was
  updated.
- Test-only consumers: the `order_deliveries` fixture resource inherits its scope from
  `orders` and runs the HTTP security contract. Kit tests on PostgreSQL cover system
  writes, inherited scope, re-homing and managed assignments.
- Not included: a declared record action for managed tasks (it depends on #48, create
  defaults), and user-only fields excluded from system writes.

## Amendment, 2026-09-29: system writes stay out of request handlers

`systemSave` and `rehome` skip role rules, so a controller or route that calls them
would let a user write past the unified authorization. The owner approved a guard
("نعم، نفّذ ذلك"):

- the ESLint rule `adula/no-system-save-in-controllers` rejects these calls in
  `app/controllers`, `app/modules/*/controllers` and `start/routes`. The reference
  configuration and new applications enable it;
- managed AGENTS rule 10 states that these calls belong in listeners and module
  services after an explicit authorization.

## Addendum (2.2.1): naming the missing parent rule

Creating or updating a `scope.from` child still requires `view` on its parent. The refusal
now names both resources («حفظ <child> يتطلب صلاحية عرض <parent>»), and `adula:doctor` and
`adula:install` warn about roles that may create or update such a child without any view
rule on its parent (#140). A parent outside the actor's scope stays 404.
