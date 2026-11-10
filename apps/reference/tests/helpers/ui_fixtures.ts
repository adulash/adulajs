import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { crc32, deflateSync } from 'node:zlib'
import drive from '@adonisjs/drive/services/main'
import env from '#start/env'
import { BaseModel } from '@adonisjs/lucid/orm'
import db from '@adonisjs/lucid/services/db'
import app from '@adonisjs/core/services/app'
import User from '#models/user'
import { UserAvatars, createResourceTable, defineResource, prepareAvatarImage } from 'adula'
import type { Module, RecordData } from 'adula'
import { modules, registry } from '#start/modules'

export type Rule = { subject: string; action: string; inverted?: boolean }
export type UiActor = { user: User; orgUnitId: number; roleId: number }

/** A user with one role and one organizational unit; rules are stored role rules, never mocks. */
export async function seedActor(
  rules: Rule[],
  options: { level?: number; fullName?: string; orgUnitId?: number } = {}
): Promise<UiActor> {
  const knex = db.connection().getWriteClient()
  const unique = randomUUID()
  const user = await User.create({
    fullName: options.fullName ?? 'مستخدم الواجهة',
    email: `ui-${unique}@example.test`,
    password: 'ui-test-only-password-123',
  })
  const [role] = await knex('roles')
    .insert({ name: `ui-${unique}`, permission_level: options.level ?? 1 })
    .returning('id')
  await knex('role_rules').insert(rules.map((rule) => ({ role_id: role.id, ...rule })))
  await knex('user_roles').insert({ user_id: user.id, role_id: role.id })
  let orgUnitId = options.orgUnitId
  if (orgUnitId === undefined) {
    const [org] = await knex('org_units')
      .insert({
        name: `وحدة الواجهة ${unique.slice(0, 8)}`,
        type: 'root',
        path: `ui_${unique.replaceAll('-', '_')}`,
      })
      .returning('id')
    orgUnitId = org.id
  }
  await knex('user_org_units').insert({ user_id: user.id, org_unit_id: orgUnitId })
  return { user, orgUnitId: Number(orgUnitId), roleId: Number(role.id) }
}

/**
 * API tokens belong to administrators (owner decision, 2.3.0), and a token keeps its owner's
 * rules. A bearer test that needs a narrow caller seeds an administrator (`manage all`) who
 * is denied every registered resource outside `resources`.
 */
export async function seedApiAdministrator(
  resources: string[],
  options: Parameters<typeof seedActor>[1] = {},
  denials: Rule[] = []
) {
  const { adula } = await import('#services/adula')
  const denied = adula()
    .registry.all()
    .map((resource) => resource.name)
    .filter((name) => !resources.includes(name))
  return seedActor(
    [
      { subject: 'all', action: 'manage' },
      ...denied.map((subject) => ({ subject, action: 'manage', inverted: true })),
      ...denials.map((rule) => ({ ...rule, inverted: true })),
    ],
    options
  )
}

const passthrough = { validate: async (data: unknown) => data as RecordData }

/** Every field kind on one generic page; the reference modules cover only a subset each. */
export const sampleLines = defineResource({
  name: 'ui_sample_lines',
  label: { ar: 'بنود العينة', en: 'Sample lines' },
  model: BaseModel,
  scoped: true,
  version: true,
  fields: {
    sampleId: {
      type: 'belongsTo',
      resource: 'ui_samples',
      required: true,
      label: { ar: 'العينة', en: 'Sample' },
    },
    item: { type: 'string', required: true, label: { ar: 'الصنف', en: 'Item' } },
    count: { type: 'integer', required: true, label: { ar: 'العدد', en: 'Count' } },
  },
  list: ['item', 'count'],
  form: ['sampleId', 'item', 'count'],
  show: ['item', 'count'],
  actions: ['view', 'create', 'update', 'delete'],
  validator: passthrough,
})
export const samples = defineResource({
  name: 'ui_samples',
  label: { ar: 'عينات الواجهة', en: 'UI samples' },
  recordLabel: { ar: 'عينة', en: 'Sample' },
  model: BaseModel,
  scoped: true,
  version: true,
  fields: {
    title: {
      type: 'string',
      required: true,
      searchable: true,
      sortable: true,
      label: { ar: 'العنوان', en: 'Title' },
    },
    notes: { type: 'text', label: { ar: 'ملاحظات', en: 'Notes' } },
    quantity: {
      type: 'integer',
      sortable: true,
      filterable: true,
      label: { ar: 'الكمية', en: 'Quantity' },
    },
    amount: { type: 'money', sortable: true, label: { ar: 'المبلغ', en: 'Amount' } },
    enabled: { type: 'boolean', filterable: true, label: { ar: 'مفعل', en: 'Enabled' } },
    day: { type: 'date', sortable: true, filterable: true, label: { ar: 'اليوم', en: 'Day' } },
    instant: { type: 'datetime', label: { ar: 'الوقت', en: 'Instant' } },
    details: { type: 'json', label: { ar: 'التفاصيل', en: 'Details' } },
    file: { type: 'attachment', label: { ar: 'المرفق', en: 'File' } },
    customerId: {
      type: 'belongsTo',
      resource: 'customers',
      filterable: true,
      label: { ar: 'العميل', en: 'Customer' },
    },
    status: {
      type: 'lookup',
      group: 'ui_status',
      filterable: true,
      label: { ar: 'الحالة', en: 'Status' },
    },
    reviewer: { type: 'user', filterable: true, label: { ar: 'المراجع', en: 'Reviewer' } },
    lines: {
      type: 'hasMany',
      resource: 'ui_sample_lines',
      foreignKey: 'sampleId',
      inline: true,
      label: { ar: 'البنود', en: 'Lines' },
    },
  },
  list: ['title', 'quantity', 'amount', 'enabled', 'day', 'customerId', 'status', 'reviewer'],
  form: [
    'title',
    'notes',
    'quantity',
    'amount',
    'enabled',
    'day',
    'instant',
    'details',
    'file',
    'customerId',
    'status',
    'reviewer',
    'lines',
  ],
  show: [
    'title',
    'notes',
    'quantity',
    'amount',
    'enabled',
    'day',
    'instant',
    'details',
    'file',
    'customerId',
    'status',
    'reviewer',
    'lines',
  ],
  actions: ['view', 'create', 'update', 'delete'],
  validator: passthrough,
})
export const sampleModule: Module = {
  name: 'ui_fixtures',
  label: { ar: 'عينات الواجهة', en: 'UI fixtures' },
  dependsOn: ['customers'],
  resources: [samples, sampleLines],
}

export async function installSampleResources() {
  const knex = db.connection().getWriteClient()
  await knex.raw('DROP TABLE IF EXISTS ui_sample_lines, ui_samples CASCADE')
  // Start from no sample rows, whatever an earlier suite (or an interrupted run) left behind.
  await purgeSampleRows(knex)
  await createResourceTable(knex, samples)
  await createResourceTable(knex, sampleLines)
  await knex('lookups')
    .insert([
      { group: 'ui_status', key: 'open', label_ar: 'مفتوح', label_en: 'Open' },
      { group: 'ui_status', key: 'closed', label_ar: 'مغلق', label_en: 'Closed' },
    ])
    .onConflict(['group', 'key'])
    .ignore()
  registry.register([...modules, sampleModule])
}

export async function removeSampleResources() {
  registry.register(modules)
  const knex = db.connection().getWriteClient()
  await knex.raw('DROP TABLE IF EXISTS ui_sample_lines, ui_samples CASCADE')
  await purgeSampleRows(knex)
}

const sampleResources = ['ui_samples', 'ui_sample_lines']
// Every table keyed by (resource, record_id) that the sample suites write to.
const sampleRowTables = [
  'field_changes',
  'activities',
  'assignments',
  'comments',
  'followers',
  'taggables',
] as const

/**
 * Dropping the sample tables restarts their identities, so a row one suite leaves behind
 * attaches to record 1 of the next suite's samples: a stale comment shows on its detail view,
 * a stale assignment is returned first by `assignments.forRecord`.
 */
async function purgeSampleRows(
  knex: ReturnType<ReturnType<typeof db.connection>['getWriteClient']>
) {
  const resources = sampleResources
  // Field changes cascade from activities; delete them explicitly too, they carry the resource.
  await knex('field_changes').whereIn('resource', resources).del()
  await knex('activities').whereIn('resource', resources).del()
  // Escalations cascade from assignments.
  await knex('assignments').whereIn('resource', resources).del()
  const comments = knex('comments').whereIn('resource', resources).select('id')
  await knex('comment_mentions').whereIn('comment_id', comments).del()
  await knex('comments').whereIn('resource', resources).del()
  await knex('followers').whereIn('resource', resources).del()
  await knex('taggables').whereIn('resource', resources).del()
  for (const table of sampleRowTables) {
    const left = await knex(table).whereIn('resource', resources).count({ count: '*' }).first()
    if (Number(left?.count) !== 0) throw new Error(`Sample ${table} rows survived cleanup`)
  }
}

/** The long dialog pattern on a phone: the footer stays on screen while only the body scrolls. */
export async function longDialogLayout(dialog: any, viewportHeight: number) {
  const footer = (await dialog.locator('[data-slot="long-dialog-footer"]').boundingBox())!
  const header = (await dialog.locator('[data-slot="dialog-header"]').boundingBox())!
  const body = dialog.locator('[data-slot="long-dialog-body"]')
  const overflow = await body.evaluate(
    (node: unknown) => (globalThis as any).getComputedStyle(node).overflowY as string
  )
  return {
    footerOnScreen: footer.y >= 0 && footer.y + footer.height <= viewportHeight,
    headerOnScreen: header.y >= 0,
    bodyScrolls: overflow === 'scroll',
  }
}

export async function screenshotDir() {
  const dir = app.makePath('../../.work/screenshots')
  await mkdir(dir, { recursive: true })
  return dir
}

function pngChunk(type: string, data: Buffer = Buffer.alloc(0)) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0)
  return Buffer.concat([head, data, crc])
}

/** A small decodable PNG photo for profile picture fixtures. */
export function pngPhoto(side = 96) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(side, 0)
  header.writeUInt32BE(side, 4)
  header[8] = 8
  header[9] = 2
  const rows: Buffer[] = []
  for (let y = 0; y < side; y++) {
    const row = Buffer.alloc(1 + side * 3)
    for (let x = 0; x < side; x++) row.set([(x * 3) % 256, (y * 5) % 256, 150], 1 + x * 3)
    rows.push(row)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(Buffer.concat(rows))),
    pngChunk('IEND'),
  ])
}

/** Stores a real profile picture for a user, as the upload route does; returns its version. */
export async function seedPicture(userId: number) {
  const image = await prepareAvatarImage(pngPhoto())
  const disk = env.get('DRIVE_DISK')
  const path = `avatars/${userId}/${randomUUID()}.${image.extname}`
  await drive.use(disk as never).put(path, image.bytes, { contentType: image.mimeType })
  const { avatar } = await new UserAvatars(db.connection().getWriteClient()).replace({
    userId,
    actorId: userId,
    disk,
    path,
    image,
  })
  return avatar.version
}

/**
 * The first profile picture inside `scope`, as a person's name shows it (ADR 050): decorative
 * beside the visible name, so hidden from assistive technology, with an empty alt.
 */
export async function decorativeAvatar(scope: any) {
  const avatar = scope.locator('[data-slot="user-avatar"]').first()
  await avatar.waitFor()
  const image = avatar.locator('img')
  return {
    hidden: await avatar.getAttribute('aria-hidden'),
    image: (await image.count()) ? await image.getAttribute('src') : null,
    alt: (await image.count()) ? await image.getAttribute('alt') : null,
  }
}

/** Whether the first picture in `scope` is decorative: aria-hidden, with an empty alt if loaded. */
export async function isDecorative(scope: any) {
  const shown = await decorativeAvatar(scope)
  return shown.hidden === 'true' && (shown.alt === null || shown.alt === '')
}
