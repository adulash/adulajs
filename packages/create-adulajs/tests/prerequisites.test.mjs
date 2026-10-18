import { test } from 'node:test'
import assert from 'node:assert/strict'
import { prepareDocker } from '../src/prerequisites.mjs'
import { checkDocker } from '../src/system.mjs'

const missing = () => {
  throw Object.assign(new Error('missing'), { code: 'DOCKER_MISSING' })
}
const docker = { command: 'docker', prefix: [], display: 'docker' }

test('ready Docker continues without asking to install anything', async () => {
  assert.deepEqual(
    await prepareDocker({
      detect: async () => docker,
      question: async () => assert.fail('unexpected prompt'),
    }),
    { docker }
  )
})

test('unattended setup never installs missing host software', async () => {
  await assert.rejects(
    prepareDocker({ detect: missing, execute: async () => assert.fail('unexpected install') }),
    /missing/
  )
})

test('declining or ambiguous consent never installs and can select existing services', async () => {
  for (const answer of ['', 'no', 'maybe']) {
    const answers = [answer, './local.json']
    assert.deepEqual(
      await prepareDocker({
        platform: 'win32',
        detect: missing,
        question: async () => answers.shift(),
        execute: async () => assert.fail('unexpected install'),
      }),
      { connection: './local.json' }
    )
  }
  await assert.rejects(
    prepareDocker({
      platform: 'win32',
      detect: missing,
      question: async () => '',
      execute: async () => assert.fail('unexpected install'),
    }),
    /cancelled.*No software was installed/
  )
})

test('explicit consent installs the exact Docker package then verifies the engine', async () => {
  const answers = ['yes', '']
  const calls = []
  let checks = 0
  const result = await prepareDocker({
    platform: 'win32',
    detect: async () => {
      if (!checks++) missing()
      return docker
    },
    question: async () => answers.shift(),
    execute: async (...args) => {
      calls.push(args)
    },
  })
  assert.deepEqual(result, { docker })
  assert.deepEqual(calls, [
    [
      'winget',
      ['install', '--id', 'Docker.DockerDesktop', '--exact', '--source', 'winget', '--interactive'],
    ],
  ])
  assert.equal(checks, 2)
})

test('restart, installer failure and unready engine stop before creating the system', async () => {
  for (const scenario of ['restart', 'failure', 'unready']) {
    const answers = ['y', scenario === 'restart' ? 'restart' : '']
    await assert.rejects(
      prepareDocker({
        platform: 'win32',
        detect: missing,
        question: async () => answers.shift(),
        execute: async () => {
          if (scenario === 'failure') throw new Error('failed')
        },
      }),
      /[Nn]o system files or databases have been created/
    )
  }
})

test('stopped engine asks for startup and retries without reinstalling', async () => {
  let checks = 0
  const result = await prepareDocker({
    detect: async () => {
      if (!checks++) throw Object.assign(new Error('stopped'), { code: 'DOCKER_STOPPED' })
      return docker
    },
    question: async () => '',
    execute: async () => assert.fail('unexpected install'),
  })
  assert.deepEqual(result, { docker })
})

test('Windows falls back to WSL using argument arrays and verifies its engine', async () => {
  const calls = []
  const runtime = await checkDocker(async (command, args) => {
    calls.push([command, ...args])
    if (command !== 'wsl.exe') throw new Error('not available')
  }, 'win32')
  assert.deepEqual(runtime, {
    command: 'wsl.exe',
    prefix: ['--exec', 'docker'],
    display: 'wsl.exe --exec docker',
  })
  assert.deepEqual(calls.slice(-2), [
    ['wsl.exe', '--exec', 'docker', 'version'],
    ['wsl.exe', '--exec', 'docker', 'compose', 'version'],
  ])
})
