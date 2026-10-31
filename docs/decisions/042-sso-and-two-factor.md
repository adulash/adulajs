# ADR 042 — SSO providers and two-factor authentication

Date: 2026-10-18. Status: accepted for implementation under the owner's post-review
hardening plan. It amends the 2FA deferral in ADR 027. The human review that rule 11
requires is still pending.

## Context

ADR 027 removed two-factor authentication from 1.0 (commit f7c68b6 was reverted). It
was to return in 2.x together with a written human ASVS review. Business systems also
need sign-in through the company directory. In practice that directory is usually
Microsoft Entra ID, and `@adonisjs/ally` 6.3 ships no driver for it.

## Decision

* **TOTP primitive in the core.** The primitive is the core class `TwoFactor` (RFC 6238
  through `otpauth`). Its state lives in the new additive migration
  `1770000000020_two_factor`; the reverted `1770000000009` name is not reused. The
  reference application wires the flow and every created system inherits it.
* **Improvements over f7c68b6:**
  * recovery codes have more than 80 bits each, a per-code salt and one row per code
    with atomic single use;
  * code attempts follow the Phase 1 lockout rules, plus an account-wide ceiling;
  * one `completeSignIn` path serves both password and OAuth sign-in;
  * administrators can reset a user's two-factor, which revokes the user's sessions and
    API tokens;
  * administrators must enrol by default (`auth.twoFactorRequiredForAdministrators`).
* **No QR dependency.** No QR library is added without the owner's approval. Enrolment
  uses manual entry and the `otpauth://` link, and `enrolmentQr()` is the extension
  point for an image.
* **Entra ID through a custom driver.** Entra ID uses a custom driver on ally's
  `Oauth2Driver`, with PKCE, a nonce and validation of the ID token's claims. An Entra
  e-mail is trusted only for the configured tenant or when the token carries
  `xms_edov`.
* **Admin-managed providers.** Administrators enable and disable providers through
  settings. Signed-in users link identities explicitly.

## Consequences

* After upgrading, administrators are asked to enrol the first time they open
  `/admin`.
* Rotating `APP_KEY` invalidates enrolled secrets; affected users need an administrator
  reset.
* The written human ASVS review stays a 2.x acceptance item;
  [authentication.md](../authentication.md) lists the evidence.
