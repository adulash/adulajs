# ADR 043 — Integration surface: generated client, import adapters, sync jobs, notification channels

Date: 2026-10-18. Status: accepted for implementation under the owner's post-review plan
(Phase 4, integration).

## Context

The owner's central goal is one system per company that integrates with the company's
existing software through the API, webhooks and imports. Four gaps remained:

* No typed client existed. Tuyau types the application's routes, but the generic resource
  endpoints return `unknown`.
* Imports read only CSV and could only create records.
* There was no supported way to run scheduled exchanges with other systems.
* Notifications reached users only in the application and by e-mail.

The authorized dependency list (adulajs-plan.md) adds no package for any of these here.

## Decision

* **Client from OpenAPI, not Tuyau.** `apiClientSource(document)` generates one
  self-contained TypeScript module from the existing `openApiDocument`. The module holds
  the per-resource types and a `fetch` runtime.
  * The running system serves it per token at `GET /api/v1/client.ts`, together with
    `client.d.ts`.
  * `node ace adula:client` writes it under `clients/`.
  * Because it comes from the actor-filtered document, a downloaded client describes only
    what that token may use. The OpenAPI document gained `operationId`s, the real list
    filters, sort enums, amend, the imports endpoints, and actor-level omission of fields
    the caller can never read or write.
  * Tuyau stays for the application's own route URLs.
  * A contract test compiles a consumer against the generated types.
* **Import adapters.** `ImportAdapter { detect, parse → rows }` separates file formats from
  the pipeline. CSV is the built-in adapter. Other formats register through `ImportBatches`
  options or `registerImportAdapter`.
  * No XLSX parser is added. The owner must approve one first; the candidates are listed in
    the integration report.
  * **Upsert by a unique field** requires the update permission and goes through
    `ResourceService` with the importer's scope.
  * **Dry run** saves every row in a transaction that is rolled back, so a check is exactly
    the real path and leaves no records, events, sequence numbers or notifications.
  * **Templates** are header rows in Arabic, filtered to the fields the actor may import.
* **Sync jobs as queued runs.** `defineSyncJob({ name: 'sync:…', cron, handler })`
  declares a job.
  * The single scheduler process only inserts a queued row into `sync_job_runs`. The worker
    claims queued rows with `SKIP LOCKED` and runs the handler with a typed context
    (`systemSave`, `logger`, `signal`, `lastSuccessAt`). One path therefore serves scheduled
    runs and «تشغيل الآن».
  * A partial unique index allows only one queued or running run per job.
  * A stale running row is failed as `timeout`.
  * Errors are stored as categories plus a sanitized short message.
  * Cron parsing is a small in-house subset compatible with adonisjs-scheduler, so no
    package is added.
  * The framework ships no sync job of its own. Its only consumer is the pair of
    test-only fixture jobs in `apps/reference/tests/fixtures/sync_jobs.ts`
    (`sync:fixture-customers`, `sync:fixture-failing`). They load only when
    `testFixturesEnabled` (ADR 017). In development and in systems made by
    create-adulajs, `start/sync_jobs.ts` is empty until the system adds its own jobs.
* **Notification channels.** Delivery goes through a `NotificationChannel` interface.
  * In-app and e-mail are implementations. `deliverNotificationMail` keeps its signature
    and its `mail_state` queue.
  * Per-user preferences live in `user_notification_channels`. Opt-in channel deliveries
    live in `notification_deliveries`, queued by `notifyWithTemplate` in the caller's
    transaction.
  * The third channel (SMS or WhatsApp) is a vendor-neutral signed HTTP POST:
    * it is sent through the Phase 1 guarded outbound client (`createOutboundPoster`);
    * it uses the webhook signature scheme;
    * its secret is sealed in `channels.http` like webhook secrets and shown once.
  * The opt-in channel receives the same notifications as e-mail (templates whose mail
    flag is on).
* **Migrations** are all additive:
  * 1770000000041 import modes;
  * 1770000000042 sync jobs;
  * 1770000000043 notification channels;
  * 1770000000044 phone-number confirmation codes;
  * 1770000000045 import worker leases.
* **Phone numbers are confirmed.** An opt-in channel is enabled only after the user
  enters a one-time code sent to the number, and the code and change routes are
  throttled. This keeps a user from sending the company's paid messages to numbers they
  do not hold.

## Consequences

* The public API gains exports only. `pnpm check:api` reports additions, so the next
  version is minor. `ImportBatch`/`ImportStatus` stay as they were; `ImportBatches` now
  returns `ImportBatchRecord`, which widens them.
* An XLSX adapter can be added once the owner approves a parser. The integration report
  names the candidates: read-excel-file for read-only use, exceljs if export is also
  wanted.
* A company needs a small gateway in front of its SMS or WhatsApp vendor, which verifies
  the documented signature. AdulaJS carries no vendor SDK.
* Scheduled jobs that create records need an author (`actorId`), usually a dedicated
  integration user.
* A timed-out run is capped at `timeoutMs` plus the stale margin (60 seconds by default),
  so a handler that never settles cannot block its job for ever. The abort signal is the
  cancellation contract, and writes and logging are refused after it. Within one worker
  process, the job's next run is held back until the abandoned handler settles, so runs
  of one job never overlap in a single worker.
