# Preparing and publishing packages

**1.0.0 is accepted and authorized for `latest` (ADR 028).** Publication follows the same path as the alphas: a reviewed PR merged after CI, a `v1.0.0` tag on the merge commit, then the release workflow. Earlier alphas are recorded in ADR 024 and the [alpha publication evidence](evidence/alpha-publication-2026-09-23.json).

## Destination

| Setting | Actual value / state |
|---|---|
| npm scope | `@adula`, owned by npm account `adula` |
| Packages | `adula`, `@adula/ui`, `create-adula-app` |
| Repository | `adulash/adulajs`; visibility verified before provenance publishing |
| Workflow | `release.yml` |
| GitHub environment | `npm`; restricted to protected branches; `main` requires PR and CI |
| Authentication | npm trusted publishing, GitHub-hosted runner, OIDC |
| Current version / target | 2.1.0 published on latest on 2026-10-17 ([evidence](evidence/publication-2-1-0-2026-10-17.json)); 2.0.0 published on latest on 2026-10-15 (ADR 039; [evidence](evidence/publication-2-0-0-2026-10-15.json)); 1.2.0 published on latest on 2026-10-01 (ADR 038; [evidence](evidence/publication-1-2-0-2026-10-01.json)); 1.0.0 published 2026-09-26 (ADR 028) |

Trusted publishers must name owner `adulash`, repository `adulajs`, workflow `release.yml` and environment `npm` for **all three packages**, with publishing permission. The 1.x packages were configured this way under the repository's previous name; after the rename the owner updates `@adula/ui` and creates the publishers for `adula` and `create-adula-app` (ADR 039). The first publication used [signed bootstrap archives](alpha-bootstrap.md) and an authenticated owner session. The workflow does not establish account setup or supply credentials.

npm trusted publishing requires at least npm 11.5.1 and Node 22.14; the workflow uses Node 24 and npm 11. Public provenance requires public source and package visibility. See [trusted publishing](https://docs.npmjs.com/trusted-publishers/) and [provenance](https://docs.npmjs.com/generating-provenance-statements/). No npm token belongs in source.

## Local preparation

`pnpm release:status` lists both channel failures and all remaining phases; use
`--json` for a machine-readable report. It returns exit 1 while either channel is
blocked and never changes acceptance. Follow the [execution packet](release-acceptance-runbook.md)
for staging/schedule, CI/publisher, performance/human review and genuine-upgrade evidence.

Run the full [development checks](development.md). `pnpm test:consumer` and `pnpm test:create` produce the tested archives, then:

```sh
pnpm test:release
pnpm check:release --artifacts=.work
pnpm check:release --channel=latest
```

The last command passes only when every phase in `release-readiness.json` is accepted with a reviewer, a date and evidence, as it is for 1.0.0 (ADR 028). A later 1.x or 2.x release on `latest` also needs its own entry in `releases` with `authorized: true`, the owner's name, a date and evidence for that exact version (ADR 038, ADR 039). Packaging checks validate versions, provenance metadata, licensing, skills/commands, exports, UI assets and absence of private/test files, then write `.work/SHA256SUMS`. They do not establish product stability.

When acceptance justifies a candidate, update all three package versions, workspace/reference versions, agent/UI lock versions, changelog and `release-readiness.json`; rebuild and repeat both consumer tests. The creator pins matching core/UI versions in its bundled template. Keep migrations additive. Previews use an explicit prerelease such as `1.0.0-rc.1` on `next`; stable uses `v1.0.0` on `latest`. These are future examples, not existing releases.

## Authorized remote release

1. After explicit authorization, push the reviewed code, establish main/staging and branch protection, and review the first real CI run.
2. Complete acceptance evidence, create an annotated `v<version>` tag on reviewed `main`, and push it only within an authorized release.
3. Run **Release npm packages** manually on `main` with the version/channel. It verifies public visibility, tag ancestry, matching versions and acceptance.
4. Reusable CI checks that exact commit: build, types, lint, PostgreSQL/runtime/browser tests, release guards, independent consumer, boundaries and dependency audit. It retains the exact consumer-tested archives/checksums.
5. The protected `npm` job verifies downloaded checksums/acceptance and publishes those archives with provenance, without rebuilding or passing publication credentials to tests.
6. Verify all three npm versions, dist-tags, provenance and `npx create-adula-app@latest` before creating release notes or claiming completion.

The workflow does not push tags, modify account settings or deploy applications. Application deployment separately follows its configured `make deploy` and restore gates.

## Failure handling

Multi-package publication is not atomic. Publish core/UI before the creator. If any publish fails, do not unpublish prior packages or blindly rerun all publishes. Inspect npm, compare published integrity with retained archives, and publish only missing packages through the approved environment. Different bytes require a new version and checks; never force-move tags or reuse a version.

Artifacts are retained for 14 days. Preserve final integrity and acceptance in durable release evidence; ignored `.work` logs remain local diagnostics.

## Public API contract

`pnpm check:api` compares every export of the built `adula` entry points and its
declared type with `packages/adula/api/adula-api.json`. CI fails on any difference.
Removed or changed exports are breaking (major release, codemod, UPGRADE.md);
added exports are a minor release. After a reviewed change run
`pnpm check:api --update` and commit the report with the change.
