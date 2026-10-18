# Upgrading a 1.x application to AdulaJS 2.0

AdulaJS 2.0 is the 1.x framework under its new name ([ADR 039](decisions/039-rename-to-adulajs.md)).
It adds no features: packages, identifiers and a few file and database names change.
New systems start with `npm create adulajs my-system`; this guide is only for systems
created with 1.x. The 2.0.0 creator was published as `create-adula-app`; the creator is
now `create-adulajs`.

| 1.x | 2.0 |
|---|---|
| `@adula/kit` | `adula` |
| `@adula/create-app` | `create-adulajs` |
| `@adula/ui` | `@adula/ui` (unchanged) |
| `KitError`, `KitAbility`, `KitActor` | `AdulaError`, `AdulaAbility`, `AdulaActor` |
| `KIT_VERSION`, `withKitDatabase` | `ADULA_VERSION`, `withAdulaDatabase` |
| `start/kit_routes.ts` | `start/adula_routes.ts` |
| `KIT_GAPS.md` | `GAPS.md` |

## Before you start

- Upgrade from 1.2.0. Commit or stash your work: the first step refuses uncommitted
  changes unless you pass `--force`.
- Take a database backup. Step 2 rewrites the migration history.
- **Do not run `node ace migration:run` before step 2.** Until `adula:upgrade` renames
  the history, Lucid sees every core migration as new. The first one would fail inside its
  transaction without changing anything, but `adula:doctor` reports the unfinished upgrade.

## Steps

1. Rewrite the application for the new package names and install them:

   ```sh
   npx create-adulajs@latest upgrade
   ```

   This updates `package.json`, every import of `@adula/kit`, the identifiers in the table,
   the routes preload in `adonisrc.ts`, the lint rule `adula/no-core-patching` and
   `ui.lock.json`, then installs with the package manager your lockfile names (pnpm or
   npm; for yarn it asks you to run `yarn install`). It prints each file it changed. Use
   `--no-install` to install yourself.

2. Rename the migration history and managed files, then migrate:

   ```sh
   node ace adula:upgrade
   ```

   It renames the 1.x migration records, `KIT_GAPS.md` and the managed `AGENTS.md`
   block, then runs `migration:run`. Migration `1770000000016_adulajs_names` gives the
   database functions, triggers, the version setting and listener names their AdulaJS
   names. It is safe to run twice.

3. Finish as for any upgrade:

   ```sh
   ADULA_ADMIN_EMAIL=<email> node ace adula:install
   node ace adula:doctor
   ```

   The UI registry moves to 2.0, so review copied components with
   `node ace adula:ui add all --preview`, then `--accept`, as described in the
   [installation guide](installation.md).

Files your application owns are not renamed, for example `app/services/kit.ts` or
`inertia/css/kit.css` from a 1.x starter. Rename them when convenient.
