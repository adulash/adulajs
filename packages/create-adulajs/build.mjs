import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const here = fileURLToPath(new URL('./', import.meta.url))
const reference = join(root, 'apps/reference')
const output = resolve(here, 'build')
if (output !== join(here, 'build')) throw new Error('Invalid build directory')
await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })
await cp(join(here, 'src'), output, { recursive: true })
const files = {}
files['docs/initial-setup.md'] = await readFile(join(root, 'docs/initial-setup.md'), 'utf8')
async function collect(relative) {
  for (const entry of await readdir(join(reference, relative), { withFileTypes: true })) {
    const path = `${relative}/${entry.name}`
    if (entry.isSymbolicLink()) throw new Error(`Template cannot contain a symlink: ${path}`)
    if (['app/modules', 'inertia/components/ui', 'inertia/lib'].includes(path)) continue
    if (
      ['start/test_fixtures.ts', 'inertia/fixture_pages.ts', 'inertia/css/adula.css'].includes(path)
    )
      continue
    if (entry.isDirectory()) await collect(path)
    else {
      if (!/\.(ts|tsx|css|edge|json)$/.test(path))
        throw new Error(`Unexpected template file: ${path}`)
      files[path] = (await readFile(join(reference, path), 'utf8')).replaceAll('\r\n', '\n')
    }
  }
}
for (const directory of [
  'app',
  'config',
  'database/migrations',
  'inertia',
  'providers',
  'resources',
  'start',
  'bin',
])
  await collect(directory)
for (const path of [
  'ace.js',
  'adonisrc.ts',
  'components.json',
  'tsconfig.json',
  'tsconfig.inertia.json',
  'vite.config.ts',
  'eslint.config.js',
  'database/schema_rules.ts',
  'tests/helpers/resource_contract.ts',
  'tests/bootstrap.ts',
]) {
  files[path] = (await readFile(join(reference, path), 'utf8')).replaceAll('\r\n', '\n')
}
for (const name of [
  'adula_worker',
  'adula_outbox',
  'adula_runtime_health',
  'adula_restore_reconcile',
  'backup_verify',
  'backup_create',
  'backup_verify_snapshot',
  'backup_restore_files',
  'backup_restore_test',
]) {
  files[`commands/${name}.ts`] = await readFile(join(reference, `commands/${name}.ts`), 'utf8')
}
// The starter needs UserSchema while migration:run boots. Lucid replaces it with
// the schema of the newly created database; no educational schemas are shipped.
const schema = await readFile(join(reference, 'database/schema.ts'), 'utf8')
const user = schema.match(
  /export class UserSchema extends BaseModel \{[\s\S]*?(?=\nexport class |$)/
)?.[0]
if (!user) throw new Error('User schema is missing')
files['database/schema.ts'] =
  `import { BaseModel, column } from '@adonisjs/lucid/orm'\nimport { DateTime } from 'luxon'\n${user}\n`
files['start/modules.ts'] =
  `import { ResourceRegistry, type Module } from 'adula'\n// adula:imports\nexport const modules: Module[] = [\n  /* adula:modules */\n]\nexport const registry = new ResourceRegistry().register(modules)\n`
files['start/listeners.ts'] =
  `import { followerListeners, workflowListeners, type Listener } from 'adula'\nimport { registry } from '#start/modules'\nimport { adula } from '#services/adula'\n\n// Follower notifications for every registered resource; add module listeners below.\nexport const listeners: Listener[] = [\n  ...followerListeners(registry, () => adula().collaboration),\n  ...workflowListeners(registry, () => adula().workflows),\n  {\n    name: 'adula.webhooks',\n    event: '*',\n    handle: (event, trx) => adula().webhooks.listener().handle(event, trx),\n  },\n]\n`
files['config/database.ts'] = files['config/database.ts']
  .replace('modules, fixtureModuleNames', 'modules')
  .replace(/\$\{fixtureModuleNames\.has\(module.name\).*?\}/, 'app/modules')
files['app/controllers/resources_controller.ts'] = files['app/controllers/resources_controller.ts']
  .replace(/^import \{ testFixturesEnabled \}.*\n/m, '')
  .replace(/^const fixtureRenderers = .*\n/m, '')
  .replace(/^  if \(testFixturesEnabled\).*\n/m, '')
  .replace(
    /^    const custom = await fixtureRenderers.*\n    if \(custom !== undefined\) return custom\n/gm,
    ''
  )
files['vite.config.ts'] = files['vite.config.ts']
  .replace('defineConfig(({ command }) => ({', 'defineConfig({')
  .replace(/^      '~\/fixture_pages'.*\n/m, '')
  .replace(/\}\)\)\s*$/, '})\n')
files['inertia/app.tsx'] = files['inertia/app.tsx']
  .replace(/^import fixturePages.*\n/m, '')
  .replace(
    "{ ...import.meta.glob<ResolvedComponent>('./pages/**/*.tsx'), ...fixturePages }",
    "import.meta.glob<ResolvedComponent>('./pages/**/*.tsx')"
  )
files['eslint.config.js'] = files['eslint.config.js'].replace(
  '../../packages/adula/src/eslint/index.js',
  'adula/eslint'
)
files['tsconfig.json'] = files['tsconfig.json'].replace(', "tests/fixtures/frontend"', '')
// Test cleanup is restricted to a dedicated database; new applications own their
// tests and retain the same PostgreSQL authorization contract used by generators.
files['tests/bootstrap.ts'] = files['tests/bootstrap.ts']
  .replace('adula-reference-test', 'application-specific test')
  .replace(/      await db.rawQuery\([\s\S]*?\n      \)/, '')
  .replace("import db from '@adonisjs/lucid/services/db'\n", '')
for (const path of ['config/cache.ts', 'config/queue.ts'])
  files[path] =
    "import env from '#start/env'\n" +
    files[path]
      .replaceAll("'adula-reference-test'", "`${env.get('ADULA_NAMESPACE')}-test`")
      .replaceAll("'adula-reference'", "env.get('ADULA_NAMESPACE')")
files['start/env.ts'] = files['start/env.ts'].replace(
  '  // App\n',
  '  // App\n  ADULA_NAMESPACE: Env.schema.string(),\n'
)
files['config/mcp.ts'] =
  "import env from '#start/env'\n" +
  files['config/mcp.ts'].replace("name: 'adula-reference'", "name: env.get('ADULA_NAMESPACE')")
files['config/limiter.ts'] = files['config/limiter.ts'].replace(
  "connectionName: 'main'",
  "connectionName: 'main', keyPrefix: `${env.get('ADULA_NAMESPACE')}:limiter`"
)
// Core 7.5 skips provider shutdown in codegen's warmup mode, but cache's Edge
// bindings initialize Redis during boot. Release those known warmup adapters.
files['bin/console.ts'] =
  'const cleanupCodegen = process.argv[2] === "codegen"\n' +
  files['bin/console.ts'] +
  `\n  .finally(async () => {\n    if (cleanupCodegen) {\n      const { default: app } = await import('@adonisjs/core/services/app')\n      if (app.container.hasBinding('cache.manager')) {\n        const cache = await app.container.make('cache.manager')\n        await cache.disconnectAll()\n      }\n      if (app.container.hasBinding('redis')) {\n        const redis = await app.container.make('redis')\n        await redis.quitAll()\n      }\n    }\n  })\n`
files['commands/adula_setup.ts'] = await readFile(join(here, 'templates/adula_setup.stub'), 'utf8')
files['scripts/dev.mjs'] = await readFile(join(here, 'templates/dev.stub'), 'utf8')
files['tests/functional/starter.spec.ts'] = await readFile(
  join(here, 'templates/starter.spec.stub'),
  'utf8'
)
for (const [path, text] of Object.entries(files)) {
  if (
    /testFixturesEnabled|fixtureModuleNames|#tests\/fixtures|~\/fixture_pages|\.\.\/\.\.\/packages\//.test(
      text
    )
  )
    throw new Error(`Reference-only content in ${path}`)
}
const app = JSON.parse(await readFile(join(reference, 'package.json'), 'utf8'))
const own = JSON.parse(await readFile(join(here, 'package.json'), 'utf8'))
const workspace = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
app.name = 'adula-system'
app.version = '0.1.0'
app.packageManager = workspace.packageManager
app.devDependencies.pnpm = workspace.packageManager.split('@')[1]
app.dependencies['adula'] = own.version
app.dependencies['@adula/ui'] = own.version
app.scripts.typecheck = 'tsc --noEmit && tsc --noEmit --project inertia/tsconfig.json'
if (app.scripts.dev !== 'node ace serve --hmr') throw new Error('Unexpected reference dev script')
app.scripts.dev = 'node scripts/dev.mjs'
// A single command: pnpm and npm append `test -- <args>` to it. The test runner's teardown
// formats database/schema.ts, which Lucid regenerates during the first test migration.
if (app.scripts.test !== 'node ace test') throw new Error('Unexpected reference test script')
files['package.json'] = JSON.stringify(app, null, 2) + '\n'
files['pnpm-workspace.yaml'] = (await readFile(join(root, 'pnpm-workspace.yaml'), 'utf8')).replace(
  /packages:[\s\S]*?(?=allowBuilds:)/,
  "packages:\n  - '.'\n"
)
files['.gitignore'] =
  'node_modules/\nbuild/\n.adonisjs/\n.env*\n!.env.example\ntmp/\nstorage/\npublic/assets/\n*.log\n'
files['.prettierignore'] = '.adonisjs\nnode_modules\nbuild\n.adula-packages\n'
await writeFile(join(output, 'template.json'), JSON.stringify({ version: own.version, files }))
await cp(join(root, 'packages/adula/LICENSE.md'), join(here, 'LICENSE'))
console.log(`Built create-adulajs ${own.version} with ${Object.keys(files).length} application files`)
