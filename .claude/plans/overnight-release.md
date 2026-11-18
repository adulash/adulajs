# Overnight release

Goal: a release goes from "merge" to "published on npm" in one night (target: under 2 hours of wall time, one owner click).

## Where 2.3.0 lost three weeks (measured 2026-11-18)

| Cause | Evidence |
|---|---|
| One long-lived release branch | 324 commits on `chore/release-2.3.0`; its first CI run was on 2026-11-15, two weeks after work started. Failures surfaced only at the end. |
| Scope kept growing after "prepare" | `chore(release): prepare 2.3.0` on 2026-11-10, then five more days of fixes and 7 owner decisions (25-30) added to the same release. |
| CI became slow | 11-15 min on 2026-11-01; 48-81 min on 2026-11-15 after the dark-theme browser rerun (timeout raised to 180 min). |
| Flaky browser tests | The same commit passed in the release `verify` job and failed on `main` (`modal routes support mobile...`, `locator.focus` timeout). 3 failed CI runs on the release PR. |
| Approval waited overnight | `verify` finished 2026-11-15 15:21; `publish` started 2026-11-16 06:23. |
| Manual publication | `create-adulajs` has no npm trusted publisher, so the workflow failed with E404 and the package was published by hand without provenance. |
| Manual post-release steps | No `docs/releases.md` row and no GitHub release for 2.3.0 yet. |

## Plan

1. **Main is always releasable.** Every change lands on `main` through its own small PR with green CI. No release branch. Design review and acceptance happen in each PR, not at release time.
2. **Freeze by default.** A release ships what is on `main` at tag time. Anything new, including an owner decision, goes to the next version. Release weekly or whenever a change is ready.
3. **One-command preparation.** `pnpm release:prepare <version>` updates every version field, the UI registry/creator template and moves `CHANGELOG` `Unreleased` under the version. One PR, merged after CI.
4. **CI under 30 minutes.** Split the job: unit/API/lint, light browser suite in shards, packaging/consumer/creator in parallel jobs. Run the dark-theme rerun only on visual specs (or nightly on `main`).
5. **Fix flakes, never hide them.** Record each CI test failure; a test that passed and failed on the same commit is fixed before the next release (no retries that mask it).
6. **One-time npm fix.** Owner adds the trusted publisher for `create-adulajs` (owner `adulash`, repository `adulajs`, workflow `release.yml`, environment `npm`). After that the workflow publishes all three packages.
7. **Automate after-publish.** `release.yml` creates the GitHub release from the CHANGELOG section and checks the three versions, `latest` and provenance on npm. `docs/releases.md` is dropped or filled by the workflow.
8. **Approval stays, timed.** The owner approves the `npm` environment from GitHub mobile when `verify` finishes; nothing else is manual.

Expected night: merge prepare PR (CI ~30 min) -> push tag -> `verify` (~30 min) -> owner approves -> publish (~1 min).

## Status (2026-11-18, branch chore/fast-release, uncommitted)

Done in the repository: items 3 (`pnpm release:prepare`), 4 (matrix CI, 4 browser shards per theme, sweep split in two, role-page sweep one control per action), 5 (the 2026-11-15 main failure fixed at its cause in `resource-surface.tsx`, with a regression test), 7 (release on merge, safe re-run, npm checks, tag and GitHub release), ADR 054, `docs/releasing.md`, 2.3.0 row in `docs/releases.md`. Not yet run: browser/database tests locally (no `.env.test` in this worktree) and the new workflows on GitHub.

Owner settings: `npm` environment must allow branch `main`; `create-adulajs` trusted publisher on npm.

Items 1, 2 and 8 are owner practice. Item 6 is owner-only on npmjs.com. Items 3, 4, 5 and 7 are repository work.
