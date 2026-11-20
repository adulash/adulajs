# Releasing

A release is a merged version bump on `main`: the owner's merge of the release pull request
authorizes publication ([ADR 040](decisions/040-lean-release-process.md),
[ADR 054](decisions/054-fast-automated-releases.md), [ADR 056](decisions/056-release-on-merge.md)).
`release.yml` re-runs CI on that commit, then publishes, verifies npm, tags the commit and
writes the GitHub release. [CHANGELOG.md](../CHANGELOG.md) is the only chronology.

## Destination

| Setting | Value |
|---|---|
| Packages | `adula`, `@adula/ui`, `create-adulajs` (all share one version) |
| npm scope | `@adula`, owned by npm account `adula` |
| Repository | `adulash/adulajs` (public; provenance requires it) |
| Workflow | `.github/workflows/release.yml` |
| Trigger | a push to `main` that changes `packages/adula/package.json`; also a `v<X.Y.Z>` tag or a manual run |
| GitHub environment | `npm`, with the owner as required reviewer; its deployment rules must allow `main` and tags `v*` |
| Authentication | npm trusted publishing (OIDC) from a GitHub-hosted runner; no npm token anywhere |

Each package's trusted publisher names owner `adulash`, repository `adulajs`, workflow
`release.yml` and environment `npm`. npm trusted publishing needs npm 11.5.1 or later; the
workflow installs npm 11.19.1 on Node 24.

## Versions

Semantic versioning, checked against `packages/adula/api/adula-api.json`:

| Kind | When | Public API |
|---|---|---|
| patch (2.3.0 → 2.3.1) | fixes | unchanged |
| minor (2.3.1 → 2.4.0) | features | additions only |
| major (2.4.0 → 3.0.0) | breaking changes, with codemod and upgrade notes | may remove or change |

Only stable versions are released, on `latest`.

## Steps

1. Every change merges to `main` in its own pull request after CI, with its CHANGELOG
   entry under `## Unreleased`.
2. When `main` should ship: `pnpm release:prepare patch` (or `minor`, `major`, `X.Y.Z`),
   then `pnpm build`, and open the pull request. The command sets every version, moves the
   `Unreleased` entries under the dated version and refuses a bump too small for the API
   change. Merge after CI.
3. `release.yml` runs on the merge:
   - **prepare** releases only a commit on `main` whose version is after the one on npm,
     checks the API against the previous release's tag, then the manifests
     (`scripts/check-release.mjs`). Any other push to that file ends here.
   - **verify** runs the whole of `ci.yml` on that commit and keeps the consumer-tested
     archives with `SHA256SUMS`.
   - **publish** runs in the `npm` environment, which has no required reviewer (ADR 056)
     and accepts deployments from `main` and `v*` tags only. It checks `SHA256SUMS`, publishes the three archives without rebuilding, checks the
     versions, `latest` and provenance on npm, and creates the `v<version>` tag and the
     GitHub release from the CHANGELOG section.

A failed verify leaves nothing published; fix it on `main` and merge a later bump. A failed
publish is safe to re-run: archives already on npm with the same bytes are skipped.

## CI

`ci.yml` runs in parallel jobs: `static` (types, API contract, lint, boundaries, release
tooling tests, audit), `tests` (`pnpm test:nonbrowser`), `packages` (consumer, genuine
upgrade from the newest earlier published version, creator, archive checks) and the
browser suite in four shards for each theme (`pnpm test:browser:shard --shard=k/4`). The
`check` job is the single required status. Locally, `pnpm test` still runs everything in
one go.

## What the checks guarantee

`scripts/check-release.mjs` validates manifests (names, one shared version, MIT,
provenance repository and directory, public access, `build` allowlist, no
`workspace:`/`file:`/`link:` dependencies). With `--artifacts=.work` it also opens each
archive: no unsafe or private paths (`.env`, keys, tests, `node_modules`), the required
files exist, every `exports`/`bin` target is packed, the UI registry and the creator
template carry the release version and the creator pins matching `adula`/`@adula/ui`
versions. It then writes `SHA256SUMS`, which the publish job verifies.

`pnpm check:api` compares every export of the built `adula` entry points and its type
with `packages/adula/api/adula-api.json`. After a reviewed change run
`pnpm check:api --update` and commit the report with the change.

Locally, after `pnpm test:consumer` and `pnpm test:create` have packed the archives:

```sh
pnpm test:release
pnpm check:release --artifacts=.work
```

## A new package name

npm can configure a trusted publisher only for a package that already exists. The owner
publishes the first version of a new name once from the CI-built archive of an approved
run: download `npm-packages-<run-id>`, run `sha256sum --check SHA256SUMS`, then
`npm publish <name>-<version>.tgz --access public --tag latest --provenance=false` with the
owner's npm session and 2FA. That one version has no provenance. Then add the trusted
publisher above; later versions go through the workflow.

## Failure handling

Publication of three packages is not atomic. The publish job is safe to re-run: it skips
an archive npm already has with the same bytes and publishes the rest from the same run's
archives (kept 14 days). Different bytes need a new version; never move a tag or reuse a
version.

The workflow does not change account settings or deploy applications.
