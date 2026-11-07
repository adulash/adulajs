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
  The entry holding the current page uses the shell's active pattern (`bg-accent
  font-semibold text-primary`, no underline), each module entry shows the same icon as in
  the collapsed sidebar, and the current page inside any menu carries `aria-current` and
  stands out (`aria-[current=page]:font-semibold aria-[current=page]:text-primary`).
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
  screens); pages need no change. The current tab carries `aria-current="page"` and the
  sidebar's active pattern (`bg-accent font-semibold text-primary`, no border or bar), like
  every active navigation entry. The longest matching address wins, so nested pages
  (`/admin/backups/restore`) keep their own tab. The failure badge sits on the operations
  section inside the administration.

Amendment (2.3.0, owner's review):

* The sidebar's administration area has exactly two entries, always shown to
  administrators and without sub-items: «الإعدادات» (the one-time setup while it is
  pending, the settings pages, operations, backups, failed workflows and the activity log)
  and «الأشخاص والصلاحيات» (users, roles, organization units, sessions and delegations). The
  former operations section is part of «الإعدادات»; its stored order id `admin.operations`
  no longer matches a section and is ignored, as every unknown id is. The alerts badge sits
  on «الإعدادات» and, inside it, on the tab that explains it: failed workflows on «تدفقات
  فاشلة» and a stale backup on «النسخ الاحتياطي». The main sidebar is otherwise unchanged,
  and the top layout keeps its drop-down menus.
* A section's pages are the registry `Tabs` with `orientation="vertical"` inside the page
  body, not a second sidebar or a list of styled links: a `tablist` with
  `aria-orientation="vertical"`, one `tab` per page and the page itself as the `tabpanel`.
  The list is the registry `TabsList` with its `nav` variant (added for navigation tabs), so
  the selected tab uses the shell's active navigation pattern (`bg-accent font-semibold
  text-primary`), with no border, bar or shadow, and screens do not restyle the primitive.
  Radix keeps the arrow-key orientation of the list's first render, so the list remounts
  when the window crosses the large breakpoint; the page beside it stays mounted.
  Each tab is a link (`TabsTrigger asChild`), so the address selects the tab: direct links,
  reloads, Back and Forward show the right one. Arrow keys move between tabs and Enter
  opens one (manual activation, since opening a tab loads a page). The tabs stay visible
  while the page scrolls (sticky under the header). Below the large breakpoint the list is
  one horizontal row that scrolls. The tabs have no reorder or restore control; arranging
  stays with the sidebar entries.
* The workspace header (breadcrumb, bell, «مهامي», assistant) is sticky at the top in both
  layouts, with the top menu, the backup warning and the impersonation bar under it, so the
  warning never covers content. The sticky tabs sit below that block (`--shell-top`, its
  measured height).
* Every sidebar entry shows the shell's focus ring on keyboard focus
  (`focus-visible:ring-[3px] focus-visible:ring-ring/50`) instead of the browser outline; the
  active entry has no border. The sidebar's own scrollbar is thin and appears on hover, so
  it does not read as a second page scrollbar.

Amendment (2.3.0, owner's decision of 2026-11-07, the workspace frame): this replaces the
header bullet above and the two header buttons of #153.

* One header runs from edge to edge at the top of the window, and the sidebar and the page sit
  below it (shadcn's site-header layout). Owner: «لماذا لا يكون الهيدر كامل قطعة واحدة من الطرف
  الى الطرف، والقائمة الجانبية والصفحات تظهر تحتها». The brand (mark, «عدولة» and its tagline)
  is part of the header, not of the sidebar («شعار «عدولة» اجعله يصبح جزء من header»); the
  sidebar begins with its navigation and the icon rail shows no brand tile.
* The sidebar has one control, and it belongs visibly to the sidebar. Owner: «زر التحكم بإظهار
  واخفاء القائمة يوجد في مكان اخر وليس ضمن القائمة وكأنه يتحكم بتوسيع الصفحة وتقليصها». The
  header's start segment stands directly above the sidebar, as wide as it, and holds the brand
  and one trigger (ghost `icon-sm`, PanelRight mirrored for the reading direction, a Tooltip,
  `aria-expanded`, `aria-controls`). A rail on the sidebar's edge toggles it too (shadcn
  SidebarRail; out of the tab order, since the trigger is the keyboard control). What
  collapsing does is the user's preference `shell.sidebarCollapse` in the account menu, «عند
  طي القائمة: أيقونات / إخفاء كامل», `icons` by default; when the sidebar is hidden the same
  trigger brings it back. The Maximize2 «hide» button is gone. There is no keyboard shortcut
  until the owner decides one (Ctrl+B was declined above).
* The header shows the registry Breadcrumb (a new registry item composing shadcn's
  breadcrumb: no new dependency) after a vertical Separator.
* From the large breakpoint the page area below the header is the page's scroll container
  (Inertia's `scroll-region`, so its position is kept and restored across visits). In
  right-to-left pages the browser draws its scroll bar at the left edge, away from the
  sidebar, whose own scroll bar stays thin, so two scroll bars never stand side by side
  (owner: «شريط التحكم بتمرير الشاشة للصفحة ... نقله الى اليسار»). The document itself does
  not scroll there, so a dialog's scroll lock shifts nothing and the #101 compensation is no
  longer needed. The backup warning and the impersonation bar head the page column, right
  under the header. The administration tabs stick inside the scroll container. Record dialogs
  remember and restore the list's position in that container. Printing returns to the normal
  flow. On phones the document scrolls as before under the sticky full-width header.

Amendment (2.3.0, owner's decision of 2026-11-07, horizontal administration tabs): this
replaces the vertical tabs of the owner's-review amendment above and its `nav` variant.
Owner: «لا اريد قائمة جانبية فرعية اضافية، اريدها ان تكون تبويبات اعلى الصفحة بشكل افقي اسفل
الheader الاساسي بحيث يكون Tabs ولكل صفحة tab خاص بها».

* A section's pages are one row of the registry `Tabs` in their default orientation and look
  (`TabsList` and `TabsTrigger` as shadcn ships them), right below the main header across the
  page area. There is no tab column beside the page, so the page uses the full content width.
  The registry's `nav` variant is removed; `tabs.tsx` is the stored shadcn component again.
* One tab per page, each a link (`TabsTrigger asChild`), with the page as the `tabpanel`:
  the address selects the tab (direct links, reloads, Back and Forward), arrow keys move
  between tabs and Enter opens one (manual activation).
* The row heads the page column, above the backup warning and the impersonation bar. From the
  large breakpoint it sits outside the page's scroll region, so it stays in view while the
  page scrolls, and the list wraps onto further rows so no tab or badge is hidden: the
  registry `TabsList` has a `wrap` option for this (AdulaJS addition; the default segmented
  look is unchanged). On phones the order is the header, the main phone navigation, then the
  tab row, which sticks under the header and scrolls sideways, bringing the active tab into
  view; its inline padding keeps the focus ring of the first and last tab whole.
* Alerts stay a count badge on the tab and on the «الإعدادات» sidebar entry. The sidebar keeps
  its two administration entries without sub-items.
* Every navigation link opens its target page at its own address (owner: «تأكد ان الازرار في
  القائمة الجانبية تعمل وكذلك التبويبات توجه الى الصفحة الهدف»). «لوحات المؤشرات» links to the
  first dashboard the viewer may see and stays current on every dashboard; «دعوة مستخدم» opens
  the invitation over the users list for administrators; the phone navigation shows the same
  two administration entries as the sidebar instead of one `/admin` link, and marks the
  current page. A browser test clicks every link the sidebar renders (expanded, as icons and on
  a phone) and every administration tab.

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
* The header's icon buttons (the bell, «مهامي», the assistant) share one shape from
  `components/header_icon.ts`: a round 36 px target (`size-9 rounded-full`), the icon at
  strokeWidth 1.6, a shadcn Tooltip with its name, and `bg-accent text-primary` while its
  page is open.

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
