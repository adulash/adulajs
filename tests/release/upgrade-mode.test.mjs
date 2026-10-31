import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { requireSyntheticRehearsal, upgradeMode } from '../../scripts/upgrade-mode.mjs'

test('synthetic upgrade requires explicit mode and cannot pretend to select a released version', () => {
  assert.throws(() => requireSyntheticRehearsal([], {}), /NOT release acceptance/)
  assert.throws(() => requireSyntheticRehearsal(['--synthetic'], { ADULA_PREVIOUS_VERSION: '0.1.0' }), /cannot select a published baseline/)
  assert.throws(() => requireSyntheticRehearsal(['--synthetic', '--real'], {}))
  assert.equal(requireSyntheticRehearsal(['--synthetic'], {}), '0.1.0')
})

test('upgrade entrypoint refuses a purported predecessor before changing package manifests', async () => {
  const script = fileURLToPath(new URL('../../scripts/test-upgrade.mjs', import.meta.url))
  const paths = ['adula', 'ui'].map((name) => new URL(`../../packages/${name}/package.json`, import.meta.url))
  const before = await Promise.all(paths.map((path) => readFile(path, 'utf8')))
  const run = spawnSync(process.execPath, [script, '--synthetic'], {
    env: { ...process.env, ADULA_PREVIOUS_VERSION: '0.1.0' }, encoding: 'utf8', windowsHide: true,
  })
  assert.equal(run.status, 1)
  assert.match(run.stderr, /cannot select a published baseline/)
  assert.deepEqual(await Promise.all(paths.map((path) => readFile(path, 'utf8'))), before)
})

test('the genuine upgrade names an exact, earlier published baseline', () => {
  assert.deepEqual(upgradeMode(['--published=0.2.0-alpha.1'], {}, '0.2.0-alpha.4'), {
    mode: 'published',
    previous: '0.2.0-alpha.1',
  })
  assert.throws(() => upgradeMode(['--published=latest'], {}, '1.0.0'), /exact version/)
  assert.throws(() => upgradeMode(['--published=1.0.0'], {}, '1.0.0'), /earlier published/)
  assert.deepEqual(upgradeMode(['--synthetic'], {}, '1.0.0'), { mode: 'synthetic', previous: '0.1.0' })
})
