# Operations

Running a system in production with the Docker deployment in `apps/reference`
(`Dockerfile`, `docker-compose.prod.yml`, `Makefile`, `deploy/`). The creator does not copy
these files into new systems; copy and adapt them. Commands below run from that directory. Local development
and tests are in [development](development.md); the first sign-in steps are in
[initial setup](initial-setup.md).

## Services

`docker-compose.prod.yml` runs `caddy`, `web`, `worker`, `scheduler`, `postgres` (17),
`redis` (7) and `backup`, with the volumes `uploads`, `backups`, `pgdata` and `redisdata`.
Only Caddy publishes a port. Keep credentials in the untracked `.env`;
`docker compose -f docker-compose.prod.yml config --quiet` validates it without printing
secrets. Add `docker-compose.pdf.yml` and set `GOTENBERG_URL=http://gotenberg:3000` for PDF
printing (plan for 8 GB hosts).

Mail settings saved in the «البريد» tab apply to `web`, `worker` and `scheduler` without a
restart. Set `MAIL_SETTINGS_SOURCE=environment` in `.env` to make the `SMTP_*` and
`MAIL_FROM_*` variables win instead; Compose passes it to the application services only
([integration](integration.md)).

Serve the system over HTTPS with HTTP/2; the bundled Caddy does. Each browser shares one
realtime stream across its tabs, but a proxy in front must not downgrade to HTTP/1.1.

On Windows, Docker may live only inside a WSL distribution: run
`wsl -d Ubuntu -- docker compose version` before concluding it is missing, and run Compose
from the `/mnt/c/...` path. Check free space on the Windows drive as well as inside WSL
before building; never remove application volumes to fix a full build cache.

## First deployment and upgrades

`make setup` builds, migrates, starts and waits for health on an empty database. Then sign
up the first account in the browser and run, passing that account's email:

```sh
docker compose -f docker-compose.prod.yml run --rm -e ADULA_ADMIN_EMAIL=you@example.com web node ace.js adula:install
```

Take one backup and one restore test (below). From then on `make doctor` passes, and
`make deploy` upgrades: pull, build, doctor, backup, migrate, start, wait for health.

## Checks

```sh
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs --tail 50 web worker scheduler
make doctor
```

`deploy/watchdog.sh` restarts an unhealthy `web`, `worker` or `scheduler`; run it from the
host's cron. A staging copy uses the same files under its own Compose project name,
volumes and `BACKUP_S3_PREFIX`. Stop with `stop`, restart with `up -d`; use
`down --volumes` only to discard that environment's data.

## Operational commands

The `adula` package ships the operational Ace commands (registered through
`adula/commands` in `adonisrc.ts`): `adula:outbox`, `adula:runtime:health`,
`adula:uploads:prune`, `adula:restore:reconcile`, `backup:create`, `backup:verify`,
`backup:verify-snapshot`, `backup:restore-files` and `backup:restore-test`. They use the
system's own `#start/env`, `#start/modules` and `app/services` (`events`, `upload_pruning`,
`backup_snapshot`, `backup_publish`, `initial_setup`), so keep those files. `adula:worker`
lives in the system's `commands/` because it wires the system's own services.

## Backups

The `backup` service runs `deploy/backup.sh` daily. It calls `backup:create`, which writes
`/backups/<UTC timestamp>/` (database dump, attachments, checksums), uploads it offsite under
`<BACKUP_S3_PREFIX>/<timestamp>/` (default prefix `adula`), downloads and verifies every
object, and writes `COMPLETE` last. Fourteen complete local snapshots are kept. Give each
deployment sharing a bucket its own prefix.

The scheduler runs `backup:verify` hourly (a recent snapshot with `COMPLETE` and all
checksum objects under this prefix) and `backup:restore-test` monthly (restore into a
temporary database, open a record with its attachment, drop the database). Run either by
hand with `docker compose -f docker-compose.prod.yml run --rm web node ace.js <command>`.

## Encrypted downloads and cloud backups

Administrators can also create an encrypted backup from «النسخ الاحتياطي»
(`/admin/backups`): download it to their machine, or send it to Google Drive or OneDrive, now
or daily/weekly (ADR 051). This is an extra copy; it does not replace the offsite snapshot
above, and production still requires the `BACKUP_S3_*` variables.

Configuration (all optional; `node ace adula:doctor` reports what is missing):

* `BACKUP_ENCRYPTION_KEY`: base64 of 32 random bytes, for example
  `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. **Keep a copy
  outside the server. Without this key no archive can ever be opened**, and a new key does not
  open archives made with the old one.
* Google Drive: an OAuth client (type Web) in your Google Cloud project with the Drive API
  enabled, the `drive.file` scope on a published consent screen (a screen in "testing" mode
  expires the connection after 7 days), redirect URI
  `<APP_URL>/admin/backups/oauth/google/callback`, then `BACKUP_GOOGLE_CLIENT_ID` and
  `BACKUP_GOOGLE_CLIENT_SECRET`.
* OneDrive: a Microsoft Entra app registration with the delegated permissions
  `Files.ReadWrite.AppFolder` and `offline_access`, web redirect URI
  `<APP_URL>/admin/backups/oauth/onedrive/callback`, then `BACKUP_MICROSOFT_CLIENT_ID`,
  `BACKUP_MICROSOFT_CLIENT_SECRET` and optionally `BACKUP_MICROSOFT_TENANT` (`common` by
  default; `consumers` for personal accounts only, or your tenant id).
* The worker writes archives to `storage/backups` and the web container serves downloads from
  it, so both mount the private `backup_files` volume (docker-compose.prod.yml). Allow about
  twice the database and attachment size there while a backup runs.

To recover from an archive:

```sh
node ace backup:open --file=adulajs-backup-<stamp>.adulabackup --snapshot=/backups/<new directory>
node ace backup:verify-snapshot --snapshot=/backups/<new directory>
make restore FILE=/backups/<new directory>
```

`backup:open` needs the same `BACKUP_ENCRYPTION_KEY`. The opened directory is unencrypted:
delete it after the restore. `backup:seal --snapshot=<dir> --file=<new file>` encrypts an
existing snapshot the same way.

## Restore

```sh
make restore FILE=/backups/<UTC timestamp>
```

Run it only against the deployment the snapshot came from, with its original disk
configuration. It stops the application services, verifies the snapshot, restores the
database and attachment bytes (`backup:restore-files`), runs `adula:restore:reconcile`
and starts the services again. A failed restore leaves them stopped. After it finishes,
open a known record and download one of its attachments before announcing the system.

To move attachments between disks (filesystem and S3) use
`node ace adula:storage:migrate <from> <to>` (`--dry-run` first); it never deletes the
source.
