# Releasing

A release is a `v<version>` tag on `main`. The tag starts `release.yml`; the owner's
approval of the `npm` environment authorizes publication ([ADR 040](decisions/040-lean-release-process.md)).
[CHANGELOG.md](../CHANGELOG.md) is the only chronology and [releases.md](releases.md)
lists what was published.

## Destination

| Setting | Value |
|---|---|
| Packages | `adula`, `@adula/ui`, `create-adulajs` (all share one version) |
| npm scope | `@adula`, owned by npm account `adula` |
| Repository | `adulash/adulajs` (public; provenance requires it) |
| Workflow | `.github/workflows/release.yml`, triggered by `push: tags: ['v*']` |
| GitHub environment | `npm`, with the owner as required reviewer; its deployment rule must allow tags `v*` |
| Trigger | `push: tags: ['v[0-9]+.[0-9]+.[0-9]+']`; a tag ruleset should restrict who creates `v*` tags |
| Authentication | npm trusted publishing (OIDC) from a GitHub-hosted runner; no npm token anywhere |

Each package's trusted publisher names owner `adulash`, repository `adulajs`, workflow
`release.yml` and environment `npm`. npm trusted publishing needs npm 11.5.1 or later; the
workflow installs npm 11.19.1 on Node 24.

## Steps

1. In a reviewed pull request, set the new version in `packages/adula`, `packages/ui`,
   `packages/create-adulajs`, the root and `apps/reference` `package.json` files and the
   agent/UI lock versions, move the CHANGELOG `Unreleased` entries under the version, and
   rebuild so the UI registry and the creator template carry the version. Merge after CI.
2. Tag the merge commit on `main` and push the tag:
   `git tag -a v2.2.0 -m "AdulaJS 2.2.0"` then `git push origin v2.2.0`.
3. `release.yml` runs:
   - **prepare** refuses a private repository, a tag that is not a stable `vX.Y.Z`, a
     commit that is not on `main`, or a tag that differs from the package version, then
     runs `node scripts/check-release.mjs` on the manifests.
   - **verify** runs the whole of `ci.yml` on that exact commit: build, types, API
     contract, lint, PostgreSQL/browser tests, consumer, upgrade and creator tests, the
     packed-archive checks, boundaries and the dependency audit. It uploads the exact
     consumer-tested archives with `SHA256SUMS`.
   - **publish** waits in the `npm` environment. The owner's approval there is the
     release authorization. It then checks `SHA256SUMS`, re-runs the archive checks and
     publishes the three archives on `latest` with provenance, without rebuilding.
4. Check the three versions, the `latest` dist-tag, provenance and `npm create adulajs`
   on npm, add the row to [releases.md](releases.md) and publish GitHub release notes.

Only stable versions are released; there is no `alpha` or `next` channel. A rejected
approval leaves nothing published; delete the tag only if the version will never be
released, otherwise fix forward with a new version.

## What the checks guarantee

`scripts/check-release.mjs` validates manifests (names, one shared version, MIT,
provenance repository and directory, public access, `build` allowlist, no
`workspace:`/`file:`/`link:` dependencies). With `--artifacts=.work` it also opens each
archive: no unsafe or private paths (`.env`, keys, tests, `node_modules`), the required
files exist, every `exports`/`bin` target is packed, the UI registry and the creator
template carry the release version and the creator pins matching `adula`/`@adula/ui`
versions. It then writes `SHA256SUMS`, which the publish job verifies.

`pnpm check:api` compares every export of the built `adula` entry points and its type
with `packages/adula/api/adula-api.json`. Removed or changed exports are breaking (major
release, codemod, upgrade notes); added exports are a minor release. After a reviewed
change run `pnpm check:api --update` and commit the report with the change.

Locally, after `pnpm test:consumer` and `pnpm test:create` have packed the archives:

```sh
pnpm test:release
pnpm check:release --artifacts=.work
```

## A new package name

npm can configure a trusted publisher only for a package that already exists. While
`create-adulajs` is not on npm, the publish job publishes core and UI and skips the creator
with a warning. The owner then publishes that first version once from the CI-built archive
of the approved run: download `npm-packages-<run-id>`, run
`sha256sum --check SHA256SUMS`, then `npm publish create-adulajs-<version>.tgz --access
public --tag latest --provenance=false` with the owner's npm session and 2FA. The flag
overrides the package's own provenance setting, which works only on CI. That one version has no
provenance. Then add the trusted publisher above; later versions go through the workflow.
Finally retire the old name:
`npm deprecate create-adula-app "Renamed to create-adulajs: npm create adulajs my-system"`.

## Failure handling

Publication of three packages is not atomic. The workflow publishes core and UI before the
creator. If one publish fails, do not unpublish the others or re-run blindly: compare what
npm has with the retained archives (kept 14 days) and publish only the missing ones from
those archives. Different bytes need a new version; never move a tag or reuse a version.

The workflow does not push tags, change account settings or deploy applications.
