import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { lockedManager, rewriteManifest, rewriteSource, upgradeApplication } from '../src/upgrade.mjs'

// 1.x names, spelled once; this suite exercises the upgrade away from them.
const RETIRED = 'kit'
const CORE = `@adula/${RETIRED}`
const Retired = RETIRED.charAt(0).toUpperCase() + RETIRED.slice(1)

async function legacyApplication() {
  const root = await mkdtemp(join(tmpdir(), 'adula-upgrade-'))
  const files = {
    'package.json': JSON.stringify({
      name: 'legacy-app',
      dependencies: { [CORE]: '1.2.0', '@adula/ui': '1.2.0', 'pg': '8.0.0' },
      devDependencies: { '@adula/create-app': '1.2.0' },
    }),
    'config/database.ts': `import { with${Retired}Database } from '${CORE}'\nexport default with${Retired}Database({}, '')\n`,
    'app/services/errors.ts': `import { ${Retired}Error, ${RETIRED.toUpperCase()}_VERSION } from '${CORE}'\nimport type { Actor } from '${CORE}/types'\nexport const fail = () => new ${Retired}Error(409, 'E', ${RETIRED.toUpperCase()}_VERSION)\nexport const myKitchen = 'kitchen'\n`,
    'adonisrc.ts': `export default { providers: [() => import('${CORE}/provider')], commands: [() => import('${CORE}/commands')], preloads: [() => import('#start/${RETIRED}_routes')] }\n`,
    [`start/${RETIRED}_routes.ts`]: `import router from '@adonisjs/core/services/router'\nimport { routes } from '${CORE}'\n`,
    'eslint.config.js': `export default { rules: { 'adula/no-${RETIRED}-patching': 'error' } }\n`,
    'ui.lock.json': JSON.stringify({ version: '1.2.0', [`${RETIRED}Compatibility`]: '1.2', files: {} }),
    'node_modules/untouched.js': `import x from '${CORE}'\n`,
    'build/untouched.js': `import x from '${CORE}'\n`,
    // Names that merely contain "lock", and a nested directory named like generated output.
    'inertia/components/clock.tsx': `import type { Actor } from '${CORE}/types'\n`,
    'app/modules/build/services/stock_lock.ts': `import { ${Retired}Error } from '${CORE}'\n`,
  }
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(root, path, '..'), { recursive: true })
    await writeFile(join(root, path), text)
  }
  return root
}

test('source rewrite renames 1.x imports and exported identifiers only', () => {
  const before = `import { ${Retired}Ability } from '${CORE}/auth'\nconst ${RETIRED}chen = '${CORE}-like'\n`
  const after = rewriteSource(before)
  assert.equal(after, `import { AdulaAbility } from 'adula/auth'\nconst ${RETIRED}chen = '${CORE}-like'\n`)
  assert.equal(rewriteSource(after), after, 'rewriting is idempotent')
})

test('manifest moves the core and creator to their 2.0 names', () => {
  const pkg = rewriteManifest(
    { dependencies: { [CORE]: '1.2.0', '@adula/ui': '1.2.0' }, devDependencies: { '@adula/create-app': '1.0.0' } },
    '2.0.0'
  )
  assert.deepEqual(pkg.dependencies, { '@adula/ui': '^2.0.0', 'adula': '^2.0.0' })
  assert.deepEqual(pkg.devDependencies, { 'create-adulajs': '^2.0.0' })
  const renamed = rewriteManifest({ dependencies: { adula: '2.1.0' }, devDependencies: { 'create-adula-app': '2.1.0' } }, '2.2.0')
  assert.deepEqual(renamed.devDependencies, { 'create-adulajs': '^2.2.0' })
})

test('upgrade rewrites a 1.x application and renames its routes preload', async () => {
  const root = await legacyApplication()
  try {
    const changed = await upgradeApplication(root, { version: '2.0.0' })
    assert.ok(changed.includes('package.json'))
    assert.ok(changed.includes('ui.lock.json'))
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
    assert.equal(pkg.dependencies.adula, '^2.0.0')
    assert.equal(pkg.dependencies[CORE], undefined)
    assert.match(await readFile(join(root, 'config/database.ts'), 'utf8'), /withAdulaDatabase\(\{\}/)
    const errors = await readFile(join(root, 'app/services/errors.ts'), 'utf8')
    assert.match(errors, /import \{ AdulaError, ADULA_VERSION \} from 'adula'/)
    assert.match(errors, /from 'adula\/types'/)
    assert.match(errors, /'kitchen'/, 'unrelated words are kept')
    const rc = await readFile(join(root, 'adonisrc.ts'), 'utf8')
    assert.match(rc, /'adula\/provider'.*'adula\/commands'.*'#start\/adula_routes'/s)
    await access(join(root, 'start/adula_routes.ts'))
    await assert.rejects(access(join(root, `start/${RETIRED}_routes.ts`)))
    assert.match(await readFile(join(root, 'eslint.config.js'), 'utf8'), /adula\/no-core-patching/)
    const lock = JSON.parse(await readFile(join(root, 'ui.lock.json'), 'utf8'))
    assert.deepEqual(Object.keys(lock), ['version', 'adulaCompatibility', 'files'])
    assert.match(await readFile(join(root, 'node_modules/untouched.js'), 'utf8'), new RegExp(CORE))
    assert.match(await readFile(join(root, 'build/untouched.js'), 'utf8'), new RegExp(CORE))
    assert.match(await readFile(join(root, 'inertia/components/clock.tsx'), 'utf8'), /'adula\/types'/)
    assert.equal(
      await readFile(join(root, 'app/modules/build/services/stock_lock.ts'), 'utf8'),
      `import { AdulaError } from 'adula'\n`
    )
    assert.deepEqual(await upgradeApplication(root, { version: '2.0.0' }), [], 'second run is a no-op')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('upgrade refuses uncommitted git changes unless forced', async () => {
  const root = await legacyApplication()
  try {
    const git = spawnSync('git', ['init', '--quiet'], { cwd: root })
    if (git.status !== 0) return
    await assert.rejects(upgradeApplication(root, { version: '2.0.0' }), /Commit or stash/)
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
    assert.equal(pkg.dependencies[CORE], '1.2.0', 'a refused upgrade wrote nothing')
    assert.ok((await upgradeApplication(root, { version: '2.0.0', force: true })).length)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the git guard also covers an application inside a larger repository', async () => {
  const repository = await mkdtemp(join(tmpdir(), 'adula-monorepo-'))
  try {
    if (spawnSync('git', ['init', '--quiet'], { cwd: repository }).status !== 0) return
    const app = await legacyApplication()
    const nested = join(repository, 'apps', 'erp')
    await mkdir(join(repository, 'apps'), { recursive: true })
    await rename(app, nested)
    await assert.rejects(upgradeApplication(nested, { version: '2.0.0' }), /Commit or stash/)
  } finally {
    await rm(repository, { recursive: true, force: true })
  }
})

test('the install uses the package manager the application already locks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'adula-manager-'))
  try {
    assert.equal(await lockedManager(root), 'pnpm')
    await writeFile(join(root, 'package-lock.json'), '{}')
    assert.equal(await lockedManager(root), 'npm')
    await writeFile(join(root, 'pnpm-lock.yaml'), '')
    assert.equal(await lockedManager(root), 'pnpm')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('upgrade copies local archives when --packages is given', async () => {
  const root = await legacyApplication()
  const archives = await mkdtemp(join(tmpdir(), 'adula-archives-'))
  try {
    await writeFile(join(archives, 'adula-2.0.0.tgz'), 'core')
    await writeFile(join(archives, 'adula-ui-2.0.0.tgz'), 'ui')
    await upgradeApplication(root, { version: '2.0.0', packages: archives })
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
    assert.equal(pkg.dependencies.adula, 'file:.adula-packages/adula.tgz')
    assert.equal(pkg.dependencies['@adula/ui'], 'file:.adula-packages/adula-ui.tgz')
    assert.equal(await readFile(join(root, '.adula-packages/adula.tgz'), 'utf8'), 'core')
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(archives, { recursive: true, force: true })
  }
})

test('a project that never used AdulaJS is rejected', async () => {
  const root = await mkdtemp(join(tmpdir(), 'adula-upgrade-'))
  try {
    await writeFile(join(root, 'package.json'), '{"dependencies":{}}')
    await assert.rejects(upgradeApplication(root, { version: '2.0.0' }), /not an AdulaJS system/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
