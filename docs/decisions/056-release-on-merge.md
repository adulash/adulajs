# ADR 056 — The release pull request's merge authorizes publication

Date: 2026-11-21. Status: accepted by the owner. Supersedes point 5 of ADR 054.

## Context

ADR 054 kept the owner's approval of the `npm` environment as the release authorization.
The release pull request is already merged by the owner after CI, so the approval asked for
the same decision a second time, an hour later, after `release.yml` had re-run CI. For
2.4.0 it waited overnight. The owner removed the environment's required reviewer on
2026-11-21.

## Decision

- The owner's merge of the release pull request (`pnpm release:prepare` with its CHANGELOG
  section) is the release authorization. `release.yml` then verifies and publishes without
  a further approval.
- The `npm` environment has no required reviewer. It keeps its deployment branch policy
  (`main` and `v*` tags), and npm trusted publishing keeps tying each package to this
  repository's workflow.
- Every other safeguard of ADR 040 and ADR 054 stands: `prepare` releases only a version
  after the one on npm and checks the API against the previous tag; `verify` runs the whole
  of CI and keeps the consumer-tested archives with `SHA256SUMS`; `publish` checks them,
  publishes without rebuilding and verifies npm.

## Consequences

- A release is: a pull request with the bump, CI, the owner's merge. Nothing waits after
  the merge.
- The last point to stop a release is before the merge. To stop one after it, cancel the
  `release.yml` run before `publish` starts.
- A version bump merged by mistake is published once `verify` passes, so release pull
  requests are merged only by the owner.
- Removing the reviewer cancelled the approval 2.4.0 was waiting for; its `publish` job was
  re-run.
