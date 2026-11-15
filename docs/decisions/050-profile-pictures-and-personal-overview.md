# ADR 050 — Profile pictures and the personal overview

Date: 2026-11-05. Status: accepted; the owner decided the points marked «owner» on
2026-11-05. Issues #158 and #159.

## Context

Users appeared everywhere as a name or two initials. The owner asked for a profile picture
that each user manages on the account page, administrators on the user page, shown beside
the user's name in the account menu, comments, mentions, assignments, activity and user
pickers. A picture is a file a user uploads, so it is untrusted input that every other user
then loads.

The home page was a static list of links. The owner asked that each user choose and order
what the overview shows, saved per user, and that a widget the user may not see never
appears. ADR 046 dashboards already compute widgets as the viewer; ADR 049 adds per-user
preferences.

## Decision

### Profile pictures

* **Storage.** A picture is one row of the core `attachments` table bound to the owner
  `resource = 'core_users'`, `field = 'avatar'`, `record_id = <user id>`, written to the
  deployment's Drive disk (local or S3) at a server-chosen key
  `avatars/<user id>/<uuid>.<png|webp>`. No migration: `core_users` is not a registered
  resource, so `/attachments/:id` answers 404 for it. Unbound-upload pruning skips it
  because it is bound. Backups, restore drills and `adula:storage:migrate` carry it like
  every other bound file. The monthly restore drill now picks its sample record among
  registered resources only.
* **Upload.** The browser crops and re-encodes the picture on a canvas to a square of at
  most 512 pixels (WebP where the browser encodes it, else PNG). The server trusts none of
  that:
  * the body parser checks the type by the file's first bytes;
  * `sanitizeAvatarImage` accepts only PNG and still WebP of at most 1 MB and 32–512 pixels
    per side, read from the container header, so a decompression bomb is refused before
    anything is stored;
  * it validates the PNG header fields, chunk order and CRCs, and the WebP RIFF size and
    frame/canvas agreement;
  * SVG, GIF, JPEG, HTML, polyglots and animations are refused;
  * only then does `prepareAvatarImage` decode the still frame with `sharp` (libvips)
    within a pixel budget (`limitInputPixels` of 512 × 512, `animated: false`,
    `failOn: 'error'`, one page) and re-encode it to the same format. The re-encoded file
    carries no metadata and none of the original compressed bytes, so a payload hidden
    inside the pixel data does not survive. A PNG that would exceed 1 MB is saved as WebP;
  * the result passes the same checks again before it is stored.

  `sanitizeAvatarImage` stays as the pre-check: it bounds what reaches the native decoder
  and gives exact Arabic errors. It also rewrites the container without ancillary chunks,
  and the re-encoded output is checked with it.
* **Writers.** The user, through `POST/DELETE /account/avatar`. Administrators
  (`manage all`, the `admin` middleware), through `POST/DELETE /admin/users/:id/avatar`.
  Anyone else gets 403. An administrator acting as the user cannot change it, because the
  picture outlives the session. Every change is logged (`avatar_updated`,
  `avatar_removed`): under `users` for the user's own changes, under `core.users` for an
  administrator's.
* **Replacing and removing (owner: approved).** The previous picture's row and file are deleted:
  a personal photo should not outlive its removal. A soft-deleted row whose file was
  removed would make `backup:create` fail (ADR 023). This departs from ADR 047's
  «file kept» rule for field attachments; the owner approved it as an exception for
  profile pictures only, and ADR 047 notes it. The choice is one constant
  (`REMOVED_PICTURES` in `core/user_avatars.ts`); `'keep'` soft-deletes and keeps the file
  instead.
* **Readers (owner: approved).** Every signed-in, active user may read every user's picture at
  `GET /users/:id/avatar`, because pictures appear beside names on shared records,
  comments and pickers across organization units. Guests are refused. A user without a
  picture answers 404, and the interface shows initials.
* **Response.** The stored, allow-listed type only (`image/png` or `image/webp`),
  `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none';
  sandbox`, `Content-Disposition: inline`, `Cross-Origin-Resource-Policy: same-origin`,
  an ETag of the version. The cache policy is `private, max-age=300`, or
  `private, max-age=31536000, immutable` for a URL with the current `?v=`.
* **Payloads (amended in 2.3.0).** Every payload that resolves a person's name also carries
  that person's picture URL: the versioned `avatarUrl(id, version)`, or `null` when they
  have none, so the page shows initials and requests nothing (no 404 per user without a
  picture). The version comes from the query that reads the name, through
  `avatarVersionColumn` (a scalar subquery served by the `attachments (resource, record_id,
  field)` index), so a list of people costs no query per row; `avatarUrlFor` turns it into the
  URL. This supersedes the earlier rule that core payload types stay unchanged. The additions
  are optional, output-only fields: `UserSummary.avatarUrl`, `Assignment.assigneeAvatarUrl`
  and `assignedByAvatarUrl`, `WorkflowDelegation.delegatorAvatarUrl` and
  `delegateAvatarUrl`, delegation candidates' `avatarUrl`, `CommentEntry.authorAvatarUrl`,
  `FieldChangeEntry.actorId` and `actorAvatarUrl`, workflow history `actorId` and
  `actorAvatarUrl`, record activity `actorAvatarUrl`, user field options and related user
  rows `avatarUrl`. The reference application adds `avatarUrl` to administrative sessions
  and `actorAvatarUrl` to the activity log. Without a `v` (an older payload) the component
  still falls back to `/users/:id/avatar`.
* **Interface.** The copied `user-avatar` component (Radix Avatar) shows the picture with
  the initials (on `bg-muted`, «؟» without a name, no per-user colours) while it loads and
  when there is none. It sits beside a visible name and is hidden from assistive
  technology (`labelled` off, empty `alt`); one picture per cell, never a stack, and several
  people stay comma-separated names. Sizes: `xs` (20px) beside names in rows and cells,
  `sm` (28px) for a list's main identity column and picker triggers, `md` (36px) for the
  header and account trigger, `lg` (64px) for the profile and the admin user page. It
  appears in user fields (record details and list cells), the admin users table, sessions
  and activity log, the delegation table and picker, workflow history, «مهامي» («أسندها» or
  «طلبها»), the record change log, comments, mentions, assignments and user pickers. Names
  inside sentences, «النظام», the impersonation bar and screens without a person keep
  names only.

### Personal overview

* `/` is the personal overview for signed-in users and the start page for guests.
* Widgets are code-defined:
  * the starter's built-ins: `core.welcome`, `core.tasks`, `core.notifications`,
    `core.modules`;
  * every ADR 046 dashboard widget marked `overview: true`, as
    `dashboard.<name>.<key>`.
* `Dashboards.overview(actor, saved, builtins)` lists only the dashboard widgets the actor
  may read, using the same check as the dashboard pages.
* It arranges them by the saved layout:
  * unknown or no longer readable ids are dropped;
  * new widgets join in default order;
  * hidden widgets stay listed for the dialog but are not computed.

  A stored id therefore never shows a widget or its number.
* The arrangement is the per-user preference `overview.layout` (ADR 049), `{ order,
  hidden }`. Its validator checks only the shape: at most 100 ids per list, each id
  matching `/^[a-zA-Z][a-zA-Z0-9_.-]{0,99}$/`. Authorization happens on every read.
* The «تخصيص» Dialog lists the visible widgets with a show/hide switch, a drag handle, a
  keyboard sortable and move buttons. In the keyboard sortable, Space picks a widget up,
  the arrows, Home and End move it, Space drops it and Escape cancels the move without
  closing the Dialog, with every step announced in Arabic. The Dialog also offers
  «استعادة الافتراضي».
* This arranges code-defined widgets; it is not a dashboard editor (GAPS.md).

### Dependencies (owner)

The owner chose `sharp` (exact pin `0.35.5` in `packages/adula`, recorded in
adulajs-plan.md) so that every picture is decoded and re-encoded, not only checked.
* **Why.** Checking and rewriting the container alone keeps the original compressed pixel
  bytes, so a payload hidden there would remain in the stored file.
* **Cost.** `sharp` ships platform binaries (`@img/sharp-*`, optional dependencies chosen
  by pnpm for the platform, Linux included in the lockfile) and an install check that
  pnpm runs only for names in `allowBuilds`. `sharp: true` is added there: the root
  `pnpm-workspace.yaml`, which created systems copy, and the consumer test workspace.
  The module is imported only when a picture is uploaded.

No drag-and-drop library is added: the `sortable-list` component implements it with
pointer events and the keyboard.

## Consequences

* New copied components: `user-avatar`, `slider`, `sortable-list`. `resource-dashboard`
  exports `DashboardWidgetCard`. Systems re-copy the record components to show pictures.
* 2.3.0 adds `avatarVersionColumn` and `avatarUrlFor` and the optional picture fields above
  (additive, minor); `resource-value` and `data-table` now depend on `user-avatar`, and
  `resource-value` exports `relatedUser`.
* New public API: `UserAvatars`, `avatarUrl`, `avatarHeaders`, `prepareAvatarImage`,
  `AVATAR_LIMITS` and the types `AvatarRecord`, `RemovedAvatarFile`, `AvatarImage`;
  `Dashboards.overview` and the types `OverviewBuiltin`, `OverviewLayout`,
  `OverviewState`, `OverviewWidget`; the optional `overview` on
  `DashboardWidgetDefinition`.
* A backup taken just before a replacement and finished after its commit can miss the
  deleted old file, as with attachment removal today.
