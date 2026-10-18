import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { mkdir, open, readFile, writeFile, realpath } from 'node:fs/promises'
import { dirname, join, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'
import { childEnvironment } from '../packages/create-adulajs/src/system.mjs'
import { resources } from '../tests/medical-consumer/resources.mjs'
import { installMedicalModule } from '../tests/medical-consumer/install.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const work = join(root, '.work')
const pnpm = process.env.npm_execpath
assert(pnpm?.includes('pnpm'), 'Run pnpm test:medical')
const args = process.argv.slice(2).filter((arg) => arg !== '--')
assert(args.length === 0 || (args.length === 1 && args[0].startsWith('--resume=')), 'Usage: pnpm test:medical [--resume=<run directory>]')
const directory = args.length ? resolve(args[0].slice(9)) : join(work, `medical-${Date.now()}`)
assert(/^medical-\d+$/.test(relative(work, directory)), 'Run directory must be a direct .work/medical-<timestamp> child')
await mkdir(directory, { recursive: true })
const stamp = directory.match(/medical-(\d+)$/)[1]
const target = join(directory, 'app')
const statePath = join(directory, 'state.json')
const state = args.length ? JSON.parse(await readFile(statePath, 'utf8')) : { directory, target, completed: [], checks: [] }
assert.equal(state.target, target)
const save = () => writeFile(statePath, JSON.stringify(state, null, 2) + '\n')
await save()
await writeFile(join(work, 'medical-latest.json'), JSON.stringify({ directory, root: target }, null, 2))
const environment = childEnvironment()
const require = createRequire(join(root, 'apps/reference/package.json'))
const { Client } = require('pg')
const { chromium } = require('playwright')
let profile
if (process.env.TEST_DATABASE_URL) {
  const url = new URL(process.env.TEST_DATABASE_URL)
  assert(['postgres:', 'postgresql:'].includes(url.protocol) && !url.search && !url.hash)
  profile = { host: url.hostname, port: Number(url.port || 5432), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: decodeURIComponent(url.pathname.slice(1)) }
} else profile = JSON.parse(await readFile(join(work, 'test-database.json'), 'utf8'))
assert(profile.database.endsWith('_test'))
const reference = process.env.TEST_DATABASE_URL ? process.env : parseEnv(await readFile(join(root, 'apps/reference/.env.test'), 'utf8'))
const hash = async (path) => createHash('sha256').update(await readFile(path)).digest('hex')
async function step(name, executable, argv, { cwd = target, env = environment, expected = 0 } = {}) {
  const file = await open(join(directory, `${name}.log`), 'w')
  let code
  try {
    code = await new Promise((done, reject) => {
      const child = spawn(executable, argv, { cwd, env, windowsHide: true, stdio: ['ignore', file.fd, file.fd] })
      child.once('error', reject)
      child.once('exit', (status, signal) => signal ? reject(new Error(`${name} stopped by ${signal}`)) : done(status))
    })
  } finally { await file.close() }
  assert([expected].flat().includes(code), `${name} failed (exit ${code}); private log: ${join(directory, `${name}.log`)}`)
  state.checks.push({ name, exitCode: code, at: new Date().toISOString() })
  await save()
  console.log(`${code === 0 ? 'PASS' : 'THRESHOLD FAILURE'} ${name}`)
  return code
}
const ace = (name, argv, options) => step(name, process.execPath, ['ace', ...argv], options)
const packageRun = (name, argv, options) => step(name, process.execPath, [pnpm, ...argv], options)
async function stage(name, action) {
  if (state.completed.includes(name)) return
  await action()
  state.completed.push(name)
  await save()
}

await stage('create', async () => {
  await writeFile(join(directory, 'services.json'), JSON.stringify({
    postgres: { host: profile.host, port: profile.port, user: profile.user, password: profile.password },
    redis: { host: reference.REDIS_HOST, port: Number(reference.REDIS_PORT), ...(reference.REDIS_PASSWORD ? { password: reference.REDIS_PASSWORD } : {}) },
  }), { mode: 0o600 })
  await step('create', process.execPath, [join(root, 'packages/create-adulajs/build/cli.mjs'), target,
    '--company', 'شريحة الأصول الطبية التجريبية', '--admin-email', 'owner@example.test',
    '--services', 'existing', '--connection', join(directory, 'services.json'),
    '--database', `adula_medical_${stamp}_test`, '--packages', work, '--yes'], { cwd: root })
  const pkg = JSON.parse(await readFile(join(target, 'package.json'), 'utf8'))
  assert(pkg.dependencies['adula'].startsWith('file:'))
  const installed = await realpath(join(target, 'node_modules/adula'))
  assert(!installed.startsWith(join(root, 'packages')), 'Consumer must not resolve workspace source')
  await step('independent-git', 'git', ['init', '--initial-branch=main'])
})

await stage('module', async () => {
  for (const resource of resources) await ace(`generate-${resource.name}`, ['adula:resource', resource.name, '--module=medical'])
  await installMedicalModule(target)
  // Application-owned Drive configuration makes isolated recovery use a separate disk root.
  const drivePath = join(target, 'config/drive.ts')
  await writeFile(drivePath, (await readFile(drivePath, 'utf8')).replace("location: app.makePath('storage/uploads')", "location: process.env.MEDICAL_UPLOADS_ROOT ?? app.makePath('storage/uploads')"))
  await writeFile(join(target, 'docs/design-identity.md'), '# Disposable acceptance-consumer identity\n\nThe owner confirmed on 2026-09-22 that this is a temporary AdulaJS test and no company identity is required. The displayed name labels synthetic test data. Reuse existing AdulaJS tokens and IBM Plex Sans Arabic; there is no company logo or brand approval to obtain. Component/page customizations exist only to test project ownership and upgrade preservation.\n')
  // Real project-owned customization, retained for later upgrade comparison.
  const button = join(target, 'inertia/components/ui/button.tsx')
  const buttonSource = await readFile(button, 'utf8')
  assert(buttonSource.includes('h-9 px-4 py-2'))
  await writeFile(button, buttonSource.replace('h-9 px-4 py-2', 'h-10 px-4 py-2'))
  const pages = join(target, 'inertia/pages/medical_assets')
  await mkdir(pages, { recursive: true })
  await writeFile(join(pages, 'index.tsx'), `import type { ReactElement } from 'react'\nimport { ResourcePage, type ResourcePageProps } from '~/components/ui/resource-page'\nimport { Alert, AlertTitle, AlertDescription } from '~/components/ui/alert'\nimport Workspace from '~/layouts/workspace'\nexport default function MedicalAssets(props: ResourcePageProps) { return <><Alert className="mb-4" dir="rtl"><AlertTitle>سجل الأجهزة الطبية</AlertTitle><AlertDescription>تتبّع موقع الجهاز ومكوّناته ودليل تشغيله، وافتح السجل لمراجعة تفاصيله.</AlertDescription></Alert><ResourcePage {...props} /></> }\nMedicalAssets.layout = (page: ReactElement) => <Workspace>{page}</Workspace>\n`)
  await packageRun('format', ['exec', 'prettier', '--write', 'app/modules/medical', 'tests/medical', 'tests/functional', 'commands/medical_seed.ts', 'config/drive.ts', 'start/modules.ts', 'inertia/pages/medical_assets', 'inertia/components/ui/button.tsx'])
  state.customizations = {}
  for (const file of ['inertia/components/ui/button.tsx', 'inertia/pages/medical_assets/index.tsx', 'docs/design-identity.md', 'AGENTS.md'])
    state.customizations[file] = await hash(join(target, file))
})

await stage('validate', async () => {
  await ace('migrate', ['migration:run', '--force'])
  await packageRun('tests', ['test'])
  await packageRun('typecheck', ['typecheck'])
  await packageRun('lint', ['lint'])
  await packageRun('build', ['build'])
  await ace('doctor', ['adula:doctor'])
})
await stage('seed', () => ace('seed', ['medical:seed']))

const appEnv = parseEnv(await readFile(join(target, '.env'), 'utf8'))
assert.equal(appEnv.DB_DATABASE, `adula_medical_${stamp}_test`)
const fixture = JSON.parse(await readFile(join(target, 'tmp/performance-fixture.json'), 'utf8'))
async function startServer(name, overrides = {}, { compiled = false } = {}) {
  const file = await open(join(directory, `${name}.log`), 'w')
  const env = { ...environment, ...appEnv, ...overrides }
  // Performance uses the compiled build (as deployed); functional stages use sources.
  const server = compiled
    ? spawn(process.execPath, ['bin/server.js'], { cwd: join(target, 'build'), env, windowsHide: true, stdio: ['ignore', file.fd, file.fd] })
    : spawn(process.execPath, ['--import=@poppinss/ts-exec', 'bin/server.ts'], { cwd: target, env, windowsHide: true, stdio: ['ignore', file.fd, file.fd] })
  const stop = async () => {
    if (server.exitCode === null) {
      const exited = new Promise((done) => server.once('exit', done))
      server.kill()
      await exited
    }
    await file.close()
  }
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${env.APP_URL}/health`, { signal: AbortSignal.timeout(1000) })).ok) return { stop, base: env.APP_URL } } catch { /* starting */ }
    if (server.exitCode !== null) break
    await delay(500)
  }
  await stop()
  throw new Error(`${name} did not start; see its private log`)
}

async function httpExercise(name, server, restored = false) {
  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext()
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(`${server.base}/login`)
    await page.locator('input[name=email]').fill(fixture.users[0].email)
    await page.locator('input[name=password]').fill(fixture.users[0].password)
    await page.locator('button[type=submit]').click()
    await page.waitForURL(`${server.base}/`)
    const headers = { Accept: 'application/json', 'X-XSRF-TOKEN': decodeURIComponent((await context.cookies()).find((cookie) => cookie.name === 'XSRF-TOKEN')?.value ?? '') }
    const bytes = Buffer.from('دليل الجهاز التجريبي\nmedical-acceptance\n')
    if (!restored) {
      const upload = await context.request.post(`${server.base}/attachments`, { headers, multipart: {
        resource: 'medical_assets', field: 'manual', file: { name: 'manual.txt', mimeType: 'text/plain', buffer: bytes },
      } })
      assert.equal(upload.status(), 201)
      const attachment = (await upload.json()).data
      const created = await context.request.post(`${server.base}/resources/medical_assets`, { headers, data: {
        ...fixture.users[0].saveBody, name: `RESTORE-${stamp}`, manual: attachment.id,
      } })
      assert.equal(created.status(), 201)
      const asset = (await created.json()).data
      state.record = { id: asset.id, attachmentId: attachment.id, attachmentUrl: attachment.url, sha256: createHash('sha256').update(bytes).digest('hex') }
      await save()
    }
    const shown = await context.request.get(`${server.base}/resources/medical_assets/${state.record.id}`, { headers })
    assert.equal(shown.status(), 200)
    assert.equal((await shown.json()).data.name, `RESTORE-${stamp}`)
    const downloaded = await context.request.get(new URL(state.record.attachmentUrl, server.base).href)
    assert.equal(downloaded.status(), 200)
    assert.equal(createHash('sha256').update(await downloaded.body()).digest('hex'), state.record.sha256)
    for (const [mode, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
      await page.setViewportSize({ width, height })
      await page.goto(`${server.base}/resources/medical_assets`)
      await page.getByText('سجل الأجهزة الطبية', { exact: true }).waitFor()
      await page.screenshot({ path: join(directory, `${name}-${mode}-list.png`), fullPage: true, animations: 'disabled' })
      await page.goto(`${server.base}/resources/medical_assets/${state.record.id}`)
      await page.getByRole('dialog').waitFor()
      await page.screenshot({ path: join(directory, `${name}-${mode}-detail.png`), fullPage: true, animations: 'disabled' })
    }
    const outsider = await browser.newContext()
    const other = await outsider.newPage()
    await other.goto(`${server.base}/login`)
    await other.locator('input[name=email]').fill(fixture.users[1].email)
    await other.locator('input[name=password]').fill(fixture.users[1].password)
    await other.locator('button[type=submit]').click()
    await other.waitForURL(`${server.base}/`)
    assert.equal((await outsider.request.get(`${server.base}/resources/medical_assets/${state.record.id}`, { headers: { Accept: 'application/json' } })).status(), 404)
    assert.equal((await outsider.request.get(new URL(state.record.attachmentUrl, server.base).href)).status(), 404)
    assert.deepEqual(errors, [])
    state.checks.push({ name, at: new Date().toISOString(), recordAndAttachment: true, scopeDenial: true, humanReview: false })
    await save()
  } finally { await browser.close() }
}

await stage('http', async () => {
  const server = await startServer('source-server')
  try { await httpExercise('source', server) } finally { await server.stop() }
})
// The budget is plan section 13: list with two relations p95 < 300 ms, save p95 < 200 ms.
if (process.env.K6_BINARY) await stage('performance', async () => {
  const server = await startServer('performance-server', { LOG_LEVEL: 'warn' }, { compiled: true })
  try {
    const workloadFixture = join(directory, 'performance-fixture.json')
    await writeFile(workloadFixture, JSON.stringify({ ...fixture, runId: `medical-${Date.now()}` }), { mode: 0o600 })
    await step('k6-version', resolve(process.env.K6_BINARY), ['version'])
    const code = await step('k6', resolve(process.env.K6_BINARY), ['run', '--no-usage-report',
      '-e', `PERF_FIXTURE=${workloadFixture}`,
      '-e', 'VUS=50', '-e', 'DURATION=3m', `--summary-export=${join(directory, 'k6-summary.json')}`,
      join(root, 'apps/reference/tests/perf/k6-workload.js')], { expected: [0, 99] })
    state.performance = { exitCode: code, thresholdsPassed: code === 0, environment: `compiled build, NODE_ENV=${appEnv.NODE_ENV}, LOG_LEVEL=warn, one web process on ${process.platform}; not staging` }
  } finally { await server.stop() }
})
const snapshot = join(directory, 'snapshot')
await stage('snapshot', () => ace('snapshot', ['backup:create', `--snapshot=${snapshot}`]))
await stage('restore', async () => {
  const restoredDatabase = `adula_medical_${stamp}_restored_test`
  const restoreRoot = join(directory, 'restored-uploads')
  const env = { ...environment, ...appEnv, DB_DATABASE: restoredDatabase, ADULA_NAMESPACE: `medical-restored-${stamp}`, MEDICAL_UPLOADS_ROOT: restoreRoot }
  await ace('verify-snapshot', ['backup:verify-snapshot', `--snapshot=${snapshot}`], { env })
  await stage('restore-target', async () => {
    const client = new Client(profile)
    await client.connect()
    try { await client.query(`CREATE DATABASE "${restoredDatabase}"`) } finally { await client.end() }
    await mkdir(restoreRoot)
  })
  await stage('restore-database', () => step('restore-database', 'pg_restore', ['--exit-on-error', '--no-owner', '--dbname', restoredDatabase, join(snapshot, 'database.dump')], { env: { ...env, PGHOST: profile.host, PGPORT: String(profile.port), PGUSER: profile.user, PGPASSWORD: profile.password } }))
  await stage('restore-files', () => ace('restore-files', ['backup:restore-files', `--snapshot=${snapshot}`, '--apply'], { env }))
  await stage('reconcile', () => ace('reconcile', ['adula:restore:reconcile', '--force'], { env }))
  const server = await startServer('restored-server', env)
  try { await httpExercise('restored', server, true) } finally { await server.stop() }
  state.restoredDatabase = restoredDatabase
})
for (const [file, digest] of Object.entries(state.customizations)) assert.equal(await hash(join(target, file)), digest, `Project-owned file changed: ${file}`)
state.result = 'local-functional-consumer-passed'
state.releaseAcceptance = false
await save()
console.log(`Independent medical consumer functional checks passed at ${target}`)
console.log('Staging performance, genuine published upgrade and human review remain separate gates.')
if (state.performance?.thresholdsPassed === false) {
  console.error('Local performance thresholds failed; restore checks completed independently.')
  process.exitCode = 99
}
