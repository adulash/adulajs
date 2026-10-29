import { lstat, readFile, readdir, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import type { Settings } from '../services/settings.js'
import { ADULA_VERSION } from '../version.js'
import { agentAssets, managedRules, digest } from './agent_assets.js'
import { columnName, joinTable } from '../resource/define_resource.js'
import { decimalShape } from '../resource/values.js'
import type { Knex } from 'knex'
import type { Field, Resource } from '../resource/types.js'
import { describeDrift, inSync, migratable, schemaDrift } from '../database/schema_diff.js'
import type { WorkflowDefinition } from '../workflows/define_workflow.js'
import type { RuntimeHealth } from '../core/health.js'

export type Finding = {
  check: string
  status: 'pass' | 'warn' | 'fail' | 'info'
  message: string
}

// The deployment volume and backup scripts share this application-relative path.
const UPLOADS_PATH = 'storage/uploads'
const UPLOADS_WARNING_BYTES = 5_000_000_000
/** An event the worker has not published within this age suggests that no worker runs. */
const OUTBOX_STALE_MS = 60_000

async function assertContained(root: string, path: string) {
  const resolved = relative(await realpath(root), await realpath(path))
  if (
    resolved === '..' ||
    resolved.startsWith('../') ||
    resolved.startsWith('..\\') ||
    isAbsolute(resolved)
  )
    throw new Error('Path resolves outside the application')
}

async function visitFiles(
  root: string,
  directory: string,
  visit: (path: string, bytes: number) => Promise<void> | void
): Promise<boolean> {
  const path = join(root, directory)
  try {
    await lstat(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
  await assertContained(root, path)
  const walk = async (current: string): Promise<void> => {
    const entry = await lstat(current)
    if (entry.isSymbolicLink()) throw new Error('Symbolic links require manual inspection')
    if (entry.isFile()) {
      await visit(relative(root, current).replaceAll('\\', '/'), entry.size)
      return
    }
    if (!entry.isDirectory()) throw new Error('Unsupported filesystem entry')
    const children = await readdir(current)
    for (const child of children.sort()) await walk(join(current, child))
  }
  const entry = await lstat(path)
  if (!entry.isDirectory()) throw new Error('Expected a directory')
  await walk(path)
  return true
}

export function assessUploadSize(bytes: number): Finding {
  const large = bytes > UPLOADS_WARNING_BYTES
  return {
    check: 'storage.uploads',
    status: large ? 'warn' : 'pass',
    message: `${UPLOADS_PATH} contains ${bytes} bytes (${(bytes / 1_000_000_000).toFixed(2)} GB); ${
      large
        ? 'above 5 GB, plan an S3 migration and verify the uploaded files before removing local copies'
        : 'within the 5 GB local-storage warning threshold'
    }`,
  }
}

export async function diagnoseUploads(root: string): Promise<Finding> {
  try {
    let bytes = 0
    const exists = await visitFiles(root, UPLOADS_PATH, (_path, size) => {
      bytes += size
    })
    return exists
      ? assessUploadSize(bytes)
      : {
          check: 'storage.uploads',
          status: 'pass',
          message: `${UPLOADS_PATH} does not exist; no local uploads volume to measure`,
        }
  } catch {
    return {
      check: 'storage.uploads',
      status: 'warn',
      message: `Cannot completely measure ${UPLOADS_PATH}; check permissions, directory structure and symbolic links. Size is unknown`,
    }
  }
}

async function diagnosePages(root: string, changed: string[]): Promise<Finding> {
  if (!changed.length)
    return {
      check: 'ui.pages',
      status: 'pass',
      message:
        'No copied UI drift detected; page compatibility still requires typecheck and page tests',
    }
  const pages: string[] = []
  const collect = (file: string) => {
    if (/\.[jt]sx$/.test(file)) pages.push(file)
  }
  try {
    await visitFiles(root, 'inertia/pages', collect)
    // Module-local page overrides are also project-owned extension points.
    await visitFiles(root, 'app/modules', (file) => {
      if (/^app\/modules\/[^/]+\/pages\//.test(file)) collect(file)
    })
  } catch {
    return {
      check: 'ui.pages',
      status: 'warn',
      message: `UI review required (${changed.join('; ')}), but page sources could not be completely inventoried. Check source permissions and symbolic links, then run typecheck and page tests`,
    }
  }
  return {
    check: 'ui.pages',
    status: 'warn',
    message: `UI review required (${changed.join('; ')}). ${
      pages.length
        ? `Review all ${pages.length} project-owned page sources: ${pages.sort().join(', ')}`
        : 'No page sources found in inertia/pages or app/modules/*/pages; review overrides in the source checkout'
    }. This is a conservative inventory, not import dependency analysis; run typecheck and page tests`,
  }
}

export async function diagnoseUi(root: string): Promise<Finding[]> {
  try {
    const lock = JSON.parse(await readFile(join(root, 'ui.lock.json'), 'utf8'))
    if (
      typeof lock.version !== 'string' ||
      typeof lock.adulaCompatibility !== 'string' ||
      !lock.files ||
      typeof lock.files !== 'object' ||
      Array.isArray(lock.files)
    )
      throw new Error('Invalid UI lock')
    const compatible = lock.adulaCompatibility === ADULA_VERSION.split('.').slice(0, 2).join('.')
    const customized: string[] = []
    for (const [file, entry] of Object.entries(lock.files) as [string, { hash: string }][]) {
      if (
        !/^inertia\/components\/ui\/[a-z][a-z0-9_-]*\.tsx?$/.test(file) ||
        !entry ||
        typeof entry.hash !== 'string' ||
        !/^[a-f0-9]{64}$/.test(entry.hash)
      )
        throw new Error('Invalid UI lock entry')
      const path = join(root, file)
      await assertContained(root, path)
      const info = await lstat(path)
      if (!info.isFile()) throw new Error('UI component must be a regular file')
      if (digest(await readFile(path, 'utf8')) !== entry.hash) customized.push(file)
    }
    const changes = [
      ...(!compatible ? ['UI registry compatibility differs from this AdulaJS version'] : []),
      ...(customized.length ? [`copied UI changed: ${customized.sort().join(', ')}`] : []),
    ]
    return [
      {
        check: 'ui.compatibility',
        status: compatible ? 'pass' : 'fail',
        message: compatible
          ? 'UI registry is compatible with this AdulaJS version'
          : 'UI registry version requires a compatibility review',
      },
      {
        check: 'ui.customizations',
        status: customized.length ? 'warn' : 'pass',
        message: customized.length
          ? `${customized.length} project-owned UI files are customized; review diffs before updates`
          : 'UI files match the installed registry snapshot',
      },
      await diagnosePages(root, changes),
    ]
  } catch {
    return [
      {
        check: 'ui.registry',
        status: 'fail',
        message: 'UI lock or component files are missing or invalid; run adula:ui add all',
      },
    ]
  }
}

export async function diagnoseAgentSkills(root: string): Promise<Finding> {
  let valid = false
  try {
    const assets = await agentAssets()
    const lock = JSON.parse(await readFile(join(root, 'adula.lock.json'), 'utf8'))
    valid = lock.version === ADULA_VERSION && lock.managedRules === digest(assets.rules)
    for (const [skillPath, content] of Object.entries(assets.skills)) {
      const actual = await readFile(join(root, skillPath), 'utf8')
      valid =
        valid && lock.skills?.[skillPath] === digest(content) && digest(actual) === digest(content)
    }
  } catch {
    valid = false
  }
  return {
    check: 'agent.skills',
    status: valid ? 'pass' : 'fail',
    message: valid
      ? 'Managed skill hashes match this AdulaJS version'
      : 'Run adula:install to synchronize managed rules and skills',
  }
}

export async function diagnose(
  root: string,
  settings: Settings,
  production: boolean,
  env: Record<string, string | undefined>,
  now = Date.now()
): Promise<Finding[]> {
  const findings: Finding[] = []
  findings.push(await diagnoseUploads(root))
  const version = await settings.get<string>('adula.version')
  findings.push({
    check: 'adula.version',
    status: version === ADULA_VERSION ? 'pass' : 'fail',
    message:
      version === ADULA_VERSION
        ? `AdulaJS ${ADULA_VERSION} is installed`
        : 'Run adula:install after migrations; installed AdulaJS version differs',
  })
  const template = await readFile(
    new URL('../../agent/AGENTS.template.md', import.meta.url),
    'utf8'
  )
  let agents = ''
  try {
    agents = await readFile(join(root, 'AGENTS.md'), 'utf8')
  } catch {}
  const managed = managedRules
  findings.push({
    check: 'agent.rules',
    status: managed(agents) === managed(template) ? 'pass' : 'fail',
    message:
      managed(agents) === managed(template)
        ? 'Managed rules match'
        : 'Managed AGENTS.md was changed or is missing',
  })
  const keys = [
    'BACKUP_S3_ENDPOINT',
    'BACKUP_S3_BUCKET',
    'BACKUP_S3_REGION',
    'BACKUP_S3_ACCESS_KEY_ID',
    'BACKUP_S3_SECRET_ACCESS_KEY',
  ]
  const configured = keys.every((key) => Boolean(env[key]))
  findings.push({
    check: 'backup.config',
    status: configured ? 'pass' : production ? 'fail' : 'warn',
    message: configured ? 'Offsite settings are present' : 'Offsite backup is not configured',
  })
  for (const [key, maxDays] of [
    ['backup.lastOffsite', 2],
    ['backup.lastRestoreTest', 90],
  ] as const) {
    const date = await settings.get<string>(key)
    const fresh =
      date &&
      Number.isFinite(Date.parse(date)) &&
      now - Date.parse(date) >= 0 &&
      now - Date.parse(date) < maxDays * 86400000
    findings.push({
      check: key,
      status: fresh ? 'pass' : production ? 'fail' : 'warn',
      message: fresh ? `${key} is current` : `${key} is missing or older than ${maxDays} days`,
    })
  }
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  findings.push({
    check: 'boundaries',
    status:
      pkg.dependencies?.['patch-package'] ||
      pkg.devDependencies?.['patch-package'] ||
      pkg.pnpm?.patchedDependencies
        ? 'fail'
        : 'pass',
    message: 'Application may not patch AdulaJS internals',
  })
  findings.push(await diagnoseAgentSkills(root))
  if (pkg.dependencies?.['@adula/ui'] || pkg.devDependencies?.['@adula/ui'])
    findings.push(...(await diagnoseUi(root)))
  return findings
}

type TableShape = Pick<Resource, 'name' | 'scoped' | 'version' | 'submittable' | 'unique'> & {
  fields: Record<
    string,
    Pick<
      Field,
      'column' | 'required' | 'sequence' | 'unique' | 'searchable' | 'default' | 'visibleWhen'
    > & {
      type: string
      resource?: string
      table?: string
      precision?: number
      scale?: number
    }
  >
}

/** The columns and indexes createResourceTable derives from a definition, one entry each. */
function tableShape(resource: TableShape) {
  const shape = new Map<string, string>()
  for (const flag of ['scoped', 'version', 'submittable'] as const)
    if (resource[flag]) shape.set(flag, flag)
  for (const [key, field] of Object.entries(resource.fields)) {
    if (field.type === 'hasMany') continue
    const column =
      field.type === 'manyToMany'
        ? joinTable(resource.name, key, { resource: String(field.resource), table: field.table })
            .table
        : (field.column ?? columnName(key))
    const traits = [
      field.type === 'belongsTo' || field.type === 'manyToMany'
        ? `${field.type} ${field.resource}`
        : field.type === 'decimal' || field.type === 'percent'
          ? `${field.type}(${Object.values(decimalShape(field)).join(',')})`
          : field.type,
      // The same NOT NULL rule as createResourceTable: visibleWhen may hide (and clear) it.
      ...(field.sequence || (field.required && field.visibleWhen === undefined)
        ? ['required']
        : []),
      ...(field.unique ? ['unique'] : []),
      ...(field.searchable ? ['searchable'] : []),
      ...(field.default !== undefined && !Array.isArray(field.default)
        ? [`default ${JSON.stringify(field.default)}`]
        : []),
    ]
    shape.set(column, `${column} (${traits.join(', ')})`)
  }
  for (const keys of resource.unique ?? [])
    shape.set(`unique ${keys.join(',')}`, `unique (${keys.join(', ')})`)
  return shape
}

/**
 * A generated create-migration embeds the definition as it was at scaffold time. While it is
 * still pending, compare that snapshot with the current resource so the table matches (#20).
 */
export function diagnoseResourceSnapshots(
  pending: { file: string; source: string }[],
  resource: (name: string) => TableShape | undefined
): Finding {
  const drift: string[] = []
  for (const { file, source } of pending) {
    const embedded = /createResourceTable\([^,]+,\s*(\{[\s\S]*\})\s*\)\s*\}/.exec(source)?.[1]
    if (!embedded) continue
    let snapshot: TableShape
    try {
      snapshot = JSON.parse(embedded)
    } catch {
      continue
    }
    const current = resource(snapshot.name)
    if (!current) continue
    const [before, after] = [tableShape(snapshot), tableShape(current)]
    const changed = [...new Set([...before.keys(), ...after.keys()])]
      .filter((key) => before.get(key) !== after.get(key))
      .map((key) => after.get(key) ?? `without ${before.get(key)}`)
    if (changed.length) drift.push(`${file} (${snapshot.name}): ${changed.join('; ')}`)
  }
  return {
    check: 'resources.snapshots',
    status: drift.length ? 'warn' : 'pass',
    message: drift.length
      ? `Pending create-migrations differ from their resource definitions; run node ace adula:resource:snapshot <name> (or update the embedded definition) before migration:run: ${drift.join(' | ')}`
      : 'Pending resource migrations match their definitions',
  }
}

/**
 * Workflow recipients address roles by their stable key, or for compatibility by
 * their editable display name. List references that match no role, and those that
 * only match a display name, which a rename in the roles screen would break (#25).
 */
export function diagnoseWorkflowRoles(
  workflows: readonly Pick<WorkflowDefinition, 'name' | 'version' | 'steps'>[],
  roles: readonly (string | { key: string | null; name: string })[]
): Finding {
  const keys = new Set(
    roles.flatMap((role) => (typeof role === 'string' || !role.key ? [] : [role.key]))
  )
  const names = new Set(roles.map((role) => (typeof role === 'string' ? role : role.name)))
  const missing: string[] = []
  const byName: string[] = []
  for (const workflow of workflows)
    for (const [key, step] of Object.entries(workflow.steps)) {
      const to = step.type === 'approval' ? step.assignees : step.type === 'notify' ? step.to : null
      if (!to || typeof to !== 'object' || !('role' in to) || keys.has(to.role)) continue
      const reference = `${workflow.name}@${workflow.version}.${key} → "${to.role}"`
      if (names.has(to.role)) byName.push(reference)
      else missing.push(reference)
    }
  // Plain name lists (older hosts) cannot tell keys from names; only missing roles matter.
  const keyed = roles.some((role) => typeof role !== 'string')
  const messages = [
    ...(missing.length
      ? [
          `Workflow steps address roles that match no role key or name; approvals there fail: ${missing.join(', ')}`,
        ]
      : []),
    ...(keyed && byName.length
      ? [
          `Workflow steps address roles by display name; give each role a key and address it by key so renaming cannot detach approvers: ${byName.join(', ')}`,
        ]
      : []),
  ]
  return {
    check: 'workflows.roles',
    status: messages.length ? 'warn' : 'pass',
    message: messages.length
      ? messages.join(' | ')
      : 'Every role addressed by a workflow step exists',
  }
}

/** Events wait in the outbox until a worker publishes them; a stale backlog means none runs (#50). */
export function diagnoseOutbox(
  health: Pick<RuntimeHealth, 'outbox'> & {
    heartbeats: Pick<RuntimeHealth['heartbeats'], 'worker'>
  }
): Finding {
  const { backlog, oldestAgeMs } = health.outbox
  const worker = health.heartbeats.worker.healthy ? 'running' : 'not running (no recent heartbeat)'
  const stale = backlog > 0 && oldestAgeMs !== null && oldestAgeMs >= OUTBOX_STALE_MS
  return {
    check: 'events.outbox',
    status: stale ? 'warn' : 'pass',
    message: stale
      ? `${backlog} unpublished events, the oldest ${Math.round(oldestAgeMs / 1000)} s old; the worker is ${worker}. Listeners run only while \`node ace adula:worker\` runs`
      : `No outbox event is older than ${OUTBOX_STALE_MS / 1000} s; the worker is ${worker}`,
  }
}

/**
 * Compares every registered resource with its live table (see schemaDrift): missing
 * columns, different types, NOT NULL columns the definition lets be empty, missing unique
 * indexes, unique indexes still counting cancelled documents and missing join tables. Run
 * `node ace adula:resource:migration <name>` to add what is missing and apply the
 * relaxing changes.
 */
export async function diagnoseResourceSchemas(
  db: Knex,
  resources: readonly Resource[]
): Promise<Finding> {
  const problems: string[] = []
  const missing = new Set<string>()
  for (const resource of resources) {
    const drift = await schemaDrift(db, resource)
    if (inSync(drift)) continue
    if (migratable(drift)) missing.add(resource.name)
    problems.push(...describeDrift(drift))
  }
  return {
    check: 'resources.schema',
    status: problems.length ? 'warn' : 'pass',
    message: problems.length
      ? `The database differs from the resource definitions: ${problems.join('; ')}${
          missing.size
            ? `. Add what is missing with ${[...missing].map((name) => `node ace adula:resource:migration ${name}`).join(', ')}, then migration:run`
            : ''
        }`
      : 'Every resource table matches its definition',
  }
}
