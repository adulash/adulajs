# @adula/ui

Version 2.1.0. For complete consumer setup, use the canonical [installation guide](https://github.com/adulash/adulajs/blob/main/docs/installation.md).

Arabic RTL shadcn registry for project-owned React components. This package ships JSON assets, not a runtime React component library. Install with `node ace adula:ui add all` or `node ace adula:ui add dialog`. The command invokes the pinned shadcn CLI and records each generated file hash in `ui.lock.json`. Project modifications are preserved; use `--preview` to review upstream differences before merging an update.

The 25 primitives are based on the official shadcn new-york-v4 registry. See LICENSE.shadcn.md and UPSTREAM.json for attribution and source hashes. Adaptations include logical spacing, Arabic labels, RTL keyboard direction, Arabic calendar defaults, RTL notifications and switch movement. Visual acceptance of the application remains a separate check.

Build with `pnpm --filter @adula/ui build`. `registry/ui` is the single source of copied UI in this repository: `scripts/ui-registry.mjs` maintains it with one subcommand per step.

| Command | Effect |
|---|---|
| `node scripts/ui-registry.mjs sync` | Fetches the upstream new-york-v4 primitives, `UPSTREAM.json` and the shadcn license (network; explicit maintenance). |
| `node scripts/ui-registry.mjs prepare` | Adapts sources for Arabic RTL and refreshes the pinned versions in `dependencies.json` and `registry.json` (npm). `--sources-only` skips npm. |
| `node scripts/ui-registry.mjs register` | Registers the AdulaJS resource components in `registry.json`. |
| `node scripts/ui-registry.mjs build` | Writes `build/` (what `pnpm --filter @adula/ui build` runs). |
| `node scripts/ui-registry.mjs reference` | Regenerates the reference application's `inertia/components/ui` and `ui.lock.json`. Both are untracked; the root `build`, `dev`, `typecheck` and `test` scripts run it first. Never edit the generated copy; change `registry/ui` instead. |

Refreshing upstream sources: run `sync`, review the changes, run `prepare`, then build and visually test. `prepare` is idempotent. Its last step is the direction transform that `shadcn add` itself applies when `components.json` sets `"rtl": true`, so the stored file is what an application installs, byte for byte. Two rules keep it a fixed point of that transform. First, every horizontal translate is stored as an explicit `ltr:`/`rtl:` pair, because shadcn appends a second `rtl:` class to a plain one on every install. The pairing covers only the `translate-x-*` family, with any variants. Any other class the transform keeps appending to, such as `space-x-*` (it re-adds `rtl:space-x-reverse`), fails the drift gate and needs a reviewed source edit. Second, no file keeps a `"use client"` directive. Applications use `"rsc": false`, and Inertia does not use it. shadcn 4.21.0 strips the directive inconsistently: its global regular expression keeps `lastIndex` between files, so only every other file in a multi-file install loses it. `pnpm --filter @adula/ui test` fails when a registry file is not prepared, when installing it would change it, or when the generated reference copy differs from the registry.

Required host tooling: Node 24, React 19, shadcn 4.21.0, Tailwind CSS 4.3.3 and @tailwindcss/vite 4.3.3. AdulaJS installer supports the official AdonisJS React starter layout. The registry is unpublished until explicitly authorized.

The theme disables automatic Tailwind source discovery and explicitly scans the consumer's inertia directory. It does not scan node_modules or unrelated workspace files. Add explicit source paths for any additional application-owned frontend directories.

Components merge `className` with `cn` (shadcn's clsx + tailwind-merge replacement), so a class passed by a page replaces the variant class of the same utility and modifier: `<Button variant="outline" className="bg-emerald-600 text-white">` drops `bg-background`. Classes under other modifiers stay, as in every shadcn project: the outline variant's `hover:bg-accent`, `hover:text-accent-foreground` and `dark:bg-input/30` still apply on hover and in dark mode. To restyle a selected or colored state, start from the `default` variant or override those modifiers too (`hover:bg-emerald-700 dark:bg-emerald-600`).

## Resource components

Nine AdulaJS components sit on top of the primitives and are registered by `node scripts/ui-registry.mjs register`. They consume the `ResourceDescription`, `ResourceList`, `ResourceEditor`, `ResourceShow`, `ResourceChildren`, `ResourceLookups` and `ResourceActivity` contracts exported by `adula`; the copied files are project-owned like every other registry item.

| Component | Role |
|---|---|
| `resource-page` | Page shell for the `index`, `form` and `show` modes. The discriminated `view` prop stays nested because Inertia page typing flattens top-level unions; the index list arrives as a top-level `result` prop built with `inertia.scroll()`. |
| `resource-surface` | Default shadcn Dialog for forms and record details, with RTL, scrollable content, accessible title/description and route dismissal. Use `presentation="page"` only for an explicit user-requested page. Custom overrides pass title, description and backHref. `openRecord()` opens a record in a dialog over the current list without leaving it (the generic list uses it); `closeRecord()` returns to that list. |
| `data-table` | URL-driven sort, text search and per-kind filters (lookup select, boolean select, typed date with calendar, related-record search, text). Keyset paging uses Inertia's `InfiniteScroll` in manual mode with a scroll trigger; pages merge into `result.data` (`matchOn('id')`) while row permissions and related labels accumulate client-side. Rows above 200 render through `@tanstack/react-virtual`. CSV export writes the loaded rows with a UTF-8 BOM, Arabic headers and the same formatting as the cells. Row actions go through `Can` and `resource-actions`. |
| `resource-form` | Controlled state per field, JSON `POST`/`PATCH` with the hidden `version`, VineJS `422` errors mapped to fields, inline child errors surfaced on their section (nested validators do not report the row), `409` conflicts with a reload action, organizational unit select, and delete/submit/cancel buttons rendered only from the record permissions. |
| `resource-field` | One control per field kind: text/textarea, integer, money (minor units in and out, Arabic-locale display with two decimals and `CURRENCY_LABEL`), boolean switch, date (typed `YYYY-MM-DD` plus calendar popover), datetime, JSON (parse check and pretty printing), attachment (uploads on selection to `POST /attachments`, progress, download link, replace and clear; the saved value is the attachment id), lookup select, belongsTo combobox (server search through `/resources/:resource/options/:field` with debounce and keyset "more"), user combobox (active members of the chosen unit and its ancestors, searched by name through the same route) and inline hasMany rows (`InlineRows`: add, edit, `_delete` markers, per-row `version`). |
| `resource-value` | Formatting and parsing shared by the table, the show page and CSV export, plus the `ResourceValue` renderer (download links, badges, `<pre>` JSON, LTR numerics). |
| `resource-show` | Field cards, status badge, actions by permission, deferred `childrenData` tables described by `childResources`, and the deferred `activity` list, each behind a skeleton. |
| `resource-actions` | Confirmation dialog and versioned `DELETE`/`submit`/`cancel` requests shared by the table and the show page. |
| `can` | Renders children only when the server-computed record permission allows the action. |

Override rule: a page file at `inertia/pages/<resource>/{index,form,show}.tsx` replaces the generic page for that resource and mode; there is no setting or hook. See docs/decisions/015-generic-resource-ui.md.

All UI work follows the installed `.agents/skills/adula-frontend-design/SKILL.md`: request missing company identity at kickoff, design for business workflows, compose the local shadcn components, and use modal forms/details by default. Record supplied branding in project-owned `docs/design-identity.md`. `ResourcePage` accepts `presentation="page"` for an explicit exception; existing customized copies require review before updating.

Server prerequisites for the generic pages: `ResourceService.lookups()` for lookup labels and filters, `ResourceService.activity()` for the deferred activity prop, and an index renderer that wraps the list in `inertia.scroll()` with the `cursor` page name. The reference `resources_controller.ts` shows the complete wiring.
