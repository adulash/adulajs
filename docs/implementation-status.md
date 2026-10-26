# Implementation status

Current state of AdulaJS 2.1.0 on 2026-10-18. [CHANGELOG.md](../CHANGELOG.md) is the
chronology of what changed and when; [GAPS.md](../GAPS.md) lists what users still cannot
do. This page describes what exists today.

## Model

One deployment per company is a **system** (نظام). Each business module inside it
(sales, HR and so on) is an **application** (تطبيق), registered as an AdulaJS module.
Arabic is the base language of the interface; other languages are optional and
chosen per user (docs/languages.md, ADR 041).

## Packages

| Package | npm name | Contents |
|---|---|---|
| `packages/adula` | `adula` | Resource framework, services, migrations, Ace commands, ESLint rules, agent skills |
| `packages/ui` | `@adula/ui` | Copy-in shadcn/ui registry of 42 components, theme and fonts |
| `packages/create-adulajs` | `create-adulajs` | Creator (`npm create adulajs my-system`) and 1.x upgrade |

All three share one version and are published together from a `v<version>` tag
(see [releasing](releasing.md) and the [release table](releases.md)).

## Core capabilities (`adula`)

* Resources: `defineResource` with 13 field types (string, text, integer, money, boolean,
  date, datetime, json, attachment, belongsTo, user, hasMany, lookup), record titles,
  sequences, optimistic versions (409 on stale writes), soft delete, draft/submit/cancel
  and amend-by-copy, create defaults from the URL, keyset pagination with a 100-row cap.
* Authorization: CASL rules with SQL/in-memory parity, organizational scope as a separate
  AND condition, field-level redaction and writable whitelists, `$actor.id` conditions,
  inherited scope (`scope: { from }`), `systemSave()` for module code.
* `ResourceService`: list (equality filters, full-text search, tags, sort), show, save,
  delete, `aggregate()` (group, count, sum), titles, editor options, inline child rows.
* Administration services: users, invitations, roles and rules, organizational units,
  settings, sessions, impersonation with audit, activity log, runtime health, setup center.
* Collaboration: comments with mentions, followers, tags, field history, assignments and
  one "My tasks" page for tasks and approvals.
* Notifications: message templates editable by administrators, in-app inbox with realtime
  SSE (one shared stream per browser), e-mail delivery by the worker.
* Integrations: signed outgoing webhooks with retries, signed inbound webhooks with
  deduplication, API tokens with `/api/v1` and per-caller OpenAPI, CSV import through the
  worker, RTL print page with optional Gotenberg PDF, optional MCP tools (`adula/mcp`).
* Workflows: versioned workflows with condition, update, notify, approval, decision,
  delay, http and end steps; row locks, bounded retries, failed-runs screen;
  transitions resolved from the step table (ADR 044, XState kept only for the
  deprecated `machine` until the next major); approval delegation while out of office
  (`/account/delegations`, `/admin/delegations`) with audit of who acted on whose
  behalf; per-step SLA deadlines with reminders and escalation (overdue, notify or
  reassign, including the approver's manager in the org tree) by the `sla:evaluate`
  job.
* Attachments: private storage on Drive disks (filesystem or S3), authorized download,
  upload grants, `adula:storage:migrate`, upload pruning.
* Operations: outbox and jobs, scheduler/worker heartbeats, `backup:create`,
  `backup:verify`, `backup:restore-files`, `backup:restore-test`,
  `adula:restore:reconcile` (see [operations](operations.md)).
* Commands: `sla:evaluate`, `adula:install`, `adula:doctor`, `adula:resource`, `adula:app`, `adula:module:add`,
  `adula:module:remove`, `adula:ui`, `adula:capabilities`, `adula:gaps`, `adula:upgrade`.
* Agent support: managed AGENTS.md block, business-design and review skills, generated
  capability catalog, ESLint rules `adula/no-core-patching` and
  `adula/no-system-save-in-controllers`. The public API contract is `api/adula-api.json`.

## Reference application (`apps/reference`)

The AdonisJS 7 + Inertia/React host whose application code the creator copies into new
systems: authentication (password recovery, sessions, optional Google/GitHub sign-in),
administration screens, workspace with module groups and generic resource pages with record
dialogs. Its production Dockerfile, Compose files, Caddy and deploy scripts stay in
`apps/reference` ([operations](operations.md)). The educational customers/orders/tasks
modules exist only as test fixtures under `apps/reference/tests/fixtures` (ADR 017).

## Consumers under `tests/`

* `tests/release`: Node tests for packaging, the public API contract, the upgrade
  harness, the performance harness and issue templates (`pnpm test:release`).
* `tests/consumer`: an independent application built from packed archives
  (`pnpm test:consumer`).
* `tests/medical-consumer`: a disposable customized consumer with seed data, k6 load
  and restore checks (`pnpm test:medical`).
* `pnpm test:create` builds a system from the packed creator; `pnpm test:upgrade
  --published=<version>` upgrades a published version in place.

## Test counts

Counted on 2026-10-18 as `test(`/`it(` declarations at the start of a line, per suite.
Japa and `node:test` run more cases than declarations where a helper registers tests
(each `resourceContract()` call registers 7).

| Suite | Files | Declarations |
|---|---|---|
| Core (`packages/adula/tests`, PostgreSQL 17) | 34 | 212 |
| Reference HTTP (`apps/reference/tests/functional`) | 27 | 124 |
| Reference browser (`apps/reference/tests/browser`, Playwright) | 10 | 35 |
| Reference helpers and opt-in S3 acceptance | 2 | 8 |
| UI (`packages/ui/tests`) | 2 | 7 |
| Creator (`packages/create-adulajs/tests`) | 7 | 45 |
| Release (`tests/release`) | 6 | 16 |
| Medical consumer (`tests/medical-consumer`) | 1 | 3 |

## Known limits

* Validator, Lucid model and migration are written by hand next to each resource.
* XLSX import, SAML SSO and a typed API client are not available. Two-factor
  authentication (TOTP) and OAuth/OIDC SSO are described in [authentication.md](authentication.md).
* Lists filter by equality only; CSV export covers the loaded rows.
* The interface is Arabic only.

The full list is in [GAPS.md](../GAPS.md).
