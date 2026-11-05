# ADR 016: Business design skill, company identity and modal defaults

Status: accepted by the user on 2026-09-19; supplements the original v4 plan.

The kit's agent must use shadcn/ui components, apply a frontend-design skill suited to business systems, and present forms and row details in a shadcn Dialog unless the user requests another presentation. Company identity must be requested at project kickoff and applied from the first interface.

The package ships the self-contained `adula-frontend-design` skill. Managed AGENTS rules route all UI work to it. It prioritizes operational workflows, readable data density, consistent navigation and actions, validation, permissions, Arabic RTL, keyboard access and restrained use of the application's visual tokens. It does not assume access to a global skill installation. Semantic HTML remains valid for document structure and form submission; shadcn primitives supply visual controls.

The skill asks for missing company name, logo, colors, fonts and guidelines early, without repeating information already supplied. The agent records sources and unresolved choices in project-owned `docs/design-identity.md`. Pending identity permits independent work and provisional neutral previews, not invented or implicitly approved branding. Kit installation and upgrades never own or rewrite this file.

`adula:install` synchronizes both managed skills and their hashes; `adula:doctor` checks every expected skill against the installed package. Other project skills and text outside the managed AGENTS block stay project-owned.

The copied `ResourceSurface` composes shadcn Dialog, with a title, description, bounded scrolling, RTL, close control and Escape dismissal. `ResourcePage` uses it for form/show modes, including direct URLs. Closing returns to the resource list; the route-backed modal does not retain an underlying list or its filters. Clicking the backdrop does not discard the form. Custom resource overrides can use the same surface; the reference order form does. The explicit `presentation="page"` prop supports a user-requested alternative without changing server permissions or resource contracts. Lookup and organization controls in these forms compose shadcn Select.

Amendment (2.3.0): every long dialog, meaning one whose content can exceed the screen height, keeps its header (title and description) and its footer (actions) fixed while only the body scrolls, and that body shows its scrollbar at all times in light and dark themes. The registry's `long-dialog` (`LongDialogContent`) composes shadcn Dialog with the layout of `ResourceSurface`; the scrollbar uses CSS only (`overflow-y: scroll`, a stable gutter and theme-token colors), without a new scroll-area dependency. Platforms that force overlay scrollbars may still hide an idle thumb; the stable gutter keeps the scroll area recognisable there.

Amendment (2.3.0, owner's decision): a dialog asks before closing only when there are unsaved changes. An untouched form, or one whose values were typed and changed back, closes at once on Escape, the close button, «إلغاء» or a click outside, whatever the dialog's `mode`. A form that reports `data-dirty` decides for itself; a change in any control outside such a form marks the dialog as changed until it closes. The `confirmDialogClose` preference still turns the question off entirely.

This establishes agent defaults and updates the generic resource consumer. It does not silently rewrite unrelated project-owned legacy screens or mark the broader phase 2 visual, performance or release gates complete.

Verification covers installed skill integrity and repair, company identity preservation, a packed independent consumer, and browser CRUD, nested controls, direct detail URLs, mobile bounds, keyboard focus, dismissal and the explicit page presentation. See the dated implementation-status entry for executed checks.

Reference: [shadcn Dialog composition](https://ui.shadcn.com/docs/components/radix/dialog).
