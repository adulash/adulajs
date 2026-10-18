---
name: idea-review
description: Translate a new application (a module under app/modules) or workflow into existing AdulaJS resources and declared extension points before writing code.
---

Use for a new application or workflow only; field changes do not need it.

1. Run `node ace adula:capabilities` and read the output: AdulaJS field types, services,
   workflow steps, extension points, what is outside AdulaJS, and this project's
   registered modules, resources and workflows. Read docs/decisions and GAPS.md.
2. Find existing entities with the same meaning; reference them with belongsTo.
   Never duplicate a table owned by another module.
3. Produce a compact blueprint:
   - module name, `dependsOn`, owned resources with `scoped` stated explicitly;
   - fields with AdulaJS types, required/unique/searchable/filterable, permission levels,
     hidden fields, lookups (groups and keys) and sequences;
   - submittable documents and their workflow as steps (condition, update, notify,
     approval, delay, http, end) with approvers by role;
   - events consumed and emitted, listeners (idempotent) and any webhooks;
   - role rules per action, including conditions from the six operators;
   - acceptance tests: 403/404/uniqueness/scope from the generator plus the
     business rules.
4. Classify each requirement: **now** (AdulaJS capability), **extension** (hooks, page
   override, listener, workflow), or **outside AdulaJS** (record it in GAPS.md
   with Needed by, Tried, Blocked because, Proposed AdulaJS change, Workaround).
5. Never design a dynamic field editor, runtime plugin loader, visual workflow editor
   or a second tenant model. An already-approved plan authorizes its modules; do not
   ask to approve them again.

After implementation, run the reviewers: module-review, security-review,
schema-review, ui-review and perf-review.
