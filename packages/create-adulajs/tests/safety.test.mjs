import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, symlink, access, writeFile } from 'node:fs/promises'
import { execFile, spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseEnv, promisify } from 'node:util'
import { createRequire } from 'node:module'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { createServer } from 'node:net'
import { runServices } from '../src/services.mjs'
import {
  assertEmpty,
  writeNew,
  projectName,
  dotenv,
  prepareEnvironment,
  exampleEnvironment,
  readIdentity,
  readJson,
  brandCss,
  composeFile,
} from '../src/project.mjs'
import {
  childEnvironment,
  databaseNames,
  pingRedis,
  packageManager,
  packageManagerBin,
  checkDocker,
} from '../src/system.mjs'
import { main } from '../src/cli.mjs'

test('invalid directory is rejected before missing company details or Docker checks', async () => {
  await assert.rejects(main(['Dental-Gate', '--yes']), /dental-gate.*Dental-Gate/)
})

test('Docker preflight distinguishes missing Compose from an unavailable engine', async () => {
  const calls = []
  await checkDocker(async (command, args) => {
    calls.push([command, ...args])
  })
  assert.deepEqual(calls, [
    ['docker', 'version'],
    ['docker', 'compose', 'version'],
  ])
  await assert.rejects(
    checkDocker(async () => {
      throw new Error('missing')
    }, 'win32'),
    /Docker with Compose.*PowerShell.*--services existing/
  )
  await assert.rejects(
    checkDocker(async (_command, args) => {
      if (args[0] === 'version') throw new Error('stopped')
    }, 'linux'),
    /Docker with Compose is unavailable.*docker version/
  )
})

test('CLI with no Docker fails before writing an application', async () => {
  const root = await mkdtemp(join(tmpdir(), 'adula-preflight-'))
  const target = join(root, 'dental-gate')
  const env = childEnvironment()
  for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key]
  env.PATH = root
  env.ProgramFiles = root
  await assert.rejects(
    promisify(execFile)(
      process.execPath,
      [
        fileURLToPath(new URL('../src/cli.mjs', import.meta.url)),
        target,
        '--company',
        'Dental-Gate',
        '--admin-email',
        'admin@example.test',
        '--yes',
      ],
      { env, windowsHide: true }
    ),
    (error) => {
      assert.match(error.stderr, /Docker with Compose.*--services existing/)
      assert.doesNotMatch(error.stderr, /ERR_MODULE_NOT_FOUND/)
      return true
    }
  )
  await assert.rejects(access(target), { code: 'ENOENT' })
})

test('the generated consumer includes the complete operational recovery command chain', async () => {
  const template = JSON.parse(
    await readFile(new URL('../build/template.json', import.meta.url), 'utf8')
  )
  for (const name of [
    'backup_create',
    'backup_verify_snapshot',
    'backup_restore_files',
    'backup_restore_test',
  ])
    assert.ok(template.files[`commands/${name}.ts`], `Missing operational command ${name}`)
  for (const name of ['backup_snapshot', 'backup_publish'])
    assert.ok(template.files[`app/services/${name}.ts`], `Missing snapshot service ${name}`)
})

test('bundled pnpm runs outside the application without a global installation', async () => {
  const [command, ...args] = await packageManager()
  const env = childEnvironment()
  for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key]
  const result = await promisify(execFile)(command, [...args, '--version'], {
    cwd: tmpdir(),
    env,
    windowsHide: true,
  })
  assert.equal(result.stdout.trim(), '11.19.0')
  await access(join(await packageManagerBin(), process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'))
})

test('creator never overwrites a nonempty project or escapes its destination', async () => {
  const root = await mkdtemp(join(tmpdir(), 'adula-creator-'))
  await assertEmpty(root)
  await writeNew(root, 'keep.txt', 'owned')
  await assert.rejects(assertEmpty(root), /nonempty/)
  await assert.rejects(writeNew(root, 'keep.txt', 'replaced'), /EEXIST/)
  await assert.rejects(writeNew(root, '../escape.txt', ''), /Unsafe/)
  await assert.rejects(writeNew(root, 'a\\..\\escape.txt', ''), /Unsafe/)
  assert.equal(await readFile(join(root, 'keep.txt'), 'utf8'), 'owned')
  const outside = await mkdtemp(join(tmpdir(), 'adula-outside-'))
  await symlink(outside, join(root, 'link'), 'junction')
  await assert.rejects(writeNew(root, 'link/escape.txt', ''), /symbolic link/)
})

test('invalid noninteractive input stops before any project creation', async () => {
  await assert.rejects(main(['invalid', '--yes']), /--company/)
  await assert.rejects(main(['invalid', '--services', 'unknown']), /docker or existing/)
  await assert.rejects(main(['invalid', '--services', 'existing']), /--connection/)
  await assert.rejects(
    main([
      'invalid',
      '--company',
      'Company',
      '--admin-email',
      'admin@example.test',
      '--database',
      'unsafe;name',
      '--yes',
    ]),
    /Database name/
  )
  assert.throws(() => projectName('bad;name'), /Project directory name/)
  assert.throws(() => databaseNames('app', '";drop database postgres'), /Invalid/)
})

test('environment files preserve special characters without interpolation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'adula-env-'))
  const secret = '$not_expanded#=\\abc"\'suffix\\'
  const values = { SECRET: 'simple-safe-value', LABEL: 'شركة الاختبار' }
  assert.deepEqual({ ...parseEnv(dotenv(values)) }, values)
  assert.throws(() => dotenv({ PASSWORD: 'one\nDB_DATABASE=production' }), /unsupported/)
  const encoded = await prepareEnvironment(root, { PASSWORD: secret })
  assert.equal(parseEnv(dotenv(encoded)).PASSWORD, 'file:./tmp/env/PASSWORD')
  assert.equal(await readFile(join(root, 'tmp/env/PASSWORD'), 'utf8'), secret)
  const require = createRequire(new URL('../../../apps/reference/package.json', import.meta.url))
  const { EnvParser } = await import(pathToFileURL(require.resolve('@adonisjs/core/env')).href)
  const parsed = await new EnvParser(dotenv(encoded), pathToFileURL(root + '/'), {
    ignoreProcessEnv: true,
  }).parse()
  assert.equal(parsed.PASSWORD, secret)
})

test('malformed connection JSON never reveals its contents', async () => {
  const root = await mkdtemp(join(tmpdir(), 'adula-profile-'))
  await writeNew(root, 'profile.json', 'secret-that-must-not-appear')
  await assert.rejects(readJson(join(root, 'profile.json'), 'الاتصال'), (error) => {
    assert(!error.message.includes('secret-that-must-not-appear'))
    return /JSON/.test(error.message)
  })
})

test('identity is validated and contrast tokens follow supplied colors', async () => {
  assert.equal((await readIdentity(undefined, 'شركة ألف')).company, 'شركة ألف')
  const root = await mkdtemp(join(tmpdir(), 'adula-brand-'))
  await writeNew(root, 'brand.json', JSON.stringify({ primaryColor: 'red; } body { display:none' }))
  await assert.rejects(readIdentity(join(root, 'brand.json'), 'Company'), /Brand color/)
  await writeNew(
    root,
    'extra.json',
    JSON.stringify({ logoBytes: 'unexpected', logoPath: '/extra.js' })
  )
  await assert.rejects(readIdentity(join(root, 'extra.json'), 'Company'), /only/)
  assert.match(brandCss({ primaryColor: '#ffffff' }), /--primary-foreground: #000000/)
  assert.match(brandCss({ primaryColor: '#000000' }), /--primary-foreground: #ffffff/)
  // Identity reaches the inline theme only through its variables (issue #23).
  assert.match(brandCss({ primaryColor: '#3949ab' }), /--ring: #3949ab;/)
  assert.equal(
    brandCss({ fontFamily: 'Tajawal' }).trim().split('\n').at(-1),
    ':root { --brand-font: "Tajawal", "IBM Plex Sans Arabic"; }'
  )
})

test('child commands cannot inherit a caller database or test mode', () => {
  const previous = process.env.DB_DATABASE
  process.env.DB_DATABASE = 'never_touch_this'
  try {
    const env = childEnvironment()
    assert.equal(env.DB_DATABASE, undefined)
    assert.equal(env.NODE_ENV, undefined)
    const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path')
    assert.equal(env[pathKey], process.env.PATH)
  } finally {
    if (previous === undefined) delete process.env.DB_DATABASE
    else process.env.DB_DATABASE = previous
  }
})

test('Docker services remain loopback-bound with persistent volumes and health checks', () => {
  const yaml = composeFile()
  assert.match(yaml, /postgres:17/)
  assert.match(yaml, /redis:7/)
  assert.equal((yaml.match(/127\.0\.0\.1:/g) ?? []).length, 2)
  assert.equal((yaml.match(/healthcheck:/g) ?? []).length, 2)
  assert.match(yaml, /pg_stat_statements/)
  assert.match(yaml, /postgres-data:/)
})

test('a closed Redis connection fails instead of silently abandoning setup', async () => {
  const server = createServer((socket) => socket.destroy())
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    await assert.rejects(pingRedis({ host: '127.0.0.1', port: server.address().port }), /Redis/)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('the committed environment example keeps variables but no local secrets or identities', () => {
  const example = exampleEnvironment(
    {
      APP_KEY: 'secret-key',
      DB_HOST: 'db.internal.example',
      DB_USER: 'company_admin',
      DB_PASSWORD: 'file:./tmp/env/DB_PASSWORD',
      DB_DATABASE: 'acme_4f2a',
      REDIS_HOST: '10.0.0.5',
      REDIS_PASSWORD: 'redis-secret',
      MAIL_FROM_ADDRESS: 'owner@acme.example',
      PORT: 3333,
    },
    'acme'
  )
  assert.deepEqual(Object.keys(example).sort(), [
    'APP_KEY',
    'DB_DATABASE',
    'DB_HOST',
    'DB_PASSWORD',
    'DB_USER',
    'MAIL_FROM_ADDRESS',
    'PORT',
    'REDIS_HOST',
    'REDIS_PASSWORD',
  ])
  const text = dotenv(example)
  for (const value of [
    'secret-key',
    'db.internal.example',
    'company_admin',
    'tmp/env',
    'acme_4f2a',
    '10.0.0.5',
    'redis-secret',
    'owner@acme.example',
  ])
    assert.ok(!text.includes(value), value)
})

test('extra test arguments reach the test runner instead of a chained formatter', async () => {
  const template = JSON.parse(
    await readFile(new URL('../build/template.json', import.meta.url), 'utf8')
  )
  const { scripts } = JSON.parse(template.files['package.json'])
  // pnpm appends `test -- --files=...` to the end of the script (issue #22).
  assert.equal(scripts.test, 'node ace test')
  assert.match(template.files['tests/bootstrap.ts'], /teardown:[\s\S]*database\/schema\.ts/)
  const calls = []
  await runServices('direct', ['test', '--files=tests/functional/a.spec.ts'], async (...call) => {
    calls.push(call)
  })
  const run = calls.find(([, params]) => params.includes('test:app'))
  assert.deepEqual(run?.[1].slice(-2), ['test:app', '--files=tests/functional/a.spec.ts'])
})

test('starter pages compose the registry Select instead of native lists', async () => {
  const template = JSON.parse(
    await readFile(new URL('../build/template.json', import.meta.url), 'utf8')
  )
  const pages = Object.entries(template.files).filter(([path]) => path.endsWith('.tsx'))
  assert.ok(pages.length > 10)
  for (const [path, source] of pages) assert.doesNotMatch(source, /<select[\s>]/, path)
})


test('npm run dev starts the event worker next to the HTTP server', async () => {
  const template = JSON.parse(
    await readFile(new URL('../build/template.json', import.meta.url), 'utf8')
  )
  const { scripts } = JSON.parse(template.files['package.json'])
  // Without a worker, every listener waited in the outbox during development (issue #50).
  assert.equal(scripts.dev, 'node scripts/dev.mjs')
  const root = await mkdtemp(join(tmpdir(), 'adula-dev-'))
  try {
    await mkdir(join(root, 'scripts'))
    await writeFile(join(root, 'scripts/dev.mjs'), template.files['scripts/dev.mjs'])
    // A stand-in for ace: the server exits at once, the worker stays until it is stopped.
    await writeFile(
      join(root, 'ace'),
      "require('fs').appendFileSync('calls.log', JSON.stringify(process.argv.slice(2)) + '\\n')\n" +
        "if (process.argv[2] === 'adula:worker') setInterval(() => {}, 1000)\n" +
        "else setTimeout(() => process.exit(3), 500)\n"
    )
    const code = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['scripts/dev.mjs', '--no-clear'], {
        cwd: root,
        stdio: 'ignore',
      })
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        reject(new Error('The development launcher did not stop with the server'))
      }, 20_000)
      child.once('exit', (exitCode) => {
        clearTimeout(timer)
        resolve(exitCode)
      })
    })
    // The server's failure stops the worker and becomes the launcher's exit code.
    assert.equal(code, 3)
    const calls = (await readFile(join(root, 'calls.log'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    assert.deepEqual(calls.sort(), [['adula:worker'], ['serve', '--hmr', '--no-clear']])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
