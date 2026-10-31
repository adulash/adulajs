# ADR 039 — Rename the project to AdulaJS (2.0.0)

The `pnpm check:naming` gate and the 1.x/2.x release guard are superseded by ADR 040; the rename stands.

Date: 2026-10-13. Status: accepted by the owner on 2026-10-13 in conversation: «اريد
تسمية المشروع الى AdulaJS» (I want to rename the project to AdulaJS), «نعم تغيير جذري،
يمكن فقط استعمال كلمة adula كاختصار، كلمة kit تحذف بشكل نهائي» (yes, a radical change;
only the word adula may be used as a short form; the word kit is removed for good), and
«نفذ الخطة كاملة» (carry out the whole plan). Issue #78. The owner authorized publishing
2.0.0 on `latest` on 2026-10-14: «أأذن بنشر 2.0.0 على latest» (I authorize publishing
2.0.0 on latest).

## Context

1.x is published as `@adula/kit`, `@adula/ui` and `@adula/create-app` from the
repository `adulash/adula-kit`, and documented as "adula-kit" or "the kit". The owner
is preparing a public release and compares the project with Next.js, whose core package
(`next`) and initializer (`create-next-app`) are unscoped while supporting packages live
under a scope (`@next/*`).

The owner registered the unscoped npm names `adula` and `create-adula-app` on
2026-10-13 and keeps the `@adula` scope.

## Decision

| Item | 1.x | 2.0 |
|---|---|---|
| Name in prose | adula-kit, the kit | AdulaJS (short form: adula) |
| Core package | `@adula/kit` | `adula` |
| Initializer | `@adula/create-app`, bin `create-adula` | `create-adula-app`, bin `create-adula-app` |
| New application | `npm create @adula/app@latest my-app` | `npx create-adula-app@latest my-app` |
| UI registry | `@adula/ui` | unchanged |
| Repository | `adulash/adula-kit` | `adulash/adulajs` |
| Directories | `packages/kit`, `packages/create-app` | `packages/adula`, `packages/create-adula-app` |
| Public identifiers | `KitError`, `KitAbility`, `KitActor`, `KIT_VERSION`, `withKitDatabase` | `AdulaError`, `AdulaAbility`, `AdulaActor`, `ADULA_VERSION`, `withAdulaDatabase` |
| Gap log | `KIT_GAPS.md` | `GAPS.md` |
| Managed AGENTS.md markers | `<!-- adula-kit:start -->` / `<!-- adula-kit:end -->` | `<!-- adula:start -->` / `<!-- adula:end -->` |
| Routes preload | `start/kit_routes.ts` | `start/adula_routes.ts` |
| Database objects | `kit_bump_auth_revision`, `kit_invalidate_auth`, `kit_notification_signal`, channel `kit_notifications` | `adula_` prefix |
| Settings and listeners | `kit.version`, listeners `kit.*` | `adula.version`, `adula.*` |
| Migration files | `<timestamp>_kit_<name>.ts` | `<timestamp>_<name>.ts` (timestamps and bodies unchanged) |

Ace commands already used the `adula:` prefix and do not change.

The word "kit" is removed from every living file. It stays only in dated records
(evidence, decision records 001–038, earlier changelog entries, 1.0 acceptance documents,
the local staging record, recorded exercises), in the user-facing upgrade guide, and in
the code that upgrades 1.x applications (`packages/adula/src/upgrade/legacy.ts`,
`packages/create-adula-app/src/upgrade.mjs`, their tests and the genuine-upgrade
harness). `pnpm check:naming`, run in CI, enforces this list.

### Migration files are renamed, once

Released migrations are never edited. This decision makes one exception: Lucid records
each migration as its directory plus file name, so moving the core from
`node_modules/@adula/kit` to `node_modules/adula` already changes every recorded name.
Because 2.0 must rewrite those rows anyway, the same rewrite drops `kit_` from the file
names. Timestamps, order and schema bodies stay as they were; only class names and the
rollback message change. Migration `1770000000016_adulajs_names` renames the database
objects, the version setting and processed listener names that 1.x created, and is a
no-op on a database created by 2.0.

### Upgrade path

1. `npx create-adula-app@latest upgrade` rewrites `package.json`, imports, the public
   identifiers above, the routes preload, the lint rule name and `ui.lock.json` without
   booting AdonisJS (once `@adula/kit` is gone, `node ace` cannot start until imports name
   `adula`), then installs dependencies. It refuses uncommitted git changes unless
   `--force`.
2. `node ace adula:upgrade` renames the recorded 1.x migrations from an explicit table in
   one transaction (an unknown 1.x row aborts without changes), renames `KIT_GAPS.md`,
   replaces the managed AGENTS.md block once, and runs pending migrations.
3. `ADULA_ADMIN_EMAIL=<email> node ace adula:install` and `node ace adula:doctor` as for
   any upgrade. Doctor names `adula:upgrade` while 1.x migration rows remain.

Project-owned files created by 1.x (`app/services/kit.ts`, `inertia/css/kit.css`) belong to
the application and are not renamed; new applications get `adula.ts` and `adula.css`.

### Release gate

ADR 038 bounded the stable track after 1.0.0 to 1.x because a new major needed its own
acceptance track. 2.0 changes names only and adds no scope, so the accepted 1.0 phases
still apply. `scripts/check-release.mjs` accepts 1.x and 2.x on `latest` under ADR 038's
rule: an entry in `releases` for that exact version with `authorized: true`, the owner, a
date and evidence. A 3.x release needs its own track.

## Consequences

- 2.0.0 is a breaking release. 1.x applications upgrade with the three steps above,
  proved by `pnpm test:upgrade --published=1.2.0` in CI.
- `release-readiness.json` records 2.0.0 with `authorized: false`. Before publication the
  owner renames the GitHub repository to `adulajs`, updates the trusted publisher of
  `@adula/ui` and creates trusted publishers for `adula` and `create-adula-app` (owner
  `adulash`, repository `adulajs`, workflow `release.yml`, environment `npm`), then
  authorizes 2.0.0.
- After 2.0.0 is on `latest`, the owner deprecates `@adula/kit` and `@adula/create-app` with
  a message pointing to `adula` and `create-adula-app`. The `0.0.0-stage` placeholders on
  the new names are superseded by 2.0.0.
- Decision records 001–038 and dated evidence keep the names that were true when written.
- The items ADR 027 deferred "to 2.0" (two-factor authentication, the human review of
  impersonation and the natural schedule observations) are not part of this rename; they
  stay open in GAP-005 for a later major release.
