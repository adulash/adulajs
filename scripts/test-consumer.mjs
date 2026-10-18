import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createHash, randomUUID } from 'node:crypto'
import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  realpath,
  stat,
  writeFile,
} from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { prepareConsumer, repo, work } from './prepare-consumer.mjs'
import { nonZero, pnpmCommand, run } from './lib/run.mjs'

const args = process.argv.slice(2).filter((arg) => arg !== '--')
assert(
  args.every((arg) => arg === '--reuse'),
  'Usage: pnpm test:consumer [--reuse]'
)
assert(Number(process.versions.node.split('.')[0]) >= 24, 'Node.js 24 or newer is required')
const reuse = args.includes('--reuse')
await mkdir(work, { recursive: true })

const pnpm = pnpmCommand('Run this harness through pnpm test:consumer')

async function step(name, command, argv, { cwd = repo, env = process.env, failure = false } = {}) {
  const { output } = await run(command, argv, {
    cwd,
    env,
    log: join(work, `consumer-${name}.log`),
    expect: failure ? nonZero : 0,
    label: `Consumer step ${name}`,
    tail: 55,
  })
  console.log(`PASS ${name}`)
  return output
}

const runPnpm = (name, argv, options) => step(name, pnpm[0], [...pnpm.slice(1), ...argv], options)
const digest = async (path) =>
  createHash('sha256')
    .update(await readFile(path))
    .digest('hex')
const exists = async (path) => {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}
async function filesUnder(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await filesUnder(path)))
    else if (entry.isFile()) files.push(path)
  }
  return files
}

await runPnpm('core-build', ['--filter', 'adula', 'build'])
await runPnpm('core-pack', ['--filter', 'adula', 'pack', '--pack-destination', work])
await runPnpm('ui-build', ['--filter', '@adula/ui', 'build'])
await runPnpm('ui-pack', ['--filter', '@adula/ui', 'pack', '--pack-destination', work])
const consumer = reuse
  ? JSON.parse(await readFile(join(work, 'consumer-latest.json'), 'utf8'))
  : await prepareConsumer()
const target = await realpath(resolve(consumer.root))
const local = relative(await realpath(work), target)
assert(local && !local.startsWith('..') && !isAbsolute(local), 'Consumer must stay under .work')
assert(
  /^adula_consumer_\d+_test$/.test(consumer.database),
  'Consumer requires its dedicated *_test database'
)

// CI exports the reference database globally. Explicitly replace inherited values for every
// consumer command so environment precedence cannot migrate or test the reference database.
const consumerEnv = { ...process.env }
for (const line of (await readFile(join(target, '.env.test'), 'utf8')).trim().split(/\r?\n/)) {
  const separator = line.indexOf('=')
  consumerEnv[line.slice(0, separator)] = JSON.parse(line.slice(separator + 1))
}
assert.equal(
  consumerEnv.DB_DATABASE,
  consumer.database,
  'Consumer metadata and environment must agree'
)
consumerEnv.NODE_ENV = 'development'
consumerEnv.ADULA_ADMIN_EMAIL = `install-${randomUUID()}@example.test`
const testUrl = new URL('postgres://localhost')
testUrl.hostname = consumerEnv.DB_HOST
testUrl.port = consumerEnv.DB_PORT
testUrl.username = consumerEnv.DB_USER
testUrl.password = consumerEnv.DB_PASSWORD
testUrl.pathname = `/${consumer.database}`
consumerEnv.TEST_DATABASE_URL = testUrl.href
consumerEnv.DATABASE_URL = testUrl.href
const options = { cwd: target, env: consumerEnv }
const ace = (name, argv, extra = {}) =>
  step(name, process.execPath, ['ace', ...argv], { ...options, ...extra })

const core = JSON.parse(await readFile(join(repo, 'packages/adula/package.json'), 'utf8'))
const ui = JSON.parse(await readFile(join(repo, 'packages/ui/package.json'), 'utf8'))
await runPnpm(
  'dependencies',
  [
    'add',
    join(work, `adula-${core.version}.tgz`),
    join(work, `adula-ui-${ui.version}.tgz`),
    '--ignore-scripts',
  ],
  options
)
if (!reuse) {
  await ace('postgres-configure', [
    'configure',
    '@adonisjs/lucid',
    '--db=postgres',
    '--no-install',
    '--force',
  ])
  // The Lucid codemod writes starter defaults; restore the isolated connection after it runs.
  const env = (await readFile(join(target, '.env.test'), 'utf8')).replace(
    'NODE_ENV="test"',
    'NODE_ENV="development"'
  )
  await writeFile(join(target, '.env'), env)
}
await ace('configure', ['configure', 'adula'])
const service = join(target, 'app/services/adula.ts')
await appendFile(service, '\n// Consumer customization must survive configure.\n')
const customized = await digest(service)
await ace('configure-again', ['configure', 'adula'])
assert.equal(await digest(service), customized, 'Configure overwrote the consumer service')
if (!reuse) {
  await ace('generate', ['adula:resource', 'samples', '--module=examples'])
  // Fill the definition, then refresh the pending create-migration from it (#20).
  const resourcePath = join(target, 'app/modules/examples/resources/samples.ts')
  await writeFile(
    resourcePath,
    (await readFile(resourcePath, 'utf8')).replace(
      "fields: { title: {",
      "fields: { notes: { type: 'text', label: { ar: 'ملاحظات', en: 'Notes' } }, title: {"
    )
  )
  await ace('snapshot', ['adula:resource:snapshot', 'samples'])
  const migrations = join(target, 'app/modules/examples/migrations')
  const [created] = (await readdir(migrations)).filter((name) => name.endsWith('_create_samples.ts'))
  assert(
    (await readFile(join(migrations, created), 'utf8')).includes('"notes"'),
    'adula:resource:snapshot did not refresh the pending migration'
  )
}
await ace('migrate', ['migration:run', '--force'])
await ace('tests', ['test'], { env: { ...consumerEnv, NODE_ENV: 'test' } })
await ace('install', ['adula:install'])
const capabilities = await ace('capabilities', ['adula:capabilities'])
assert(
  capabilities.includes(`# AdulaJS capabilities (${core.version})`),
  'Packed capability catalog has a stale version'
)
// The generated catalog reads this consumer's registry, not only AdulaJS.
assert(
  capabilities.includes('### examples') && capabilities.includes('`samples`'),
  'The capability catalog does not list the consumer module and resource'
)
assert(capabilities.includes('adula:resource'), 'The catalog is missing the AdulaJS commands')
const lockPath = join(target, 'ui.lock.json')
const uiLock = JSON.parse(await readFile(lockPath, 'utf8'))
const registryRoot = join(repo, 'packages/ui/build')
const registry = JSON.parse(await readFile(join(repo, 'packages/ui/registry.json'), 'utf8'))
const fixedComponents = [
  'button',
  'input',
  'textarea',
  'select',
  'checkbox',
  'switch',
  'radio-group',
  'table',
  'form',
  'label',
  'dialog',
  'sheet',
  'dropdown-menu',
  'popover',
  'command',
  'calendar',
  'badge',
  'card',
  'tabs',
  'sonner',
  'skeleton',
  'pagination',
  'tooltip',
  'separator',
  'alert',
]
for (const name of fixedComponents)
  assert(
    registry.items.some((item) => item.name === name),
    `Fixed UI component missing from registry: ${name}`
  )
const registryItems = await Promise.all(
  registry.items.map(async (item) =>
    JSON.parse(await readFile(join(registryRoot, `${item.name}.json`), 'utf8'))
  )
)
const expectedFiles = [
  ...new Set(registryItems.flatMap((item) => item.files.map((file) => file.target))),
].sort()
assert.deepEqual(
  Object.keys(uiLock.files).sort(),
  expectedFiles,
  'UI registry did not install its complete component set'
)
for (const file of Object.keys(uiLock.files))
  assert(await exists(join(target, file)), `Missing installed UI file ${file}`)
const button = join(target, 'inertia/components/ui/button.tsx')
await appendFile(button, '\n// Consumer-owned button customization.\n')
const buttonHash = await digest(button)
const lockHash = await digest(lockPath)
const refused = await ace('ui-protection', ['adula:ui', 'add', 'button'], { failure: true })
assert(
  refused.includes('Project customized'),
  'UI command failed for a reason other than customization protection'
)
assert.equal(await digest(button), buttonHash, 'UI add overwrote customization')
assert.equal(await digest(lockPath), lockHash, 'Rejected UI update changed its lock')
await ace('ui-preview', ['adula:ui', 'add', 'button', '--preview'])
assert.equal(await digest(button), buttonHash, 'UI preview modified customization')
assert.equal(await digest(lockPath), lockHash, 'UI preview modified its lock')
const agentPath = join(target, 'AGENTS.md')
const designSkillPath = join(target, '.agents/skills/adula-frontend-design/SKILL.md')
assert.equal(
  await readFile(designSkillPath, 'utf8'),
  await readFile(join(repo, 'packages/adula/agent/skills/adula-frontend-design/SKILL.md'), 'utf8'),
  'Packed consumer is missing the current business frontend-design skill'
)
await mkdir(join(target, 'docs'), { recursive: true })
const identityPath = join(target, 'docs/design-identity.md')
const identity = '# Company identity\nBrand supplied by the consumer; preserve on upgrade.\n'
await writeFile(identityPath, identity)
await appendFile(agentPath, '\nConsumer rule: preserve our pages.\n')
// Reproduce a legacy installation with an existing role but no bootstrap grant.
// The database assertion above prevents this fault injection against user data.
const requireConsumer = createRequire(join(target, 'package.json'))
const { Client } = requireConsumer('pg')
const repairDb = new Client({ connectionString: testUrl.href })
await repairDb.connect()
try {
  await repairDb.query(
    "DELETE FROM role_rules WHERE role_id = (SELECT id FROM roles WHERE name = 'administrator') AND subject = 'all' AND action = 'manage' AND inverted = false"
  )
} finally {
  await repairDb.end()
}
await ace('install-again', ['adula:install'])
await ace('install-repair-idempotent', ['adula:install'])
const verifyRepairDb = new Client({ connectionString: testUrl.href })
await verifyRepairDb.connect()
try {
  const repaired = await verifyRepairDb.query(
    "SELECT count(*)::int AS count FROM role_rules WHERE role_id = (SELECT id FROM roles WHERE name = 'administrator') AND subject = 'all' AND action = 'manage' AND inverted = false AND conditions IS NULL AND fields IS NULL"
  )
  assert.equal(repaired.rows[0].count, 1, 'Install must repair exactly one missing bootstrap grant')
} finally {
  await verifyRepairDb.end()
}
assert(
  (await readFile(agentPath, 'utf8')).includes('Consumer rule: preserve our pages.'),
  'Install overwrote project rules'
)
assert.equal(await digest(button), buttonHash, 'Repeated install overwrote the customized button')
assert.equal(await readFile(identityPath, 'utf8'), identity, 'Install overwrote company identity')
await ace('doctor', ['adula:doctor'])
await ace('module-add', ['adula:module:add', 'disposable', '--reference'])
await ace('module-resource', ['adula:resource', 'disposable_items', '--module=disposable'])
const modulePath = join(target, 'app/modules/disposable')
const moduleFiles = new Map(
  await Promise.all(
    (await filesUnder(modulePath)).map(async (path) => [
      relative(modulePath, path),
      await digest(path),
    ])
  )
)
const moduleTest = join(target, 'tests/functional/disposable_items.spec.ts')
const moduleTestHash = await digest(moduleTest)
await ace('module-remove', ['adula:module:remove', 'disposable'])
assert(!(await exists(modulePath)), 'Reference module was not archived')
assert(!(await exists(moduleTest)), 'Removed reference test remains active')
const archives = (await readdir(join(target, 'tmp/adula-removed')))
  .filter((name) => name.startsWith('disposable-'))
  .sort()
const archive = join(target, 'tmp/adula-removed', archives.at(-1) ?? '')
assert(archives.length, 'Removed module has no archive')
for (const [file, hash] of moduleFiles) {
  const preserved = /\.(ts|tsx|js|jsx)$/.test(file) ? `${file}.bak` : file
  assert.equal(
    await digest(join(archive, preserved)),
    hash,
    `Archived module file changed: ${file}`
  )
}
assert.equal(
  await digest(join(archive, 'disposable_items.spec.ts.bak')),
  moduleTestHash,
  'Archived test changed'
)
await runPnpm('typecheck', ['typecheck'], options)
// Unrelated files must not contribute utilities to the consumer's stylesheet.
await writeFile(
  join(target, 'database/non-ui-tailwind-fixture.txt'),
  '<div class="z-[987654]"></div>\n'
)
await runPnpm('build', ['build'], options)
const cssFiles = (await filesUnder(join(target, 'public/assets'))).filter((path) =>
  path.endsWith('.css')
)
const css = (await Promise.all(cssFiles.map((path) => readFile(path, 'utf8')))).join('\n')
assert(
  !css.includes('987654') && css.includes('.bg-primary'),
  'Tailwind source boundaries were not preserved'
)
console.log('PASS UI source boundaries')
console.log(`Verified packed consumer: ${target}`)
