# ADR 055 — AdulaJS UI is shadcn/ui on Radix

Date: 2026-11-20. Status: accepted for 2.4.0. Issue #168. Amends ADR 007 (the registry is
no longer fixed at 25 upstream components) and ADR 049 (the shell's sidebar is shadcn
Sidebar; its behaviour is unchanged).

## Context

AGENTS.md and the `adula-frontend-design` skill tell applications to compose the copied
shadcn components and never recreate them with styled native HTML. The framework itself did
not follow that rule everywhere: the workspace sidebar was a hand-built `<aside>` imitating
SidebarRail and SidebarTrigger, the main list and nine other tables were native `<table>`
elements, three scrollers styled the browser's scrollbar with CSS, user-avatar and slider
used Radix directly, confirm-action rebuilt an alert dialog on Dialog, and nothing recorded
which differences from shadcn were deliberate. Agents copy the framework's own pattern, so
each deviation spread.

## Decision

- AdulaJS UI is shadcn/ui, new-york-v4 style, on Radix (the `radix-ui` package). Every part
  that has a shadcn component uses it. A Radix primitive is used directly only where shadcn
  has no component, and each such use, like every other exception, is listed below with its
  reason. Base UI and other component libraries are out of scope.
- The registry stores every shadcn item it uses. `scripts/ui-registry.mjs sync` fetches each
  item of `UPSTREAM_ITEMS` from `ui.shadcn.com/r/styles/new-york-v4` into
  `packages/ui/upstream/` (repository only, not published) and records each file's sha256,
  URL and upstream dependencies in `UPSTREAM.json`; it no longer overwrites `registry/ui` or
  `registry.json`. `prepare --sources-only` writes the RTL-adapted form of every upstream
  file into `registry/ui`, except the files in `UPSTREAM_EDITS`, which carry a deliberate
  AdulaJS edit and are merged by hand. The registry test checks each hash, checks that every
  other stored file is exactly the prepared upstream file, and checks that each listed edit
  still differs.
- Added from upstream: sidebar (with its `use-mobile` hook), avatar, slider (replacing the
  AdulaJS slider built on Radix), alert-dialog, scroll-area and collapsible (the sidebar's module groups). Breadcrumb, previously an
  AdulaJS copy, is now the stored upstream file; its Arabic labels and the mirrored chevron
  come from `adaptSource`. The registry stores 33 upstream items, one file each.
- `packages/ui/tests/native-elements.test.mjs` refuses native `button`, `input`, `select`,
  `textarea`, `table` and `aside` elements and native scrollbar styling (`scrollbar-width`,
  `scrollbar-color`, `scrollbar-gutter`, `::-webkit-scrollbar`) in the registry, its theme
  and everything `create-adulajs` copies from `apps/reference/inertia`, outside the stored
  shadcn files and the exceptions below. Hidden inputs are form data, not controls.

### The shell, tables and scrollers

- The workspace shell is `SidebarProvider`, `Sidebar`, `SidebarContent`, `SidebarFooter`,
  `SidebarRail` and `SidebarTrigger`. The provider is controlled by the user's
  `shell.sidebar` preference: the trigger and the rail set `expanded`, or collapse to the
  user's `shell.sidebarCollapse` choice, `icons` (`collapsible="icon"`, the icon rail) or
  `hidden` (`collapsible="offcanvas"`, and `inert` so nothing in it takes focus). ADR 049's
  behaviour is kept: three modes, the top layout, right-to-left and left-to-right, the
  full-width header above the sidebar (shadcn's site-header layout: the sidebar starts at
  `--shell-header`), the brand in the header, the trigger with its truthful `aria-expanded`
  and `aria-controls`, the rail out of the tab order, and no keyboard shortcut. The sidebar
  shows from the large breakpoint; below it the navigation row stays, as before. The sidebar
  keeps its `complementary` landmark and name. Its colours are the `--color-sidebar*` theme
  tokens, mapped to the card, accent, border and ring tokens, so it reads as before in both
  themes. The invitation link and the account menu sit in `SidebarFooter`.
- The main list (`data-table`), the inbound webhooks log, record collaboration, the child
  tables of record fields and record details, and the print templates, mail templates,
  webhooks and workflows administration tables use shadcn Table. In the list, the table's
  own container is kept visible so the sticky header sticks to the page's scroller; the list
  scrolls sideways only when its columns do not fit (#109), and virtualisation and column
  preferences are unchanged.
- The sidebar, the long dialog body and the administration tab row scroll inside shadcn
  Scroll Area: on hover in the sidebar, always shown in long dialogs (`type="always"`, so the
  reader sees there is more below), and with its bar hidden in the tab row, which scrolls
  sideways below the medium breakpoint and wraps from it. The long dialog body is
  `[data-long-dialog-body]`; its `[data-slot=scroll-area-viewport]` is the element that
  scrolls. Where a Scroll Area holds text, its content is a block so long text wraps instead
  of widening the area.
- user-avatar composes shadcn Avatar (`data-slot="avatar"`, plus `data-user-avatar`),
  confirm-action composes shadcn Alert Dialog (`role="alertdialog"`, answered only by its two
  buttons), and the overview customisation dialog uses Label. Their public props are
  unchanged.

### Exceptions

- The page's own scroll stays the browser's, unstyled: from the large breakpoint the page
  area is Inertia's `scroll-region`, which keeps and restores its position across visits
  and moves the bar to the inline end (ADR 049); a Scroll Area viewport would lose both.
  Plain `overflow-x-auto` around wide content (shadcn Table's own container, code blocks)
  is browser scrolling too; nothing styles those bars.
- Hidden file inputs in `file-input` and the two file fields of `resource-field`: only a
  native file input opens the browser's file chooser; a shadcn Button opens it.
- The sign-out entry of the account menu is a submit button inside `DropdownMenuItem
asChild`, so signing out works as a plain form post with the menu item's look, role and
  keys.
- The starter print template is HTML text for the printed document (ADR 048), not interface.
- Radix primitives used directly: none in the registry or the shell.
- The sidebar's entries are SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuItem,
  SidebarMenuButton (with its own tooltip in the icon rail) and SidebarMenuBadge; the module
  groups are shadcn Collapsible, and in the icon rail each module is a SidebarMenuButton that
  opens a DropdownMenu. One override, by the owner's decision of 2026-11-20: the current entry
  keeps the semibold weight (`data-[active=true]:font-semibold`) that the top menu, the
  tabs and the phone row share, where SidebarMenuButton sets `font-medium`. Its fill and colour
  are SidebarMenuButton's own (`--color-sidebar-accent` and its foreground, mapped to the
  accent and primary tokens). The icon rail is shadcn's default `3rem`.
- The list's rows keep `hover:bg-background` instead of TableRow's `hover:bg-muted/50`: the
  actions column pinned while the columns overflow must be opaque and change with its row.
  Selected rows use TableRow's own `data-state="selected"`.
- The header's icon buttons (the bell, «مهامي», the assistant) are shadcn's ghost icon Button
  (the two links through `asChild`) with one shared shape in `components/header_icon.ts`, and
  their counts are Badge. Sidebar counts are a Badge inside SidebarMenuBadge, red for alerts
  and primary for work, and a dot of the same colour in the icon rail.
- In the icon rail a module's button is both a Tooltip trigger and a DropdownMenu trigger;
  SidebarMenuButton's tooltip wraps it, so the button cannot also show the menu's open state.
  Reduced motion is the theme's global rule (every transition near zero), which covers the
  sidebar's own transitions.
- SidebarProvider opens every tooltip at once (`delayDuration={0}`); the shell nests a
  TooltipProvider with the application's 300 ms delay so tooltips behave as before.
- Radix Scroll Area lays its content out left to right unless it is given the reading
  direction, so every Scroll Area in the shell, the long dialog and the tab row passes `dir`
  from `useMessages()` (tabs, like pagination, reads the interface direction).
- Registry `.ts` files are snake_case, so shadcn's `use-mobile` hook is stored as
  `use_mobile.ts` and the sidebar imports it by that name (`adaptSource`).

### AdulaJS edits to stored shadcn files (`UPSTREAM_EDITS`)

- dialog: unsaved-change protection, confirm mode and dialog URLs (ADR 016, ADR 035).
- tabs: the `wrap` option of TabsList (ADR 049), now inside a Scroll Area that follows the
  interface direction.
- pagination: interface text through `useMessages` for the optional languages (ADR 041).
- sidebar: no Ctrl+B shortcut (ADR 049: Ctrl+B means bold in editors and bookmarks in
  Firefox) and no `sidebar_state` cookie (the state is the user's preference).

Every other stored file differs from upstream only by `adaptSource`: logical spacing and
positions, `dir="rtl"` on Radix roots, Arabic labels, the paired `ltr:`/`rtl:` translate and
resize-cursor classes, and the removed `"use client"` directive.

## Consequences

- New registry items: `sidebar`, `use-mobile` (the file `use_mobile.ts`), `avatar`, `alert-dialog`, `scroll-area`, `collapsible`.
  `user-avatar` depends on `avatar`, `confirm-action` on `alert-dialog`, `long-dialog` and
  `tabs` on `scroll-area`, and `data-table` on `table`. No new npm dependency: every item
  uses the pinned `radix-ui`, `cn`, `class-variance-authority` and `lucide-react`.
- Existing systems: `adula:ui add sidebar avatar alert-dialog scroll-area collapsible` installs the new
  items, and updating the changed items (`--preview` first) brings the rest. `adula:ui`
  writes `inertia/css/adula.css` once, so systems add the eight `--color-sidebar*` lines to
  its `@theme inline` block by hand. The shell (`layouts/workspace.tsx`) and the changed
  pages are project-owned: systems copy them from a new system, as the upgrade notes list.
- Markup that tests or tools may select changed: `data-slot="user-avatar"` is now
  `[data-user-avatar]` with `data-slot="avatar"`; the long dialog body is
  `[data-long-dialog-body]` with its viewport as the scroller; the sidebar is
  `data-slot="sidebar"` and no longer an `<aside>`; lists are `data-slot="table"`.
- Upstream updates are a reviewed maintenance step: `sync`, then `prepare --sources-only`,
  then merge the four edited files by hand and run the registry test.
