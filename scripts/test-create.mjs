import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFile, writeFile, mkdir, open, readdir, access } from 'node:fs/promises'
import { dirname, join, resolve, delimiter } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'
import {
  childEnvironment,
  createDatabases,
  npmEntry,
  pingRedis,
} from '../packages/create-adulajs/src/system.mjs'
import { dockerBackend } from '../packages/create-adulajs/src/docker-runtime.mjs'
import { holdDockerSession } from '../packages/create-adulajs/src/docker-session.mjs'
import { packageNames, tarballName } from './check-release.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const work = join(root, '.work')
const require = createRequire(join(root, 'apps/reference/package.json'))
const { Client } = require('pg')
const { chromium } = require('playwright')
const pnpm = process.env.npm_execpath
assert(pnpm?.includes('pnpm'), 'Run pnpm test:create')
const docker = process.argv.slice(2).includes('--docker')
const reusePackages = process.argv.slice(2).includes('--reuse-packages')
assert(
  process.argv.slice(2).every((arg) => ['--', '--docker', '--reuse-packages'].includes(arg)),
  'Usage: pnpm test:create [--docker] [--reuse-packages]'
)
await mkdir(work, { recursive: true })
async function step(name, command, args, cwd = root, env = process.env, failure = false) {
  const path = join(work, `create-${name}.log`)
  const log = await open(path, 'w')
  let code
  try {
    code = await new Promise((done, reject) => {
      const child = spawn(command, args, {
        cwd,
        env,
        stdio: ['ignore', log.fd, log.fd],
        shell: false,
        windowsHide: true,
      })
      child.once('error', reject)
      child.once('exit', (code) => done(code))
    })
  } finally {
    await log.close()
  }
  if (failure ? code === 0 : code !== 0) {
    console.error((await readFile(path, 'utf8')).split(/\r?\n/).slice(-65).join('\n'))
    throw new Error(`Creator check failed: ${name} (exit ${code}, ${path})`)
  }
  console.log(`PASS ${name}`)
}
for (const name of packageNames) {
  if (reusePackages) continue
  // Step names become log file names: @adula/ui -> adula-ui.
  const label = name.replace(/^@/, '').replace('/', '-')
  await step(`${label}-build`, process.execPath, [pnpm, '--filter', name, 'build'])
  await step(`${label}-pack`, process.execPath, [
    pnpm,
    '--filter',
    name,
    'pack',
    '--pack-destination',
    work,
  ])
}
let connection
if (process.env.TEST_DATABASE_URL) {
  const url = new URL(process.env.TEST_DATABASE_URL)
  assert(['postgres:', 'postgresql:'].includes(url.protocol))
  connection = {
    host: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
  }
} else connection = JSON.parse(await readFile(join(work, 'test-database.json'), 'utf8'))
assert(connection.database.endsWith('_test'), 'Acceptance needs a dedicated *_test profile')
const referenceEnv = process.env.TEST_DATABASE_URL
  ? process.env
  : parseEnv(await readFile(join(root, 'apps/reference/.env.test'), 'utf8'))
const profile = {
  postgres: {
    host: connection.host,
    port: connection.port,
    user: connection.user,
    password: connection.password,
  },
  redis: {
    host: referenceEnv.REDIS_HOST ?? '127.0.0.1',
    port: Number(referenceEnv.REDIS_PORT ?? 6379),
    ...(referenceEnv.REDIS_PASSWORD ? { password: referenceEnv.REDIS_PASSWORD } : {}),
  },
}
const profilePath = join(work, 'create-services.json')
await writeFile(profilePath, JSON.stringify(profile), { mode: 0o600 })
const identityPath = join(work, 'create-brand.json')
await writeFile(
  identityPath,
  JSON.stringify({
    primaryColor: '#14532d',
    guidelines: 'Test identity, supplied by the acceptance harness.',
  })
)
const version = JSON.parse(
  await readFile(join(root, 'packages/create-adulajs/package.json'), 'utf8')
).version
const target = join(work, `created-app-${Date.now()}`)
const npm = await npmEntry()
await readFile(npm)
const env = childEnvironment()
delete env.npm_execpath
delete env.npm_config_user_agent
const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH'
env[pathKey] = [
  dirname(process.execPath),
  ...(process.platform === 'win32'
    ? [join(process.env.SystemRoot, 'System32'), process.env.SystemRoot]
    : ['/usr/bin', '/bin']),
].join(delimiter)
for (const directory of env[pathKey].split(delimiter)) {
  for (const executable of ['pnpm', 'pnpm.cmd', 'pnpm.exe']) {
    let found = false
    try {
      await access(join(directory, executable))
      found = true
    } catch {
      /* intentionally absent */
    }
    assert(!found, `The from-zero test must not expose a global pnpm: ${directory}`)
  }
}
// This uses npm exec's installed bin, not source imports. It also exercises the
// npm -> pinned pnpm bootstrap, with neither Adonis nor AdulaJS present beforehand.
let runtime
let releaseDocker = () => {}
try {
  await step(
    'from-zero',
    process.execPath,
    [
      npm,
      'exec',
      '--yes',
      `--package=${join(work, tarballName('create-adulajs', version))}`,
      '--',
      'create-adulajs',
      target,
      '--company',
      'شركة الاختبار',
      '--admin-email',
      'owner@example.test',
      '--identity',
      identityPath,
      '--database',
      `adula_created_${Date.now()}_test`,
      ...(docker ? [] : ['--services', 'existing', '--connection', profilePath]),
      '--packages',
      work,
      '--yes',
    ],
    root,
    env
  )
  await writeFile(join(work, 'create-latest.json'), JSON.stringify({ root: target }, null, 2))
  const installationOutput = await readFile(join(work, 'create-from-zero.log'), 'utf8')
  assert.match(installationOutput, /OK \[6\/6\] Typecheck and build the system/)
  assert.match(installationOutput, /Administrator credentials: tmp\/dev-admin.txt/)
  assert(
    !installationOutput.includes('\u001b'),
    'Noninteractive installer output must not contain terminal animations'
  )
  await access(join(target, 'tmp/install.log'))
  const appEnv = parseEnv(await readFile(join(target, '.env'), 'utf8'))
  const testEnv = parseEnv(await readFile(join(target, '.env.test'), 'utf8'))
  if (docker) {
    const config = JSON.parse(await readFile(join(target, 'scripts/docker-backend.json'), 'utf8'))
    runtime = dockerBackend(config.backend)
    if (runtime.command === 'wsl.exe') releaseDocker = await holdDockerSession(runtime)
    else
      await assert.rejects(access(join(target, 'scripts/docker-session.mjs')), { code: 'ENOENT' })
    const manifest = JSON.parse(await readFile(join(target, 'package.json'), 'utf8'))
    assert.equal(manifest.scripts.dev, 'node scripts/services.mjs dev')
    assert.equal(manifest.scripts.test, 'node scripts/services.mjs test')
    // Cross the WSL idle interval, then exercise real migrations and Redis.
    await delay(20000)
    await step(
      'backend-migrations',
      process.execPath,
      ['scripts/services.mjs', 'ace', 'migration:run', '--force'],
      target,
      env
    )
    await pingRedis({ host: appEnv.REDIS_HOST, port: Number(appEnv.REDIS_PORT) })
    console.log(`PASS pinned ${config.backend} backend retains PostgreSQL/Redis through migrations`)
  }
  assert.notEqual(appEnv.DB_DATABASE, connection.database)
  assert(
    appEnv.DB_DATABASE.endsWith('_test'),
    'Browser acceptance also requires an isolated *_test database'
  )
  assert.notEqual(appEnv.DB_DATABASE, testEnv.DB_DATABASE)
  assert.notEqual(appEnv.PORT, testEnv.PORT)
  assert.notEqual(appEnv.APP_KEY, testEnv.APP_KEY)
  assert(testEnv.DB_DATABASE.endsWith('_test'))
  assert.equal(JSON.parse(await readFile(join(target, 'adula-setup.json'), 'utf8')).completed, true)
  const lock = await readFile(join(target, 'pnpm-lock.yaml'), 'utf8')
  assert(!lock.includes('workspace:') && !lock.includes('link:'), 'Starter depends on the monorepo')
  assert.match(await readFile(join(target, 'docs/design-identity.md'), 'utf8'), /شركة الاختبار/)
  assert.match(
    await readFile(join(target, '.agents/skills/adula-frontend-design/SKILL.md'), 'utf8'),
    /company identity/i
  )
  assert.match(await readFile(join(target, 'inertia/components/ui/dialog.tsx'), 'utf8'), /Dialog/)
  assert(
    !JSON.stringify(
      JSON.parse(await readFile(join(root, 'packages/create-adulajs/build/template.json'), 'utf8'))
        .files
    ).includes('#tests/fixtures')
  )
  const dbPassword = appEnv.DB_PASSWORD.startsWith('file:')
    ? await readFile(resolve(target, appEnv.DB_PASSWORD.slice(5)), 'utf8')
    : appEnv.DB_PASSWORD
  const generatedConnection = {
    host: appEnv.DB_HOST,
    port: Number(appEnv.DB_PORT),
    user: appEnv.DB_USER,
    password: dbPassword,
  }
  const client = new Client({
    ...generatedConnection,
    database: appEnv.DB_DATABASE,
  })
  await client.connect()
  const users = await client.query('SELECT email, password FROM users')
  assert.equal(users.rowCount, 1)
  assert.equal(users.rows[0].email, 'owner@example.test')
  const credentials = await readFile(join(target, 'tmp/dev-admin.txt'), 'utf8')
  const password = /^Password: (.+)$/m.exec(credentials)[1]
  assert.notEqual(users.rows[0].password, password)
  assert.equal(
    (await client.query('SELECT name FROM org_units WHERE parent_id IS NULL')).rows[0].name,
    'شركة الاختبار'
  )
  assert.equal(
    (await client.query("SELECT count(*) FROM role_rules WHERE subject='all' AND action='manage'"))
      .rows[0].count,
    '1'
  )
  assert.equal(
    (
      await client.query(
        "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('customers','orders','order_lines','tasks')"
      )
    ).rows[0].count,
    '0'
  )
  await client.end()
  // A name collision is rejected before any migration or data mutation.
  await assert.rejects(
    createDatabases(generatedConnection, {
      database: appEnv.DB_DATABASE,
      testDatabase: testEnv.DB_DATABASE,
    }),
    /Database already exists and will not be modified/
  )
  await step(
    'refuse-overwrite',
    process.execPath,
    [
      join(root, 'packages/create-adulajs/build/cli.mjs'),
      target,
      '--company',
      'Changed',
      '--admin-email',
      'other@example.test',
      '--yes',
    ],
    root,
    env,
    true
  )
  assert.equal(await readFile(join(target, 'tmp/dev-admin.txt'), 'utf8'), credentials)
  await step('application-tests', process.execPath, [pnpm, 'test'], target, env)
  await step('application-lint', process.execPath, [pnpm, 'lint'], target, env)

  const serverLog = await open(join(work, 'create-browser-server.log'), 'w')
  const server = spawn(process.execPath, ['--import=@poppinss/ts-exec', 'bin/server.ts'], {
    cwd: target,
    env,
    stdio: ['ignore', serverLog.fd, serverLog.fd],
    windowsHide: true,
  })
  let browser
  try {
    let ready = false
    for (let i = 0; i < 60; i++) {
      try {
        if (
          (
            await fetch(`${appEnv.APP_URL}/health`, {
              signal: AbortSignal.timeout(2000),
            })
          ).ok
        ) {
          ready = true
          break
        }
      } catch {
        /* starting */
      }
      await delay(500)
    }
    assert(ready, 'Generated application did not start')
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(`${appEnv.APP_URL}/login`)
    await page.locator('input[name="email"]').fill('owner@example.test')
    await page.locator('input[name="password"]').fill(password)
    await page.locator('button[type="submit"]').click()
    await page.waitForURL(`${appEnv.APP_URL}/`)
    assert((await page.locator('body').innerText()).includes('شركة الاختبار'))
    assert.equal(
      await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--primary').trim()
      ),
      '#14532d'
    )
    // The brand color must reach compiled utilities, not only the variable (issue #23).
    assert.equal(
      await page.evaluate(() => {
        const probe = document.createElement('span')
        probe.className = 'text-destructive'
        probe.style.setProperty('--destructive', '#14532d')
        document.body.append(probe)
        return getComputedStyle(probe).color
      }),
      'rgb(20, 83, 45)'
    )
    const response = await page.goto(`${appEnv.APP_URL}/admin/users`)
    assert.equal(response.status(), 200)
    await page
      .getByRole('table')
      .getByText('owner@example.test', { exact: true })
      .waitFor({ state: 'visible' })
    assert((await page.locator('body').innerText()).includes('owner@example.test'))
    await page.screenshot({
      path: join(work, 'create-app-admin.png'),
      fullPage: true,
    })
    assert.deepEqual(errors, [])
    const setupPage = await page.goto(`${appEnv.APP_URL}/admin/setup`)
    assert.equal(setupPage.status(), 200)
    await page.getByRole('heading', { name: 'الإعداد الأولي', exact: true }).waitFor()
    assert((await page.locator('body').innerText()).includes('شركة الاختبار'))
    await page.getByRole('button', { name: 'فحص التخزين', exact: true }).click()
    await page.getByText('نجح الفحص', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'إرسال إشعار تجريبي', exact: true }).click()
    await page.getByText('بانتظار قراءة الإشعار', { exact: true }).waitFor()
    await page.getByRole('link', { name: 'فتح الإشعارات', exact: true }).click()
    await page.getByRole('button', { name: 'تعيين كمقروء', exact: true }).click()
    await page
      .getByRole('button', { name: 'تعيين كمقروء', exact: true })
      .waitFor({ state: 'hidden' })
    await page.goto(`${appEnv.APP_URL}/admin/setup`)
    await page.getByText('تمت قراءة الإشعار التجريبي', { exact: true }).waitFor()
    await page.screenshot({ path: join(work, 'create-app-setup.png'), fullPage: true })
    assert.deepEqual(errors, [])
    console.log('PASS generated setup center, storage roundtrip and notification receipt')
    for (const file of [
      'company-identity.json',
      'docs/design-identity.md',
      'inertia/brand.ts',
      'inertia/css/brand.css',
    ])
      assert.equal(
        await readFile(join(target, 'build', file), 'utf8'),
        await readFile(join(target, file), 'utf8'),
        `Production identity mismatch: ${file}`
      )
    console.log('PASS real administrator browser login and administration')
  } finally {
    await browser?.close()
    server.kill()
    await serverLog.close()
  }
  const logs = (await readdir(work)).filter(
    (name) => name.startsWith('create-') && name.endsWith('.log')
  )
  for (const name of logs)
    assert(
      !(await readFile(join(work, name), 'utf8')).includes(password),
      'Administrator password leaked to a log'
    )
  console.log(`Verified new application from packed creator: ${target}`)
} finally {
  if (docker) {
    try {
      await readFile(join(target, 'compose.yaml'))
      runtime ??= dockerBackend(
        JSON.parse(await readFile(join(target, 'scripts/docker-backend.json'), 'utf8')).backend
      )
      await step(
        'docker-stop',
        runtime.command,
        [...runtime.prefix, 'compose', 'stop'],
        target,
        env
      )
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    } finally {
      releaseDocker()
    }
  }
}
