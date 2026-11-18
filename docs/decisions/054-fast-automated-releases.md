# ADR 054 — Fast, automated releases

Date: 2026-11-18. Status: proposed to the owner. Amends ADR 040 (how a release is
triggered and finished); its archive safety, API contract and owner approval stand.

## Context

2.3.0 took three weeks from the first change to a complete release. Measured causes: one
long-lived release branch (324 commits, first CI run two weeks after the work started);
new owner decisions added after "prepare"; CI grown from 13 to 60-80 minutes, of which the
browser suite took 33 minutes twice (light and dark) in one job, and the clean-close sweep
20 of those minutes (6 on one page that repeats one control per resource); flaky browser
tests; an approval that waited overnight; a creator package without a trusted publisher,
published by hand; and manual after-publication steps. The owner wants a release in one
night and patch versions (2.3.1, 2.3.2) for small fixes.

## Decision

1. **Every change lands on main through its own pull request**; main is always releasable.
   A release ships what main holds; a new decision goes to the next version.
2. **Semantic versioning, checked by machine.** `pnpm release:prepare patch|minor|major`
   sets every version and moves the CHANGELOG `Unreleased` entries under the dated
   version. A patch keeps the public API, a minor only adds to it, a major may break it;
   `scripts/release.mjs` compares `packages/adula/api/adula-api.json` with the previous
   release's tag, both in prepare and in `release.yml`.
3. **Merging the bump releases it.** `release.yml` runs on pushes to main that change
   `packages/adula/package.json` (and on a `v*` tag or a manual run). It releases only
   when the version is after the one on npm; otherwise it does nothing.
4. **CI in parallel.** One matrix: static checks, non-browser tests, packages, and the
   browser suite in four shards for each theme (`scripts/test-browser-shard.mjs`). The
   sweep splits into two parts by its targets. `check` is the one required status.
   The role page's sweep checks one permission control per action, as the
   organization units page already did per unit.
5. **The owner's approval of the `npm` environment stays the release authorization.**
6. **After approval nothing is manual.** The publish job skips an archive already on npm
   with the same bytes (safe to re-run), checks the three versions, `latest` and
   provenance, then creates the `v<version>` tag and the GitHub release from the
   CHANGELOG section. `docs/releases.md` keeps the versions up to 2.3.0; GitHub Releases
   lists the later ones.

## Consequences

- A small fix is: a pull request, then `pnpm release:prepare patch` in a second pull
  request (or the same one), merge, approve. Expected wall time about an hour.
- The `npm` environment must allow deployments from `main` as well as `v*` tags, and
  `create-adulajs` needs its npm trusted publisher; both are owner settings.
- A flaky browser test is fixed before the next release, never retried away.
