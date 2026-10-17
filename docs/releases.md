# Releases

Every published AdulaJS version, one row each. [CHANGELOG.md](../CHANGELOG.md) is the
chronology of what each version changed; the older dated release evidence lives in git
history (last present in commit `f5ae844`, under `docs/evidence/`). How a release is cut is
in [releasing](releasing.md).

Dates are the npm publication times (UTC). All three packages of a version are published
together by the `Release npm packages` workflow (`release.yml`) with npm provenance.
Packages: 0.2.0 and 1.x as `@adula/kit`, `@adula/ui`, `@adula/create-app`; 2.x as `adula`,
`@adula/ui`, `create-adula-app` (renamed `create-adulajs` after 2.1.0).

| Version | Date | Tag | PR | CI run | npm status |
|---|---|---|---|---|---|
| 2.1.0 | 2026-10-16 | `v2.1.0` (f5ae844) | [#86](https://github.com/adulash/adulajs/pull/86), [#87](https://github.com/adulash/adulajs/pull/87) | [38971440118](https://github.com/adulash/adulajs/actions/runs/38971440118) | `latest` |
| 2.0.0 | 2026-10-15 | `v2.0.0` (4b9951e) | [#79](https://github.com/adulash/adulajs/pull/79), [#81](https://github.com/adulash/adulajs/pull/81) | [38698145811](https://github.com/adulash/adulajs/actions/runs/38698145811) | published; superseded by 2.1.0 |
| 1.2.0 | 2026-10-01 | `v1.2.0` (e6c860c) | [#75](https://github.com/adulash/adulajs/pull/75), [#76](https://github.com/adulash/adulajs/pull/76) | [36829586279](https://github.com/adulash/adulajs/actions/runs/36829586279) | `latest` of `@adula/kit`; deprecated (renamed to `adula`) |
| 1.1.0 | — | none | — | — | not published; shipped in 1.2.0 |
| 1.0.1 | — | none | — | — | not published; shipped in 1.2.0 |
| 1.0.0 | 2026-09-26 | `v1.0.0` (6280c05) | [#16](https://github.com/adulash/adulajs/pull/16) | [36205271341](https://github.com/adulash/adulajs/actions/runs/36205271341) | published; deprecated |
| 0.2.0-alpha.4 | 2026-09-24 | `v0.2.0-alpha.4` (ac9e6c8) | [#15](https://github.com/adulash/adulajs/pull/15) | [36060405387](https://github.com/adulash/adulajs/actions/runs/36060405387) | `alpha`; deprecated |
| 0.2.0-alpha.3 | 2026-09-23 | `v0.2.0-alpha.3` (0994f99) | [#6](https://github.com/adulash/adulajs/pull/6) | [35888662986](https://github.com/adulash/adulajs/actions/runs/35888662986) | published; deprecated |
| 0.2.0-alpha.2 | 2026-09-23 | `v0.2.0-alpha.2` (383bc41) | [#5](https://github.com/adulash/adulajs/pull/5) | [35800296806](https://github.com/adulash/adulajs/actions/runs/35800296806) | published; deprecated |
| 0.2.0-alpha.1 | 2026-09-22 | `v0.2.0-alpha.1` (2ee5733) | [#1](https://github.com/adulash/adulajs/pull/1), [#2](https://github.com/adulash/adulajs/pull/2), [#3](https://github.com/adulash/adulajs/pull/3) | [35790083688](https://github.com/adulash/adulajs/actions/runs/35790083688) | published; deprecated |

"Deprecated" applies to the renamed `@adula/kit` and `@adula/create-app`, whose npm
messages point to `adula` and the creator. `@adula/ui` keeps one name across all versions
and none is deprecated; its `alpha` tag still points to 0.2.0-alpha.4. The repository was named `adulash/adula-kit` until 2026-10-13; GitHub
redirects the old links.

## Retired exercises

`tests/feasibility-exercise` (the 2026-09-25 timed exercise of building customers without the framework) and `tests/agent-exercise` (the phase 5 support-module exercise) were removed in this branch; both were last present at commit `f5ae844`.
