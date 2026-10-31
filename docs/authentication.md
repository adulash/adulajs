# Authentication

Every system created with `create-adulajs` inherits the reference application's
authentication. It offers:

- password sign-in with lockout;
- optional sign-in through external identity providers (SSO);
- time-based two-factor authentication (TOTP);
- administrator controls for all of the above.

The reference implementation lives in `apps/reference`:

- controllers: `app/controllers/{session,oauth,two_factor,two_factor_challenge,profile}_controller.ts`;
- services: `app/services/{sign_in,two_factor,social_accounts}.ts`;
- the Entra ID driver: `app/auth/microsoft_driver.ts`;
- the TOTP primitive: the `TwoFactor` class in the core package (`packages/adula/src/auth/two_factor.ts`).

## Sign-in flow

Every sign-in has one first factor, either a password or an external provider. Both
finish through `completeSignIn` in `app/services/sign_in.ts`, so neither path can skip
the second factor.

- **No two-factor:** the session user is created and a `login` or `oauth_login`
  activity is recorded.
- **Two-factor enabled:**
  1. The session is regenerated.
  2. It holds only a pending challenge for five minutes (user id, method, provider).
     There is no session user, and nothing is recorded as a login yet.
  3. The browser is sent to `/login/two-factor`. Every protected route treats the
     visitor as signed out until a valid code is entered.
  4. When the code passes, the session user is created and the activity records which
     second factor was used.

## External providers (SSO)

A provider appears on the login page only when two things are true. Its credentials
exist in the environment. An administrator has not disabled it under
**Administration → Settings → Authentication** (stored as the system setting
`auth.providers.disabled`). An unconfigured or disabled provider answers 404 on its
redirect, callback and link routes.

| Provider           | Variables                                                               | Callback URL                          |
| ------------------ | ----------------------------------------------------------------------- | ------------------------------------- |
| GitHub             | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`                              | `${APP_URL}/oauth/github/callback`    |
| Google             | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`                              | `${APP_URL}/oauth/google/callback`    |
| Microsoft Entra ID | `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID` | `${APP_URL}/oauth/microsoft/callback` |

All of them are optional. Keep the secrets in `.env` only, never in settings or Git.

### Microsoft Entra ID

`@adonisjs/ally` 6.3 has no Microsoft driver, so AdulaJS ships one that builds on
ally's OAuth 2 base class.

How the driver works:

- It uses the v2.0 authorization-code flow, with PKCE (S256), `state` and a random
  `nonce` kept in an encrypted cookie.
- It reads the ID token directly from the token endpoint, as a confidential client over
  TLS. OIDC Core 3.1.3.7(6) lets TLS server validation stand in for checking the
  signature in this case.
- It validates these claims: `iss` (`https://login.microsoftonline.com/{tid}/v2.0`),
  `aud` (the client id), `exp`, `nbf`, `iat`, `nonce`, `tid` and `oid`.
- The local identity is `tid:oid`, never the e-mail address.

Setting `MICROSOFT_TENANT_ID`:

- Use your directory's tenant GUID (Entra admin centre → Overview → Tenant ID). With a
  tenant GUID, only that directory's accounts can sign in.
- `organizations` and `common` accept any work account. `consumers` accepts personal
  accounts only.
- An Entra e-mail claim does not prove that the user owns the address (the "nOAuth"
  problem). AdulaJS therefore treats the e-mail as verified only in two cases:
  - the token's `tid` equals the configured tenant GUID and the user is a member of that
    directory (a B2B guest, `acct: 1` or a foreign `idp`, is not trusted);
  - the token carries `xms_edov: true`.

  An unverified address can neither create an account nor link to an existing one by
  e-mail. Such users link their Microsoft identity from their profile while signed in.

App registration in Entra:

- platform **Web**;
- redirect URI `${APP_URL}/oauth/microsoft/callback`;
- a client secret;
- the delegated permissions `openid`, `profile` and `email`.

### Account linking rules

- **Existing link:** an identity that is already linked signs in its user.
- **Matching e-mail:** an identity is linked by e-mail only when both of these hold:
  - the provider marks the address as verified;
  - the local account's address is verified (`email_verified_at`).

  An account that was self-registered but never verified is never linked. This prevents
  pre-registration takeover.

- **New account:** an unknown verified address creates an account only while signup is
  open (`SIGNUP_ENABLED`; see [installation.md](installation.md)). While signup is
  closed, an unknown address and an unproven address get the same generic answer.
- **Explicit linking:** a signed-in user can link any identity from
  **Profile → Connected accounts**, whatever the provider's e-mail.
  - Linking needs a sign-in within the last ten minutes or the current password.
  - The request records a ten-minute intent bound to the user and provider.
  - The callback links only when that intent matches.
  - Linking is refused when the identity belongs to another user, or when the user
    already has a different identity from that provider.
- **Unlinking:** also from the profile.
- **Impersonation:** linking and unlinking are refused while an administrator
  impersonates the user.
- **Automatic links:** an e-mail link made during sign-in is recorded as `social_linked`
  (`automatic: true`). When the account has two-factor enabled, the link is created only
  after the code passes.
- **Refusals:** disabled accounts are refused at every step, and nothing is linked for
  them.

### Callback hardening

- The `state` parameter must be present and match its cookie before any token request is
  made. Ally on its own accepts a missing cookie together with a missing parameter.
- Error text from the provider is logged, never shown to the user.
- Token and profile failures get a generic message instead of a server error.
- Callback redirects use only named routes and clear the query string.

## Two-factor authentication (TOTP)

- **Code type:** RFC 6238 codes from any authenticator app: SHA-1, 6 digits, a
  30-second period, one step of tolerance in each direction, and a 160-bit secret.
- **Secret storage:** the secret is stored encrypted with the system's `APP_KEY`
  encryption service (`user_two_factor.secret`). `config/encryption.ts` uses
  `keys: [APP_KEY]`. **When rotating `APP_KEY`, append the old key to that list**, or
  enrolled secrets become unreadable. A user whose secret cannot be opened is refused
  with a message to contact the administrator (`E_TWO_FACTOR_UNREADABLE`) and must be
  reset by an administrator.
- **Replay protection:** each time step is accepted once. A code that was already used,
  or an older one, is refused.

### Enrolment (Profile → Security)

Starting enrolment needs a sign-in within the last ten minutes or the current password
(`403 E_REAUTH_REQUIRED` otherwise). Users who signed in only through a provider sign in
again instead.

1. **Start:** choose **Enable two-factor authentication**. The dialog shows the issuer,
   the account, the base32 secret for manual entry and the `otpauth://` link.
2. **Confirm:** enter a code from the app to confirm.
3. **Save the recovery codes:** ten codes are shown once, in the format
   `XXXXX-XXXXX-XXXXX-XXXXX`. They can be copied or downloaded.

QR rendering is an extension point: `enrolmentQr()` in `app/services/two_factor.ts`. It
returns `null` until a QR renderer is approved as a dependency. The dialog shows the
image only when it is not null.

Users can also:

- **regenerate the recovery codes**, which needs a current authenticator code;
- **disable two-factor**, which needs the password plus a code or a recovery code.

None of these operations are available while an administrator impersonates the user.

### Recovery codes

- **Entropy:** each code carries more than 80 bits.
- **Storage:** each code is a separate row (`user_two_factor_recovery_codes`) holding a
  random 16-byte salt and a SHA-256 hash, so the plain code is never stored.
- **Single use:** using a code marks it used atomically, so two concurrent requests
  cannot both use it.
- **Audit:** each use is recorded with the number of codes left.

### Lockout

Code attempts follow the Phase 1 login rules:

- 5 failures per (user, client address) within 15 minutes, then blocks of 1, 2, 4 … up
  to 60 minutes;
- a ceiling of 20 failures per hour per account across all addresses, because whoever
  is guessing already knows the password;
- every attempt is counted before the code is checked, so concurrent requests cannot
  exceed the limits; a valid code gives its unit back;
- while a block is active, codes are not checked at all;
- wrong codes and passwords on the self-service operations (regenerate, disable) count
  toward the same account ceiling (`429 E_TWO_FACTOR_LOCKED`);
- a pending challenge ends when the password or the two-factor state changes during it.

These activities are recorded: `two_factor_failed`, `two_factor_locked`,
`two_factor_recovery_used` and `password_confirmation_failed`.

### Administrator reset

On the user's page, **Reset two-factor** does the following:

- removes the secret and the recovery codes;
- ends every session of the user;
- deletes their API tokens;
- records `two_factor_reset`, with the administrator as actor.

Administrators reset other users only. To change their own setup, they use the profile
page.

### Required for administrators

The system setting `auth.twoFactorRequiredForAdministrators` defaults to on. It can be
changed under **Administration → Settings → Authentication**. While it is on, a user
with `manage all` who has not enrolled cannot use administrator power:

- no `/admin` page, including the active sessions screen;
- no new API token, and existing API tokens of that user are refused on the bearer API;
- no MCP access.

The answers are:

- HTML requests are sent to `/account/profile?enrol=two-factor`, with an Arabic
  explanation, and the enrolment dialog opens.
- JSON requests receive `403 E_TWO_FACTOR_REQUIRED`.

The resource pages (`/resources/*`) are not gated: they apply the same permissions as for
any user and carry no administration screens.

## Routes

| Method and path                                                  | Purpose                                                                |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `GET /login/two-factor`, `POST /login/two-factor`                | Second sign-in step (guest)                                            |
| `POST /account/two-factor/begin`                                 | Start enrolment                                                        |
| `POST /account/two-factor/confirm`                               | Confirm enrolment; returns the recovery codes                          |
| `POST /account/two-factor/recovery-codes`                        | Regenerate the recovery codes                                          |
| `DELETE /account/two-factor`                                     | Disable two-factor                                                     |
| `POST /account/connections/:provider`                            | Link a provider identity                                               |
| `DELETE /account/connections/:provider`                          | Unlink a provider identity                                             |
| `GET /oauth/:provider/redirect`, `GET /oauth/:provider/callback` | Provider sign-in; the callback also completes linking                  |
| `POST /admin/users/:id/reset-two-factor`                         | Administrator reset                                                    |
| `PUT /admin/settings/authentication`                             | Enable or disable providers, and require two-factor for administrators |

## ASVS 4.0.3 coverage

### Covered

| Item                                 | How                                                                                          |
| ------------------------------------ | -------------------------------------------------------------------------------------------- |
| 2.2.1                                | Lockout per (account, address), plus an account-wide ceiling for second-factor attempts      |
| 2.5.x                                | An administrator reset ends sessions and API tokens; disabling needs the password and a code |
| 2.6.1–2.6.3                          | Recovery codes: single use, more than 80 bits each, salted SHA-256                           |
| 2.8.1 and 2.8.3                      | RFC 6238 with a defined lifetime and a 160-bit secret                                        |
| 2.8.4                                | Each time step is accepted once                                                              |
| 2.8.5                                | Failures and lockouts are logged                                                             |
| 3.2.1                                | The session is regenerated after the first factor and again after the second                 |
| 3.7.1                                | Linking a provider and starting enrolment need a recent sign-in or the password              |
| 3.3.1                                | The pending state ends with the session and expires after five minutes                       |
| 7.x                                  | Every change of an authenticator and every administrator reset is audited                    |
| OAuth 2.0 Security BCP and OIDC Core | `state`, PKCE and `nonce` (Entra), plus claim validation                                     |

### Not covered

- **Human review:** a written human ASVS review is still required. `adulajs-plan.md`
  makes it an acceptance condition, and ADR 027 requires human review of every
  two-factor change.
- **E-mail notification:** users get no e-mail when two-factor is enabled, disabled or
  reset.
- **Hardware keys:** there are no WebAuthn or FIDO2 authenticators.
- **ID token signature:** the Entra ID token signature is not checked. This is safe only
  while the token comes directly from the token endpoint.
