# ADR 038 — Stable releases after 1.0.0, and release 1.2.0

Superseded by ADR 040.

Date: 2026-09-30. Status: accepted by the owner on 2026-09-30. The owner authorized
publishing 1.2.0 on `latest` the same day: «أأذن بنشر 1.2.0 على latest» (I authorize
publishing 1.2.0 on latest).

## Context

The release gate (`scripts/check-release.mjs`) was written for the 1.0 track: on the
`latest` channel it accepted only the version equal to `release-readiness.json`'s
`target`, `1.0.0`. After 1.0.0 was published (ADR 028), 1.0.1 and 1.1.0 were prepared
but never published, and 1.2.0 completed the decisions in ADR 029 to 037. No later
stable version could pass the gate.

## Decision

The owner approved, in conversation on 2026-09-30, changing the gate as follows:

1. `latest` still accepts `1.0.0` exactly as before.
2. A later stable version on `latest` must be a `1.x` release (a new major needs its own
   acceptance track). The accepted phases 0 to 7 must still all be accepted with dated
   reviewers and evidence.
3. It also needs an entry in `releases` for that exact version with
   `authorized: true`, the owner as `reviewedBy`, a `reviewedAt` date and evidence under
   `docs/evidence/`. Without it the gate refuses the release.
4. Prereleases keep the `next` and `alpha` rules unchanged.

Release packaging, the consumer and creator tests, the dependency audit and the
published-version upgrade check in CI are unchanged. CI now runs the genuine upgrade from
the published `1.0.0`, the version current consumers actually run.

## Release 1.2.0

- Packages `@adula/kit`, `@adula/ui` and `@adula/create-app` and the reference
  application move to `1.2.0`.
- 1.0.1 and 1.1.0 are not published separately; the changelog marks their sections as
  included in 1.2.0. Upgrading from 1.0.0 applies the additive kit migrations
  `1770000000011` to `1770000000015`.
- `release-readiness.json` records 1.2.0 with `authorized: false`. Publication follows
  ADR 028's path after the owner authorizes this exact version: the entry is set to
  `authorized: true` with the owner's name and date in a reviewed pull request, then a
  `v1.2.0` tag on the merge commit and the "Release npm packages" workflow on `latest`.

## Consequences

- Each later 1.x publication leaves a dated owner decision in the repository.
- The 1.0 limits recorded in ADR 027 and ADR 028 still apply to 1.2.0.
- `tests/release/packaging.test.mjs` covers the new gate: authorization, exact version,
  date, evidence, the 1.x bound and the phases.
