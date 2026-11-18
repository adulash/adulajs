// Version arithmetic and file edits shared by `pnpm release:prepare` and release.yml (ADR 054).
// Pure functions only: the callers read and write the files.
import { compare } from './api-compare.mjs'

const STABLE = /^(\d+)\.(\d+)\.(\d+)$/

export function parse(version) {
  const match = STABLE.exec(version)
  if (!match) throw new Error(`Only stable X.Y.Z versions are released, got ${version}`)
  return match.slice(1).map(Number)
}

/** -1, 0 or 1, comparing two stable versions. */
export function compareVersions(a, b) {
  const [x, y] = [parse(a), parse(b)]
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1
  return 0
}

/** The next version from `patch`, `minor`, `major` or an exact X.Y.Z greater than the current one. */
export function nextVersion(current, spec) {
  const [major, minor, patch] = parse(current)
  const next =
    spec === 'patch'
      ? `${major}.${minor}.${patch + 1}`
      : spec === 'minor'
        ? `${major}.${minor + 1}.0`
        : spec === 'major'
          ? `${major + 1}.0.0`
          : spec
  if (compareVersions(next, current) <= 0) throw new Error(`${next} is not after ${current}`)
  return next
}

/** What kind of release goes from `previous` to `next`. */
export function bumpKind(previous, next) {
  const [a, b] = [parse(previous), parse(next)]
  if (compareVersions(next, previous) <= 0) throw new Error(`${next} is not after ${previous}`)
  return b[0] !== a[0] ? 'major' : b[1] !== a[1] ? 'minor' : 'patch'
}

/**
 * Semantic versioning against the public API report: a removed or changed export needs a
 * major release, an added one at least a minor release; a patch release keeps the API.
 * Returns the reasons the bump is too small, or an empty list.
 */
export function semverProblems(kind, previousApi, currentApi) {
  const { breaking, added } = compare(previousApi, currentApi)
  if (breaking.length && kind !== 'major')
    return [`a ${kind} release cannot remove or change exports (major needed): ${breaking.slice(0, 5).join(', ')}`]
  if (added.length && kind === 'patch')
    return [`a patch release cannot add exports (minor needed): ${added.slice(0, 5).join(', ')}`]
  return []
}

/** The greatest published version before `current`: the genuine upgrade's starting point. */
export function upgradeBaseline(published, current) {
  const earlier = published.filter((v) => STABLE.test(v) && compareVersions(v, current) < 0)
  if (!earlier.length) throw new Error(`No published version before ${current}`)
  return earlier.sort(compareVersions).at(-1)
}

const UNRELEASED = /^## Unreleased[ \t]*\r?\n/m

/** Moves the Unreleased entries under `## <version> — <date>`, leaving Unreleased empty. */
export function moveUnreleased(changelog, version, date) {
  const match = UNRELEASED.exec(changelog)
  if (!match) throw new Error('CHANGELOG.md has no "## Unreleased" heading')
  const start = match.index + match[0].length
  const end = changelog.slice(start).search(/^## /m)
  const body = (end === -1 ? changelog.slice(start) : changelog.slice(start, start + end)).trim()
  if (!body) throw new Error('CHANGELOG.md has nothing under "## Unreleased" to release')
  if (new RegExp(`^## ${version.replaceAll('.', '\\.')}\\b`, 'm').test(changelog))
    throw new Error(`CHANGELOG.md already has ${version}`)
  const rest = end === -1 ? '' : changelog.slice(start + end)
  return `${changelog.slice(0, start)}\n## ${version} — ${date}\n\n${body}\n\n${rest}`.replace(/\n+$/, '\n')
}

/** The entries of one version, for its GitHub release notes. */
export function changelogSection(changelog, version) {
  const heading = new RegExp(`^## ${version.replaceAll('.', '\\.')}(?: |$).*\\r?\\n`, 'm')
  const match = heading.exec(changelog)
  if (!match) throw new Error(`CHANGELOG.md has no section for ${version}`)
  const start = match.index + match[0].length
  const end = changelog.slice(start).search(/^## /m)
  return (end === -1 ? changelog.slice(start) : changelog.slice(start, start + end)).trim() + '\n'
}

/**
 * Every file that names the release version, and how to set it. JSON files keep their
 * formatting: only the top-level "version" value changes.
 */
export const VERSION_FILES = [
  { path: 'package.json', json: true },
  { path: 'apps/reference/package.json', json: true },
  { path: 'apps/reference/adula.lock.json', json: true },
  { path: 'packages/adula/package.json', json: true },
  { path: 'packages/ui/package.json', json: true },
  { path: 'packages/create-adulajs/package.json', json: true },
  { path: 'packages/adula/agent/capabilities.md', pattern: /^(# AdulaJS capabilities \()\d+\.\d+\.\d+(\))/m },
  { path: 'packages/ui/README.md', pattern: /^(Version )\d+\.\d+\.\d+(\.)/m },
]

export function setVersion(text, file, version) {
  if (file.json) {
    // The top-level key sits at two spaces; nested "version" keys sit deeper.
    const next = text.replace(/^( {2}"version": ")[^"]+(")/m, `$1${version}$2`)
    if (JSON.parse(next).version !== version) throw new Error(`${file.path} has no top-level version`)
    return next
  }
  if (!file.pattern.test(text)) throw new Error(`${file.path} does not state the version`)
  return text.replace(file.pattern, `$1${version}$2`)
}
