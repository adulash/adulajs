# Disposable medical-assets consumer

This is a reproducible AdulaJS acceptance fixture, not a customer application. The
owner explicitly waived company identity for this temporary test. No domain or
navigation item is added to the reference application's normal operation.

After the full build and release/consumer checks, build/pack the creator and run:

```sh
pnpm --filter create-adulajs pack --pack-destination ../../.work
pnpm check:release --artifacts=.work
pnpm test:medical
```

The runner requires PostgreSQL 17 credentials in `TEST_DATABASE_URL` (a `*_test`
maintenance database) or the existing private `.work/test-database.json`. Redis
settings come from the environment with TEST_DATABASE_URL, otherwise the reference
`.env.test`. Also provide pg_dump, pg_restore and GNU tar on PATH, and the existing
Playwright Chromium installation. Dependencies are the approved creator packages.

It creates a fresh application and Git repository under `.work/medical-<timestamp>/app`,
separate source/test/restore databases, local uploads and cache/queue namespaces.
It installs core/UI archives, uses adula:resource for scaffolds, embeds immutable
initial schema snapshots, fills the generated HTTP contracts and adds transaction
tests. It installs copied UI through the creator's adula:ui flow. A larger default
button height and a resource index override exercise project ownership; no brand
is invented. Those files are hashed before validation and checked afterward.

The application tests cover real PostgreSQL authorization and field contracts.
The runner creates 100000 synthetic assets distributed across ten organizational
units (half in one unit), ten categories, fifty locations and fifty distinct users.
It records raw cached actor-plus-Ability timings and verifies real cache invalidation.
Real browser login creates a bound attachment, checks bytes and scope denials, and
captures desktop/mobile views. It stops the server, snapshots, restores into a new
database and a separate empty upload root, reconciles queues/cache, then repeats HTTP
download and denial assertions against the restored application.

Set `K6_BINARY` to an installed, verified k6 executable to also run the configured
50-user/3-minute workload. k6 is run locally with usage reporting disabled. A latency
threshold failure is retained in state and exits 99 after the independent restore
exercise. Functional workload failures stop the run immediately. This is a local development-mode
measurement, not staging performance acceptance.

The runner writes progress to `.work/medical-latest.json` and per-run `state.json`.
Use `pnpm test:medical --resume=<absolute run directory>` to skip completed stages.
A partially failed creation/seed requires diagnosis or a fresh run; the runner never
empties a populated target or silently resets a database. Logs and the credential-bearing
performance fixture remain private under ignored `.work`/`tmp`; do not commit them.

The generated application is disposable. It is retained for inspection after the run;
no cleanup or database deletion happens automatically. Publish only sanitized result
summaries and artifact hashes. Local installation/restore does not prove a genuine
published minor-version upgrade, staging, natural scheduling or human visual approval.
