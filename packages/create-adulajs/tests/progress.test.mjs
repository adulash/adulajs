import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Progress } from '../src/progress.mjs'
import { run } from '../src/system.mjs'

test('redirected and NO_COLOR progress has readable stages without terminal escapes', () => {
  for (const [isTTY, env] of [
    [false, {}],
    [true, { NO_COLOR: '1' }],
    [true, { TERM: 'dumb' }],
  ]) {
    let output = ''
    const progress = new Progress(
      {
        isTTY,
        write: (text) => {
          output += text
        },
      },
      env
    )
    progress.start('Prepare application')
    progress.start('Install dependencies')
    progress.finish(true)
    assert.match(output, /OK \[1\/6\] Prepare application/)
    assert.match(output, /FAIL \[2\/6\] Install dependencies/)
    assert.doesNotMatch(output, /\x1b|\r/)
    assert.equal(progress.timer, undefined)
  }
})
test('interactive progress stops its spinner after success and failure', () => {
  let output = ''
  const progress = new Progress(
    {
      isTTY: true,
      write: (text) => {
        output += text
      },
    },
    {}
  )
  progress.start('Build application')
  assert.ok(progress.timer)
  progress.finish()
  assert.equal(progress.timer, undefined)
  assert.match(output, /\x1b\[32mOK/)
})
test('child failure points to retained output without flooding progress', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'adula-progress-'))
  const logFile = join(directory, 'install.log')
  await assert.rejects(
    run(process.execPath, ['-e', "console.error('test failure detail');process.exit(2)"], {
      logFile,
    }),
    /Command failed/
  )
  assert.match(await readFile(logFile, 'utf8'), /test failure detail/)
})
