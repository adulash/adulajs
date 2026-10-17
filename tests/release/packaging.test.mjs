import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { packageNames, tarballName, validateManifest, validateContents } from '../../scripts/check-release.mjs'

const core = JSON.parse(await readFile(new URL('../../packages/adula/package.json', import.meta.url), 'utf8'))

test('refuses a package with the wrong provenance destination or local dependency', () => {
  validateManifest(core, 'adula', core.version)
  assert.throws(() => validateManifest({ ...core, repository: { ...core.repository, url: 'git+https://github.com/other/repo.git' } }, core.name, core.version), /repository mismatch/)
  assert.throws(() => validateManifest({ ...core, dependencies: { ...core.dependencies, helper: 'workspace:*' } }, core.name, core.version), /local dependency/)
  assert.throws(() => validateManifest(core, 'adula', '9.9.9'), /versions must match/)
})

test('refuses private files and archives missing executable exports', () => {
  assert.throws(() => validateContents(core, ['package/.env.production']), /Private file/)
  assert.throws(() => validateContents(core, ['package/build/tests/authorization.js']), /Private source/)
  assert.throws(() => validateContents(core, ['package/../private']), /Unsafe archive/)
  assert.throws(() => validateContents(core, ['package/package.json', 'package/README.md']), /Required package file missing/)
})

test('every published manifest matches its expected name and the shared version', async () => {
  for (const [index, directory] of ['adula', 'ui', 'create-adula-app'].entries()) {
    const pkg = JSON.parse(await readFile(new URL(`../../packages/${directory}/package.json`, import.meta.url), 'utf8'))
    validateManifest(pkg, packageNames[index], core.version)
  }
  assert.equal(tarballName('@adula/ui', '2.1.0'), 'adula-ui-2.1.0.tgz')
  assert.equal(tarballName('create-adulajs', '2.1.0'), 'create-adulajs-2.1.0.tgz')
})
