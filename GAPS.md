# AdulaJS gaps

Open capability gaps for people building systems with AdulaJS, as of 2.1.0. What exists is
in [docs/implementation-status.md](docs/implementation-status.md); what changed is in
[CHANGELOG.md](CHANGELOG.md). Report a new gap with the issue form in `.github/ISSUE_TEMPLATE`.

## Resource definition

* The resource definition is not the single source of truth: `adula:resource` scaffolds
  the Vine validator, Lucid model and migration once, and after that each is maintained by
  hand alongside `defineResource`.
* 13 field types only. Missing: decimal, percent, phone, e-mail, URL, multi-select,
  many-to-many, composite unique constraints and declared default values.
* `customFields: true` creates a `custom_fields` JSONB column that nothing reads or writes.

## Lists and data

* List filters are equality only (plus search and tags); range, `in` and condition filters
  exist in `aggregate()` but not in lists.
* CSV export runs in the browser and contains only the rows already loaded.
* No bulk actions on selected rows.
* No dashboards or charts, although `ResourceService.aggregate()` and its HTTP endpoint
  provide grouped counts and sums.
* Soft delete has no restore (undelete) operation or screen.

## Notifications, printing and files

* Notification channels are in-app, e-mail and one signed HTTP provider for SMS or
  WhatsApp (a company gateway in front of its vendor); there is no push channel and no
  bundled vendor integration.
* One generic print layout serves every resource; there are no custom print templates.
* An attachment field holds one file; there is no in-page preview of attachments.

## Workflows

* SLA deadlines count wall-clock hours: there is no business calendar (working days,
  holidays), and an overdue step escalates once (no escalation chain).
* Delegation covers workflow approvals only (not manual tasks), one hop, by UTC date:
  there is no system time-zone setting to interpret the dates locally.
* `WorkflowDefinition.machine` and the `xstate` dependency remain until the next major
  version (ADR 044).

## Security and integration

* Two-factor authentication has had no written human ASVS review yet (ADR 027).
* Two-factor uses TOTP only: there are no WebAuthn/FIDO2 keys, no QR renderer (manual
  entry and the `otpauth://` link only) and no e-mail notice on two-factor changes.
* SSO covers OAuth/OIDC sign-in through GitHub, Google and Microsoft Entra ID; there is
  no SAML and no SCIM provisioning.
* The generated API client is TypeScript only; other languages use `/api/v1/openapi.json`.
* XLSX import is pending the owner's approval of a parser; the `ImportAdapter`
  registration point is ready and CSV import works (docs/integration.md).

## Language and documentation

* Arabic is the base language; other languages are optional (docs/languages.md).
  English is bundled for the framework's own strings; the administration pages,
  record assignments, workflows, collaboration and CSV import are not in the catalog yet.
* No documentation site and no complete `defineResource` reference.
