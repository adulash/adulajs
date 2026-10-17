# ADR 040 — Lean release process

Date: 2026-10-18. Status: accepted by the owner on 2026-10-18 after the release-process
review. Supersedes ADR 024, 025, 026, 028 and 038, and the release-gate paragraphs of
ADR 017 and ADR 039.

## Context

The 1.0 track built a release bureaucracy around one maintainer: `docs/release-readiness.json`
with eight acceptance phases, a guard in `scripts/check-release.mjs` that asserted the
target was `1.0.0` and special-cased 1.x and 2.x versions, `pnpm release:status`, 46
`docs/evidence/*.json` prose records, an acceptance runbook, release packets, a signed
alpha bootstrap and `pnpm check:naming`. Its tests checked that JSON records agreed with
each other, not that the product worked. About a third of all commits touched
`docs/evidence`. None of it stopped a broken archive that the packaging checks and CI
did not already stop.

## Decision

Keep only what has teeth:

1. **Archive safety.** `scripts/check-release.mjs` keeps `validateManifest` and
   `validateContents`: names, one shared version, provenance metadata, no local
   dependencies, no private or unsafe paths, required files, `exports`/`bin` targets,
   UI registry and creator template versions, and `SHA256SUMS` of the tested archives.
2. **API contract.** `pnpm check:api` and `pnpm check:boundaries` stay in CI.
3. **Authorization.** A `v<version>` tag on `main` triggers `release.yml`, which re-runs
   all of CI on that commit and publishes the CI-built archives with provenance from the
   `npm` GitHub environment. The environment's required reviewer is the owner; approving
   the deployment is the release authorization. No readiness file, no phase records.
4. **Chronology.** `CHANGELOG.md` is the only chronology; `docs/releases.md` is a table
   of published versions. Earlier evidence stays in git history.
5. Only stable versions are published, on `latest`. The `alpha` and `next` channels,
   the signed bootstrap and its scripts are removed.

Removed: `docs/release-readiness.json`, `docs/evidence/`, `scripts/release-status.mjs`,
`scripts/check-naming.mjs`, `scripts/naming.mjs`, `scripts/sign-bootstrap.mjs`,
`scripts/publish-bootstrap.mjs`, the readiness, release-status and naming tests, the
acceptance runbook, release packet, 1.0 acceptance, confirmed achievements, npm
acceptance review and alpha bootstrap documents.

The same review renamed the creator package to `create-adulajs` (`npm create adulajs`),
before the framework is announced, with no alias.

## Consequences

- A release is a reviewed version bump, a tag and one approval. `docs/releasing.md`
  describes it.
- The first version of a new package name (`create-adulajs`) is published once by the
  owner from the CI-built archive, then gets a trusted publisher like the others.
- The retired 1.x name is no longer policed by CI; review catches it.
- CI runs once per pull request (push builds only `main`), cancels superseded runs and
  has a time limit. Dependabot proposes grouped weekly npm updates.
