import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url))

test('direct creator executable prints help without starting installation', () => {
  const result = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /npm create adulajs my-system/)
  assert.match(result.stdout, /npx create-adulajs@latest my-system/)
})

test('npm-style symlink executable invokes the creator on Unix', {
  skip: process.platform === 'win32' ? 'Windows npm uses command shims, exercised by test:create' : false,
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'adula-bin-'))
  try {
    const bin = join(directory, 'create-adula')
    await symlink(cli, bin)
    const result = spawnSync(process.execPath, [bin, '--help'], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /Create a new business system/)
    assert.match(result.stdout, /npx create-adulajs@latest my-system/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
