import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { askDetails, pipedQuestions, prompts } from '../src/prompts.mjs'

const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url))

test('the creator asks only for the company and administrator, never an identity', async () => {
  const asked = []
  const answers = ['شركة ألف', 'owner@example.test']
  const details = await askDetails(async (message) => {
    asked.push(message)
    return answers.shift()
  })
  assert.deepEqual(asked, [prompts.company, prompts.email])
  assert.deepEqual(details, { company: 'شركة ألف', email: 'owner@example.test' })
  assert(!Object.values(prompts).some((message) => /identity|logo|colou?r/i.test(message)))
  // Options already supplied are not asked again.
  const none = []
  await askDetails(async (message) => none.push(message), { company: 'ب', email: 'b@example.test' })
  assert.deepEqual(none, [])
})

test('piped answers that arrive early are kept, and ended input fails clearly', async () => {
  const input = new PassThrough()
  const output = new PassThrough()
  let printed = ''
  output.on('data', (chunk) => (printed += chunk))
  const reader = pipedQuestions(input, output)
  input.end('first\nsecond\n')
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(await reader.question('One: '), 'first')
  assert.equal(await reader.question('Two: '), 'second')
  await assert.rejects(reader.question('Three: '), /Input ended .*Three:/)
  reader.close()
  assert.match(printed, /One: first\nTwo: second\nThree: /)
})

test('piped input drives the real creator prompts and validation stops before any write', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'adula-prompts-'))
  try {
    const target = join(parent, 'system')
    const result = spawnSync(
      process.execPath,
      [cli, target, '--services', 'existing', '--connection', join(parent, 'absent.json')],
      { input: 'شركة الاختبار\nnot-an-email\n', encoding: 'utf8' }
    )
    assert.notEqual(result.status, 0)
    assert.match(result.stdout, new RegExp(`${prompts.company}شركة الاختبار`))
    assert.match(result.stdout, new RegExp(`${prompts.email}not-an-email`))
    assert.doesNotMatch(result.stdout, /identity/i)
    assert.match(result.stderr, /Invalid administrator email/)
    assert.deepEqual(await readdir(parent), [])
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})

test('closed input without the required options fails with a clear message', () => {
  const result = spawnSync(process.execPath, [cli], { input: '', encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Input ended before this question was answered: System directory:/)
})
