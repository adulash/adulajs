# Integration

A system built with AdulaJS rarely lives alone. The company already runs accounting,
payroll, a CRM or an SMS gateway, and the system has to exchange data with them. This
guide covers the five ways it does that:

| Need | Mechanism | Direction |
|---|---|---|
| Another program reads or writes records | [Resource API and the generated client](#resource-api-and-the-generated-client) | in |
| A spreadsheet or export from another system becomes records | [Imports](#imports) | in |
| The system pulls from or pushes to another system on a schedule | [Sync jobs](#sync-jobs) | both |
| People are told about events outside the application | [Notification channels](#notification-channels) | out |
| Another system reacts to events as they happen | [Webhooks](#webhooks) | both |

Every path writes through `ResourceService`, so validation, authorization, row
conditions, organisation scope, activity, the outbox and workflows apply exactly as
they do in the user interface. The design is recorded in
[ADR 043](decisions/043-integration-surface.md).

## Resource API and the generated client

### Authentication

Each user creates **personal API tokens** under the account menu (`/account/tokens`).
A token has an access level (read, or read-write) and an expiry date. Send it as
`Authorization: Bearer adula_…` to `/api/v1`. That API takes no cookies and needs no CSRF.

* Every call is authorized with the token owner's **current** roles, field rules, row
  conditions and organisation units. Revoking a role takes effect immediately.
* Read tokens are limited to `GET`.
* For a machine integration, create a dedicated user (for example «تكامل المحاسبة»).
  Give it only the roles it needs, and create its token while signed in as that user.
* Administrators can revoke all of a user's tokens from the user's admin page.

### Getting the client

The client is generated from the system's OpenAPI document, so its types match the
resources the system actually registers. It needs no npm package. It is one TypeScript
module that uses only the global `fetch` (Node 18+, browsers, Deno, Bun).

* **From a running system, per token.** `GET /api/v1/client.ts` returns the source.
  `GET /api/v1/client.d.ts` returns the types and the declared runtime signatures.
  Both are filtered for the token owner:
  * only resources the owner may view appear;
  * only operations the owner's roles allow become methods;
  * fields the owner can never read or write are left out of the types.

  ```bash
  curl -H "Authorization: Bearer $ADULA_TOKEN" https://erp.example.com/api/v1/client.ts -o adula-client.ts
  ```

* **From the source checkout.** `node ace adula:client` writes
  `clients/<system>/index.ts` and a README:
  * `--as-user=<id>` describes what that user may use; by default the whole registry is described;
  * `--url=<origin>` sets the default server (defaults to `APP_URL`);
  * `--output=<dir>` changes where the files are written.

  Re-run the command after resources change. The file is generated, so do not edit it.

`GET /api/v1/openapi.json` stays available for other languages and tools.

### Using it

```ts
import { createAdulaClient, AdulaApiError } from './adula-client.js'

const api = createAdulaClient({ baseUrl: 'https://erp.example.com', token: process.env.ADULA_TOKEN! })

const page = await api.resources.orders.list({
  limit: 50,
  sort: 'issuedAt',
  direction: 'desc',
  search: 'عقد',
  filters: { status: 'open' }, // equality filters on filterable fields, typed per field
})
const next = page.meta.nextCursor ? await api.resources.orders.list({ cursor: page.meta.nextCursor }) : null

const order = await api.resources.orders.create({ orgUnitId: 3, total: '1050', lines: [{ description: 'بند', quantity: 2 }] })
await api.resources.orders.update(order.id, { notes: 'مراجعة', version: order.version })
await api.resources.orders.submit(order.id, { version: 2 }) // only on submittable resources
const totals = await api.resources.orders.aggregate({ groupBy: ['status'], sum: 'total' })

try {
  await api.resources.orders.show(999999)
} catch (error) {
  if (error instanceof AdulaApiError) console.log(error.status, error.code, error.message) // 404 E_NOT_FOUND «…»
}
```

* Methods return the record itself, with `data` unwrapped. The exceptions are `list`
  (`{ data, meta }`), `aggregate` and `imports.template` (the CSV text).
* Value types:
  * money is a decimal string in minor units (`'1050'` = 10.50);
  * dates and datetimes are ISO strings;
  * an attachment is `{ id, name, size, mimeType }` when read, and an attachment id when written;
  * `docStatus` is `0 | 1 | 2`.
* The compiler catches these mistakes:
  * an unknown or hidden field;
  * a number where money is expected;
  * a sort or filter on a field that does not allow it;
  * `submit` on a resource that is not submittable;
  * a missing required field.
* `api.request(method, path, body?)` is the escape hatch for any other endpoint.
* The contract test `packages/adula/tests/api_client.spec.ts` compiles a sample consumer
  against generated types. It proves these mistakes are compile errors.

## Imports

### From the interface

Index pages show «استيراد CSV» to users who may create records. The steps are:

1. **Template.** «تنزيل قالب CSV» downloads one header row. It lists the fields the user
   may import, labelled in Arabic, with required columns marked ` *`. The file starts with
   a UTF-8 BOM so Excel shows Arabic correctly. Columns of a filled template map automatically.
2. **Upload and mapping.** Columns are matched to fields by key or Arabic label, and the
   user corrects the mapping.
3. **Mode.** Choose «إضافة فقط» or «إضافة أو تحديث» (upsert). Upsert matches existing
   records by one field. That field must be marked `unique` in the definition and mapped
   to a column, and upsert also needs the update permission. An empty cell in a matched
   row keeps the stored value.
4. **«تحقق دون حفظ» (dry run).** The worker runs every row through the real save, then
   rolls it back:
   * the run covers conversion, required fields, the validator, authorization, unique
     values (including repeats inside the file) and relations;
   * nothing is kept: no records, activity, events, sequence numbers or notifications;
   * the batch becomes «تم التحقق دون حفظ» with a per-row report: row, ok or error, the message,
     and whether the row would create or update.
5. **Import.** «بدء الاستيراد» imports the same batch for real. The worker saves each row
   with the importer's permissions. `/imports` shows progress, the created, updated and
   failed counts, and row errors. A notification arrives when the import finishes.

### From the API

```ts
const header = await api.imports.template('customers') // GET /api/v1/resources/customers/imports/template
const batch = await api.imports.create('customers', {
  fileName: 'customers.csv',
  content: csvText, // or base64 with encoding: 'base64' for binary formats
  mode: 'upsert',
  matchField: 'code',
  dryRun: true,
})
await api.imports.start(batch.id, { mapping: { '0': 'code', '1': 'name' } })
const status = await api.imports.show(batch.id) // status: mapping | queued | running | validated | done | failed
```

The routes are listed below. `POST` needs a read-write token.

* `POST /api/v1/resources/:resource/imports`
* `POST /api/v1/imports/:id/start`
* `GET /api/v1/imports`
* `GET /api/v1/imports/:id`
* `GET /api/v1/resources/:resource/imports/template`

Each file has the same limits as in the interface: 5 MB, 100 columns and 5,000 rows.

### File formats

Each format is an `ImportAdapter`:

```ts
interface ImportAdapter {
  name: string // the API's `format` value
  extensions: string[]
  mimeTypes?: string[]
  binary?: boolean
  detect(file: ImportFile): boolean
  parse(file: ImportFile): Promise<{ headers: string[]; rows: string[][] }>
}
```

* **Built in.** CSV (`csvImportAdapter`) is the only built-in format.
* **Registering another format.** Pass `new ImportBatches(…, { adapters: [adapter] })` or
  call `imports.registerAdapter(adapter)` in `app/services/adula.ts`. The upload screen
  then accepts the adapter's extensions.
* **How a file finds its adapter.** A named `format` wins. Otherwise the file extension
  decides, then `detect()`.
* **XLSX.** No XLSX parser is bundled yet: one needs the owner's approval (see
  [GAPS](../GAPS.md)). Once a parser is approved, an XLSX adapter is a single file
  registered this way.

## Sync jobs

A sync job is code that exchanges data with another system on a schedule. For example,
it can pull new customers from the CRM every 15 minutes. Its definition looks like this:

```ts
// start/sync_jobs.ts
import { defineSyncJob } from 'adula'

export const syncJobDefinitions = [
  defineSyncJob({
    name: 'sync:crm-customers', // prefix sync:, then kebab-case
    label: { ar: 'سحب عملاء نظام المبيعات' },
    cron: '*/15 * * * *', // minute hour day month weekday, server time
    timeoutMs: 120_000, // default 5 minutes, at most 6 hours
    async handler(ctx) {
      const since = ctx.lastSuccessAt // Date | null: pull only what changed
      const rows = await fetchCrmCustomers(since, { signal: ctx.signal })
      for (const row of rows)
        await ctx.systemSave('customers', { code: row.id, name: row.name }, { actorId: integrationUserId })
      ctx.logger.info('pulled customers', { count: rows.length })
      return { pulled: rows.length } // optional numeric stats kept with the run
    },
  }),
]
```

### How a run works

* The scheduler process only **queues** runs. The worker (`node ace adula:worker`) runs
  them one at a time, in a lane of its own, so a slow job never delays events,
  workflows, imports or webhooks.
* A job never has two runs queued or running at once.
* The handler gets this context:
  * `jobName` and `runId`;
  * `trigger`: `schedule` or `manual`;
  * `requestedBy`, the user who pressed «تشغيل الآن»;
  * `lastSuccessAt`;
  * `signal`, which is aborted at the timeout; pass it to `fetch`;
  * a tagged `logger`;
  * `systemSave`, which is `ResourceService.systemSave`.
* A scheduled run that creates records must pass `actorId`, the author. Use a dedicated
  integration user.
* At the timeout the handler's `signal` is aborted, and `systemSave` and `logger`
  refuse further calls. The run stays «running» until the handler returns, so a second
  run of the same job cannot start in the meantime. A handler that never returns, or a
  run whose worker crashed, is marked failed with the category `timeout` one minute
  after its time limit.

### History and errors

Every run is kept in `sync_job_runs`: status, trigger, duration, stats, an error
category and a short message. Credentials and tokens are removed from the message before
it is stored.

The error categories are:

* `timeout`;
* `validation`;
* `authorization`;
* `conflict`;
* `handler`;
* the outbound categories (`dns`, `connect`, `tls`, `blocked-target`, `http-status:<n>`).

A handler can name its own category: `throw new SyncJobError('http-status:503', '…')`.

### Admin screen

`/admin/jobs` has a «مهام المزامنة» section. For each job it shows the cron expression,
the last run, the last success, the last error category and the next run. It also has
«تشغيل الآن», which queues a manual run and records it in the activity log, and «السجل»,
which shows the run history.

The routes are:

* `POST /admin/jobs/sync/:name/run` returns 409 while a run is queued or running;
* `GET /admin/jobs/sync/:name/runs`.

## Notification channels

A notification is always stored in the application (the bell, the realtime stream). The
worker then delivers it through each channel the recipient has enabled:

| Channel | Key | Default | Delivers |
|---|---|---|---|
| In the application | `in_app` | always on, cannot be turned off | every notification |
| E-mail | `mail` | on | templates whose mail flag is on |
| Text message or WhatsApp | `sms` / `whatsapp` | off until the user enters a phone number | the same notifications as e-mail |

* **User preferences.** Each user chooses channels under «قنوات الإشعارات» on the
  profile page (`PUT /account/notification-channels`). Turning a channel off keeps the
  phone number. An administrator who is impersonating the user cannot change these
  preferences. Every change is logged without the number.
* **Retries.** E-mail keeps its three attempts. Other channels retry after 1, 5, 30 and
  120 minutes, then give up. Only an error category is stored.

### Text-message provider

AdulaJS ships no SMS or WhatsApp vendor SDK. It posts each message to a provider URL.
That URL is usually a small gateway the company runs in front of its vendor.

Configure the provider under «قناة الرسائل النصية» in `/admin/settings`: kind (sms or
whatsapp), URL, and enabled. «إرسال رسالة تجريبية» sends a test message.

The provider secret works like a webhook secret:

* it is generated on the first save and shown **once**;
* it is sealed with `APP_KEY`;
* it is never returned again or written to the activity log;
* «تدوير السر» rotates it.

The settings key is `channels.http`, and the generic settings editor cannot read or change it.

The URL must use HTTPS and carry no credentials, query string or fragment; the receiver
authenticates requests by their signature. Requests go through the guarded outbound
client. Private and loopback addresses are refused unless `WEBHOOKS_ALLOW_PRIVATE=true`.
Each worker leases the deliveries it sends, so two workers never send the same message. Each request looks like this:

```
POST <provider URL>
Content-Type: application/json
X-Adula-Channel: sms
X-Adula-Delivery: 3f1c…            (the same on every retry; deduplicate on it)
X-Adula-Timestamp: 1760780000
X-Adula-Signature: sha256=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>

{"id":"3f1c…","channel":"sms","to":"+966500000001","subject":"مهمة جديدة مسندة إليك",
 "text":"مراجعة — الطلبات #7","link":"https://erp.example.com/resources/orders/7","timestamp":"1760780000"}
```

The receiver must:

* verify the signature over the raw body, comparing in constant time;
* reject old timestamps;
* deduplicate on `id`.

The provider's reply is handled like this:

* any 2xx response means the message was sent;
* anything else is retried;
* response bodies are never read.

### Adding a channel in code

A channel implements `NotificationChannel`, defined in `core/notification_channels.ts`:

```ts
{ key, label, delivery: 'always' | 'template' | 'opt-in', address?(value), deliver(message, recipient, ctx), drain? }
```

Register it in `app/services/notification_channels.ts`.

## Webhooks

* **Outgoing webhooks** (`/admin/webhooks`): an HTTPS endpoint subscribes to record
  events (`<module>.<resource>.created`, `…updated`, `…submitted` and so on). Each
  delivery has these properties:
  * it is signed with HMAC-SHA256 over `<timestamp>.<body>`;
  * it is retried with backoff;
  * it is pinned to the validated address.

  The payload is the event envelope, without record fields. The receiver reads the
  record through the API with its own token.
* **Inbound webhooks** (`POST /webhooks/in/:source`): another system posts signed events.
  Each one is verified, deduplicated and handed to the module's handler. See
  [ADR 037](decisions/037-signed-inbound-webhooks.md).

Details are in [Business features](business-features.md#outgoing-webhooks).
