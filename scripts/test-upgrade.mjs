// Synthetic migration/customization regression only. This does not satisfy plan section 17.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, join } from 'node:path'
import { prepareConsumer, repo, work } from './prepare-consumer.mjs'
import { upgradeMode } from './upgrade-mode.mjs'

/**
 * 0.1.0 was never tagged, so the baseline is reconstructed from the current source by
 * withholding the artifacts the new minor release introduces. The withheld list is
 * explicit on purpose: everything the upgrade is supposed to deliver appears here.
 */
const WITHHELD_FROM_BASELINE = [
  'build/database/migrations/1770000000002_saved_views.js',
  'build/database/migrations/1770000000002_saved_views.d.ts',
]

// Refuse ambiguous use before creating databases, repacking or rewriting manifests.
const current = JSON.parse(await readFile(join(repo, 'packages/adula/package.json'), 'utf8')).version
const { mode, previous } = upgradeMode(process.argv.slice(2), process.env, current)
const genuine = mode === 'published'
const pnpmEntry = process.env.npm_execpath
assert(
  pnpmEntry && basename(pnpmEntry).includes('pnpm'),
  'Run this harness through pnpm test:upgrade'
)
const pnpm = /\.(?:c?js|mjs)$/.test(pnpmEntry) ? [process.execPath, pnpmEntry] : [pnpmEntry]
await mkdir(work, { recursive: true })

async function step(name, command, argv, { cwd = repo, env = process.env, failure = false } = {}) {
  const logPath = join(work, `upgrade-${name}.log`)
  const log = await open(logPath, 'w')
  let code
  try {
    code = await new Promise((done, reject) => {
      const child = spawn(command, argv, {
        cwd,
        env,
        stdio: ['ignore', log.fd, log.fd],
        shell: false,
        windowsHide: true,
      })
      child.once('error', reject)
      child.once('exit', (status, signal) =>
        signal ? reject(new Error(`${name} stopped by ${signal}`)) : done(status)
      )
    })
  } finally {
    await log.close()
  }
  const output = await readFile(logPath, 'utf8')
  if (failure ? code === 0 : code !== 0) {
    console.error(output.split(/\r?\n/).slice(-45).join('\n'))
    throw new Error(`Upgrade step failed: ${name} (exit ${code}; ${logPath})`)
  }
  console.log(`PASS ${name}`)
  return output
}

const runPnpm = (name, argv, options) => step(name, pnpm[0], [...pnpm.slice(1), ...argv], options)
const digest = async (path) => createHash('sha256').update(await readFile(path)).digest('hex')

async function setVersion(version) {
  for (const pkg of ['packages/adula/package.json', 'packages/ui/package.json']) {
    const path = join(repo, pkg)
    const manifest = JSON.parse(await readFile(path, 'utf8'))
    manifest.version = version
    await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`)
  }
}

async function pack(version, { withhold = [] } = {}) {
  await setVersion(version)
  await runPnpm(`core-build-${version}`, ['--filter', 'adula', 'build'])
  for (const file of withhold) await rm(join(repo, 'packages/adula', file), { force: true })
  await runPnpm(`core-pack-${version}`, [
    '--filter',
    'adula',
    'pack',
    '--pack-destination',
    work,
  ])
  await runPnpm(`ui-build-${version}`, ['--filter', '@adula/ui', 'build'])
  await runPnpm(`ui-pack-${version}`, ['--filter', '@adula/ui', 'pack', '--pack-destination', work])
}

const { Client } = createRequire(join(repo, 'apps/reference/package.json'))('pg')
async function query(url, sql, params = []) {
  const client = new Client(url)
  try {
    await client.connect()
    return (await client.query(sql, params)).rows
  } finally {
    await client.end()
  }
}
async function columnsOf(url, table) {
  const rows = await query(
    url,
    'select column_name from information_schema.columns where table_name = $1 order by 1',
    [table]
  )
  return rows.map((row) => row.column_name)
}
const released = JSON.parse(await readFile(join(repo, 'packages/adula/package.json'), 'utf8')).version
const minorOf = (version) => version.split('.').slice(0, 2).map(Number)
const before = (version, major, minor) => {
  const [a, b] = minorOf(version)
  return a < major || (a === major && b < minor)
}
// A published 1.x baseline uses the core package's 1.x name; 2.0 renames it (ADR 039).
const renamed = genuine && before(previous, 2, 0)

// The synthetic baseline withholds saved_views. Published alpha baselines predate the
// phase 3 tables; 1.0/1.1 baselines predate the 1.2 inbound webhook tables (015). A 1.2
// baseline already has every table; its upgrade delivers the AdulaJS names instead.
const stableBaseline = genuine && !previous.includes('-')
const deliveredTable = !genuine
  ? 'saved_views'
  : !stableBaseline
    ? 'comments'
    : before(previous, 1, 2)
      ? 'inbound_sources'
      : undefined
const deliveredColumns = !genuine
  ? ['id', 'name', 'query', 'resource', 'shared', 'user_id']
  : !stableBaseline
    ? ['author_id', 'body', 'id', 'record_id', 'resource']
    : ['active', 'dedupe_body', 'id', 'key', 'name', 'secret']
const legacyMigrations = 'node_modules/@adula/kit/build/database/migrations/%'
const functionsNamed = async (url, names) =>
  (
    await query(url, 'select proname from pg_proc where proname = any($1) order by 1', [names])
  ).map((row) => row.proname)
assert.notEqual(previous, released, 'The upgrade test needs two different versions')
console.log(
  genuine
    ? `GENUINE upgrade: published ${previous} from npm -> ${released}`
    : `SYNTHETIC rehearsal: ${previous} -> ${released}; not published-version acceptance`
)

let consumer
try {
  if (genuine) consumer = await prepareConsumer({ baseline: previous })
  else {
    await pack(previous, { withhold: WITHHELD_FROM_BASELINE })
    consumer = await prepareConsumer()
  }
  const target = consumer.root
  const consumerEnv = { ...process.env }
  for (const line of (await readFile(join(target, '.env.test'), 'utf8')).trim().split(/\r?\n/)) {
    const separator = line.indexOf('=')
    consumerEnv[line.slice(0, separator)] = JSON.parse(line.slice(separator + 1))
  }
  consumerEnv.NODE_ENV = 'development'
  consumerEnv.ADULA_ADMIN_EMAIL = `upgrade-${randomUUID()}@example.test`
  const testUrl = new URL('postgres://localhost')
  testUrl.hostname = consumerEnv.DB_HOST
  testUrl.port = consumerEnv.DB_PORT
  testUrl.username = consumerEnv.DB_USER
  testUrl.password = consumerEnv.DB_PASSWORD
  testUrl.pathname = `/${consumer.database}`
  consumerEnv.TEST_DATABASE_URL = testUrl.href
  const options = { cwd: target, env: consumerEnv }
  const ace = (name, argv, extra = {}) =>
    step(name, process.execPath, ['ace', ...argv], { ...options, ...extra })

  // ---- The consumer adopts the previous minor version and makes it its own ----
  await runPnpm('install-previous', ['install', '--ignore-scripts'], options)
  await ace('postgres-configure', [
    'configure',
    '@adonisjs/lucid',
    '--db=postgres',
    '--no-install',
    '--force',
  ])
  const env = (await readFile(join(target, '.env.test'), 'utf8')).replace(
    'NODE_ENV="test"',
    'NODE_ENV="development"'
  )
  await writeFile(join(target, '.env'), env)
  await ace('configure-previous', ['configure', consumer.core])
  // The packed consumer's own suite exercises this resource name.
  await ace('generate', ['adula:resource', 'samples', '--module=examples'])
  await ace('migrate-previous', ['migration:run', '--force'])
  // The consumer's own suite signs the administrator up; adula:install then adopts that account.
  await ace('tests-previous', ['test'], { env: { ...consumerEnv, NODE_ENV: 'test' } })
  await ace('install-core', ['adula:install'])
  await ace('ui-previous', ['adula:ui', 'add', 'all'])

  const buttonPath = join(target, 'inertia/components/ui/button.tsx')
  const marker = '/* consumer customization: wider default radius */'
  await writeFile(join(buttonPath), `${marker}\n${await readFile(buttonPath, 'utf8')}`)
  const overridePath = join(target, 'inertia/pages/samples/index.tsx')
  await mkdir(join(target, 'inertia/pages/samples'), { recursive: true })
  await writeFile(
    overridePath,
    `import { Head } from '@inertiajs/react'\n\n/** Project-owned page: the generated index must never replace it. */\nexport default function SamplesIndex() {\n  return (\n    <main dir="rtl">\n      <Head title="العينات" />\n      <h1>صفحة العينات الخاصة بالمشروع</h1>\n    </main>\n  )\n}\n`
  )
  const customized = { button: await digest(buttonPath), page: await digest(overridePath) }
  await runPnpm('consumer-typecheck-previous', ['exec', 'tsc', '--noEmit'], options)
  const installedPrevious = JSON.parse(
    await readFile(join(target, `node_modules/${consumer.core}/package.json`), 'utf8')
  )
  assert.equal(installedPrevious.version, previous, 'The consumer must start on the baseline')
  if (deliveredTable) {
    assert.deepEqual(
      await columnsOf(consumerEnv.TEST_DATABASE_URL, deliveredTable),
      [],
      'The baseline must not already carry the table the upgrade delivers'
    )
    console.log(`PASS baseline-has-no-${deliveredTable}`)
  }
  if (renamed) {
    assert.deepEqual(
      await functionsNamed(consumerEnv.TEST_DATABASE_URL, [
        'adula_bump_auth_revision',
        'kit_bump_auth_revision',
      ]),
      ['kit_bump_auth_revision'],
      'The 1.x baseline must carry the 1.x database names'
    )
    console.log('PASS baseline-has-1.x-names')
  }
  // Consumer data written on the baseline must survive the upgrade.
  const [{ count: usersBefore }] = await query(
    consumerEnv.TEST_DATABASE_URL,
    'select count(*)::int as count from users'
  )
  const [{ count: activitiesBefore }] = await query(
    consumerEnv.TEST_DATABASE_URL,
    'select count(*)::int as count from activities'
  )

  // ---- Current source is repacked; neither archive was published ----
  await pack(released)
  if (renamed) {
    // Step 1 of the documented 2.0 upgrade: the creator rewrites the application
    // without booting AdonisJS, here from the local archives instead of the registry.
    await runPnpm('creator-build', ['--filter', 'create-adulajs', 'build'])
    const rewrite = await step(
      'creator-upgrade',
      process.execPath,
      [
        join(repo, 'packages/create-adulajs/build/cli.mjs'),
        'upgrade',
        target,
        '--packages',
        work,
        '--no-install',
        '--force',
      ],
      options
    )
    assert.match(rewrite, /updated package\.json/)
    assert.match(rewrite, /updated config\/database\.ts/, 'The database config must be rewritten')
    await runPnpm('install-upgraded', ['install', '--no-frozen-lockfile', '--ignore-scripts'], options)
    assert.doesNotMatch(
      await readFile(join(target, 'config/database.ts'), 'utf8'),
      /@adula\/kit|withKitDatabase/,
      'The application still names the 1.x package'
    )
  } else
    await runPnpm(
      'update',
      [
        'add',
        join(work, `adula-${released}.tgz`),
        join(work, `adula-ui-${released}.tgz`),
        '--ignore-scripts',
      ],
      options
    )
  const installedCore = JSON.parse(
    await readFile(join(target, 'node_modules/adula/package.json'), 'utf8')
  )
  assert.equal(installedCore.version, released, 'The consumer must resolve the new AdulaJS version')

  // Doctor must refuse the drift before migrations and the install command have run.
  const drift = await ace('doctor-drift', ['adula:doctor'], { failure: true })
  assert.match(drift, /adula\.version/, 'Doctor must report AdulaJS version drift')
  assert.match(drift, /FAIL/, 'Doctor must fail on an unfinished upgrade')
  if (renamed)
    assert.match(drift, /run node ace adula:upgrade/, 'Doctor must name the upgrade command')

  // Step 2: renames the 1.x migration history and files, then runs pending migrations.
  await ace('upgrade', ['adula:upgrade'])
  if (deliveredTable) {
    const columns = await columnsOf(consumerEnv.TEST_DATABASE_URL, deliveredTable)
    for (const column of deliveredColumns)
      assert.ok(
        columns.includes(column),
        `The upgraded schema is missing ${deliveredTable}.${column}`
      )
    console.log('PASS additive-migration-applied')
  }
  const [{ count: legacyRows }] = await query(
    consumerEnv.TEST_DATABASE_URL,
    'select count(*)::int as count from adonis_schema where name like $1',
    [legacyMigrations]
  )
  assert.equal(legacyRows, 0, 'The migration history still names the 1.x package')
  const [{ count: namesMigration }] = await query(
    consumerEnv.TEST_DATABASE_URL,
    'select count(*)::int as count from adonis_schema where name = $1',
    ['node_modules/adula/build/database/migrations/1770000000016_adulajs_names']
  )
  assert.equal(namesMigration, 1, 'Migration 016 must run exactly once')
  assert.deepEqual(
    await functionsNamed(consumerEnv.TEST_DATABASE_URL, [
      'adula_bump_auth_revision',
      'kit_bump_auth_revision',
    ]),
    ['adula_bump_auth_revision'],
    'Database objects must carry the AdulaJS names'
  )
  console.log('PASS migration-history-and-names')
  const [{ count: usersAfter }] = await query(
    consumerEnv.TEST_DATABASE_URL,
    'select count(*)::int as count from users'
  )
  const [{ count: activitiesAfter }] = await query(
    consumerEnv.TEST_DATABASE_URL,
    'select count(*)::int as count from activities'
  )
  assert.equal(usersAfter, usersBefore, 'The upgrade changed consumer users')
  assert.ok(activitiesAfter >= activitiesBefore, 'The upgrade lost consumer activity history')
  console.log('PASS consumer-data-preserved')
  await ace('install-upgrade', ['adula:install'])
  const agents = await readFile(join(target, 'AGENTS.md'), 'utf8')
  assert.equal(agents.split('<!-- adula:start').length, 2, 'AGENTS.md needs one managed block')
  assert.doesNotMatch(agents, /adula-kit:(start|end)/, 'The 1.x managed block was not replaced')

  // ---- Ownership held: a customization blocks a silent overwrite and must be reviewed ----
  const protection = await ace('ui-protection', ['adula:ui', 'add', 'data-table'], {
    failure: true,
  })
  assert.match(protection, /customized/i, 'Reinstalling UI must refuse to overwrite a customization')
  assert.equal(await digest(buttonPath), customized.button, 'A refused install still wrote the file')

  // UI compatibility is tracked per minor version. Across a minor change doctor keeps
  // failing until the registry review is finished; within one minor the registry stays
  // compatible and doctor still names the customized files that need a review.
  const minor = (version) => version.split('.').slice(0, 2).join('.')
  if (minor(previous) !== minor(released)) {
    const blocked = await ace('doctor-before-review', ['adula:doctor'], { failure: true })
    assert.match(blocked, /ui\.compatibility/, 'Doctor must demand the UI compatibility review')
  } else {
    const sameMinor = await ace('doctor-before-review', ['adula:doctor'])
    assert.match(sameMinor, /PASS ui\.compatibility/, 'Same-minor registries stay compatible')
    assert.match(sameMinor, /ui\.pages: UI review required/, 'Doctor must list pages to review')
  }

  await ace('ui-preview', ['adula:ui', 'add', 'all', '--preview'])
  assert.equal(await digest(buttonPath), customized.button, 'A preview modified project files')
  await ace('ui-accept', ['adula:ui', 'add', 'all', '--accept'])

  const healthy = await ace('doctor-upgraded', ['adula:doctor'])
  assert.match(healthy, new RegExp(`AdulaJS ${released.replace(/\./g, '\\.')} is installed`))
  assert.doesNotMatch(healthy, /^FAIL/m, 'Doctor must pass after the upgrade completes')
  assert.equal(await digest(buttonPath), customized.button, 'The customized component changed')
  assert.equal(await digest(overridePath), customized.page, 'The overridden page changed')
  assert.match(
    await readFile(buttonPath, 'utf8'),
    new RegExp(marker.replace(/[*/]/g, '\\$&')),
    'The customization marker disappeared'
  )

  await runPnpm('consumer-typecheck-upgraded', ['exec', 'tsc', '--noEmit'], options)
  await ace('tests-upgraded', ['test'], { env: { ...consumerEnv, NODE_ENV: 'test' } })
  await ace('build-upgraded', ['build'])

  console.log(
    genuine
      ? `\nGenuine upgrade verified at ${target}: published ${previous} -> ${released}`
      : `\nSynthetic regression verified at ${target}; genuine upgrade acceptance remains pending`
  )
  console.log(`${previous} -> ${released}: additive migration ran, doctor gated the drift,`)
  console.log('the customized component and the overridden page were preserved.')
} finally {
  if (!genuine) await setVersion(released)
  await runPnpm('restore-build', ['--filter', 'adula', 'build']).catch(() => {})
  await runPnpm('restore-ui-build', ['--filter', '@adula/ui', 'build']).catch(() => {})
}
