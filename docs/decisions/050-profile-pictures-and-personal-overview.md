# ADR 050 — Profile pictures and the personal overview

Date: 2026-11-05. Status: proposed; the points marked «owner» need the owner's
confirmation. Issues #158 and #159.

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
  * it rewrites the container. A PNG keeps only IHDR, PLTE, tRNS, IDAT and IEND, so text,
    EXIF, ICC and time chunks are dropped. A WebP drops EXIF, XMP and ICCP and clears their
    VP8X flags. Bytes after the image end are discarded;
  * SVG, GIF, JPEG, HTML, polyglots and animations are refused.
* **Writers.** The user, through `POST/DELETE /account/avatar`. Administrators
  (`manage all`, the `admin` middleware), through `POST/DELETE /admin/users/:id/avatar`.
  Anyone else gets 403. An administrator acting as the user cannot change it, because the
  picture outlives the session. Every change is logged (`avatar_updated`,
  `avatar_removed`): under `users` for the user's own changes, under `core.users` for an
  administrator's.
* **Replacing and removing (owner).** The previous picture's row and file are deleted:
  a personal photo should not outlive its removal. A soft-deleted row whose file was
  removed would make `backup:create` fail (ADR 023). This departs from ADR 047's
  «file kept» rule for field attachments. The choice is one constant
  (`REMOVED_PICTURES` in `core/user_avatars.ts`); `'keep'` soft-deletes and keeps the file
  instead.
* **Readers (owner).** Every signed-in user may read every user's picture at
  `GET /users/:id/avatar`, because pictures appear beside names on shared records,
  comments and pickers across organization units. Guests are refused. A user without a
  picture answers 404, and the interface shows initials.
* **Response.** The stored, allow-listed type only (`image/png` or `image/webp`),
  `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none';
  sandbox`, `Content-Disposition: inline`, `Cross-Origin-Resource-Policy: same-origin`,
  an ETag of the version. The cache policy is `private, max-age=300`, or
  `private, max-age=31536000, immutable` for a URL with the current `?v=`. Only the shared
  `account` prop and the admin user page carry the versioned URL; other places derive
  `/users/:id/avatar` from the user id, so core payload types stay unchanged.
* **Interface.** The copied `user-avatar` component (Radix Avatar) shows the picture with
  the initials while it loads and when there is none. The record components (comments,
  mentions, assignments, activity, user pickers) and the account menu use it. Workflow
  history carries no actor id yet and still shows names only.

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

### No new dependencies (owner)

Neither `sharp` nor a drag-and-drop library is added.
* **The cost of `sharp`.** Decoding and re-encoding with it would also neutralize payload
  bytes hidden inside the compressed pixel data (IDAT, VP8 data), and would add an exact
  pixel limit. But it puts a native binary in every created system, plus `allowBuilds`
  and platform prebuilds.
* **The residual risk.** Such payload bytes remain in stored pictures. They cannot run: the
  file is served only as an image with `nosniff` and a sandboxing CSP, and browsers decode
  images in their sandboxed image decoders.
* **Drag and drop.** The `sortable-list` component implements it with pointer events and
  the keyboard.

## Consequences

* New copied components: `user-avatar`, `slider`, `sortable-list`. `resource-dashboard`
  exports `DashboardWidgetCard`. Systems re-copy the record components to show pictures.
* New public API: `UserAvatars`, `avatarUrl`, `avatarHeaders`, `sanitizeAvatarImage`,
  `AVATAR_LIMITS` and the types `AvatarRecord`, `RemovedAvatarFile`, `AvatarImage`;
  `Dashboards.overview` and the types `OverviewBuiltin`, `OverviewLayout`,
  `OverviewState`, `OverviewWidget`; the optional `overview` on
  `DashboardWidgetDefinition`.
* A backup taken just before a replacement and finished after its commit can miss the
  deleted old file, as with attachment removal today.
