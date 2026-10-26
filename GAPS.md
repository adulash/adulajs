# AdulaJS gaps

Open capability gaps for people building systems with AdulaJS, as of 2.1.0. What exists is
in [docs/implementation-status.md](docs/implementation-status.md); what changed is in
[CHANGELOG.md](CHANGELOG.md). Report a new gap with the issue form in `.github/ISSUE_TEMPLATE`.

## Resource definition

* CSV import does not map multi-select or many-to-many fields; role rule conditions and
  aggregate filters refuse them; inline child rows and related rows are read without their
  many-to-many links.
* Inline child rows do not edit many-to-many links: the inline form omits a child's
  manyToMany fields and an inline payload's values for them are ignored, so the links are
  kept; edit the child record itself to change them.
* `adula:resource:migration` never changes a column type and does not update the search
  vector: those changes need a hand-written expand/contract migration.

## Lists and data

* List filters are equality only (plus search and tags); range, `in` and condition filters
  exist in `aggregate()` but not in lists.
* CSV export runs in the browser and contains only the rows already loaded.
* No bulk actions on selected rows.
* No dashboards or charts, although `ResourceService.aggregate()` and its HTTP endpoint
  provide grouped counts and sums.
* Soft delete has no restore (undelete) operation or screen.

## Notifications, printing and files

* Notification channels are in-app and e-mail only (no SMS, WhatsApp or push).
* One generic print layout serves every resource; there are no custom print templates.
* An attachment field holds one file; there is no in-page preview of attachments.

## Workflows

* No delegation of approvals and no SLA deadlines or escalation.

## Security and integration

* Two-factor authentication has had no written human ASVS review yet (ADR 027).
* Two-factor uses TOTP only: there are no WebAuthn/FIDO2 keys, no QR renderer (manual
  entry and the `otpauth://` link only) and no e-mail notice on two-factor changes.
* SSO covers OAuth/OIDC sign-in through GitHub, Google and Microsoft Entra ID; there is
  no SAML and no SCIM provisioning.
* No generated, typed API client: the Tuyau registry is used for URLs, but the generic
  resource endpoints return untyped responses.
* XLSX import is pending a maintained parser; CSV import works.

## Language and documentation

* Arabic is the base language; other languages are optional (docs/languages.md).
  English is bundled for the framework's own strings; the administration pages,
  record assignments, workflows, collaboration and CSV import are not in the catalog yet.
* No documentation site.
