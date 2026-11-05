# ADR 049 — Workspace layouts, navigation order, dark mode and per-user preferences

Date: 2026-11-05. Status: accepted for 2.3.0. The owner chose the light default theme and
drop-down menus (not a second row of tabs) for the top layout.

Issues #153 (collapse or hide the sidebar), #154 (top menu with tabs), #155 (dark mode),
#156 («مهامي» beside the bell) and #157 (one entry per administration section, sub-tabs,
reorder and reset). Related: #106 (shell scrolling, 2.3.0) and #158/#159 (avatars and the
overview arrangement), which reuse the preference store below.

## Context

The workspace shell (`apps/reference/inertia/layouts/workspace.tsx`, copied into every new
system) had one fixed 244 px sidebar, a light palette only, «مهامي» as a sidebar entry and,
inside the administration, every page of every section expanded in the sidebar. Users asked
to reclaim width, to use a top menu, to work in a dark theme, to reach their tasks next to
their notifications and to arrange the menu. Each of these is a choice a person makes for
themselves, so it must be remembered per user, not per browser. AdulaJS had no per-user
interface store: `users.language` (ADR 041) is a column, `ui.preferences` is system-wide,
and the collapsed module groups live in `localStorage`.

## Decisions

### Per-user preferences

* `definePreference({ key, default, validate })` and `UserPreferences` (core,
  `src/core/user_preferences.ts`). Values live in the existing `settings` table with scope
  `user`, `scope_id` = the user id and key `preference.<key>`: no migration. Keys are lower
  camel segments joined by dots; each value is validated by its own definition and capped at
  4096 UTF-8 bytes; unknown keys are refused (404 `E_PREFERENCE_UNKNOWN`). A stored value
  that no longer validates (after an upgrade) reads as the default and is reported once.
* The application declares its keys in `start/preferences.ts` (the shell's four keys:
  `shell.sidebar`, `shell.layout`, `shell.theme`, `shell.navOrder`; other features append,
  such as `overview.layout` for #159). `UserPreferences.validate()` runs at boot.
* `PUT` and `DELETE /account/preferences/:key` change or reset the signed-in user's own value;
  there is no user id in the address or the body. They are refused while impersonating
  (403 `E_IMPERSONATING`): an administrator acting as someone does not rearrange that
  person's interface; the change applies to the page view only. They are throttled (60 per
  minute per user) and CSRF-protected like the other account routes.
* The shared Inertia prop `preferences` carries every registered key with defaults filled
  in; guests get the defaults. The settings screen never lists `preference.*` rows and
  refuses to write or delete them (403 `E_SETTING_RESERVED`): they are private to the user.
* No activity entry is written: this is the user's own interface state, like the language.

### Layouts (#153, #154)

* One navigation model (`components/shell_navigation.ts`): daily work, modules grouped from
  the server's `navigation` prop, and the administration entries. The sidebar, its icon
  rail, the top bar and the small-screen row all render it, so they show the same pages and
  the same permissions by construction.
* The sidebar has three modes (`shell.sidebar`): `expanded`, `icons` (a 4.5 rem rail whose
  entries keep their accessible names, with tooltips; each module becomes one icon button that
  opens a menu of its pages, named by its tooltip and accessible name) and `hidden`. Two header buttons control it, each with a
  truthful `aria-expanded` and `aria-controls`; there is no global shortcut (Ctrl+B opens
  bookmarks in Firefox and means bold in editors). Widths use the `--shell-sidebar` CSS
  variable and logical properties, so RTL and LTR mirror. The fixed `<aside>` keeps the
  `right-scroll-bar-position` stopgap of #101.
* `ui.preferences` gains optional `layout` (`sidebar` | `top`, absent = `sidebar`) and
  `layoutUserChoice` (absent = false). The system's administrator picks the layout; when
  they allow it, each user may choose their own from the account menu (`shell.layout`,
  `null` follows the system). The sidebar stays the default.
* The top layout puts daily work, one entry per module and «الإدارة» in a row under the
  header (owner: drop-down menus). Daily-work entries are links; each module entry opens a
  drop-down menu of that module's pages, and «الإدارة» opens one of its sections (the
  registry DropdownMenu: arrow keys, Escape, focus return and RTL alignment come with it).
  The entry holding the current page is marked, and the current page inside its menu
  carries `aria-current`.
* Module icons in the rail (amended before the 2.3.0 release, owner's decision): the first
  version showed each module's first letter, which reads as noise in Arabic. The rail now
  shows an icon from the project-owned `components/module_icons.ts`: `MODULE_ICONS` maps a
  module name to a lucide icon, and a module without an entry gets a neutral shape chosen
  stably from its name, so the same module always looks the same; when that shape is
  already taken by another group shown beside it, the next unused one, so groups stay
  distinct while the twelve shapes last. The tooltip and the
  accessible name carry the module's name. `Module` and `ResourceNavigation` gain no icon
  option: that would add public API, and the project map gives each system its own icons
  without it (GAPS).

### Navigation order (#157)

* Entries have stable ids: `work.overview`, `work.dashboards`, `work.imports`,
  `module.<name>`, `admin.<section>`. `shell.navOrder` stores the ids the user moved; the
  others keep the default order. Ids the user cannot see (or that no longer exist) are
  ignored when rendering, so a stored order never reveals a page.
* «ترتيب القائمة…» in the account menu opens a dialog with one list per group and up/down
  buttons (no drag dependency; keyboard and screen-reader friendly, with a live
  announcement). Saving stores only the lists the user changed; «استعادة الترتيب
  الافتراضي» deletes the preference.

### Administration sections (#157)

* `components/admin_sections.ts` (project-owned) declares
  `AdminSection { id, title, icon, pages: AdminPage[] }` and
  `AdminPage { id, href, label, icon, match?, visible? }`. Teams add a page to a section or a
  section to the list; routes stay inside the `middleware.admin()` group, which remains the
  authority. `visible` only hides pages that do not apply (the setup while it is complete).
* The sidebar shows one entry per section (and the setup while pending); outside the
  administration it stays one «الإدارة» entry (ADR 036). The layout renders the current
  section's pages as vertical sub-tabs at the start side (one scrolling row on small
  screens); pages need no change. The longest matching address wins, so nested pages
  (`/admin/backups/restore`) keep their own tab. The failure badge sits on the operations
  section inside the administration.

### Dark mode (#155)

* `@custom-variant dark (&:where(.dark, .dark *))` and a `.dark` block that overrides every
  color token; new tokens `--popover`, `--popover-foreground`, `--destructive-foreground`,
  `--success`, `--warning` and `--info` (text and icon colors at 4.5:1 or more on the
  background and card in both themes; tinted surfaces use `bg-success/10` and the like).
  A unit test computes the contrast of every text/surface pair in both themes.
* `shell.theme` is `light` (default, owner), `dark` or `system` («حسب الجهاز»). The server
  renders `class="dark"` and `data-theme` on `<html>`; for `system` a CSP-nonce inline
  script applies the device setting before the first paint and follows its changes. The
  account menu applies a change at once and saves it.
* Components use tokens only: hard-coded `bg-white`, `text-white`, palette classes and hex
  colors are replaced in the shell, the generic resource components, dialogs, tables and the
  reference pages, and a test refuses new ones. Upstream shadcn primitives keep their own
  `dark:` variants. Indicator meters already use tokens.
* Printed documents stay light (paper): they declare `color-scheme: light`. While
  impersonating, the shell shows the target user's theme.

### «مهامي» beside the bell (#156)

* «مهامي» leaves the sidebar and becomes an icon link next to the notification bell with
  the open count as a badge. The count is `Assignments.openCounts(actor)`, the same counting
  code `mine()` uses for the page header, so the badge and the list agree, delegated
  approvals included (ADR 044). The bell's realtime refresh reloads it too.

## Consequences

* New public API (additive): `definePreference`, `UserPreferences`, `PreferenceDefinition`,
  `isPreferenceSetting`, `PREFERENCE_PREFIX`, `PREFERENCE_MAX_BYTES`, `NavigationLayout`,
  `Assignments.openCounts()`, and the optional `UiPreferences.layout` and
  `layoutUserChoice`. `check:api` reports `UiPreferences` as "changed" because its type text
  differs; the change is additive in practice: both members are optional, so every object
  that type-checked before still does, readers that ignore them see the same behavior, and
  `validateUiPreferences` still accepts every value stored by earlier versions (absent means
  `sidebar` and `false`). Only code that enumerates the keys exhaustively (a mapped type over
  `keyof UiPreferences` without defaults) would notice, the same precedent as the optional
  `digits` member.
* The «مهامي» count costs one grouped query plus one record check per record with open
  items (at most 1000), so it is a deferred shell prop: pages render first, the client asks
  for it once per visit, and partial reloads that do not name it never compute it.
* Project-owned files change; systems created earlier copy them from a new system (upgrade
  notes list them). `adula:ui` writes `inertia/css/adula.css` only once, so existing
  systems merge the `.dark` block and the new tokens into it by hand; the registry
  components that now use status tokens need them.
* `useCollapsedModules` stays a per-browser convenience (`localStorage`).
* #106 is not addressed here: the top bar is in normal flow and the collapsed or hidden
  sidebar narrows or removes the fixed panel, so neither makes the scrolling behind it worse.
* Browser suites run in both themes in CI (`pnpm test:browser:dark`, a test-only default
  honoured when the test fixtures are enabled).
