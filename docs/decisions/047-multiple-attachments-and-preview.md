# ADR 047 — Multiple attachments per field and file preview

Date: 2026-10-29. Status: proposed (Wave 3 of the post-review programme); the points
marked «owner» need the owner's confirmation.

## Context

GAPS.md listed two file gaps: an attachment field holds one file, and a file can only be
downloaded, never looked at in the page. Business records often carry several documents
(an order's quotation, invoice and delivery note) and users want to check a scanned
receipt without saving it first. Single attachments (ADR 045 field types, the upload
grants of 1.1, Drive disks and `adula:storage:migrate`) already decide ownership in the
`attachments` table: every row names its uploader, resource, record, field and unit.

## Decision

### Field definition

```ts
documents: {
  type: 'attachment',
  multiple: true, // several files
  max: 3, // 1 to 100, default MULTIPLE_ATTACHMENT_LIMIT (10)
  accept: ['pdf', 'png', 'jpg'], // per file, as for one file
  maxSize: '5mb', // per file
}
```

`defineResource` refuses `max` without `multiple`, a `max` outside 1–100, and `sortable`,
`searchable` or `unique` (alone or in a unique combination) on a multiple field.
`required` means at least one file.

### Storage and values

A multiple field is one `jsonb` column on the record holding the ordered, distinct
attachment ids; the array order is the display order. It has no foreign key: the
`attachments` row stays the authority on which record and field own a file, exactly as
for one file, so no core table and no core migration are needed (migration number
1770000000047 stays unused). Switching an existing field between one file and several
changes the column type (integer ↔ jsonb); the schema diff reports it as a type mismatch
and never changes it automatically.

The write value is the array of ids (numbers or digit strings), distinct and at most
`max`; a duplicate, too many files or an invalid value is 422 with an Arabic message.
Reads return the summaries in stored order and drop ids whose row is gone.

### Writes

Every id added to the array is claimed through `claimAttachment` (only its uploader, only
for this resource and field, an upload authorized by a grant only for the granted record,
the record's unit for scoped resources). When a scoped record moves to another unit, the
files it already holds follow it: each row is locked, checked to be bound to this record
and field, and moved to the new unit without the uploader check, so a record whose files
came from several colleagues can still be moved (single attachments use the same path).
A newly added id still needs the full claim. A removed id is released (the row is soft-deleted and the file kept
for restore drills, as for one file). Reordering only rewrites the column. The record
audit carries the before and after id arrays. Copies skip attachments as before; pruning
removes each never-bound upload separately.

### Download and preview

`GET /attachments/:id` authorizes a file of a multiple field like one file: the reader
must be able to show the record (role rules, organization scope, field permission) and
the field's value must contain the id; otherwise 404.

`GET /attachments/:id?preview=1` is the same route and the same authorization. The core
helper `attachmentHeaders(file, { preview })` decides the response:

* Inline only for an allow-list where the extension and the stored content type agree:
  png, jpg/jpeg, gif, webp (image), pdf and txt (`text/plain; charset=utf-8`). The
  response carries the listed type, never the uploader's.
* SVG, HTML and every other type are always sent with `Content-Disposition: attachment`,
  even with `preview=1`.
* Every response has `X-Content-Type-Options: nosniff`, `Cache-Control: private,
  no-store` and a CSP starting with `default-src 'none'`. Images and text are also
  `sandbox`ed. Downloads forbid framing; inline previews may be framed by this origin only
  (`frame-ancestors 'self'`, `X-Frame-Options: SAMEORIGIN`).
* PDFs are not sandboxed because browsers refuse to show a sandboxed PDF; their CSP still
  allows no page script (`default-src 'none'; object-src 'self'`). «owner»: accept this,
  or turn PDF previews off and download PDFs.

`AttachmentSummary.preview` (`'image' | 'pdf' | 'text' | null`) tells the interface which
files can open in the preview Dialog: an `<img>`, a same-origin `<iframe>` for PDF, or the
text fetched and shown in `<pre>` (never rendered as markup). Every other file shows a
download link only.

### Interface

The generated form control uploads several files at once with per-file progress, moves a
file up or down, removes one, previews one and checks `max` before uploading. Record
details list the files with a preview button; list cells and the print layout show the
names. Export joins the file names with «، ». Import still refuses attachment columns,
now with a message telling the user to upload the files from the record page.

## Consequences

* `AttachmentSummary` gains the required `preview` key, so `pnpm check:api` reports the
  summary, `Field`, `ResourceEditor` and `createResourceController` as changed. Readers
  are unaffected; a consumer that deep-compares summaries must add the key. «owner»: the
  coordinator decides whether the release is minor or major.
* A multiple field can be filtered only by "has files" / "no files"; it cannot be sorted,
  searched, grouped, totalled or used as a workflow or role condition.
* The consumer is the `order_documents` fixture resource (ADR 017: fixtures only), which
  accepts svg and html on purpose so tests prove they never render inline.

## Alternatives considered

* A join table per field (like manyToMany): a second source of truth next to the
  `attachments` rows, which already record the binding, and an extra migration per field.
* A separate preview route: two authorization paths to keep identical; one route with a
  flag cannot drift.
* Rendering SVG with a sandbox CSP: browsers differ on scripts inside SVG documents and
  the business value is low, so SVG only downloads.
