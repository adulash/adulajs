import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { holdDockerSession } from '../src/docker-session.mjs'

test('native Docker and existing services need no WSL process', async () => {
  for (const runtime of [undefined, { command: 'docker' }]) {
    const release = await holdDockerSession(runtime, () => assert.fail('unexpected process'))
    release()
  }
})

test('WSL lease stays alive across child commands and releases on pipe EOF', async () => {
  let child
  const release = await holdDockerSession({ command: 'wsl.exe' }, (command, args, options) => {
    assert.equal(command, 'wsl.exe')
    assert.deepEqual(args, ['--exec', 'sh', '-c', 'printf ready; cat >/dev/null'])
    assert.equal(options.windowsHide, true)
    child = spawn(
      process.execPath,
      ['-e', "process.stdout.write('ready'); process.stdin.resume()"],
      options
    )
    return child
  })
  try {
    await once(spawn(process.execPath, ['-e', ''], { windowsHide: true }), 'close')
    assert.equal(child.exitCode, null)
  } finally {
    const closed = once(child, 'close')
    release()
    assert.equal((await closed)[0], 0)
  }
})

test('failed WSL startup fails before running installation', async () => {
  await assert.rejects(
    holdDockerSession({ command: 'wsl.exe' }, (_command, _args, options) =>
      spawn(process.execPath, ['-e', 'process.exit(1)'], options)
    ),
    /ended before it was ready/
  )
})
