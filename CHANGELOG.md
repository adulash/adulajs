# Changelog

## Unreleased

### Integration surface

Minor: new exports only (`pnpm check:api` reports additions). It adds five additive
migrations: `1770000000041_import_modes`, `1770000000042_sync_jobs`,
`1770000000043_notification_channels`, `1770000000044_channel_confirmations` and
`1770000000045_import_leases`. See docs/integration.md and ADR 043.

* **Generated API client.**
  * `apiClientSource` and `apiClientDeclarations` turn the OpenAPI document into one
    self-contained typed TypeScript client (`createAdulaClient`, `AdulaApiError`). It needs
    no package.
  * The client is served per token at `GET /api/v1/client.ts` and `GET /api/v1/client.d.ts`.
  * New command `node ace adula:client [--as-user] [--url] [--output]` writes it under `clients/`.
  * The OpenAPI document gains `operationId`s, list `filters[field]`, sort enums,
    `estimate`, aggregate `filters`/`count`, the amend path, the imports endpoints and an
    `ImportBatch` schema.
  * Actor-filtered documents now leave out fields the caller can never read or write.
* **Imports.**
  * Format adapters (`ImportAdapter`, `csvImportAdapter`, `importFile`, the `adapters`
    option and `registerAdapter`) are the registration point for XLSX. No XLSX parser is
    bundled.
  * Per-resource CSV header templates in Arabic.
  * Dry-run validation with a per-row report (status `validated`).
  * `upsert` mode by a `unique` field (needs the update permission).
  * Bearer API routes under `/api/v1`: imports list, show, create (JSON or multipart),
    start and template.
  * Type note: `ImportBatches` methods now return `ImportBatchRecord`, whose `status` adds
    `'validated'`. Code that assigns their result to the older `ImportBatch` type (kept
    unchanged and deprecated) must switch to `ImportBatchRecord`. `pnpm check:api`
    compares exported names and does not report this.
  * Upsert keeps a record's stored value when its cell is empty; creates treat an empty
    cell as no value.
* **Sync jobs.**
  * `defineSyncJob` and `SyncJobs` define and run them. The scheduler queues runs and the
    worker runs them; run history is kept in `sync_job_runs`, with error categories and
    stale-run recovery.
  * The admin jobs page has a «مهام المزامنة» section with «تشغيل الآن» and history.
    Routes: `POST /admin/jobs/sync/:name/run` and `GET /admin/jobs/sync/:name/runs`.
* **Notification channels.**
  * The `NotificationChannel` interface has in-app and e-mail implementations, and
    `NotificationChannels` dispatches to them.
  * Per-user channel preferences are set on the profile (`PUT /account/notification-channels`).
  * `httpNotificationChannel` is a signed, vendor-neutral SMS/WhatsApp HTTP provider sent
    through the guarded outbound client.
  * The provider is configured under admin settings, with the secret sealed in
    `channels.http` and shown once. Routes: `PUT /admin/settings/channels`,
    `POST /admin/settings/channels/rotate` and `POST /admin/settings/channels/test`.
  * `notifyWithTemplate` keeps its signature. It now skips e-mail for users who turned it
    off, and queues opt-in channel deliveries in the same transaction.
  * New `isSealedSetting`: `channels.*` settings are read-only in the generic settings editor.
  * A phone number is enabled only after a one-time code sent to it is confirmed
    (`POST /account/notification-channels/:key/code` and `…/confirm`, throttled). This adds
    the additive migration `1770000000044_channel_confirmations`.
  * The admin test-message route is throttled.
  * Queued SMS/WhatsApp messages are dropped only when a successful settings read shows
    the provider is off; otherwise they wait, at most 24 hours (then skipped as `expired`).
    Without `{ retired: [...] }`, `NotificationChannels` no longer skips the deliveries of
    a channel that is merely unregistered. Pass the keys a successful configuration read
    proved are off (`HttpChannelSettings.resolve()`) to skip them at once as
    `channel-unavailable`.
  * Numbers saved before confirmation existed count as unconfirmed and must be confirmed
    again. Codes are capped at 5 per channel in 24 hours.
* Imports: workers claim a batch with a lease (additive migration
  `1770000000045_import_leases`), so two workers never process the same batch. This also
  fixes a race that already existed on `main`.
* Sync jobs: handlers must honour `ctx.signal`. Within one worker, a job's next run waits
  until an abandoned handler of that job settles.
* The reference worker now delivers notifications through the channel dispatcher and runs
  sync jobs in a lane of their own.
### Multiple attachments and preview

Minor (ADR 047), no migration. `pnpm check:api` reports `AttachmentSummary` (optional
`preview` key), `Field`, `ResourceEditor`, `createResourceController`, `loadAttachments`
and `summarizeAttachment` as changed because each gains optional members; the
`ResourceService` constructor takes an optional `{ attachments }` too. It also adds new
exports (`attachmentPreview`, `attachmentHeaders`, `AttachmentPreview`,
`AttachmentPreviewOptions`, `MULTIPLE_ATTACHMENT_LIMIT`). Existing code compiles
unchanged.

* An attachment field takes `multiple: true` and `max` (1 to 100, default 10): a `jsonb`
  column of ordered attachment ids. `accept` and `maxSize` apply to each file. Added files
  are claimed like one file (uploader, field, grant record, unit), removed files are
  released, the audit records the id arrays, export lists the file names and import
  refuses the column with an Arabic message.
* `GET /attachments/:id?preview=1` renders png, jpg, gif, webp, pdf and txt inline when the
  extension and stored type agree, with the listed `Content-Type`, `nosniff` and a CSP
  with `default-src 'none'` (sandboxed except PDF). SVG, HTML and other types always
  download. The authorization is the download's. `config/adula.ts` gains
  `attachments: { pdfPreview: true }`; set it to `false` to download PDFs instead of
  previewing them (projects add the key to their own config to change it).
* `@adula/ui`: new `attachment-preview` Dialog; the attachment control handles several
  files (progress, reorder, remove, preview); record details show preview buttons.
  Regenerate consumer UI through `adula:ui`.

### Print templates

Minor (ADR 048), with the additive migration `1770000000049_print_templates`.
`pnpm check:api` reports `Resource`, `ResourceDescription`, `UiPreferences` and
`ResourceChildren` as changed because each gains an optional field (`printTemplates`,
`printTemplates`, `digits`, `related`);
existing code compiles unchanged.

* Resources may declare `printTemplates` (paper, orientation, header/footer, fields,
  line columns and totals); unknown fields are definition errors.
* Administrators create and version templates per resource in «قوالب الطباعة»
  (`/admin/print-templates`) with a safe `{{ }}` language, an allowlist HTML sanitizer
  and a preview on a readable record. Versions are immutable.
* `GET /resources/:resource/:id/print?template=<key>` prints with a template; values are
  read as the printing user, so unreadable fields stay empty. Every print records a
  `printed` activity with the template key, version and format.
* The record page's «طباعة» opens a dialog to choose the template and HTML or PDF
  (registry component `record-print`).
* `ui.preferences` accepts an optional `digits: 'latn' | 'arab'` for printed numbers;
  stored values without it stay valid.
* New `ResourceService.documentLines(name, id, actor, { fields, limit })` reads the line
  groups of a printed document with children()'s authorization, the lines' own relation
  rows, and no silent cut: a print refuses more than `PRINT_LINE_LIMIT` (1000) lines per
  group with 422 `E_PRINT_LINE_LIMIT`. The generic print uses it too, so it no longer
  stops at 100 lines.
* **Behavior change:** the generic print (`/resources/:resource/:id/print` without a
  template) of a record with more than 1000 lines in a group now answers 422
  `E_PRINT_LINE_LIMIT`; before, it silently printed the first 100 lines.
* `PrintTemplates.update` needs `expectedVersion`, the version the editor opened; a
  mismatch (another administrator saved meanwhile) is 409 `E_PRINT_TEMPLATE_CONFLICT`, so
  a concurrent edit is refused instead of silently dropped.
* `PrintTemplates.create` refuses an existing key (409), `update` needs one (404) and keeps
  the stored `active` flag when it is not sent. `recordPrinted` writes the `printed`
  activity; the reference app calls it after the HTML is rendered or the PDF converted.
* `renderTemplateDocument` renders a template for one reader's description; printed
  date-times and the print time use the application time zone (`timeZone`), and Arabic-
  Indic digits apply to `{{id}}`, `{{rowNumber}}` and `{{printedAt}}` too.

### Workflow delegation and SLA

Minor (ADR 044). An additive migration `1770000000046_workflow_delegation_sla` adds
`workflow_delegations`, `workflow_escalations` and six nullable `assignments` columns.
`pnpm check:api` reports `WorkflowStep`, `WorkflowRun`, `WorkflowOptions`, `Assignment`
and `AssignmentOptions` as changed because each gains optional fields; existing code
compiles unchanged.

* Delegation while out of office: `WorkflowDelegations` (create, revoke, list,
  candidates) and the reference pages `/account/delegations` and `/admin/delegations`.
  While a delegation is in force, new approvals open for the delegate on behalf of the
  approver, and the approver's pending approvals can be decided by the delegate. The
  run history records who decided on whose behalf (`onBehalfOf`, `onBehalfOfName`).
  Delegation never widens record access, never lets anyone approve a request they
  submitted, and ends at expiry or revocation (revoking returns the routed approvals to
  the approver). The delegate picker searches names of two characters or more, or an
  exact e-mail address. New message template `workflow.delegated`.
* SLA on approval and decision steps: `sla: { hours, dueSoonHours?, escalate? }` with
  escalation `overdue` (default), `notify` or `reassign` to any recipient or to
  `{ manager: roleKey }` (the approver's manager in the org tree).
  `WorkflowEngine.evaluateSla()` runs from the new `sla:evaluate` command, which the
  reference scheduler runs every minute. It sends one reminder per approval and one
  escalation per overdue step, both recorded in `workflow_escalations`. New templates
  `workflow.sla_due_soon`, `workflow.sla_overdue` and `workflow.sla_escalated`.
  `WorkflowRun.sla`, `Assignment.sla` and `Assignment.dueAt` carry the deadline and its
  state, and My tasks and the record's workflow panel show «في الموعد / يقترب الموعد /
  متأخر».
* Workflow transitions are resolved from the step table (`nextStep`) instead of
  XState. An approval or decision step may now name itself as its next step (it
  reopens). Any other step naming itself is refused by `defineWorkflow`, and the
  engine fails such a run. `WorkflowDefinition.machine` is
  deprecated; it and the `xstate` dependency are removed in the next major version.
* System time zone: `WorkflowOptions`, `AssignmentOptions` and
  `WorkflowDelegationOptions` take an optional `timeZone` (IANA name, default UTC).
  Due dates (`dueOn`) and delegation ranges are calendar days in that zone. Before,
  `dueOn` was the UTC day, so between 00:00 and 03:00 in Riyadh it came out one day
  early. The reference `config/adula.ts` sets `timeZone: 'Asia/Riyadh'`.
* New exports: `WorkflowDelegations`, `slaState`, `createWorkflowDelegationSlaSchema`
  and the types `StepSla`, `SlaEscalation`, `EscalationTarget`, `SlaState`,
  `WorkflowSlaStatus`, `SlaEvaluation`, `WorkflowDelegation`,
  `WorkflowDelegationInput` and `WorkflowDelegationOptions`.
* Reference consumer: the orders fixture workflow declares an SLA on its manager step,
  and `tests/functional/workflow_delegation_sla.spec.ts` covers delegation and SLA end
  to end.
### List layer

Minor: filter operators, server export, bulk actions, restore and dashboards (ADR 046).
No migration. Resource definitions need no change. `pnpm check:api` reports some
existing types as changed: each change is an added optional member or a widened union.
Code that reads a saved view's filter values must now accept operator objects as well
as scalars.

* Filter operators for lists, `aggregate()` and saved views:
  `filters[f][in]=a,b` (1–50 values), `filters[f][gte]` / `filters[f][lte]` (integer,
  money, date, datetime) and `filters[f][empty]=true|false`. Invalid operands are
  422 `E_FILTER`, as for equality filters. New types `ListFilterValue` and `ListFilterScalar`.
* Server export: `ResourceService.export()` and `GET /resources/:resource/export`
  (also under `/api/v1`) write a CSV of the whole filtered set. It uses the list's
  authorization, keeps only the fields the user may read, shows display values and
  guards against spreadsheet formulas (= + - @, also after
  spaces and in full-width forms, and a leading tab or CR). Above `EXPORT_ROW_LIMIT` (5000) rows it answers
  422 `E_EXPORT_LIMIT`. Each export is written to the activity log (`core.exports`).
* Bulk actions: `BulkActions` and `defineBulkActions()`, served by
  `GET`/`POST /resources/:resource/bulk`. Built-in actions are delete, restore, submit
  and cancel; a defined action is an update with fixed values. Each row runs in its own
  transaction, with the user's own permissions checked for that row. The response lists
  the rows that succeeded and the rows that failed, with Arabic messages. At most
  `BULK_ID_LIMIT` (100) rows per request.
* Restore: `ResourceService.restore()` and `POST /resources/:resource/:id/restore`.
  `list(…, { trashed: true })` and `GET /resources/:resource/trash` list deleted
  records. Both are allowed by the user's delete permission, with its conditions and
  organization scope applied to the deleted record. Restore writes a `restore` activity
  and a `<module>.<resource>.restored` event. `describe()` adds `trash`, `exportable`
  and `bulk`.
* Dashboards: `defineDashboard()` and `Dashboards` build indicator pages from
  `aggregate()`, running each widget as the viewer. A widget the viewer cannot read is
  left out. Grouped values come with display labels. The reference app adds
  `/dashboards/:name` and a «لوحات المؤشرات» navigation link when dashboards exist.
* `@adula/ui`: new `list-filters`, `resource-bulk` and `resource-dashboard` items.
  `data-table` adds operator filters with chips, «تصدير النتائج» (server export),
  row selection with a bulk bar and confirmation Dialog, and the «المحذوفات» view
  with «استعادة». Run `node ace adula:ui` to update copied components.
* Reference consumers (test fixtures, ADR 017): the `orders_overview` dashboard and
  the tasks `markDone` bulk action.

### Optional languages

Minor: Arabic stays the base language and every other language is an optional layer
(see docs/languages.md, ADR 041). Resource definitions need no change. Code that
*reads* `label.en` now gets `string | undefined` and must fall back to `label.ar`
(`labelText`); `pnpm check:api` reports `Label` as changed for this reason.

* `label.en` is optional on resources, fields, record and create labels, module lookups
  and modules; `label.ar` stays required. `Label` widens from `{ ar; en }` to
  `{ ar: string; en?: string; [language: string]: string | undefined }`, so existing
  definitions compile unchanged. A label that names a language must give it text
  (`en: ''` is still refused). `label.<lang>` falls back to `label.ar` in pages and in
  the OpenAPI document; lookups without English store their Arabic text in `label_en`.
* Message catalog: new exports `BASE_LANGUAGE`, `arabicMessages`, `englishMessages`,
  `registerLanguage`, `registeredLanguages`, `enabledLanguages`, `resolveLanguage`,
  `languageDirection`, `translate`, `localizeText`, `messageKeyOf`, `clientMessages`,
  `labelText`, `runWithLanguage`, `currentLanguage`, `CatalogMessagesProvider`,
  `installCatalogMessages` and the types `MessageCatalog`, `MessageParams`,
  `TextDirection`, `LanguageInfo` and `LanguageOptions`. `AdulaError` gains `messageKey` and translates its message
  inside a request running in another language; Arabic output is byte-identical.
* VineJS messages answer through the catalog. Rules that previously fell back to
  VineJS's English defaults (for example `required` on resource validators) now answer
  in Arabic, or in the user's enabled language.
* Reference application: `config/adula.ts` (`languages: ['ar']`; add `'en'` to offer
  the bundled English catalog), `start/languages.ts`, an additive `users.language`
  migration (default `ar`), a language card on the profile page (`PUT /account/language`),
  the shared props `locale`, `dir`, `languages` and `messages`, and `<html lang dir>`
  following the user. `start/languages` and `start/validator` now preload before the
  routes. The order-receipts fixture has no `label.en` and is the Arabic-only consumer.
  The 404 and 500 pages, previously English, now read «الصفحة غير موجودة» and «حدث خطأ
  غير متوقع» (English for English users).
* `@adula/ui`: new `messages` registry item (`useMessages()` → `t`, `label`, `locale`,
  `dir`); the generic resource components, dialog, pagination and confirm-action look
  their Arabic text up through it and take `dir` from the page.

### Security hardening

Minor release (semver minor, not a patch): the public interfaces `ActivityEntry`,
`UploadInput` and `HttpPoster` gain optional members, and new exports are added. Operators
must review the new environment variables before upgrading a production deployment.

* Signup: new `SIGNUP_ENABLED`. When unset, self-signup is open only until the first
  administrator exists, then `/signup` returns 404; `true`/`false` is obeyed. Signup
  answers new, registered and invited addresses identically and no longer signs the
  visitor in. OAuth sign-in creates no new users while signup is closed.
* `adula:install` can create the first administrator (`--admin-email`, `--admin-name`;
  the generated password is printed once). If the address already belongs to an account
  and no administrator exists yet, install rotates its password (printed once) and
  removes its sessions, API tokens, unused password-reset links and pending invitations,
  defeating pre-registration takeover. Pass `--keep-password` when you created that
  account yourself; `create-adula-app` setup and `adula:seed` do. Creating or re-securing
  the first administrator requires the application's `#models/user` Lucid model; without
  it `adula:install` stops with an explicit error.
* API tokens are revoked on password reset, password change and administrator session
  revocation. Administrators can list a user's tokens (metadata only) and revoke all of
  them from the user page.
* Login lockout is scoped to (e-mail, client address) with escalating blocks of 1, 2,
  4 … up to 60 minutes after 5 failures, and records a `login_locked` activity. A
  stranger's failures no longer lock the owner out from another address.
* New `TRUSTED_PROXIES` (proxy-addr names, addresses or CIDRs). Unset trusts loopback
  only; `docker-compose.prod.yml` sets `loopback,uniquelocal` for the Caddy hop, and
  Caddy now replaces any client `X-Forwarded-For`. `/health` is throttled per client
  (60/min), except the proxy's own probe.
* Outbound webhooks and workflow HTTP steps: every IANA special-purpose IPv4/IPv6 range
  (including mapped, NAT64 and 6to4 forms) is blocked, DNS is resolved once and the
  connection pinned to the validated address, and redirects are not followed. Private
  or plain-HTTP targets now require `WEBHOOKS_ALLOW_PRIVATE=true` in every environment
  (previously allowed outside production). `last_error` stores only a category (`dns`,
  `connect`, `tls`, `timeout`, `blocked-target`, `http-status:NNN`).
* Printing: the logo is embedded only from a local `public/` image (≤ 512 KiB); remote
  logo URLs are no longer printed, and print HTML carries a restrictive CSP.
* Production Compose: Redis requires `REDIS_PASSWORD` (`--requirepass`; startup fails
  when empty), the backup service runs as `node`, and each service receives only the
  variables it needs instead of the whole `.env`.
* Resources: mismatched filter values return 422 `E_FILTER` and forged cursors 422
  `E_CURSOR` instead of 500; `amend()` requires `create` on inline child resources and
  validates copied lines; workflow `update` steps run the resource validator, hooks and
  optimistic lock. The mention picker no longer matches e-mail prefixes (exact address
  only). Uploads, saved views and invitations made while impersonating record the
  impersonator.

* UI: `@adula/ui` now stores each component exactly as `adula:ui add` installs it, so a
  reinstall reproduces the registry byte for byte. `node ace adula:ui add --preview`
  offers these changes; nothing changes visually in RTL pages:
  * `dialog`: `translate-x-[-50%]` becomes `ltr:translate-x-[-50%]` (next to the existing
    `rtl:-translate-x-[-50%]`).
  * `radio-group`: the indicator's `-translate-x-1/2` becomes `ltr:-translate-x-1/2`.
  * `select`: `data-[side=left]:-translate-x-1` and `data-[side=right]:translate-x-1`
    become `ltr:data-[side=left]:-translate-x-1` and `ltr:data-[side=right]:translate-x-1`.
  * `switch`: the duplicated `rtl:data-[state=checked]:-translate-x-[calc(100%-2px)]` is
    removed; `data-[state=checked]:translate-x-[calc(100%-2px)]` and
    `data-[state=unchecked]:translate-x-0` gain the `ltr:` prefix.
  * The `"use client"` directive is removed from `checkbox`, `command`, `dialog`,
    `dropdown-menu`, `form`, `radio-group`, `tabs` and `tooltip`; Inertia ignores it, and
    shadcn 4.21.0 had stripped it from only some files.
  * In left-to-right pages, a `className="translate-x-…"` passed to `DialogContent` or
    `SelectContent` (popper position) no longer replaces the default offset,
    because the `ltr:` class takes precedence. Pass the matching `ltr:` class instead.
    RTL pages were already unaffected by such overrides.
* Source repository: `scripts/ui-registry.mjs` (`sync`, `prepare`, `register`, `build`,
  `reference`) replaces `sync-ui-registry.mjs`, `prepare-ui-registry.mjs`,
  `register-resource-ui.mjs` and `build-ui-registry.mjs`; `prepare` is idempotent. The
  reference application's `inertia/components/ui` and `ui.lock.json` are no longer tracked;
  the root `build`, `dev`, `typecheck` and `test` scripts generate them from the registry,
  and `pnpm --filter @adula/ui test` fails when a registry file would change on install or
  on another `prepare` run.
  The reference stylesheet registers the generated directory with `@source "../components/ui"`,
  because Tailwind 4 skips gitignored paths; a `@adula/ui` test guards the line.

* Creator: the package is renamed `create-adulajs` (bin `create-adulajs`); new systems
  start with `npm create adulajs my-system` or `npx create-adulajs@latest my-system`.
  `create-adula-app` gets no further versions. The creator's wording calls the created
  project a system (نظام) and the business modules inside it applications (تطبيقات).
* Releases (ADR 040): a `v<version>` tag on `main` triggers `release.yml`, which re-runs
  CI on that commit and publishes the CI-built archives on `latest` with provenance after
  the owner approves the `npm` environment. Removed: `docs/release-readiness.json`, the
  readiness guard in `check-release.mjs`, `pnpm release:status`, `pnpm check:naming`, the
  alpha/next channels, the signed bootstrap scripts, `docs/evidence/` (now
  [docs/releases.md](docs/releases.md)), the acceptance runbook, release packet and other
  1.0 acceptance documents. `check-release.mjs` keeps the manifest, archive-content and
  `SHA256SUMS` checks.
* CI: push builds only `main` (branches run through their pull request), superseded runs
  are cancelled, the job has a 60-minute limit. Dependabot proposes grouped weekly npm
  updates.
* Docs: `docs/implementation-status.md` is a short current-state page; `GAPS.md` lists only
  open capability gaps; operational instructions move to `docs/operations.md`.
* Removed dead code: `tests/feasibility-exercise`, `tests/agent-exercise`, the orphaned
  `resources/index` page of the reference application, `scripts/readme-hero.mjs` (the
  banner SVG stays) and `packages/adula/bench/list_save.ts`.
* Operational commands ship in the `adula` package (`adula/commands`): `adula:outbox`,
  `adula:runtime:health`, `adula:uploads:prune`, `adula:restore:reconcile`,
  `backup:create`, `backup:restore-files`, `backup:restore-test`, `backup:verify` and
  `backup:verify-snapshot`, with unchanged names, flags and behaviour. They still use the
  system's own `#start/env`, `#start/modules` and `#services/*` (`events`,
  `upload_pruning`, `backup_snapshot`, `backup_publish`, `initial_setup`), and resolve
  `@aws-sdk/client-s3`, `@adonisjs/cache` and `@nemoventures/adonis-jobs` from the system.
  New systems no longer receive copies under `commands/`, and now also get
  `adula:uploads:prune`, which the creator had not copied. In an existing system the
  packaged command runs even when a local copy with the same name remains under
  `commands/` (only `node ace list` shows the local copy); delete those copies.
  `adula:worker` and `adula:seed` stay in the application.
* `adula:ui` recognizes the `inertia/css/adula.css` entry whatever its quotes and
  spacing (prettier writes `@import './app.css';`), so re-running it no longer prepends
  the `@layer` and `@import` lines again; a missing `@layer` line is restored on its own.

### Applications in a system

* New `node ace adula:app <name> --label-ar=<Arabic> [--label-en=<English>] [--dry-run]`
  scaffolds an application (a module under `app/modules/<name>`): the module definition,
  one example resource with its migration, model, validator, factory and security contract,
  default roles `<name>_manager` and `<name>_user` (seeded by `adula:install`), a smoke test
  under `tests/functional/<name>/` and the registration in `start/modules.ts`. Names must
  be slugs of at most 40 characters; reserved framework names (`RESERVED_APP_NAMES`) and
  existing applications are refused. `--dry-run` prints the plan and writes nothing.
* Administration screens for lookups (`/admin/lookups`) and sequences (`/admin/sequences`).
  Administrators add values to a group (Arabic label required, English optional), edit
  labels, reorder, disable, enable and delete them. Keys never change; a value used by
  stored records cannot be disabled or deleted, and a value a module declares cannot be
  deleted. Sequences move forward only. Every change is recorded in the activity log
  (`core.lookups`, `core.sequences`). New exports: `LookupsAdmin`, `SequencesAdmin`,
  `formatSequence` and their types; `sequence()` output is unchanged.
* Wording: the deployment is the system (النظام) and each business area an application
  (تطبيق) in the framework's Arabic text, the reference UI, the agent rules and skills, the
  issue forms and the docs. Code identifiers and routes are unchanged. New
  [docs/applications.md](docs/applications.md) explains adding an application, what
  applications share and how a system integrates with other software, with a "leave
  requests" example checked by a test fixture.

### SSO and two-factor authentication

Minor release: new core exports (`TwoFactor`, `createTwoFactorSchema` and related
constants and types) and the additive core migration `1770000000020_two_factor`. See
[docs/authentication.md](docs/authentication.md).

* Two-factor authentication (TOTP, RFC 6238, through `otpauth`):
  * Enrolment is on the profile page. It offers manual entry of the secret plus the
    `otpauth://` link; QR rendering is an extension point and needs no new dependency.
  * Secrets are encrypted with the application key, and each time step is accepted once.
  * Ten single-use recovery codes are stored with a salt and SHA-256.
  * Password and OAuth sign-in stop at `/login/two-factor`. There is no session user
    until the code passes.
  * Code attempts follow the login lockout rules, plus a ceiling of 20 failures per hour
    per account.
  * Administrators can reset a user's two-factor; this ends the user's sessions and API
    tokens and is audited.
  * New system setting `auth.twoFactorRequiredForAdministrators`, on by default. Users
    with `manage all` must enrol before they can use `/admin` pages, mint API tokens, or
    use their API tokens or MCP.
  * Starting enrolment and linking a provider need a sign-in within ten minutes or the
    current password.
  * **Operators (breaking):** existing administrators are asked to enrol on their next
    visit to the administration area, and their API tokens are refused until they do
    (or until the setting is turned off). When rotating `APP_KEY`, append the old key in
    `config/encryption.ts`, or enrolled secrets become unreadable.
* SSO:
  * New Microsoft Entra ID provider (`MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`,
    `MICROSOFT_TENANT_ID`), using a custom driver on ally's OAuth 2 base. It uses PKCE
    and a nonce and validates the ID token's claims. The e-mail is trusted only for the
    configured tenant, or when the token carries `xms_edov`.
  * Administrators can enable and disable each configured provider (system setting
    `auth.providers.disabled`).
  * Signed-in users can link and unlink provider identities from their profile.
* OAuth fixes:
  * The callback now requires a `state` parameter. Ally accepted a request with neither
    a state cookie nor a state parameter (login CSRF).
  * The provider's error text is no longer shown to users.
  * A token or profile failure no longer answers 500.
  * Disabled accounts are no longer linked.
  * A second identity from the same provider is refused.

### Field types and the definition as the source of truth

Minor: the resource definition is the single description of a resource (ADR 045, see
[docs/resources.md](docs/resources.md)). Existing definitions compile unchanged (apart from the
removed `customFields`);
`pnpm check:api` reports `Field` and `Resource` as changed (new members, `validator` and
`model` optional). `@vinejs/vine` `^4.0.0` becomes a peer dependency of `adula`; every
AdonisJS application already has it.

Added:

* Field types `decimal` and `percent` (`numeric(precision, scale)`, defaults 18/2 and 7/2,
  decimal strings such as `"12.50"`), `email` (trimmed, lower-cased), `phone` (stored as
  `+?digits`, 7 to 15 digits; spaces, dashes, parentheses and Arabic-Indic digits accepted),
  `url` (absolute http/https only), `enum` and `multiSelect` (`options: { value, label }[]`;
  multiSelect is a JSONB array in options order, filtered by "contains") and `manyToMany`
  (a join table `<owner>_<key>` or `table`, value = ascending linked ids, synced by
  difference in the record's transaction, every newly linked record must be viewable).
  New export `joinTable`.
* Field props: `min`/`max` (length on text types, range on integer, money in minor units,
  decimal and percent, count on multiSelect), anchored `pattern`, `format` on string
  (`email`, `url`, `phone`), `precision`/`scale`, `options`, `default` (applied on create
  when the key is absent, prefilled in the create form, column default for scalars) and
  `visibleWhen` (a hidden field is not required and is stored as null, on create and update;
  an update keeps the stored value of a hidden field the actor may not write). `visibleWhen`
  values must be canonical values of the controlling field (enum and multiSelect values
  must be options).
  `defineResource` validates all of them.
* Resource-level composite `unique: [['orgUnitId', 'code']]`: a partial unique index over
  live rows that treats NULLs as equal (`NULLS NOT DISTINCT`); `orgUnitId` is allowed on
  scoped resources. Adding one with `adula:resource:migration` fails while live rows
  already repeat the combination, null members included.
* Role rule conditions on decimal and percent fields take canonical decimal strings with
  exactly `scale` decimals and compare numerically, in CASL and in PostgreSQL alike; ordered
  rules need `buildAbility(rules, registry.all())`. CSV import reads decimal and percent
  cells with thousands grouping (`1,234.5`) and the Arabic decimal point (`٫`); `12,5` is
  refused.
* `adula:capabilities` (and the shipped `agent/capabilities.md`) lists the new types, field
  options and the `unique`, `validator` and `model` resource options.
* Derived validation: `definitionValidator(resource)`, `definitionSchema(resource)` to
  extend it (`vine.create(vine.object({ ...definitionSchema(r), … }))`),
  `resourceValidator`, `isVisible`, `applyVisibility`. `fieldValue` enforces every field
  constraint on every write path (validators, `beforeSave` hooks, `systemSave`): 422
  `E_FIELD_VALUE`. New catalog messages `validation.phone`, `validation.decimalScale`,
  `validation.decimalPrecision`, `validation.relation` and `errors.E_DUPLICATE.fields`.
  Also `FieldValueError`, `canonicalDecimal` and `decimalShape`.
* Schema from the definition: `resourceSchema`, `fieldColumnType`, `alterResourceTable`,
  `schemaDrift`, `resourceAddition`, `describeDrift` and their types. `adula:doctor` gains
  the `resources.schema` check (missing table, columns, unique indexes and join tables;
  different column types). The create-migration snapshot also records `visibleWhen` and the
  resolved `precision`/`scale`, so `resources.snapshots` notices changes to them.
* `node ace adula:resource:migration <name>` writes an additive migration of what the
  table lacks, embedding only the new pieces; types are never changed automatically.
* Editor, OpenAPI, aggregates (`sum` over decimal and percent) and the relation options
  endpoint understand the new types. The fixture module `suppliers` in
  `apps/reference/tests/fixtures` uses every new type.
* `@adula/ui`: generated forms, details and lists cover every new type. The
  `resource-value` item gains `field_values.ts` (pure helpers: decimal parsing and
  display, multi-value state, visibleWhen, safe links) and `resource-field` depends on
  `checkbox` and `badge`. Widgets: decimal and percent inputs accept Arabic-Indic digits
  and `٫`, normalize to the field's scale and show the ٪ suffix (commas only as thousands
  grouping; `1,5` is refused); email, phone and URL inputs (also for `string` with
  `format`) are LTR and render as `mailto:`, `tel:` and safe http(s) links with
  `rel="noopener noreferrer"`; enum is a Select; multiSelect a labelled checkbox group
  shown as badges; manyToMany a multiple picker over the relation options search, shown
  as record titles. Create forms are prefilled with declared defaults. visibleWhen hides
  fields live, in inline rows too, resolves chains to a fixed point and compares values
  canonically like the server; a hidden field is not submitted. Lists filter enum and
  multiSelect through a Select and manyToMany through the relation filter, with tabular
  decimal and percent columns. New catalog keys `ui.field.decimalPlaces`,
  `ui.field.noDecimalPlaces`, `ui.field.selectedCount`, `ui.field.chooseRecords`,
  `ui.field.selectedIn`, `ui.field.removeRecord`, `ui.field.required`,
  `ui.validation.decimal`, `ui.validation.decimalScale` and `ui.value.percent`.
* ADR 045 (definition as the source of truth) and the field reference in
  [docs/resources.md](docs/resources.md).

Changed:

* `Resource.validator` and `Resource.model` are optional. Without a validator, writes use
  the derived one; a declared validator still replaces it. AdulaJS never reads `model`.
  Type-breaking for code that calls `resource.validator.validate(…)` directly: use
  `resourceValidator(resource).validate(…)`, which falls back to the derived validator.
* `adula:resource` and `adula:app` no longer write a validator, Lucid model or factory;
  `adula:resource --validator` and `--model` opt in.
* A unique violation, single or composite, stays 409 `E_DUPLICATE` and now names the
  fields: «هذه القيمة مستخدمة في سجل آخر: <الحقول>».
* String fields enforce their 255-character column length as a 422 validation error
  instead of a database error.
* Constraints apply to stored records too: after adding `max`, `pattern` or another
  constraint to an existing field, or with the new 255-character limit, an edit of a legacy
  row whose value violates it fails with 422 until the value is corrected.
* Inline child rows do not edit many-to-many links: the editor omits a child's manyToMany
  fields and an inline payload's values for them are ignored, so saving a parent never
  clears its lines' links.
* `visibleWhen: { field: null }` on a multiSelect controller matches no selection (null or
  an empty list), in the server and the generated form alike.
* Adding `visibleWhen` to an existing required field: the doctor's `resources.schema`
  check reports a `NOT NULL` column the definition lets be empty (`SchemaDrift.notNullColumns`),
  and `adula:resource:migration` drops the constraint (`ResourceAddition.dropNotNull`; only
  relaxes, `NOT NULL` is never added). Until then a save that hides the field is 422
  `E_NOT_NULL` naming the field (catalog `errors.E_NOT_NULL`, `errors.E_NOT_NULL.field`)
  instead of a 500.
* Submittable resources: unique indexes, single and composite, exclude cancelled documents
  (`WHERE deleted_at IS NULL AND doc_status <> 2`), so an amended copy keeps the unique values
  of its cancelled original; two live documents still conflict (409). Existing indexes are
  reported by the doctor (`SchemaDrift.staleUnique`) and recreated by
  `adula:resource:migration` (`ResourceAddition.recreateUnique`: dropped and created again in
  the same migration). `ResourceUniqueIndex` gains `excludeCancelled`.
* Decimal and percent values sent as JSON numbers of magnitude `Number.MAX_SAFE_INTEGER` or
  more, or with more than 15 significant digits, are refused with 422 (catalog
  `validation.unsafeNumber`, asking for a string) instead of being rounded silently.
* Amend-by-copy also copies the manyToMany links of inline lines (within the actor's field
  permissions), and newly linked manyToMany targets are checked with one query per field.

Deprecated:

* `adula:resource:snapshot`: it still rewrites a pending create-migration and prints a
  notice; use `adula:resource:migration` after the create-migration ran.

### Calendar days in every time zone

Fix: node-postgres read a `DATE` column as a JavaScript `Date` at the server process's
local midnight, so raw Lucid queries reported the previous day east of UTC (for example
`2026-09-18` became `2026-09-17T21:00:00.000Z` with `TZ=Asia/Riyadh`). `adula/provider` now
registers a `DATE` parser on every PostgreSQL connection, so every query, including module
code and raw Lucid queries, returns the stored `YYYY-MM-DD` text unchanged. This fixes the date
failures seen when the server process ran at UTC+3. The Hijri date picker opens on the
viewer's local today rather than the UTC one.

Changed (breaking for code that reads dates directly): module code and raw queries now
receive `DATE` columns as `'YYYY-MM-DD'` strings instead of JavaScript `Date` objects at
local midnight, and `date[]` columns as arrays of such strings. Resource values were
already calendar strings and are unchanged.

### Documentation

Docs only; no code or API change (the TSDoc comments added to
`packages/adula/src/resource/types.ts` change no type).

* **Tutorial.** docs/tutorial-leave-requests.md builds a leave-requests application from
  `npm create adulajs`: `adula:app`, a resource with enum, date, decimal, attachment and
  `visibleWhen` fields, default roles, a workflow with approval, delegation and SLA, list
  filters and saved views, and a dashboard. Every step was run in a system created from
  the local creator.
* **Generated `defineResource` reference.** docs/reference/define-resource.md lists every
  resource option, field prop and field type with its type, default and description. It is
  generated from the TSDoc comments of `types.ts` by `pnpm docs:reference`
  (scripts/define-resource-reference.mjs, TypeScript compiler API). `pnpm check:api` and
  `tests/release/define-resource-reference.test.mjs` fail when the page is stale or an
  entry has no description.
* **Arabic documentation.** docs/ar/ holds Arabic versions of the documentation map,
  installation, initial setup, applications, resource definitions, languages,
  authentication and the tutorial.
* **npm landing pages.** The `adula` and `create-adulajs` READMEs were rewritten with an
  Arabic summary, a minimal example, the feature list and links to the guides.
* **Link check.** `tests/release/docs-links.test.mjs` (part of `pnpm test:release`) fails
  when a relative link or `#anchor` in docs/ or docs/ar/ does not resolve. A stale link in
  ADR 020 to the removed evidence archive was replaced with a note, and stale statements
  were corrected: two-factor availability in business-features.md, the typed API client
  and optional languages in implementation-status.md, and `timeZone` in the languages.md
  configuration example.

### Removed

* The `customFields` resource option. It had no screen, no API and no consumer: it only
  created a `custom_fields` JSONB column that nothing read or wrote. `defineResource` now
  refuses a definition that still sets it (true or false) with an error that names the
  removal, so an upgrade is never silent; delete the option from the definition. No
  migration drops the column: an existing `custom_fields` column stays in place with its
  data, and a create-migration generated before the removal still compiles and replays
  unchanged. `Resource` loses `customFields`, `adula:capabilities` no longer lists it and
  `adula:doctor` no longer compares it. The option can return later with a real consumer.

## 2.1.0 — 2026-10-17

Minor release: new defaults for the copied interface and a refreshed README. No API or
migration changes; existing applications keep their project-owned styles until they
reinstall UI.

* UI: the default theme uses the shadcn/ui neutral palette (`oklch` values) instead of the
  green identity, and the default font is IBM Plex Sans Arabic
  (`@fontsource/ibm-plex-sans-arabic`) instead of Noto Sans Arabic. `adula:ui` installs the
  new font package; a company font from `create-adula-app --identity` now falls back to
  IBM Plex Sans Arabic. Project-owned `brand.css` overrides are unchanged. PDF printing
  keeps the server's Noto Sans Arabic.
* README: an animated banner (`docs/assets/adulajs-hero.svg`, generated by
  `node scripts/readme-hero.mjs`), AdulaJS introduced as a TypeScript framework for
  business applications, and a "Built with" section.

## 2.0.0 — 2026-10-15

Major release: the project is renamed to **AdulaJS** (ADR 039, #78). No features are
added. Upgrade 1.x applications with the three steps in
[docs/upgrade-2.0.md](docs/upgrade-2.0.md).

* Packages: `@adula/kit` becomes `adula` and `@adula/create-app` becomes
  `create-adula-app` (bin `create-adula-app`). `@adula/ui` keeps its name. New
  applications start with `npx create-adula-app@latest my-app`.
* Public API: `KitError`, `KitAbility`, `KitActor`, `KIT_VERSION` and `withKitDatabase` are
  renamed `AdulaError`, `AdulaAbility`, `AdulaActor`, `ADULA_VERSION` and
  `withAdulaDatabase`. The lint rule `adula/no-kit-patching` is `adula/no-core-patching`
  and also covers `node_modules/adula`.
* Upgrade: `npx create-adula-app@latest upgrade` rewrites a 1.x application without
  booting AdonisJS; the new `node ace adula:upgrade` renames the recorded migration
  history in one transaction, renames `KIT_GAPS.md` to `GAPS.md` and the managed
  AGENTS.md block, then runs pending migrations. Doctor names the command while 1.x
  history remains.
* Migrations: core migration files drop the `kit_` prefix (timestamps and bodies
  unchanged). New migration `1770000000016_adulajs_names` renames the authorization and
  notification functions and triggers, the notification channel (`adula_notifications`),
  the `adula.version` setting and processed listener names (`adula.*`).
* Files: the routes preload is `start/adula_routes.ts`; the gap log is `GAPS.md`;
  managed markers are `<!-- adula:start -->` / `<!-- adula:end -->`.
* HTTP: outgoing webhooks send `User-Agent: adula-webhooks` and workflow `http` steps
  `adula-workflows`. Receivers that filter on the 1.x values must accept these;
  signature headers (`X-Adula-*`) are unchanged.
* Release gate: `latest` accepts 2.x under ADR 038's owner-authorization rule. CI runs
  the genuine upgrade from the published 1.2.0 and the new `pnpm check:naming` gate.

## 1.2.0 — 2026-10-01

Minor release: workspace and realtime changes decided in ADR 034 and later. 1.0.1
and 1.1.0 were not published separately; their changes below ship in 1.2.0, so
upgrading from 1.0.0 applies all three sections and the additive kit migrations 011 to
015. Stable publication after 1.0.0 needs the owner's authorization of the exact
version (ADR 038).

* Realtime: the tabs of one browser share one notification stream (#36). Visible tabs
  elect a leader with a Web Lock; the leader holds the stream and relays each signal to
  the other tabs over a `BroadcastChannel`, and a waiting tab takes over when the
  leader closes or stays hidden. Browsers without these APIs keep one stream per
  visible tab. See ADR 034. Projects with a copied `notification-bell.tsx` need the
  updated component.
* Workspace: one "My tasks" page for tasks and approvals (#35), with tabs for all open
  items, items waiting for my decision, assigned tasks and closed items. Approval and
  decision steps are decided in place; `/approvals` redirects there and keeps its JSON
  inbox. `Assignments.mine()` takes `kind`, and the optional `Assignment.canDecide` and
  `AssignmentPage.approvals` are new.
* Workspace: the sidebar puts daily work first, then collapsible module groups
  (optional `ResourceNavigation.moduleLabel`), and one administration entry with a failure badge;
  links follow permissions (#34). See ADR 036. Projects with the starter's workspace
  layout, `admin-nav`, My tasks page or assignments/workflows controllers need the
  updated files; `pages/work/approvals.tsx` is removed.
* UI: records open in a dialog over the mounted list (#31). The list's view and edit
  links call `openRecord()` (new registry component `resource-surface`), which reads the
  record once from `GET /resources/:resource/:id/view`; closing returns to the same list
  with its query, loaded rows and scroll, and refreshes rows only when the record
  changed. Saving an edit shows the details in the same dialog. On a direct record URL,
  children and activity arrive in one deferred request (`ResourceService.details()`);
  `ResourceService.record()` serves show, children and activity together. See ADR 035.
  Projects with copied `data-table`, `resource-form`, `resource-page` or `resource-show`
  need the updated components.
* Integrations: signed inbound webhooks (#30). Administrators add sources with a
  generated, rotatable secret; senders post to `POST /webhooks/in/<key>`, the HMAC over
  the raw body is verified before anything is stored, deliveries are deduplicated and
  raised as `inbound.<key>.<event>` through the outbox, and the delivery log can raise
  one again. A body already received from a source is refused under any delivery id or
  event name (`dedupeBody`, on by default), form-encoded deliveries get 415, updates
  change only the fields given, and deliveries are kept for 90 days
  (`InboundWebhooks.pruneDeliveries()`, scheduled daily). Additive migration
  `1770000000015_kit_inbound_webhooks`. See ADR 037. Projects need the starter's route
  with both limiters, controller, scheduler entry and shield exception.

## 1.1.0 — not published separately; included in 1.2.0

Minor release: additive APIs and additive kit migrations
(`1770000000011_kit_managed_assignments`, `1770000000012_kit_role_keys`,
`1770000000013_kit_notification_targets`, `1770000000014_kit_upload_grants`). See ADR 029,
030, 032 and 033.

* Resources: `ResourceService.systemSave()` writes a record for module code through the
  validator, hooks, lookup/relation/attachment checks, versioning and the audit trail,
  without the actor's role rules. The activity entry records the reason (#44).
* Resources: `scope: { from: '<belongsTo>' }` makes a scoped record inherit its
  organization unit from its parent before authorization. The form hides the unit
  picker, and `ResourceService.rehome()` moves the children after the parent moves
  (#45). Projects with a copied `resource-form` need the updated component.
* Resources: `title: ['field', ...]` names a record wherever it is referenced. The
  default is the sequence and the first text field, and a lookup shows its Arabic label.
  Titles are read under the viewer's field access. Relation cells and pickers, My tasks
  (`recordTitle`) and the approvals inbox use them instead of a raw lookup key or `#id`.
  `ResourceService.titles()` returns them for module pages (#47, #32). Projects with a
  copied `resource-value` need the updated component.
* Resources: `/resources/<name>/create?defaults[field]=value` opens the create form
  pre-filled. Only visible form fields are used, related records must be viewable and
  lookups active, and saving validates as usual (#48). Projects with a copied
  `resource-form` need the updated component.
* Workflows: a `decision` step offers named outcomes, for example approve, reject and
  return. Each outcome names its next step, which may be an earlier step, and may
  require a comment. The approvals inbox renders one button per outcome. The submitted
  document stays locked: a decision never edits it (#42). Projects with a copied
  `record-workflows` need the updated component.
* Security: the ESLint rule `adula/no-system-save-in-controllers` keeps `systemSave`
  and `rehome` out of controllers and routes, and managed AGENTS rule 10 says so.
  Existing projects can enable the rule in `eslint.config.js` and run `adula:install`
  to refresh the managed rules.
* Assignments: «تم الإنجاز» and «إلغاء المهمة» open a dialog for a closing note, kept
  with the task. Each application makes the note optional (default) or required with
  `new Assignments(..., { closeNote })`. Managed tasks
  (`Assignments.create(..., { managed: true })`) close with the record through
  `Assignments.close()`, or by hand only with a note. Both closes are recorded in the
  activity log (#51). The starter "My tasks" page and `app/services/kit.ts` changed.

* Resources: a `user` field type stores a user id (foreign key to `users`, `RESTRICT`).
  Choices are active members of the record's unit or its ancestors, searched by name;
  saving checks the same rule. Lists and details return `{ id, fullName }` without the
  e-mail. The field filters, sorts, imports by id and accepts create defaults.
  `systemSave(..., { chooser })` checks a user chosen by a person against that person's
  scope (#28). Code that switches exhaustively over `Field['type']` needs the new case
  (`pnpm check:api` also reports `createResourceController` and `ResourceEditor`,
  whose types include it; `SettingScope` only prints in a new order). Projects
  with copied `data-table`, `resource-field`, `resource-form` or `resource-value` need
  the updated components. See ADR 032.
* Authorization: role rule conditions accept `'$actor.id'` (`ACTOR_ID`) on user fields,
  `createdBy` and `updatedBy`, for example `{ inspector: '$actor.id' }`. It is resolved
  per actor and bound as a query parameter; `buildAbility` and `conditionSql` refuse an
  unresolved placeholder. The starter role screen (`inertia/pages/admin/roles/show.tsx`) offers «المستخدم الحالي» for those fields.
  A placeholder on any other field, even one written without `RolesAdmin`, stays
  unresolved and the rule is refused. Hosts that build actors themselves call
  `resolveActorConditions` (#29).

* Roles: a stable, unique `roles.key` (additive migration `1770000000012_kit_role_keys`;
  existing identifier-like names such as `administrator` become their key).
  `RolesAdmin.create` accepts a key and `setKey` assigns one once. Workflow `{ role }`
  recipients resolve by key first and by display name for compatibility, so renaming
  a role no longer detaches its workflows, and the `workflows.roles` doctor check warns
  about references that match only a display name. The starter role screens show and
  set the key (#25). Projects with copied `admin/roles` pages need the updated pages.
* Notifications: an optional `{ resource, recordId }` target (additive migration
  `1770000000013_kit_notification_targets`). `notify()` and `notifyWithTemplate()`
  accept it, and the kit's collaboration, assignment and workflow notifications pass
  it. `NotificationsAdmin` returns the target with its link only while the resource is
  registered, and `open()` marks the notification read and returns the link; the
  record page authorizes the reader. Notification e-mail receives the target so the
  host can append an absolute link (#38). `Notification` gains the nullable `target`,
  so code that builds it needs the member; the new parameters are optional.
* Resources: optional bilingual `recordLabel` (the singular noun, for example «حساب»)
  and `createLabel` (the full button text, for example «مهمة جديدة»). Generated pages
  say «إضافة حساب» on the create button, «إضافة حساب» / «تعديل حساب» as the form title
  and «تمت إضافة حساب» after saving; resources without them keep «إضافة سجل».
  `adula:resource` scaffolds a `recordLabel` (#37). `ResourceDescription` and
  `ResourceEditor` gain the nullable `recordLabel` (and `createLabel` on the
  description), so code that builds these objects itself needs them; `pnpm check:api`
  therefore also reports `Resource` and `createResourceController`. Projects with
  copied `resource-page` or `resource-form` need the updated components.
* Attachments: `grantUpload()` lets module code allow one user to upload to one
  attachment field of one record without a role rule, for ten minutes by default and
  one hour at most (additive migration `1770000000014_kit_upload_grants`; only the token
  hash is stored). The starter upload endpoint accepts the token as `grant` and takes
  the grant's resource, field and unit; type, size and the pending-upload limit still
  apply. The upload binds to the granted record only, through the module's own write.
  Issuing and using a grant are recorded in the record's activity log. `UploadInput`
  gains the optional `grant`. See ADR 033 (#43). Projects with a copied
  `attachments_controller.ts` need the updated controller to use grants.
* Generators: `node ace adula:resource:snapshot <name>` rewrites the definition
  embedded in a resource's generated create-migration from the registered resource
  while that migration is still pending. A migration that already ran is refused with
  the advice to add an expand migration. `adula:resource` and the `resources.snapshots`
  doctor check point to it (#20).

* Modules: `lookups` (rows by group) and `defaultRoles` (key, name, permission level,
  rules) on a module definition. `adula:install` applies them through `seedModules`:
  missing lookup rows are inserted, a default role is created when no role holds its
  key, and a keyless role with the same name adopts the key. Existing rows and roles
  are never changed, so administrator edits survive. Rules are validated like the roles
  screen, and the registry refuses invalid or duplicate keys (#26).
* Resources: `ResourceService.aggregate()` counts and totals records grouped by up to
  three fields under the same authorization as `list()`: role rules and organization
  scope filter the rows, and grouping, totals, filters and conditions are refused on
  fields the actor may not query. It is served at `/resources/<name>/aggregate` and
  `/api/v1/resources/<name>/aggregate` and described in OpenAPI. `canQueryField` is
  exported for module services (#27).
* Gaps: `adula:gaps report` prints, for each KIT_GAPS.md entry without an `Issue:`
  line, a link that opens the kit's gap form prefilled with the masked entry, and
  lists the required fields still missing. Nothing is sent: the developer reviews and
  submits the form, then records `Issue: #<number>`. New projects get a KIT_GAPS.md
  template with the form's fields (Package, Needed by, Tried, Blocked because, Proposed
  kit change, Reproduction, Acceptance, Workaround, Issue). Managed AGENTS rule 17 says
  so; run `adula:install` to refresh it.

## 1.0.1 — not published separately; included in 1.2.0

Patch release: fixes reported against 1.0.0, with no public API or schema change.
Copied UI files changed; review them with `node ace adula:ui add all --preview`.

* Dates: Arabic Gregorian dates no longer render scrambled in lists and details,
  and due dates in My tasks and the record assignments panel use the calendar
  preference (#19, #33).
* UI: filters and the starter admin pages use the registry Select instead of native
  lists, and the relation filter is searchable (#39). Closing a record dialog returns
  to the list view it was opened from, with its query, scroll and focus, and the row
  actions column stays pinned (#31). Hidden tabs release their realtime stream, so
  more than six tabs work over HTTP/1.1; deploy behind HTTP/2 (#36).
* Theme: `brand.css` can now override the focus ring, destructive color, primary text
  color and font (`--ring`, `--destructive`, `--primary-foreground`, `--brand-font`)
  (#23).
* Generators: module and resource marker lists are written in the layout Prettier
  keeps, so a new module passes lint (#21). `adula:resource` explains that the
  generated migration embeds the definition, and the new `resources.snapshots` doctor
  check reports a pending migration that differs from its resource (#20).
* Workflows: naming errors state the rule and suggest a valid name (#24). An approval
  addressed to a missing role, or to no eligible user, fails at once instead of
  retrying for hours, and the `workflows.roles` doctor check lists role names that
  match no role (#25).
* Starter: `npm test -- <args>` reaches the test runner; the test teardown formats
  `database/schema.ts` (#22). Existing projects can set their `test` script to
  `node ace test` and add the same teardown.
* Starter: `npm run dev` also runs the event worker, restarted by `node --watch` when
  application code changes, so listeners run during development. The new
  `events.outbox` doctor check warns when outbox events wait longer than a minute and
  reports the worker heartbeat (#50). Existing projects can copy `scripts/dev.mjs`
  from a new application and set `"dev": "node scripts/dev.mjs"`.
* Security contract: the generated `resource_contract.ts` follows the resource's
  declared actions. Undeclared create, update and delete routes must return 403, and
  the update fixture is needed only when `update` is declared. The attachment test
  uploads a type the field accepts (#49). Existing projects can copy the helper from
  a new application.
* UI docs: how `className` merges with component variants, and which variant classes
  (hover, dark) stay (#46).

## 1.0.0 — 2026-09-25

The complete approved 1.0 scope, accepted by the owner with release authorization
(ADR 028; scope decisions in ADR 027). Two-factor authentication is not included
and returns in 2.0; impersonation was reviewed by automated tests, with its human
review due in 2.0. Phase 2 was accepted by owner attestation (ADR 025). The k6 budget now passes on a
GitHub runner with the compiled build (list p95 152 ms, save p95 135 ms;
docs/evidence/phase5-performance-2026-09-25.json). Phases 3–6 implemented with consumers and PostgreSQL tests.
All new kit tables arrive through additive migrations (`kit_collaboration`,
`kit_assignments`, `kit_messaging`, `kit_webhooks`, `kit_imports`,
`kit_workflows`).

* Security: impersonation no longer survives sign-out (a shared-browser takeover
  found by an adversarial test), is bound to its target, cannot mint API tokens and
  records the administrator on self-service actions. Reviewed by automated tests
  only; the human review is deferred to 2.0 (ADR 027).
* Collaboration: comments with mentions, followers, tags (with list filtering) and
  per-field change history; notifications only reach users who can read the record.
* Assignments and a "my tasks" page; approval steps reuse assignments.
* Message templates editable per deployment, templated notification e-mail sent by
  the worker, and a realtime notification bell (PostgreSQL NOTIFY on commit, SSE via
  @adonisjs/transmit).
* Outgoing webhooks signed with HMAC-SHA256, retried with backoff, HTTPS-only and
  private-address safe, with a delivery log.
* Personal API tokens (read or read-write) for a bearer-only `/api/v1` resource API
  and a generated OpenAPI 3.1 document.
* CSV import batches with column mapping, processed by the worker with per-row
  errors (XLSX is GAP-006).
* Generic RTL record printing with optional Gotenberg PDF conversion.
* Document lifecycle: amend-by-copy for cancelled documents.
* Workflows: versioned `defineWorkflow` definitions compiled to XState 5, a durable
  engine with row locks, six step types, bounded retries, an approvals inbox, a
  record workflow panel and a failed-runs screen.
* Agent: generated capability catalog (`adula:capabilities`), idea-review reading it,
  and the module, security, schema, UI and performance reviewer skills.
* Release: public API contract report (`pnpm check:api`), a genuine upgrade test from
  a version published on npm (`pnpm test:upgrade --published=<version>`), and a
  Performance workflow measuring the compiled build with k6 on a GitHub runner.

## 0.2.0-alpha.4 — 2026-09-24

* Login: the per-address limit is 100 attempts per minute (configurable with
  `LOGIN_ADDRESS_LIMIT`) so offices behind one address can sign in together;
  per-account lockout is unchanged.
* CI: checkout v7, setup-node v7 (no package cache in release jobs),
  upload-artifact v7, download-artifact v8 (digest mismatches fail),
  pnpm/action-setup v6, all pinned by commit SHA.
* Local k6 budgets still fail (list p95 1140 ms, save p95 1060 ms); this alpha
  accepts no phase.
* Security: e-mail is a case-insensitive identity (additive migration with a unique
  `lower(email)` index); OAuth links only to accounts whose e-mail ownership was proven
  (invitation, mailed recovery or a verified provider); a pending invitation reserves
  its address against self-signup; per-account lockout of failed logins (cleared by
  recovery), a per-address login limit and a password-change limit; nonce-based CSP;
  no-referrer/no-store on recovery pages; OAuth redirects drop the query string; pages
  and activity records carry opaque session handles instead of session ids; passwords
  up to 64 characters; minimal public `/health`.
* Kit: validator-added fields are authorized like submitted ones; saved views may only
  query fields their author may query, list the user's own views first and cap shared
  views; attachment fields accept `accept`/`maxSize` with a default document/image
  allowlist, unbound uploads are capped per user and pruned daily
  (`adula:uploads:prune`); impersonated writes record the administrator and
  administrators cannot impersonate administrators; record history shows display names,
  not e-mails; `adula:gaps report` is registered.
* Performance: only the first list page runs the planner estimate; the database pool
  size is configurable with `DB_POOL_MAX` (default 20).
* Supply chain and hygiene: GitHub Actions pinned by commit SHA with Dependabot, npm
  pinned in the publish job, generated `.env.example` without local hosts, users or
  addresses; removed unused dependencies (zod, @hookform/resolvers, @casl/react,
  @casl/ability in the reference app, @ucast/sql), the obsolete probe and PowerShell
  wrapper; reconciled stale publication statements in the docs.

## 0.2.0-alpha.3 — 2026-09-23

* Prefer successful direct `docker version` and `docker compose version` probes;
  use default-distribution WSL Docker only after direct Docker fails on Windows.
* Pin the chosen backend through installation and generated development, tests,
  Ace, service start and service stop commands; never switch daemons on failure.
* Keep WSL alive only on its fallback path, including migrations and tests.
  Direct Docker never starts a WSL session.
* Preserve matching kit/UI/creator versions on alpha without claiming stable acceptance.

## 0.2.0-alpha.2 — 2026-09-23

* Validate the supplied project directory before collecting company details.
* Check Docker Compose and engine availability before prompts or project writes,
  with Windows/WSL guidance and the existing PostgreSQL/Redis alternative.
* Reuse Docker in the default WSL distribution from Windows automatically; ask
  before installing missing Docker Desktop with winget in interactive setup.
  Declining offers existing services or cancellation; unattended mode never installs.
* Clarify that company display names may retain uppercase letters and that
  preflight failures do not necessarily leave files or databases behind.
* Keep matching kit/UI/creator versions on alpha; no stable acceptance is claimed.

## 0.2.0-alpha.1 — release candidate preparation, 2026-09-22

* Prepare the owner-authorized experimental alpha distribution and one-command
  creator; keep next/latest and incomplete 1.0 acceptance explicitly blocked.
* Select local production-mode Docker staging and framework-only delivery (ADR 024).
* Correct the source/provenance destination to adulash/adula-kit.
* Include managed diagnostic files in the production image so initial installation
  and doctor can verify the same UI and agent assets as the source checkout.
* Use PostgreSQL 17 backup/restore clients in CI; the first remote run exposed the
  runner's incompatible default PostgreSQL 16 client.

## 0.2.0 — unreleased

* Add @adula/create-app for one-command creation from an empty folder: AdonisJS, application screens, kit/UI, managed design skill, company identity, isolated PostgreSQL/Redis, fresh migrations, administrator setup and verified assets. Keep registry availability pending publication and host/external-service prerequisites explicit.

* Keep the complete 1.0 acceptance scope; prepare evidence-gated manual npm publication with provenance and the exact independently tested archives.
* Consolidate installation/development/release documentation, align package metadata and licenses, and record the reserved @adula scope.
* Remove educational customers/orders/tasks modules from normal application operation; retain their migrations, listeners and page overrides only as isolated test fixtures, without dropping existing data.

* Ship a business-focused frontend-design skill and route UI work to it through managed agent rules. Request company identity at kickoff and preserve project-owned branding notes across installation.
* Use shadcn components as the agent default, with Dialog for all forms and record details unless the user requests another presentation.
* Add the copied ResourceSurface, use it for generic resource forms/details and the reference order form, and use shadcn Select for lookup and organizational fields. Preserve the explicit page option.
* Verify both managed skills in doctor and test skill repair, identity preservation and modal interaction.

### Foundation carried into 0.2.0

* Establish the pnpm workspace on the official AdonisJS 7 starters.
* Add the resource registry, CASL authorization with PostgreSQL parity tests, organizational scope and field contracts.
* Add transactional JSON resource CRUD, version conflicts, sequences, soft deletion and outbox/listener deduplication.
* Add the reference modules, generator, core bootstrap and diagnostic commands.
* Add local PostgreSQL helpers, CI and unverified deployment/backup assets.
* Wire Redis-backed actor caching, adonis-jobs event delivery, a single scheduler, heartbeat checks and backup failure notifications. Verify actual queue redelivery against PostgreSQL and Redis on Node 24.
* Add independent-consumer configuration, migration discovery, copied HTTP contract harness, repeatable installation and managed agent hashes.
* Add reference module scaffolding/removal with archival and dependency checks.
* Add authorized selected-column projection, estimated counts, packed field rules and editor metadata.
* Add the 25-component Arabic/RTL UI registry, customization protection and update previews; build a hand-designed Arabic order list and form.
* Reconcile inline inserts, updates and explicit soft deletes in one transaction, protect submitted parents and add versioning to reference order lines through an additive migration.
* Verify real browser create/edit/search/mobile behavior and both packed packages in an independent application.
* Add schema-aware money/date/timestamp authorization, Unicode text ordering, calendar-preserving DATE conversion and normalized scalar/JSON write contracts.
* Add the optional MCP resource adapter with authenticated HTTP, CSRF, field/scope and mutation tests.
* Persist submission envelopes atomically with their corresponding outbox events and check migration inventory in doctor.
* Restrict Tailwind source discovery to consumer-owned frontend files, fixing excessive memory use in an independent nested consumer build.
* Generate explicit HTTP fixtures that verify real record isolation, mapped storage, normalized fields, uniqueness, conflicts and soft deletion; guard kit tests with PostgreSQL 17 and a dedicated test database.
* Exercise all field kinds in a PostgreSQL service fixture and reject sparse JSON arrays before storage can change their meaning.
* Diagnose local upload volume and conservatively identify project pages to review after copied UI changes.
* Make packed-consumer installation verification portable through Node with an immutable official starter revision and isolated database environment.
* Accept the official Drive and limiter adapters under a recorded freshness exception, and configure Drive, attachments, limiter, Ally and SMTP mail on private disks and optional credentials.
* Store attachments in a kit table with disk-relative paths, enforce uploader and organizational ownership inside the write transaction, and serve downloads only through the record's own view policy.
* Move files between disks with `adula:storage:migrate`, resumable and non-destructive, and prove a restored record still opens its attachment with `backup:restore-test` on a monthly schedule.
* Complete the authentication lifecycle: password recovery by mail, revocable tracked sessions, disabled accounts, optional Ally providers, rate limits and auth activity.
* Add the fixed core administration screens — users, the roles and rules matrix with a validated condition editor, the movable organizational tree, activity, jobs and health, settings, notifications, sessions — with impersonation visible in every layout.
* Add a route scan that refuses anonymous and unauthorized clients across every registered route.
* Complete the generated interface: every field control, belongsTo autocomplete, inline rows, URL-driven sort, filters and search, virtualization above 200 rows, CSV export, deferred activity and children, and the page override rule.
* Report the field's accessible name without its required marker, and submit the whole form on update so resource validators see a complete document.
* Add `adula:gaps report` and a k6 workload script carrying the plan's performance budget.

See the implementation status and gaps for incomplete plan requirements. This is not a 1.0 release.
