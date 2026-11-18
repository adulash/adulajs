import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  bumpKind,
  changelogSection,
  moveUnreleased,
  nextVersion,
  semverProblems,
  upgradeBaseline,
  VERSION_FILES,
} from '../../scripts/lib/release-version.mjs'
import { guard, prepare } from '../../scripts/release.mjs'

const repo = fileURLToPath(new URL('../../', import.meta.url))

test('patch, minor and major follow semantic versioning; an exact version must move forward', () => {
  assert.equal(nextVersion('2.3.0', 'patch'), '2.3.1')
  assert.equal(nextVersion('2.3.4', 'minor'), '2.4.0')
  assert.equal(nextVersion('2.3.4', 'major'), '3.0.0')
  assert.equal(nextVersion('2.3.0', '2.3.7'), '2.3.7')
  assert.throws(() => nextVersion('2.3.0', '2.3.0'), /not after/)
  assert.throws(() => nextVersion('2.3.0', '2.2.9'), /not after/)
  assert.throws(() => nextVersion('2.3.0', '2.4.0-beta.1'), /stable/)
  assert.equal(bumpKind('2.3.0', '2.3.1'), 'patch')
  assert.equal(bumpKind('2.3.1', '2.4.0'), 'minor')
  assert.equal(bumpKind('2.9.9', '3.0.0'), 'major')
})

test('a patch keeps the public API, a minor only adds, a major may break', () => {
  const before = { '.': { a: { kind: 'FunctionDeclaration', type: '() => void' } } }
  const added = { '.': { ...before['.'], b: { kind: 'FunctionDeclaration', type: '() => void' } } }
  const changed = { '.': { a: { kind: 'FunctionDeclaration', type: '(x: number) => void' } } }
  assert.deepEqual(semverProblems('patch', before, before), [])
  assert.match(semverProblems('patch', before, added)[0], /minor needed/)
  assert.deepEqual(semverProblems('minor', before, added), [])
  assert.match(semverProblems('minor', before, changed)[0], /major needed/)
  assert.match(semverProblems('patch', before, {})[0], /major needed/)
  assert.deepEqual(semverProblems('major', before, changed), [])
})

test('the upgrade starts from the newest published version before this one', () => {
  const published = ['1.0.0', '1.2.0', '2.2.0', '2.3.0', '0.0.0-stage']
  assert.equal(upgradeBaseline(published, '2.3.1'), '2.3.0')
  assert.equal(upgradeBaseline(published, '2.3.0'), '2.2.0')
  assert.throws(() => upgradeBaseline(published, '1.0.0'), /No published version/)
})

test('the Unreleased entries move under the dated version and become its release notes', () => {
  const changelog = '# Changelog\n\n## Unreleased\n\n* Fix a dialog.\n\n## 2.3.0 — 2026-11-14\n\nOld.\n'
  const moved = moveUnreleased(changelog, '2.3.1', '2026-11-18')
  assert.equal(moved, '# Changelog\n\n## Unreleased\n\n## 2.3.1 — 2026-11-18\n\n* Fix a dialog.\n\n## 2.3.0 — 2026-11-14\n\nOld.\n')
  assert.equal(changelogSection(moved, '2.3.1'), '* Fix a dialog.\n')
  assert.equal(changelogSection(moved, '2.3.0'), 'Old.\n')
  assert.throws(() => moveUnreleased(moved, '2.3.2', '2026-11-18'), /nothing under/)
  assert.throws(() => changelogSection(moved, '2.3.9'), /no section/)
  assert.throws(() => moveUnreleased(changelog, '2.3.0', '2026-11-18'), /already has 2\.3\.0/)
})

test('the real CHANGELOG has release notes for the current version', async () => {
  const version = JSON.parse(await readFile(join(repo, 'packages/adula/package.json'), 'utf8')).version
  assert.ok(changelogSection(await readFile(join(repo, 'CHANGELOG.md'), 'utf8'), version).length > 20)
})

/** A throwaway copy of the files prepare edits, with the version under test. */
async function fixture(unreleased) {
  const dir = await mkdtemp(join(tmpdir(), 'adula-release-'))
  for (const file of [...VERSION_FILES.map((f) => f.path), 'CHANGELOG.md', 'packages/adula/api/adula-api.json'])
    await cp(join(repo, file), join(dir, file))
  const changelog = await readFile(join(dir, 'CHANGELOG.md'), 'utf8')
  // Whatever main has under Unreleased is replaced by the fixture's own entry.
  await writeFile(join(dir, 'CHANGELOG.md'), changelog.replace(/^## Unreleased\s*\n[\s\S]*?(?=^## )/m, `## Unreleased\n\n${unreleased}`))
  return dir
}

test('release:prepare sets every version and dates the CHANGELOG, or changes nothing', async () => {
  const current = JSON.parse(await readFile(join(repo, 'packages/adula/package.json'), 'utf8')).version
  const expected = nextVersion(current, 'patch')
  const dir = await fixture('* Fix a dialog.\n\n')
  try {
    const result = await prepare(dir, 'patch', '2026-11-18')
    assert.equal(result.version, expected)
    for (const file of VERSION_FILES) {
      const text = await readFile(join(dir, file.path), 'utf8')
      if (file.json) assert.equal(JSON.parse(text).version, expected, file.path)
      else assert.ok(text.includes(expected) && !text.includes(current), file.path)
    }
    // Dependency versions that happen to equal the release are left alone.
    const reference = JSON.parse(await readFile(join(dir, 'apps/reference/package.json'), 'utf8'))
    const original = JSON.parse(await readFile(join(repo, 'apps/reference/package.json'), 'utf8'))
    assert.deepEqual(reference.devDependencies, original.devDependencies)
    const changelog = await readFile(join(dir, 'CHANGELOG.md'), 'utf8')
    assert.equal(changelogSection(changelog, expected), '* Fix a dialog.\n')
    // Nothing left to release: refused before any file changes.
    const before = await readFile(join(dir, 'package.json'), 'utf8')
    await assert.rejects(prepare(dir, 'patch', '2026-11-18'), /nothing under/)
    assert.equal(await readFile(join(dir, 'package.json'), 'utf8'), before)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the release guard skips a version already published', async () => {
  const current = JSON.parse(await readFile(join(repo, 'packages/adula/package.json'), 'utf8')).version
  assert.equal((await guard(repo, current)).release, false)
  assert.equal((await guard(repo, undefined)).release, true)
})
