# ADR 024: Framework-only distribution and first alpha

Superseded by ADR 040.

Date: 2026-09-22. Status: owner-authorized scope and publication direction;
execution evidence remains separate.

The product is a reusable framework, not a permanent medical or other business
application. Independent generated applications remain disposable acceptance
consumers. Their data, credentials, screenshots and build directories are never
published. Reproducible test fixtures remain source tests, excluded from npm and
normal runtime. No company identity is required for the disposable medical test.

The owner selected local Docker staging instead of an external host, and reported
personally testing operations. Record that statement as owner attestation, not as
new machine-captured proof of natural daily/monthly execution. The framework still
ships and tests its backup/recovery and supervision contracts.

There is no previously published version. A genuine published-predecessor upgrade
cannot gate the first alpha. Preserve the synthetic compatibility test and its
honest label. The next applicable minor release must exercise a real published
predecessor while preserving consumer data and customizations.

The owner authorized GitHub publication to adulash/adula-kit through a pull request
that is merged only after CI passes, and npm 0.2.0-alpha.1 on the alpha channel.
Keep latest and next blocked under their existing acceptance rules. Alpha is an
explicit experimental distribution of implemented capabilities, not acceptance
of any phase or a completed 1.0. Do not remove remaining framework features or
claim failed performance budgets passed.

The one-command entrypoint is npm create @adula/app@alpha my-app. The creator pins
matching kit/UI versions and installs application dependencies. Node.js and Docker
remain host prerequisites; real external service credentials are deployment-owned.

For final framework acceptance, phase 6 covers independent generated-consumer
integration and runtime verification rather than delivery of a permanent medical
product. Phase 7 remains complete framework scope, documentation, passing tests
and an authorized public release. Local Docker results do not claim external
capacity, public TLS, or an operated customer deployment.

## Owner amendment, 2026-09-23

After initial npm publication, the registry exposed `latest` alongside `alpha`.
The owner explicitly approved retaining both for `0.2.0-alpha.1` after being told
that unqualified installation would select this experimental version. This
supersedes the earlier requirement that the registry have no `latest` alias for
this version only. `next` remains absent. No phase or stable release gate is
accepted by this amendment, and future stable releases retain the 1.0 gates.
