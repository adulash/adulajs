# Source development

Use Node 24 or newer, pnpm 11.19.0, PostgreSQL 17 and Redis 7. Measured runtime versions and test totals are in [implementation status](implementation-status.md).

```sh
pnpm install --frozen-lockfile
pnpm --filter adula build
pnpm --filter @adula/ui build
```

The reference application's `inertia/components/ui` and `ui.lock.json` are generated from `packages/ui/registry` and not tracked. On a fresh clone, run `pnpm build` or `node scripts/ui-registry.mjs reference` before filtered reference commands (`pnpm --filter @adula/reference …`) and `pnpm lint`. The root `build`, `dev`, `typecheck` and `test` scripts regenerate them.

Copy `apps/reference/.env.example` into local `.env` and `.env.test` files. Generate separate APP_KEY values with `node ace generate:key`, set database/Redis connections, and use `DRIVE_DISK=local` unless a real S3 disk is configured. Tests require a dedicated database ending in `_test`; set `TEST_DATABASE_URL` for core tests. Never commit credentials.

On the original Windows workstation, `pwsh -File scripts/local-postgres.ps1` and `node scripts/setup-local.mjs` provision the isolated loopback PostgreSQL profile on port 55432. Run Redis separately with `wsl -d Ubuntu --exec sh scripts/local-redis.sh` (port 16379), then run:

```sh
pnpm --filter @adula/reference exec node ace migration:run
pnpm dev
```

Set `ADULA_ADMIN_EMAIL` and run `pnpm --filter @adula/reference exec node ace adula:install`; when that account does not exist and no administrator does, it is created and its one-time password is printed on the terminal. If you registered that account yourself first, its password is replaced (printed once) and its sessions and tokens end unless you pass `--keep-password`. Open `http://127.0.0.1:3333` and sign in. With `SIGNUP_ENABLED` unset, self-signup closes (404) once an administrator exists; set it to `true` to keep it open locally. Local `adula:seed` can create an administrator with random credentials saved to ignored `tmp/dev-admin.txt`; normal mode creates no educational business records. Signup itself grants no roles or organizational access.

Run the worker with `pnpm --filter @adula/reference exec node ace adula:worker` and exactly one scheduler with `pnpm --filter @adula/reference exec node ace scheduler:run`.

## Verification

```sh
pnpm --filter @adula/reference exec playwright install chromium --only-shell
pnpm build
pnpm typecheck
pnpm test
pnpm lint
pnpm check:boundaries
pnpm test:release
pnpm test:consumer
pnpm test:create
pnpm check:release --artifacts=.work
```

On Windows, put Git's `usr/bin` on PATH for GNU tar; Windows' BSD tar does not support the restore drill's `--force-local`. Set `PLAYWRIGHT_BROWSERS_PATH` when using `.work/playwright`. Linux CI installs Chromium with system dependencies.

Authorization tests use real PostgreSQL. Core tests recreate their isolated `adula_test` schema; reference tests truncate their dedicated test database. Never use business data. Customers/orders/tasks and their migrations/listeners/pages load only under `NODE_ENV=test` with a `_test` database. Their removal from the normal application does not drop local tables.

After the fixture-path relocation, use a fresh dedicated test database if an older test database already recorded the original migration paths. Do not rename production migration history or reset a development database. Build the reference application before the tests: fixture isolation also inspects its production frontend manifest.

## Independent consumer

`pnpm test:create` additionally packs all three packages and invokes the creator's installed npm executable, with no pre-existing application and a minimal PATH that excludes global pnpm. It verifies fresh databases, company identity, managed skills/UI, administrator authorization, HTTP tests, lint/types/build and actual browser login. The local profile uses existing PostgreSQL/Redis. Run `pnpm test:create --docker` on a Docker-capable host to verify default service provisioning; CI runs both paths and stops the created containers afterward. No tests or source links are substituted into the created application's authentication path.

`pnpm test:consumer` packs both packages, creates a fresh official React starter under `.work`, and verifies HTTP contracts, repeated configuration/install, customization protection, module archival, doctor, types and production assets.

Supply `ADULA_STARTER_PATH` or checkout `adonisjs/starter-kits` revision `7e1c7930ec260ea38c3eb394eb192e05c12d3f7b` into `.work/starter-kits-main`. Database credentials come from `TEST_DATABASE_URL` or ignored `.work/test-database.json`. The harness creates its own `adula_consumer_<timestamp>_test` database and overrides inherited database variables.

`pnpm test:upgrade:synthetic` is a local compatibility rehearsal with a synthetic baseline, not proof of a genuine published minor-version upgrade. The genuine upgrade is `pnpm test:upgrade --published=<version>`, which installs that published version first; CI runs it. `pnpm test:upgrade` refuses ambiguous use, and synthetic mode rejects `ADULA_PREVIOUS_VERSION`. See [releasing](releasing.md).

CI builds/packs the creator once and uses `test:create --reuse-packages` for both service modes, retaining the exact core/UI archives exercised by `test:consumer`. This flag skips only rebuilding/repacking; it still creates and verifies a fresh independent application.

`pnpm test:medical` builds a disposable independent acceptance consumer from those local archives. It tests four generated resources, project-owned UI, real PostgreSQL authorization, a 100000-row dataset, cached Ability timing and bound-attachment recovery into separate storage. Set `K6_BINARY` for the local 50-user load run. See [fixture requirements and resume instructions](../tests/medical-consumer/README.md). This is a test application with no company-brand requirement; it does not add medical or educational resources to the reference menu. Local recovery is not published-version upgrade or staging acceptance.

## Explicit source-S3 acceptance

`pnpm test:s3 --credentials-file=<local-env-file>` runs an external acceptance exercise using the existing AWS source-file and offsite-backup settings from that file. The normal test suite never contacts S3. Keep credentials untracked; the harness selects only `AWS_*`, `S3_BUCKET` and `BACKUP_S3_*` connection settings and never changes the consumer's configuration or business database.

The harness requires the reference `.env.test` Redis profile, a PostgreSQL 17 `*_test` maintenance connection (`TEST_DATABASE_URL` or `.work/test-database.json`), and `pg_dump`, `pg_restore` and `tar` on PATH. It creates two new `adula_s3_<timestamp>_{source,restored}_test` databases, uses Redis test database 14 and an available loopback HTTP port, and loads the existing educational resources only in test mode.

It uploads three synthetic attachments through the application's HTTP route, checks ownership/scope/field restrictions, moves them from S3 to a filesystem disk and back, and downloads the snapshot's file bytes from S3. A database dump, object archive, manifest, checksums and final completion marker are uploaded to a unique `adula/acceptance-tests/source-s3/<uuid>/` backup prefix and downloaded again. The source objects are then deleted and their absence verified. The downloaded snapshot restores a separate database and the original test object keys; a fresh application process verifies the restored record bindings, exact HTTP download hashes and access denials.

Source test objects and both temporary databases are removed at the end. The small synthetic offsite snapshot is retained as evidence: the backup IAM policy intentionally grants no delete permission. Local reports and child logs remain under `.work/s3-acceptance-<timestamp>/`. No broad bucket enumeration, cleanup or IAM changes are performed.

The harness now invokes the shipped backup:create, backup:restore-test and backup:restore-files commands. It also proves a missing source object cannot produce COMPLETE, and the monthly drill never writes original keys. Container, actual scheduling and staging execution remain separate acceptance gates.

## Operations

The daily `deploy/backup.sh` invokes `node ace.js backup:create --snapshot=/backups/<UTC timestamp>`. New snapshots contain `database.dump`, `uploads.tar.gz` (ID-addressed bytes from every attachment disk), `attachments.json`, `SHA256SUMS` and `COMPLETE`. Never create or upload the marker manually: the command publishes it only after downloading and hashing every remote artifact. Missing source objects stop the backup. Existing complete prefixes and local snapshot directories cannot be overwritten.

Source credentials require read access for backups and write/read/delete access under `.adula-restore-tests/` for the monthly drill. Disaster recovery requires writing original attachment keys. Offsite credentials require PutObject/GetObject and permissions needed for absence checks; DeleteObject is not required. The monthly drill restores an isolated database and temporary disk keys, then removes both. It does not change original keys or active application records.

For recovery from offsite storage, download the complete snapshot prefix into the backups volume, including its manifest, checksums and marker. Run `make restore FILE=/backups/<UTC timestamp>` with the original disk configuration. This stops traffic, verifies snapshot integrity, restores the database, restores and reads back every original attachment key, and reconciles queue/cache state before restarting services. A failure leaves services stopped; inspect the error before retrying. `backup:restore-files --snapshot=<directory> --apply` is the explicit file-only recovery command after the database has been restored. Do not use it against a running application or a different database snapshot. Legacy archives lack a manifest and remain local-only.

Docker Compose services, backups and restores are described in [operations](operations.md). Caddy/TLS, `make deploy`, natural scheduled execution and staging supervision remain pending. Production requires database sessions and real `BACKUP_S3_*` configuration. `backup:verify` checks objects; `backup:restore-test` separately restores a record and attachment. See [gaps](../GAPS.md).
