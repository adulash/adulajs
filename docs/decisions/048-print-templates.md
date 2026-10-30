# ADR 048 — Print templates per resource

Date: 2026-10-29. Status: proposed; the points marked «owner» need the owner's
confirmation.

## Context

GAPS.md said «One generic print layout serves every resource; there are no custom print
templates.» Businesses print invoices, delivery notes and receipts whose layout differs
from the record page. A print template is content written by an administrator and
rendered by a PDF service inside the deployment network, so it must not be able to run
script, fetch a URL or print a value the reader may not read. The generic print
(`renderPrintHtml`) already embeds the logo as a data URI and sets a
`default-src 'none'` CSP; message templates already use `{{name}}` placeholders.

## Decision

### Three kinds of template

* `default`: the existing generic layout, unchanged. It stays the implicit template of
  every resource and of `GET /resources/:resource/:id/print` without `?template`.
* **Code templates**: `printTemplates` on a resource definition (`PrintTemplate` type):
  `key`, `label`, `paper` (`A4` | `A5` | `Letter`), `orientation` (`portrait` |
  `landscape`), plain-text `header`/`footer` with placeholders, `fields`, `lines`
  (hasMany key → child columns) and `totals` (`{ label, field }` for a money/number
  field, or `{ label, lines, column }` summing a printed numeric line column).
  `defineResource` refuses unknown or line fields, a `default` key, duplicate keys and
  invalid paper; `ResourceRegistry.register` refuses unknown child columns and
  non-numeric totals. `describe()` lists code templates as `printTemplates` (only when a
  resource has some, so existing descriptions are unchanged).
* **Administrator templates**: stored per resource, edited in «قوالب الطباعة»
  (`/admin/print-templates`, behind the administrator middleware like message
  templates). A key cannot reuse a code key or `default`.

### Schema (additive migration `1770000000049_print_templates`)

* `print_templates`: `id`, `resource`, `key` (unique together), `label`,
  `current_version`, `active`, `created_by`, `updated_by`, `created_at`, `updated_at`.
* `print_template_versions`: `id`, `template_id`, `version` (unique per template, > 0),
  `label`, `body`, `paper`, `orientation`, `header`, `footer`, `created_by`, `created_at`.
  A trigger refuses UPDATE and DELETE (except clearing `created_by` when a user is
  deleted), so a recorded version always resolves to the markup that printed.
* «owner»: templates are deployment-wide, like `message_templates` and `settings`; there
  is no per-organization-unit template. A unit-specific layout is a separate key.

`PrintTemplates.create` inserts version 1 and refuses an existing key (409
`E_PRINT_TEMPLATE_EXISTS`); `update` needs an existing template (404), inserts version
`current_version + 1` in one transaction (the template row is locked) and keeps the stored
`active` flag when the input leaves it out. Deactivation is that flag; nothing is deleted.

### Template language

The shared tokenizer is `core/template_language.ts` (`parseTemplate`); message templates
keep `renderTemplate` and import the same `PLACEHOLDER` pattern. Grammar:

| Tag | Meaning |
| --- | --- |
| `{{field.key}}` | display value of a record field (lookup label, related title, grouped money…) |
| `{{row.key}}` | a line column, inside `{{#each}}` only |
| `{{id}} {{resource}} {{template}} {{company}} {{status}} {{printedBy}} {{printedAt}} {{rowNumber}}` | document values |
| `{{logo}}` | the already embedded data-URI logo (`printLogoHtml`), body only |
| `{{#if ref}}…{{else}}…{{/if}}` | `ref` is a field, row value, document value or `lines.group` (non-empty) |
| `{{#each lines.group}}…{{/each}}` | the readable lines of a hasMany field; not nested |
| `{{helper arg}}` | `date`, `money`, `number`, `digits` on a field/row value, `label "key"` / `label "group.column"`, `total lines.group.column` |

There are no expressions, no other paths, no partials and no raw output (`{{{` is
refused). Every interpolated value is HTML-escaped. Unknown names, helpers outside the
whitelist, `row.*` outside `each`, mismatched blocks and wrong helper arguments are 422
`E_PRINT_TEMPLATE` with an Arabic message when the template is saved or previewed. The
header and footer are text: no blocks, lines or logo, and their literal text is escaped.

`date` follows the `ui.preferences` calendar (Gregorian, Umm al-Qura, both). A new
optional `digits: 'latn' | 'arab'` preference (absent = `latn`, so stored values stay
valid) switches dates, amounts and numbers to Arabic-Indic digits with ٬ and ٫
separators; `digits` converts any other value.

### Sanitizer

`sanitizePrintHtml` is an in-house allowlist (no dependency), applied when a template is
saved (the stored body is the sanitized one) and again on every render:

* Tags: div, section, header, footer, p, span, strong, em, b, i, u, br, hr, h1–h4, table,
  thead, tbody, tfoot, tr, th, td, ul, ol, li, small. Script, style, iframe, object,
  embed, svg, math, template, form, textarea, media and similar tags are removed with
  their contents; other tags (a, img, link, meta, base, …) are removed, text kept.
* Attributes: `class` (word characters), `colspan`/`rowspan` (1–99), `dir`, and `style`
  reduced to allowlisted properties with plain values (lengths, keywords, hex,
  rgb()/hsl()). `url(`, `expression`, `@import`, `//`, `:` in values, comments, quotes,
  braces, backslashes and entities are refused. Any value with `&`, `\`, `{{` or `}}` is
  dropped, so neither entities nor template values reach an attribute.
* Comments, doctype and processing instructions are removed, stray `<` is escaped and
  closing tags are balanced.

The page keeps the CSP meta of the generic print, and `@page` carries the template's
paper size and orientation.

### Authorization and audit

Rendering reads the record only through `ResourceService.show`, `describe` and the new
`documentLines` as the printing actor; the variables are built from those results, and
`renderTemplateDocument` prints a value only when its field is in the reader's
description, whatever the record object holds. A field the actor cannot read is absent,
so `{{field.x}}` renders empty and code templates leave the row out; another unit's record
is the same 404 as the record page (preview included), and an unknown template on a
hidden record is also 404 (the record is authorized first).

* **Which line groups.** A print may read a hasMany field the record exposes
  (`serialize`, or `list` and `show`) or one that a code print template of the same
  resource declares in `lines`; both are decisions of the resource author
  (`printableGroups`). An administrator template may only name those groups (refused
  when saved). The orders fixture keeps `lines` out of its detail view and exposes them
  through its `invoice` code template. `documentLines` applies children()'s rules: the
  hasMany field's rules and level, the child's view permission and each line's
  organization scope.
* **No truncation.** `documentLines` reads up to `PRINT_LINE_LIMIT` (1000) lines per group;
  a longer document is 422 `E_PRINT_LINE_LIMIT` («عدد البنود يتجاوز حد الطباعة (1000 بند)»),
  so a table or a total is never silently cut. The generic print uses the same read.
* **Labels.** Relation values print the server's `_title` (the UI's relationLabel rule);
  inside `{{#each}}`, lookups and relations resolve from the line resource's own lookup
  labels and related rows.
* **Time and digits.** Date-times and the print time are shown in the application time zone
  (`timeZone` of config/adula, the workflows' zone); the digits preference also applies to
  `{{id}}`, `{{rowNumber}}`, `{{printedAt}}` and the «طُبع بواسطة» line.
* **Audit.** `recordPrinted` writes a `printed` activity on the record
  (`changes: { template, version, format }`); the version is the integer of an
  administrator template, `code:<sha256 prefix>` of a code template's declaration, or
  `generic`. The reference application calls it after the HTML is rendered or after the
  PDF conversion succeeded, so a failed conversion is not recorded. The record page's
  activity labels it «طباعة السجل بقالب».
* **Sanitizer cost.** A tag scan stops at the next `<` or `>`, and nesting deeper than 100
  is flattened, so sanitizing stays linear (tested under 200 ms on pathological input).

### Routes and UI

* `GET /resources/:resource/:id/print?template=<key>&format=pdf` (PDF through Gotenberg
  when `GOTENBERG_URL` is set; 501 otherwise, before any read).
* `GET /resources/:resource/print-templates` lists the templates the actor may use and
  whether PDF is configured; the record page's «طباعة» (registry component
  `record-print`) opens a Dialog to pick a template and a format.
* Administration: `GET/POST /admin/print-templates`, `GET/PUT
  /admin/print-templates/:resource/:key`, `GET …/versions`, `POST
  /admin/print-templates/preview` (renders the draft against `recordId` or the newest
  record the administrator may read; nothing is stored or audited). Forms and history
  open in Dialogs; the preview is a sandboxed `iframe srcdoc`.

## Consequences

* Additive: one migration, new exports (`PrintTemplates`,
  `renderTemplateDocument`, `printableGroups`, `PRINT_LINE_LIMIT`, `ResourceService.documentLines`, `sanitizePrintHtml`,
  `parseTemplate`, `createPrintTemplatesSchema`, types), an optional `printTemplates`
  key on resources and an optional `digits` preference.
* The reference orders fixture declares the `invoice` code template (ADR 017: fixtures
  stay out of the normal registry) and is used by the functional and browser tests.
* Not covered: a visual designer, per-unit templates, images other than the logo, and
  documents of more than 1000 lines per group; see GAPS.md.
