# adula

Resource framework for AdonisJS 7 and PostgreSQL 17, version 2.1.0 (AdulaJS since 2.0.0, ADR 039; 1.0 scope accepted by the owner, ADR 028). Node 24 or later is required. MIT licensed. The public API in `api/adula-api.json` follows semantic versioning.

## Install into a consumer

Follow the canonical [installation guide](https://github.com/adulash/adulajs/blob/main/docs/installation.md). For a new system, the separate `create-adulajs` initializer (`npm create adulajs my-system`) installs the AdonisJS host and system screens from an empty directory. For an existing official AdonisJS 7 React/PostgreSQL application, install the core/UI archives and documented UI prerequisites, configure AdulaJS, migrate and create the intended administrator before `node ace adula:install`. The Ace command completes initialization inside that host. No educational customers/orders/tasks modules are installed by either path.

The managed rules require the bundled `.agents/skills/adula-frontend-design/SKILL.md` for UI work. It is tailored to business workflows, asks for missing company identity at project kickoff, and uses project-owned shadcn components with modal forms and record details by default. User-requested presentation exceptions remain supported. Company identity belongs in `docs/design-identity.md`, which installation never overwrites. Doctor verifies the design skill along with the idea-review skill.

## Contracts

`defineResource` declares fields, forms, serialization, actions and scope. `ResourceRegistry` validates module ownership and dependencies. `ResourceService` applies CASL and organizational scope to JSON operations, serialization, editor options and atomic inline reconciliation. Money is a canonical string of integer minor units within PostgreSQL bigint range; calendar dates are YYYY-MM-DD; timestamps are canonical UTC ISO strings with milliseconds. Versioned updates require the current version and stale writes return 409.

Use `buildAbility(rules, registry.all())` for schema-aware money conditions. The SQL adapter rejects ordered money predicates without schemas. Browser code may import the same matcher through `adula/auth`. Organizational restrictions remain a separate AND condition.

Other exports include `ActorStore`, schema helpers, organizational moves, settings, sequences, notifications, jobs/outbox interfaces, packed rules and the generic controller factory. Commands include `adula:resource`, `adula:install`, `adula:doctor`, `adula:module:add`, `adula:module:remove`, `adula:ui add` and `adula:capabilities`.

The optional `adula/mcp` entry exports `createResourceTools`. Install @jrmc/adonis-mcp 2.0.0 and supply an authenticated actor resolver. Cookie-authenticated MCP routes must keep CSRF protection enabled. Tool inputs cannot supply identity or organizational scope.

## Generated HTTP contracts

Generated tests call the copied `resourceContract(name, fixture)` helper. Extend the application-owned fixture whenever fields or validation change. Supply `input` and a valid `update`, plus `expected` and `updated` values after normalization. Every form field needs an input fixture; every written scalar needs a storage expectation. Use `stored`/`updatedStored` for writable fields excluded from the response, and `inline`/`updatedInline` for the complete live child rows in ID order. Dates use YYYY-MM-DD, timestamps canonical UTC strings, and money integer-minor-unit strings in expectations. Fixture callbacks receive `userId`, `orgUnitId` and a unique suffix for creating real related records.

The harness creates database-backed roles and organization memberships, checks existing-record isolation across reads and writes, central-resource visibility, serialization, mapped storage, forbidden fields, stale versions, unique constraints and soft deletion. It refuses non-test databases. Configuration preserves existing copied helpers: consumers with the old one-argument helper must review and merge the new template before generating tests that use fixtures.

Doctor measures the deployment's `storage/uploads` directory and warns above 5 decimal GB. When copied UI hashes or AdulaJS compatibility change, it inventories project pages for review. This conservative check does not prove import compatibility, completed page review or attachment restoration.

## Current limitations

Phases 3 and 4 (collaboration, assignments, templates and realtime notifications,
CSV import, printing, webhooks, API tokens/OpenAPI, amend-by-copy and versioned
XState workflows) are implemented with PostgreSQL tests; see the
[business features guide](https://github.com/adulash/adulajs/blob/main/docs/business-features.md).

- Two-factor authentication is not included; it is planned for 2.0 (ADR 027).
- Impersonation was reviewed by automated adversarial and black-box tests only; its
  human security review is deferred to 2.0 (ADR 027).
- XLSX import is not available (GAP-006); CSV is.

See [implementation status](https://github.com/adulash/adulajs/blob/main/docs/implementation-status.md) and [gaps](https://github.com/adulash/adulajs/blob/main/GAPS.md).
