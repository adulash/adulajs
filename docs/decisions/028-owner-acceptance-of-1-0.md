# ADR 028 — Owner acceptance of 1.0 and release authorization

Superseded by ADR 040.

Date: 2026-09-25. Status: accepted by the owner.

## Decision

After the phases and council 2 were explained, the owner stated in conversation:

> أقبل المراحل من 0 إلى 7 والمجلس الثاني، وأأذن بنشر 1.0.0

(I accept phases 0 to 7 and council 2, and I authorize publishing 1.0.0.)

- Phases 0 to 7 are accepted on the recorded evidence with the limits named in
  ADR 027 and KIT_GAPS.md.
- Council 2 (ADR 026) is accepted: the framework works outside its owner's head,
  with the named limits.
- Publishing `1.0.0` of `@adula/kit`, `@adula/ui` and `@adula/create-app` on the
  `latest` channel is authorized, through the existing path: a pull request to
  `main` merged after CI passes, a `v1.0.0` tag on the merge commit, and the
  "Release npm packages" workflow with provenance.

## Limits carried into 1.0 (from ADR 027)

- Two-factor authentication is not included; it returns in 2.0 with a human ASVS
  review.
- Impersonation was reviewed by automated adversarial and black-box tests; its
  human review is due in 2.0.
- Natural daily and monthly scheduling observations, an operated production
  consumer, XLSX import (GAP-006) and staging hardware performance are 2.0 items.
- Local Docker staging was accepted on an independent automated run in which
  three Alpine OS tools came from other images.

## Consequences

From 1.0.0 on, removing or changing an export recorded in
`packages/kit/api/kit-api.json` requires a major version. Migrations remain
additive and immutable.
