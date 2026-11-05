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

test('help lists every option in one aligned block before the explanatory paragraph', () => {
  const result = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  const lines = result.stdout.split(/\r?\n/)
  const first = lines.findIndex((line) => line.startsWith('  --'))
  assert.notEqual(first, -1, 'help lists options')
  // The block runs from the first option to the first blank line; a wrapped description
  // continues on a line indented to the description column.
  const end = lines.indexOf('', first)
  const block = lines.slice(first, end)
  const options = block.filter((line) => line.startsWith('  --'))
  const description = (line) => line.match(/^\s*\S+(?: \S+)*?\s{2,}/)[0].length
  const columns = new Set(options.map(description))
  assert.equal(columns.size, 1, `descriptions start in one column:\n${options.join('\n')}`)
  const [column] = columns
  for (const line of block.filter((item) => !item.startsWith('  --')))
    assert.equal(line.search(/\S/), column, `continuation is aligned: ${line}`)
  // Every documented option sits in that block, ending with --help.
  const listed = options.map((line) => line.trim().split(/\s/)[0])
  assert.deepEqual(listed, [
    '--company',
    '--admin-email',
    '--identity',
    '--services',
    '--connection',
    '--database',
    '--packages',
    '--yes',
    '--help',
  ])
  // The paragraph about prompts follows the block, and no creation option comes after it
  // before the separate upgrade section.
  const paragraph = lines.findIndex((line) => line.startsWith('Without --yes'))
  const upgrade = lines.findIndex((line) => line.startsWith('Upgrade a 1.x system'))
  assert(paragraph > end, 'the explanatory paragraph follows the options')
  assert(upgrade > paragraph, 'the upgrade section follows the creation help')
  assert(!lines.slice(end, upgrade).some((line) => line.startsWith('  --')))
  // The upgrade options form their own aligned block.
  const upgradeOptions = lines.slice(upgrade).filter((line) => line.startsWith('  --'))
  assert.deepEqual(
    upgradeOptions.map((line) => line.trim().split(/\s/)[0]),
    ['--force', '--no-install', '--packages']
  )
  assert.equal(new Set(upgradeOptions.map(description)).size, 1, upgradeOptions.join('\n'))
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
