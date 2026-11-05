# ADR 051 — Encrypted downloadable and cloud backups

Date: 2026-11-05. Status: proposed for 2.3.0 (#160). Real Google Drive and OneDrive delivery
is **unverified**: every test uses local fakes of their HTTP APIs, and ADR 021 does not let a
provider be claimed as working until the owner's OAuth clients have completed a real
connection and upload.

## Context

Backups were operator-only: `deploy/backup.sh` runs `backup:create` daily into `/backups`
and S3 (ADR 004, ADR 023). The owner asked for an administrator to save a backup to their own
machine, Google Drive or OneDrive. A backup holds every record, attachment and password hash,
so it must never leave the server unencrypted, every action must need the strongest
administration permission and be audited, and no plaintext copy may remain in a public or
temporary path.

## Decision

### Archive format

* One `.adulabackup` file per backup (`src/backups/archive.ts`): a 48-byte header (magic
  `ADULABK\0`, version, algorithm, chunk size, key id, random salt), then AES-256-GCM frames of
  at most 1 MiB. The file key is HKDF-SHA256 of the master key with the file's salt, so nonces
  (a frame counter) never repeat across files. The header, the counter and a final-frame flag
  are authenticated with every frame: changed bytes, reordered or dropped frames, truncation
  and appended data are all detected. A key id names a wrong key clearly.
* The plaintext inside is a small length-prefixed container of the fixed snapshot files
  (`database.dump`, `uploads.tar.gz`, `attachments.json`, `SHA256SUMS`, `COMPLETE`). Other
  names, duplicates, links and special files are refused; no system `tar` runs on decrypted
  data. Only node:crypto is used; no dependency is added.
* The master key is a dedicated deployment variable `BACKUP_ENCRYPTION_KEY` (base64 of 32
  random bytes), not APP_KEY: the owner can keep it offline and give it to whoever restores,
  and it stays independent from session and cookie secrets. **Losing it makes every archive
  unreadable**; the page, `adula:doctor` and docs/operations.md say so.
* `backup:seal --snapshot --file` and `backup:open --file --snapshot` convert between a
  snapshot directory and an archive. Recovery stays operator-driven: download, `backup:open`,
  `backup:verify-snapshot`, then the existing restore path. There is no restore from inside
  the application.

### Destinations and runs

* Destinations: download (kept 24 hours, then deleted), Google Drive with scope `drive.file`
  (only files the application created, in a folder «AdulaJS backups») and OneDrive with
  `Files.ReadWrite.AppFolder offline_access` (only the application's own folder). OAuth uses
  the authorization code flow with PKCE S256 and a 32-byte state kept in the server-side
  session, single-use, bound to the provider and the administrator, valid 10 minutes.
* Client ids and secrets come only from the deployment: `BACKUP_GOOGLE_CLIENT_ID/SECRET`,
  `BACKUP_MICROSOFT_CLIENT_ID/SECRET` and optional `BACKUP_MICROSOFT_TENANT` (default
  `common`). They are separate from the sign-in clients of ADR 042: the scopes, consent screen
  and redirect URIs differ, a personal OneDrive needs a multi-tenant client, and a leaked
  sign-in secret must not grant file writes. A destination is offered only when both values
  are present; `adula:doctor` reports absent ones as not configured.
* Refresh tokens are sealed with the application's SecretBox (APP_KEY encryption, like webhook
  and channel secrets), re-sealed when the provider rotates them, never logged and never sent
  to the browser. Disconnecting revokes the token at Google (OneDrive has no revocation
  endpoint) and deletes it.
* Runs live in `backup_runs` (migration `1770000000054_cloud_backups`, with
  `backup_connections`). The worker runs one backup at a time in the whole system: it creates
  the snapshot under `storage/backups/work-*` (0700; attachments are staged there through
  `createSnapshot(dir, {workDirectory})`, not in `os.tmpdir()`), seals it into
  `storage/backups/files`, and removes the plaintext in `finally`. Uploads are resumable,
  chunked and verified by size (and SHA-256 on Drive); the local archive is then deleted.
  The runner refuses a directory inside the system temporary directory or a `public` path.
* Scheduling is per destination (off, daily at 02:00 UTC, weekly on Friday 02:00 UTC). The
  scheduler queues due runs every 15 minutes under the administrator who connected the
  destination; if that user is disabled or no longer holds `manage all`, the period records one
  failed run asking for reconnection. Sync jobs (`defineSyncJob`) were not used: they have one
  static cron per job, while backup frequency is per destination and set from the page.
* Errors are stored as a category and a fixed Arabic text, never the raw message (pg_dump
  output or provider bodies could name hosts or users).

### Authorization and audit

* Seven routes under `/admin/backups` in the admin group (authentication, `manage all` and the
  administrators' two-factor rule). Each handler checks again that the user is an enabled
  administrator with `manage all`, and refuses while impersonation is active.
* `logActivity` resource `core.backups`: `connected`, `connect_failed`, `disconnected`,
  `scheduled`, `queued`, `succeeded`, `failed` and `downloaded`, with kind, trigger, size,
  SHA-256 and the error category; never tokens, codes or URLs.

### Relation to the offsite backup

A download or cloud upload is a second, administrator-driven copy. It does **not** count as
the ADR 023 offsite snapshot, does not set `backup.lastOffsite` and does not relax the
production `BACKUP_S3_*` requirement. There is no remote retention: the application never
deletes files in Drive or OneDrive (ADR 023's no-deletion rule). A scheduled cloud run may
overlap the daily `backup:create`; both read a consistent PostgreSQL snapshot, so the overlap
costs load, not correctness.

## Consequences

* Deployments that want the feature add `BACKUP_ENCRYPTION_KEY`, optionally the OAuth
  clients with their redirect URIs `<APP_URL>/admin/backups/oauth/google/callback` and
  `<APP_URL>/admin/backups/oauth/onedrive/callback`, and a private `backup_files` volume
  shared by web and worker. A Google consent screen left in "testing" mode expires refresh
  tokens after 7 days.
* Archives need about twice the database and attachment size in `storage/backups` while a
  run is in progress.
