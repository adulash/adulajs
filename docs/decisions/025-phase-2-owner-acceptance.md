# ADR 025 — Phase 2 accepted by owner attestation; council 1 record

Superseded by ADR 040.

Date: 2026-09-24. Status: accepted by the owner.

## Decision

The owner stated in conversation (Arabic: "المرحلة 2 تم اختبار بشكل شخصي وناجح")
that they personally tested phase 2 and found it successful, and instructed work to
continue with phases 3 and 4. Phase 2 is recorded as accepted on that attestation.
This covers the human RTL review, including the localized date order on the detail
view, and the owner's own use of the generated interface.

## What the attestation does not change

- The measured k6 budgets did **not** pass: list/save p95 were 504.83/463.00 ms
  (2026-09-22) and 1140/1060 ms (2026-09-24) against <300/<200 ms. No threshold is
  relaxed and no passing measurement is claimed. The budget moves to the second k6
  run of phase 5 and the release gate of phase 7, where it must be re-measured on
  fixed hardware. Owner acceptance of phase 2 is an explicit, recorded deviation
  from the plan's section 13 acceptance budget, not evidence that it passed.
- A genuine published-predecessor minor upgrade remains required before 1.0 (ADR
  024); it is now possible because 0.2.0-alpha.1 and 0.2.0-alpha.4 exist on npm.

## Council 1 (end of phase 2) — review of the generated interface and vertical slice

Recorded by the implementing agent and accepted with the owner's instruction to
proceed. Seven angles:

1. Correctness: the generic ResourcePage/Form/Show are covered by functional and
   browser suites; authorization is evaluated server-side for every read and write.
2. Security: field-level serialization, scope as an AND constraint and the audit
   hardening of 2026-09-23 hold; impersonation still lacks a human review.
3. Performance: the single controller keeps the budget decision in one place, but
   the measured p95 fails. Profiling request/pool contention is the next action.
4. Upgrade safety: copied UI with ui.lock.json and page overrides survived the
   disposable consumer's customization test.
5. Agent usability: one resource definition drives list, form, show and tests.
6. Operability: backup/restore with bound attachments is proven locally and on S3.
7. Scope discipline: educational modules stay test-only fixtures (ADR 017).

Consequence: phase 3 may start. Phase 3 features follow section 14 of the plan:
each ships with an additive kit migration, a consumer and a PostgreSQL test.
