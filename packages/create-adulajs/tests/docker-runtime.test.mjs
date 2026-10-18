import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectDocker } from '../src/docker-runtime.mjs'
import { runServices } from '../src/services.mjs'

test('working direct Docker wins on Windows without probing WSL', async () => {
  const calls = []
  const backend = await detectDocker(
    async (command, args) => calls.push([command, ...args]),
    'win32'
  )
  assert.equal(backend.command, 'docker')
  assert.deepEqual(calls, [
    ['docker', 'version'],
    ['docker', 'compose', 'version'],
  ])
})

for (const failure of ['version', 'compose']) {
  test(`Windows falls back only after direct ${failure} fails`, async () => {
    const calls = []
    const backend = await detectDocker(async (command, args) => {
      calls.push([command, ...args])
      if (command === 'docker' && args[0] === failure) throw new Error('unavailable')
    }, 'win32')
    assert.equal(backend.command, 'wsl.exe')
    assert.deepEqual(calls.slice(-2), [
      ['wsl.exe', '--exec', 'docker', 'version'],
      ['wsl.exe', '--exec', 'docker', 'compose', 'version'],
    ])
    assert.equal(calls[0][0], 'docker')
  })
}

test('both unavailable produce an actionable error and Linux never probes WSL', async () => {
  for (const platform of ['win32', 'linux']) {
    const commands = []
    await assert.rejects(
      detectDocker(async (command) => {
        commands.push(command)
        throw new Error('offline')
      }, platform),
      /Docker with Compose is unavailable.*--services existing/
    )
    assert.deepEqual(commands, platform === 'win32' ? ['docker', 'wsl.exe'] : ['docker'])
  }
})

for (const backend of ['direct', 'wsl']) {
  test(`${backend} stays selected for dev, tests, Ace migrations, start and stop`, async () => {
    for (const args of [['dev'], ['test'], ['ace', 'migration:run', '--force'], ['up'], ['stop']]) {
      const calls = []
      let held = false
      let releases = 0
      const hold = async () => {
        assert.equal(backend, 'wsl', 'direct Docker must never acquire a WSL session')
        held = true
        return () => {
          held = false
          releases++
        }
      }
      await runServices(
        backend,
        args,
        async (command, params) => {
          calls.push([command, ...params])
          if (command === process.execPath) assert.equal(held, backend === 'wsl')
        },
        hold
      )
      const docker = calls.filter(([command]) => command !== process.execPath)
      assert.equal(docker.length, 1)
      assert.equal(docker[0][0], backend === 'direct' ? 'docker' : 'wsl.exe')
      assert.equal(held, false)
      assert.equal(releases, backend === 'wsl' && !['up', 'stop'].includes(args[0]) ? 1 : 0)
      if (args[0] === 'ace')
        assert.deepEqual(calls[1], [process.execPath, 'ace', 'migration:run', '--force'])
    }
  })

  test(`${backend} failure never switches daemon and releases the migration session`, async () => {
    for (const failure of ['compose', 'migration']) {
      const calls = []
      let released = false
      await assert.rejects(
        runServices(
          backend,
          ['ace', 'migration:run'],
          async (command) => {
            calls.push(command)
            if ((failure === 'compose') === (command !== process.execPath))
              throw new Error('failed')
          },
          async () => () => {
            released = true
          }
        ),
        /failed/
      )
      assert.deepEqual(calls, [
        backend === 'direct' ? 'docker' : 'wsl.exe',
        ...(failure === 'migration' ? [process.execPath] : []),
      ])
      assert.equal(released, backend === 'wsl')
    }
  })
}
