import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { identifier } from '../resource/define_resource.js'
import type { Label } from '../resource/types.js'
import { planResource, quoted } from './generator.js'
import { MODULE_DIRECTORIES, moduleRegistered } from './source_markers.js'

/**
 * Names an application (module) may not take: AdulaJS framework areas, URL segments of
 * the generated application, and tables the core and the host application own. An
 * application's example resource and table share its name, so a collision would shadow
 * a framework table or route.
 */
export const RESERVED_APP_NAMES: readonly string[] = [
  // Framework and application areas
  'adula',
  'adulajs',
  'core',
  'app',
  'apps',
  'module',
  'modules',
  'system',
  'admin',
  'auth',
  'api',
  'account',
  'profile',
  'work',
  'resources',
  'settings',
  'lookups',
  'sequences',
  'notifications',
  'workflows',
  'approvals',
  'my_tasks',
  'imports',
  'attachments',
  'webhooks',
  'health',
  'login',
  'logout',
  'invitations',
  'permissions',
  'reports',
  'jobs',
  'mcp',
  // Core and host-application tables
  'users',
  'roles',
  'role_rules',
  'user_roles',
  'user_org_units',
  'org_units',
  'activities',
  'assignments',
  'auth_access_tokens',
  'authorization_revision',
  'comment_mentions',
  'comments',
  'field_changes',
  'followers',
  'import_batches',
  'inbound_deliveries',
  'inbound_sources',
  'message_templates',
  'outbox',
  'processed_events',
  'saved_views',
  'sessions',
  'taggables',
  'tags',
  'upload_grants',
  'user_invitations',
  'user_sessions',
  'webhook_deliveries',
  'workflow_events',
  'workflow_runs',
  'password_reset_tokens',
  'social_accounts',
  'adonis_schema',
  'adonis_schema_versions',
]

/** Longest application name: its table, indexes and role keys must fit PostgreSQL limits. */
export const APP_NAME_MAX_LENGTH = 40

export type AppOptions = { name: string; labelAr?: string; labelEn?: string }

export type AppPlan = {
  name: string
  label: Label
  /** New files relative to the application root, module definition included. */
  files: Record<string, string>
  /** Empty module folders created next to the files. */
  directories: string[]
  /** start/modules.ts after registering the application. */
  modules: { path: string; source: string }
}

/** Validates an application name: an SQL-safe slug that is neither reserved nor too long. */
export function appName(value: string) {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9_]*$/.test(value))
    throw new Error(
      `Invalid application name "${value}": use lower-case letters, digits and underscores, starting with a letter`
    )
  identifier(value)
  if (value.length > APP_NAME_MAX_LENGTH)
    throw new Error(`Application name is longer than ${APP_NAME_MAX_LENGTH} characters`)
  if (RESERVED_APP_NAMES.includes(value))
    throw new Error(`"${value}" is reserved by AdulaJS; choose another application name`)
  return value
}

/** leave_requests → Leave requests */
export function defaultEnglishLabel(name: string) {
  const words = name.replaceAll('_', ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** The default roles an application ships, in the shape module definitions declare. */
export function appDefaultRoles(name: string, labelAr: string) {
  return [
    {
      key: `${name}_manager`,
      name: `مدير ${labelAr}`,
      permissionLevel: 1,
      rules: (['view', 'create', 'update', 'delete'] as const).map((action) => ({
        subject: name,
        action,
      })),
    },
    {
      key: `${name}_user`,
      name: `مستخدم ${labelAr}`,
      rules: [
        { subject: name, action: 'view' },
        { subject: name, action: 'create' },
        { subject: name, action: 'update', conditions: { createdBy: '$actor.id' } },
      ],
    },
  ]
}

/** The module definition of a new application, in the project's Prettier layout. */
export function appModuleSource(name: string, label: Label) {
  const [manager, user] = appDefaultRoles(name, label.ar)
  const rule = (action: string) => `        { subject: '${name}', action: '${action}' },`
  return [
    "import { ACTOR_ID, type Module } from 'adula'",
    '// adula:imports',
    'export default {',
    `  name: '${name}',`,
    '  label: {',
    `    ar: ${quoted(label.ar)},`,
    `    en: ${quoted(label.en ?? defaultEnglishLabel(name))},`,
    '  },',
    '  dependsOn: [],',
    '  resources: [/* adula:resources */],',
    '  // Created by `node ace adula:install` when missing; administrators own them afterwards.',
    '  defaultRoles: [',
    '    {',
    `      key: '${manager.key}',`,
    `      name: ${quoted(manager.name)},`,
    '      permissionLevel: 1,',
    '      rules: [',
    ...['view', 'create', 'update', 'delete'].map((action) => rule(action)),
    '      ],',
    '    },',
    '    {',
    `      key: '${user.key}',`,
    `      name: ${quoted(user.name)},`,
    '      rules: [',
    rule('view'),
    rule('create'),
    '        // Each user edits only the records they created.',
    '        {',
    `          subject: '${name}',`,
    "          action: 'update',",
    '          conditions: { createdBy: ACTOR_ID },',
    '        },',
    '      ],',
    '    },',
    '  ],',
    '} satisfies Module',
    '',
  ].join('\n')
}

/**
 * A functional smoke test: an administrator opens the example resource list and the
 * navigation carries the application's menu group.
 */
export function appSmokeTestSource(name: string, label: Label) {
  return `import { test } from '@japa/runner'
import { randomUUID } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import User from '#models/user'

const application = '${name}'
const label = ${quoted(label.ar)}

test.group('${name} application smoke test', () => {
  test('an administrator opens the list and sees the application menu group', async ({
    client,
    assert,
  }) => {
    const knex = db.connection().getWriteClient()
    const unique = randomUUID()
    const admin = await User.create({
      email: \`\${application}-admin-\${unique}@example.test\`,
      password: 'smoke-test-password-123',
    })
    const [role] = await knex('roles')
      .insert({ name: \`\${application}-admin-\${unique}\`, permission_level: 1 })
      .returning('id')
    await knex('role_rules').insert({ role_id: role.id, subject: 'all', action: 'manage' })
    await knex('user_roles').insert({ user_id: admin.id, role_id: role.id })
    const [unit] = await knex('org_units')
      .insert({
        name: 'وحدة الاختبار',
        type: 'root',
        path: \`\${application}_\${unique.replaceAll('-', '_')}\`,
      })
      .returning('id')
    await knex('user_org_units').insert({ user_id: admin.id, org_unit_id: unit.id })
    const page = await client
      .get(\`/resources/\${application}\`)
      .loginAs(admin)
      .header('Accept', 'text/html')
      .withInertia()
    page.assertStatus(200)
    const group = page
      .body()
      .props.navigation.filter((entry: { module: string }) => entry.module === application)
    assert.deepEqual(
      group.map((entry: { name: string }) => entry.name),
      [application]
    )
    assert.equal(group[0].moduleLabel, label)
  })
})
`
}

async function exists(path: string) {
  try {
    await access(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return false
  }
}

/**
 * Plans a new application (module) without writing: its module definition with bilingual
 * labels and default roles, one example resource from the resource generator, the empty
 * module folders, a smoke test and its registration in start/modules.ts.
 */
export async function planApp(root: string, options: AppOptions): Promise<AppPlan> {
  const name = appName(options.name)
  const ar = options.labelAr?.trim()
  if (!ar) throw new Error('--label-ar is required: the Arabic label shown in the menu')
  const label = { ar, en: options.labelEn?.trim() || defaultEnglishLabel(name) }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(label.ar + label.en))
    throw new Error('Labels must be a single line without control characters')
  if (await exists(join(root, 'app/modules', name)))
    throw new Error(`Application already exists: app/modules/${name}`)
  const modulesPath = join(root, 'start/modules.ts')
  if (moduleRegistered(await readFile(modulesPath, 'utf8'), name))
    throw new Error(`Application ${name} is already registered in start/modules.ts`)
  const resource = await planResource(root, name, name, {
    moduleSource: appModuleSource(name, label),
    label,
  })
  if (!resource.modules) throw new Error(`Application ${name} is already registered`)
  const files = {
    [`app/modules/${name}/module.ts`]: resource.module.source,
    ...resource.files,
    [`tests/functional/${name}/smoke.spec.ts`]: appSmokeTestSource(name, label),
  }
  for (const file of Object.keys(files))
    if (await exists(join(root, file))) throw new Error(`Refusing to overwrite ${file}`)
  return {
    name,
    label,
    files,
    directories: MODULE_DIRECTORIES.map((directory) => `app/modules/${name}/${directory}`),
    modules: resource.modules,
  }
}

/** Writes a plan; files are created exclusively, start/modules.ts is changed last. */
export async function writeAppPlan(root: string, plan: AppPlan) {
  for (const directory of plan.directories) await mkdir(join(root, directory), { recursive: true })
  for (const [file, content] of Object.entries(plan.files)) {
    const path = join(root, file)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content, { flag: 'wx' })
  }
  await writeFile(plan.modules.path, plan.modules.source)
}
