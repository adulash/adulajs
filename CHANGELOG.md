# Changelog

## Unreleased

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
