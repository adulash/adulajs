import { test } from '@japa/runner'
import { execFile } from 'node:child_process'
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import {
  RESERVED_APP_NAMES,
  appDefaultRoles,
  planApp,
  writeAppPlan,
} from '../src/commands/app_scaffold.js'
import { getMetaData } from '../commands/main.js'

const run = promisify(execFile)
const reference = fileURLToPath(new URL('../../../apps/reference/', import.meta.url))
const MODULES = '// adula:imports\nexport const modules = [/* adula:modules */]\n'

async function emptyApp() {
  const root = await mkdtemp(join(tmpdir(), 'adula-app-'))
  await mkdir(join(root, 'start'))
  await writeFile(join(root, 'start/modules.ts'), MODULES)
  return root
}

/** Every file under a directory, relative and with forward slashes. */
async function tree(root: string) {
  const entries = await readdir(root, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort()
}

/**
 * Links each installed package of the reference application into a copy. pnpm's links are
 * relative, so every package is linked to its real location rather than through one
 * junction to the whole folder.
 */
async function linkDependencies(from: string, to: string) {
  for (const entry of await readdir(from, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    if (entry.name.startsWith('@') && entry.isDirectory()) {
      await linkDependencies(join(from, entry.name), join(to, entry.name))
      continue
    }
    await mkdir(to, { recursive: true })
    await symlink(await realpath(join(from, entry.name)), join(to, entry.name), 'junction')
  }
}

/** Removes the links only, so cleanup never reaches the shared dependencies. */
async function unlinkDependencies(path: string) {
  const entries = await readdir(path, { withFileTypes: true }).catch(() => [])
  for (const entry of entries)
    if (entry.isSymbolicLink()) await unlink(join(path, entry.name))
    else if (entry.isDirectory()) await unlinkDependencies(join(path, entry.name))
}

/** Prettier with the reference system's configuration (the layout create-adulajs ships). */
async function prettier() {
  const require = createRequire(join(reference, 'package.json'))
  const module = await import(pathToFileURL(require.resolve('prettier')).href)
  // The reference application owns Prettier; the core package does not depend on it.
  const format = (module.default ?? module) as {
    resolveConfig(file: string): Promise<Record<string, unknown> | null>
    check(source: string, options: Record<string, unknown>): Promise<boolean>
  }
  const config = await format.resolveConfig(join(reference, 'start/modules.ts'))
  return (source: string, file: string) =>
    format.check(source, { ...config, filepath: join(reference, file) })
}

test.group('adula:app', () => {
  test('is registered with the AdulaJS commands and takes the documented flags', async ({
    assert,
  }) => {
    const commands = await getMetaData()
    const command = commands.find((entry) => entry.commandName === 'adula:app')
    assert.exists(command)
    assert.sameMembers(
      command!.flags.map((flag) => flag.flagName),
      ['label-ar', 'label-en', 'dry-run']
    )
  })

  test('refuses names that are not slugs, are reserved or already exist', async ({ assert }) => {
    const root = await emptyApp()
    for (const name of ['Leave', 'leave-requests', '1leave', '_leave', '../escape', 'إجازات', ''])
      await assert.rejects(
        () => planApp(root, { name, labelAr: 'تجربة' }),
        /Invalid application name/
      )
    for (const name of ['admin', 'users', 'roles', 'org_units', 'lookups', 'adula', 'core'])
      await assert.rejects(() => planApp(root, { name, labelAr: 'تجربة' }), /reserved/)
    assert.includeMembers([...RESERVED_APP_NAMES], ['settings', 'sequences', 'workflows', 'auth'])
    await assert.rejects(
      () => planApp(root, { name: `a${'b'.repeat(40)}`, labelAr: 'تجربة' }),
      /longer than 40/
    )
    await assert.rejects(() => planApp(root, { name: 'leave_requests' }), /--label-ar is required/)
    await assert.rejects(
      () => planApp(root, { name: 'leave_requests', labelAr: '   ' }),
      /--label-ar is required/
    )
    await assert.rejects(
      () => planApp(root, { name: 'leave_requests', labelAr: "طلبات\n'); x('" }),
      /single line/
    )
    await mkdir(join(root, 'app/modules/existing'), { recursive: true })
    await assert.rejects(
      () => planApp(root, { name: 'existing', labelAr: 'قائم' }),
      /already exists/
    )
    await writeFile(
      join(root, 'start/modules.ts'),
      "import module_listed from '#modules/listed/module'\n" + MODULES
    )
    await assert.rejects(
      () => planApp(root, { name: 'listed', labelAr: 'مسجل' }),
      /already registered/
    )
  })

  test('plans without writing, then scaffolds a Prettier-formatted, registered application', async ({
    assert,
  }) => {
    const root = await emptyApp()
    const before = await tree(root)
    const plan = await planApp(root, { name: 'leave_requests', labelAr: 'طلبات الإجازة' })
    // Planning is the dry run: nothing is written.
    assert.deepEqual(await tree(root), before)
    assert.equal(await readFile(join(root, 'start/modules.ts'), 'utf8'), MODULES)
    assert.deepEqual(plan.label, { ar: 'طلبات الإجازة', en: 'Leave requests' })
    const files = Object.keys(plan.files)
    for (const file of [
      'app/modules/leave_requests/module.ts',
      'app/modules/leave_requests/resources/leave_requests.ts',
      'tests/functional/leave_requests.spec.ts',
      'tests/functional/leave_requests/smoke.spec.ts',
    ])
      assert.include(files, file)
    // The definition derives validation; no validator, model or factory is scaffolded (ADR 045).
    for (const folder of ['models', 'validators', 'factories'])
      assert.notInclude(files, `app/modules/leave_requests/${folder}/leave_requests.ts`)
    assert.isTrue(files.some((file) => /migrations\/\d+_create_leave_requests\.ts$/.test(file)))

    await writeAppPlan(root, plan)
    assert.sameMembers(await tree(root), [...before, ...files].sort())
    for (const directory of ['resources', 'migrations', 'workflows', 'tests'])
      assert.include(plan.directories, `app/modules/leave_requests/${directory}`)
    const modules = await readFile(join(root, 'start/modules.ts'), 'utf8')
    assert.include(modules, "import module_leave_requests from '#modules/leave_requests/module'")
    assert.include(modules, '[\n  module_leave_requests,\n  /* adula:modules */\n]')
    const module = plan.files['app/modules/leave_requests/module.ts']
    assert.include(module, "label: {\n    ar: 'طلبات الإجازة',\n    en: 'Leave requests',\n  },")
    assert.include(module, "key: 'leave_requests_manager',")
    assert.include(module, "name: 'مدير طلبات الإجازة',")
    assert.include(module, "key: 'leave_requests_user',")
    assert.include(module, "name: 'مستخدم طلبات الإجازة',")
    assert.include(module, "action: 'update',\n          conditions: { createdBy: ACTOR_ID },")
    assert.include(module, '    resource_leave_requests,\n    /* adula:resources */\n')
    const resource = plan.files['app/modules/leave_requests/resources/leave_requests.ts']
    assert.include(resource, "label: { ar: 'طلبات الإجازة', en: 'Leave requests' }")
    assert.deepEqual(
      appDefaultRoles('leave_requests', 'طلبات الإجازة').map((role) => [
        role.key,
        role.rules.map((rule) => rule.action),
      ]),
      [
        ['leave_requests_manager', ['view', 'create', 'update', 'delete']],
        ['leave_requests_user', ['view', 'create', 'update']],
      ]
    )
    // The files adula:app itself writes keep the project's Prettier layout.
    const formatted = await prettier()
    for (const file of [
      'app/modules/leave_requests/module.ts',
      'tests/functional/leave_requests/smoke.spec.ts',
    ])
      assert.isTrue(await formatted(plan.files[file], file), `${file} is not Prettier-formatted`)
    assert.isTrue(await formatted(modules, 'start/modules.ts'))
    // A second run refuses instead of overwriting.
    await assert.rejects(
      () => planApp(root, { name: 'leave_requests', labelAr: 'طلبات الإجازة' }),
      /already exists/
    )
  })

  test('the command scaffolds a copy of the reference application that typechecks', async ({
    assert,
  }) => {
    const root = await mkdtemp(join(tmpdir(), 'adula-app-reference-'))
    try {
      await cp(reference, root, {
        recursive: true,
        filter: (source) => {
          const path = relative(reference, source).split(sep)
          return (
            !['node_modules', 'build', 'tmp', 'storage', 'coverage'].includes(path[0]) &&
            !path.at(-1)!.startsWith('.env')
          )
        },
      })
      await linkDependencies(join(reference, 'node_modules'), join(root, 'node_modules'))
      const env = {
        ...process.env,
        NODE_ENV: 'development',
        TZ: 'UTC',
        PORT: '3399',
        HOST: '127.0.0.1',
        LOG_LEVEL: 'warn',
        APP_KEY: 'adula-app-command-test-key-0123456789',
        APP_URL: 'http://127.0.0.1:3399',
        SESSION_DRIVER: 'memory',
        DB_HOST: '127.0.0.1',
        DB_PORT: '5432',
        DB_USER: 'unused',
        DB_PASSWORD: 'unused',
        DB_DATABASE: 'unused_test',
        REDIS_HOST: '127.0.0.1',
        REDIS_PORT: '6379',
        DRIVE_DISK: 'local',
      }
      const ace = (...args: string[]) =>
        run(process.execPath, ['ace', 'adula:app', ...args], {
          cwd: root,
          env,
          windowsHide: true,
          timeout: 120000,
        })
      const before = await tree(join(root, 'app'))
      const modules = await readFile(join(root, 'start/modules.ts'), 'utf8')
      const dry = await ace('leave_requests', '--label-ar=طلبات الإجازة', '--dry-run')
      assert.include(dry.stdout, 'app/modules/leave_requests/module.ts')
      assert.include(dry.stdout, 'tests/functional/leave_requests/smoke.spec.ts')
      assert.include(dry.stdout, 'Nothing was written')
      assert.deepEqual(await tree(join(root, 'app')), before)
      assert.equal(await readFile(join(root, 'start/modules.ts'), 'utf8'), modules)

      const refused = await ace('admin', '--label-ar=الإدارة').then(
        () => undefined,
        (error) => error as { code: number; stdout: string; stderr: string }
      )
      assert.exists(refused, 'A reserved name must fail the command')
      assert.include(`${refused!.stdout}${refused!.stderr}`, 'reserved')

      const created = await ace('leave_requests', '--label-ar=طلبات الإجازة')
      assert.include(created.stdout, 'adula:install')
      assert.include(
        await readFile(join(root, 'start/modules.ts'), 'utf8'),
        "import module_leave_requests from '#modules/leave_requests/module'"
      )
      // The scaffolded application compiles with the reference application's settings. Only
      // diagnostics in what adula:app wrote count: the copy also carries uncommitted work.
      const tsc = createRequire(join(reference, 'package.json')).resolve('typescript/bin/tsc')
      const output = await run(process.execPath, [tsc, '--noEmit', '-p', 'tsconfig.json'], {
        cwd: root,
        windowsHide: true,
        timeout: 240000,
      }).then(
        () => '',
        (error) => String((error as { stdout: string }).stdout)
      )
      const scaffolded = output
        .split(/\r?\n/)
        .filter((line) => /leave_requests|start[\\/]modules\.ts|database[\\/]schema/.test(line))
      assert.deepEqual(scaffolded, [])
      assert.notInclude(output, 'Cannot find module')
    } finally {
      await unlinkDependencies(join(root, 'node_modules'))
      await rm(root, { recursive: true, force: true })
    }
  }).timeout(360000)
})
