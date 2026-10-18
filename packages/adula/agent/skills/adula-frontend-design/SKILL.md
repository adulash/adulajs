---
name: adula-frontend-design
description: Design business application interfaces for AdulaJS using project-owned shadcn/ui components, Arabic RTL layouts, practical data density, and modal forms and record details. Apply whenever creating or changing an operational page, form, table, dialog, or dashboard in an AdulaJS application.
---

# Frontend design for AdulaJS

This is AdulaJS's self-contained frontend-design skill. Read it before UI work; it does not require a globally installed skill or a particular agent vendor.

## Request company identity on day one

At project kickoff, before the first visual design, inspect the user's brief, existing assets, theme and `docs/design-identity.md`. If the company identity has not been supplied, ask for it early in one concise Arabic request. For example:

> لتطبيق هوية شركتكم من أول واجهة، زوّدني باسم الشركة وشعارها وألوانها وخطوطها المعتمدة ودليل الهوية إن وُجد. وإن لم تكن لديكم هوية جاهزة، أخبرني بذلك لنحدد اتجاهًا مناسبًا لنظام الأعمال.

Use the normal conversation when requesting logo files or a brand guide; a text-only input tool cannot receive attachments. Ask only for missing items when some identity is already known. Do not request information or approval already supplied. If the user explicitly delegates brand creation or says there is no identity, propose a restrained business direction within that authorization.

Record supplied identity in project-owned `docs/design-identity.md`: company/product names, local asset paths or supplied source links, color tokens, Arabic and Latin fonts if specified, logo usage, source of each decision and unresolved items. This is application content, not an AdulaJS-managed file; installation and upgrades must preserve it. Do not claim that a proposed or inferred choice came from the company's official guidelines.

Apply known identity from the first interface through theme tokens, typography, logo placement and naming. Adapt inaccessible color combinations through readable pairings while retaining the brand's role and noting the decision. Do not distort logos or fetch unrelated branding. If a reply or assets are pending, continue independent work; use the existing theme or a clearly provisional neutral theme for unavoidable previews. Elapsed time is not brand approval. Incorporate supplied identity once it arrives.

## Design within the application

Understand the user's task, the important action and the information hierarchy. Inspect the existing theme and nearby screens before choosing typography, density, spacing and emphasis. Build a deliberate, cohesive interface using the application's tokens and Arabic typography. Prefer a restrained business interface with clear states and useful whitespace; avoid generic dashboard decoration and invented metrics. Honor a supplied design direction.

## Business application priorities

Optimize for repeated daily work: finding a record, understanding its status, entering accurate data and completing an authorized action. Use familiar layouts consistently across applications. A marketing landing page, experimental typography, oversized hero section or ornamental animation is not the default for an operational screen.

- Tables: prioritize identifiers, meaningful names, status, dates and amounts. Align numeric values consistently, use tabular numerals, preserve searchable/filterable columns, and keep row actions predictable. Prefer useful density with readable spacing; do not replace comparable rows with decorative cards. Show totals or KPIs only when backed by actual data.
- Forms: group related fields, order them according to the business workflow, expose required fields and format hints, distinguish editable and read-only values, and place validation beside the affected field. Use sensible existing defaults, clear save/cancel actions and visible saving/success/conflict feedback. Keep inline document items within the parent transaction.
- Details: lead with the record identifier and current status, followed by the business facts, permitted next actions, related items and audit history when available. Do not expose hidden fields or use color as the only status indicator.
- Appearance: reuse the application's typography and design tokens, quiet surfaces, clear borders and a restrained accent for the primary action. Reserve warning/destructive colors for their actual meaning. Avoid gradients, decorative motion, arbitrary font changes and excess whitespace that slows scanning unless the user specifically requests them.
- Arabic and accessibility: use RTL logical spacing and Arabic labels, keep identifiers and numeric/date inputs legible with appropriate direction, maintain keyboard order and visible focus, and keep controls usable on mobile. Long forms scroll inside their Dialog rather than switching presentation automatically.
- Operational states: provide specific Arabic loading, empty, no-results, permission-denied, validation and recoverable-error states. Distinguish an empty dataset from a failed request; never invent sample success data in a live screen.

If a general frontend-design skill is also available, apply its craft within these business constraints. Do not follow its more experimental visual suggestions when they conflict with consistency, usability or the user's workflow.

## Compose shadcn components

Use the copied shadcn/ui primitives in `inertia/components/ui/`: Button, Input, Textarea, Select, Checkbox, Switch, Table, Card, Dialog, Alert and related components. Compose them; do not recreate controls with styled native HTML, a custom modal overlay or an unrelated component library. Semantic elements such as main, section, headings, dl and form remain appropriate for structure and submission. Hidden inputs remain appropriate for metadata.

Install missing registry components with `node ace adula:ui add <component>`. Never run `shadcn add` directly or modify installed AdulaJS internals. Preserve application-owned component customizations; preview updates and merge deliberate changes.

## Modal is the default

Every form and every row/record detail view opens in a shadcn Dialog unless the user explicitly requests another presentation. This includes create/edit forms and custom page overrides. Do not infer a page or Sheet exception from screen size, form length or personal design preference.

For resource routes, use `ResourcePage`, which selects the modal surface by default. For a custom form/detail override, wrap its content in `ResourceSurface` with a title, description and the list's `backHref`. It keeps direct URLs usable and returns to the list when dismissed. From a list, open records with `openRecord(resource, id, 'show' | 'edit')` (exported by `resource-surface`): the dialog opens over the mounted list, and closing keeps its query, loaded rows and scroll. Use `presentation="page"` only for a user-requested page exception. Keep embedded line-item fields within their parent's form, not separate nested forms. Search and filter controls may stay in the list toolbar; their form element is submission structure, not a separate record form.

Give every Dialog a visible DialogTitle and a useful DialogDescription. Keep long content scrollable within the viewport, Arabic RTL alignment, an accessible close control, focus containment and Escape dismissal. Use shadcn components inside the modal too. Keep validation and conflict messages inside it, preserve typed values on errors, and keep unauthorized actions absent. Do not replace server authorization with UI checks.

Use `mode="view"` for details and `mode="edit"` for custom forms. Details close on outside click; editors ask for confirmation on outside click, close or Escape by default and preserve input when the user continues editing. Respect `ui.preferences` rather than rebuilding dismissal logic. Confirm permission changes and destructive actions with distinct labels, and display server rejection/success feedback. Administrative access protection must remain enforced on the server.

Honor the system calendar preference: Gregorian, Umm al-Qura Hijri, or both. Reuse FieldControl/ResourceValue and the shared formatter; never store formatted Hijri text in a date column. Both mode shows two representations of one date and allows either input calendar. Keep transitions short, preserve the workspace shell and honor reduced motion. Installation terminal instructions are English for terminal compatibility; the application remains Arabic.

## Verify the experience

Exercise opening, filling, validation, saving, viewing details and closing. Check direct links, nested selects/popovers, keyboard focus and Escape, and a narrow mobile viewport. Test the explicit page exception when adding one. Use realistic Arabic content, inspect the rendered result, and run the project's required checks. Report which behavior was actually verified without claiming the broader visual or release acceptance gate is complete.
