import { test } from '@japa/runner'
import { BaseModel } from '@adonisjs/lucid/orm'
import {
  ImportBatches,
  ResourceRegistry,
  ResourceService,
  alterResourceTable,
  createResourceTable,
  defineResource,
  resourceAddition,
  schemaDrift,
} from '../index.js'
import type { Actor, RecordData } from '../index.js'
import { laterRelationTargets, resourceSnapshot } from '../src/commands/snapshot.js'
import {
  additionMigrationSource,
  inSync,
  missingStandardColumns,
} from '../src/database/schema_diff.js'
import { admin, db, setup } from './helpers.js'
import { failure } from './helpers/failure.js'
import { addUserProfileColumns } from './helpers/actors.js'

const passthrough = { validate: async (data: unknown) => data as RecordData }
const label = (ar: string) => ({ ar, en: ar })

/** A hook can move an item to another parent by setting this id (see the hook test). */
let hookParent: number | null = null

const parent = defineResource({
  name: 'rd_parents',
  label: label('الأصول'),
  model: BaseModel,
  scoped: true,
  fields: { name: { type: 'string', required: true, label: label('الاسم') } },
  list: ['name'],
  form: ['name'],
  show: ['name'],
  actions: ['view', 'create', 'update', 'delete'],
  validator: passthrough,
})
const item = defineResource({
  name: 'rd_items',
  label: label('العناصر'),
  model: BaseModel,
  scoped: true,
  version: true,
  fields: {
    code: { type: 'string', required: true, unique: true, label: label('الرمز') },
    title: { type: 'string', label: label('العنوان') },
    qty: { type: 'integer', label: label('الكمية') },
    parentId: { type: 'belongsTo', resource: 'rd_parents', label: label('الأصل') },
    secret: { type: 'text', permissionLevel: 1, label: label('سري') },
    lines: {
      type: 'hasMany',
      resource: 'rd_lines',
      foreignKey: 'itemId',
      inline: true,
      label: label('البنود'),
    },
  },
  list: ['code', 'title', 'qty', 'parentId'],
  form: ['code', 'title', 'qty', 'parentId', 'secret', 'lines'],
  show: ['code', 'title', 'qty', 'parentId', 'secret'],
  actions: ['view', 'create', 'update', 'delete'],
  validator: passthrough,
  hooks: {
    beforeSave: async (record) => {
      if (hookParent !== null) record.parentId = hookParent
    },
  },
})
const itemLine = defineResource({
  name: 'rd_lines',
  label: label('البنود'),
  model: BaseModel,
  scoped: true,
  fields: {
    itemId: { type: 'belongsTo', resource: 'rd_items', required: true, label: label('العنصر') },
    name: { type: 'string', required: true, label: label('الاسم') },
  },
  list: ['itemId', 'name'],
  form: ['itemId', 'name'],
  show: ['itemId', 'name'],
  actions: ['view', 'create', 'update', 'delete'],
  validator: passthrough,
})
const registry = new ResourceRegistry().register([
  {
    name: 'rd',
    label: label('البيانات'),
    dependsOn: [],
    resources: [parent, item, itemLine],
  },
])
const service = new ResourceService(db, registry)

/** A user of unit 1.2 (id 2) who may work with every rd_* resource there. */
const unitA: Actor = {
  id: 2,
  orgPaths: ['1.2'],
  permissionLevel: 0,
  rules: [
    ...['rd_parents', 'rd_items', 'rd_lines'].map((subject) => ({
      subject,
      action: ['view', 'create', 'update', 'delete'],
    })),
  ],
}

async function createParent(name: string, orgUnitId: number) {
  const saved = await service.save('rd_parents', admin, { name, orgUnitId })
  return Number(saved.id)
}
/** The stored row of an item. */
async function itemRow(id: unknown) {
  return db('rd_items').where('id', Number(id)).first()
}
async function createItem(values: RecordData) {
  return service.save('rd_items', admin, { orgUnitId: 2, ...values })
}

test.group('Resource writes: reference checks and the organization unit', (group) => {
  group.setup(async () => {
    await setup()
    await addUserProfileColumns()
    for (const resource of registry.all()) await createResourceTable(db, resource)
  })
  group.each.teardown(() => {
    hookParent = null
  })

  test('an unchanged link to a deleted parent never blocks editing the record', async ({
    assert,
  }) => {
    const kept = await createParent('محذوف لاحقا', 2)
    const saved = await createItem({ code: 'L1', title: 'قبل', parentId: kept })
    // The service refuses deleting a referenced parent since #133; rows deleted before
    // that, or by SQL, still leave such links, so the parent is deleted directly here.
    await db('rd_parents').where('id', kept).update({ deleted_at: db.fn.now() })

    // A user resubmitting the whole form, link included, saves the other fields.
    const edited = await service.save(
      'rd_items',
      unitA,
      { code: 'L1', title: 'بعد', parentId: kept, orgUnitId: 2, version: 1 },
      Number(saved.id)
    )
    assert.equal(edited.title, 'بعد')
    // So does module code.
    await service.systemSave('rd_items', { qty: 4 }, Number(saved.id), { actorId: admin.id })
    const row = await itemRow(saved.id)
    assert.equal(row.qty, 4)
    assert.equal(row.parent_id, kept)

    // Changing the link is checked: a deleted parent stays 404 for users and module code.
    const gone = await createParent('محذوف', 2)
    await service.transition('rd_parents', gone, admin, 'delete')
    const user = await failure(() =>
      service.save('rd_items', unitA, { parentId: gone, version: 3 }, Number(saved.id))
    )
    assert.equal(user.status, 404)
    const system = await failure(() =>
      service.systemSave('rd_items', { parentId: gone }, Number(saved.id), { actorId: admin.id })
    )
    assert.equal(system.status, 404)
    const created = await failure(() =>
      service.save('rd_items', unitA, { code: 'L2', parentId: gone, orgUnitId: 2 })
    )
    assert.equal(created.status, 404)
    const afterKept = await itemRow(saved.id)
    assert.equal(afterKept.parent_id, kept)
    // A live parent is accepted.
    const live = await createParent('حي', 2)
    await service.save('rd_items', unitA, { parentId: live, version: 3 }, Number(saved.id))
    const afterLive = await itemRow(saved.id)
    assert.equal(afterLive.parent_id, live)
  })

  test('an unchanged link to a parent moved out of the writer scope stays editable', async ({
    assert,
  }) => {
    const moved = await createParent('منقول', 2)
    const saved = await createItem({ code: 'M1', parentId: moved })
    await db('rd_parents').where('id', moved).update({ org_unit_id: 3 })
    const edited = await service.save(
      'rd_items',
      unitA,
      { code: 'M1', title: 'محدث', parentId: moved, orgUnitId: 2, version: 1 },
      Number(saved.id)
    )
    assert.equal(edited.title, 'محدث')
    // Linking another record of unit 1.3 is refused like an unknown one.
    const foreign = await createParent('خارجي', 3)
    const refused = await failure(() =>
      service.save('rd_items', unitA, { parentId: foreign, version: 2 }, Number(saved.id))
    )
    assert.equal(refused.status, 404)
  })

  test('a link changed by a hook is checked like a submitted one', async ({ assert }) => {
    const own = await createParent('أصلي', 2)
    const saved = await createItem({ code: 'H1', parentId: own })
    hookParent = await createParent('خارج النطاق', 3)
    const refused = await failure(() =>
      service.save('rd_items', unitA, { title: 'خطاف', version: 1 }, Number(saved.id))
    )
    assert.equal(refused.status, 404)
    const afterOwn = await itemRow(saved.id)
    assert.equal(afterOwn.parent_id, own)
  })

  test('a scoped create without a unit is 422 naming the unit; a foreign unit stays 404', async ({
    assert,
  }) => {
    const missing = await failure(() => service.save('rd_items', unitA, { code: 'U1' }))
    assert.equal(missing.status, 422)
    assert.equal(missing.code, 'E_REQUIRED')
    assert.include(missing.message, 'الوحدة التنظيمية')
    const blank = await failure(() =>
      service.save('rd_items', admin, { code: 'U1', orgUnitId: '' })
    )
    assert.equal(blank.code, 'E_REQUIRED')
    for (const orgUnitId of [3, 999]) {
      const refused = await failure(() =>
        service.save('rd_items', unitA, { code: 'U1', orgUnitId })
      )
      assert.equal(refused.status, 404, String(orgUnitId))
    }
    assert.notExists(await db('rd_items').where('code', 'U1').first())
    // Module code keeps its own answer for a unit it did not supply.
    const system = await failure(() =>
      service.systemSave('rd_items', { code: 'U1' }, undefined, { actorId: admin.id })
    )
    assert.equal(system.code, 'E_ORG_UNIT')
  })
})

test.group('Resource activity entries name changed fields per viewer', (group) => {
  group.setup(async () => {
    await setup()
    await addUserProfileColumns()
    for (const resource of registry.all()) await createResourceTable(db, resource)
  })

  /** May view items of unit 1.2, never their title; level 0, so never the secret. */
  const noTitle: Actor = {
    id: 2,
    orgPaths: ['1.2'],
    permissionLevel: 0,
    rules: [
      { subject: 'rd_items', action: 'view' },
      { subject: 'rd_items', action: 'view', fields: ['title'], inverted: true },
    ],
  }

  test('an update names exactly the fields it changed, never every submitted key', async ({
    assert,
  }) => {
    const owner = await createParent('أصل', 2)
    const form = { code: 'A1', title: 'قديم', qty: 1, parentId: owner, secret: 'س' }
    const saved = await createItem(form)
    const id = Number(saved.id)
    await service.save(
      'rd_items',
      admin,
      { ...form, title: 'جديد', qty: 2, orgUnitId: 2, version: 1 },
      id
    )
    const [update, create] = await service.activity('rd_items', id, admin)
    assert.equal(update.action, 'update')
    assert.sameMembers(update.fields, ['title', 'qty'])
    assert.equal(create.action, 'create')
    assert.sameMembers(create.fields, ['code', 'title', 'qty', 'parentId', 'secret'])
    const stored = await db('activities')
      .where({ resource: 'rd_items', record_id: id, action: 'update' })
      .first()
    assert.sameMembers(stored.changes.fields, ['title', 'qty'])
    // The record page and the details read return the same entries.
    const details = await service.details('rd_items', id, admin)
    const page = await service.record('rd_items', id, admin)
    assert.deepEqual(details.activity[0].fields, update.fields)
    assert.deepEqual(page.activity[0].fields, update.fields)
  })

  test('a viewer is never told about a field it may not read', async ({ assert }) => {
    const form = { code: 'B1', title: 'قديم', qty: 1, secret: 'أ' }
    const saved = await createItem(form)
    const id = Number(saved.id)
    await service.save(
      'rd_items',
      admin,
      { ...form, title: 'جديد', secret: 'ب', orgUnitId: 2, version: 1 },
      id
    )
    const [update, create] = await service.activity('rd_items', id, noTitle)
    // The title is denied by a field rule, the secret by its permission level.
    assert.deepEqual(update.fields, [])
    assert.sameMembers(create.fields, ['code', 'qty'])
    const [full] = await service.activity('rd_items', id, admin)
    assert.sameMembers(full.fields, ['title', 'secret'])
  })

  test('entries stored with every submitted key are narrowed when read', async ({ assert }) => {
    const saved = await createItem({ code: 'C1', title: 'قديم' })
    const id = Number(saved.id)
    const [activity] = await db('activities')
      .insert({
        resource: 'rd_items',
        record_id: id,
        actor_id: admin.id,
        action: 'update',
        changes: JSON.stringify({
          fields: ['code', 'title', 'qty', 'parentId', 'secret', 'orgUnitId', 'lines'],
        }),
      })
      .returning('id')
    await db('field_changes').insert({
      activity_id: activity.id,
      resource: 'rd_items',
      record_id: id,
      field: 'title',
      before: JSON.stringify('أقدم'),
      after: JSON.stringify('قديم'),
    })
    const [entry] = await service.activity('rd_items', id, admin)
    // `lines` is kept by the update rule but is not exposed by list/show, like orgUnitId.
    assert.deepEqual(entry.fields, ['title'])
    const [restricted] = await service.activity('rd_items', id, noTitle)
    assert.deepEqual(restricted.fields, [])
  })

  test('an inline-only edit records the line group, not the unchanged fields', async ({
    assert,
  }) => {
    const form = { code: 'D1', title: 'ثابت', qty: 3 }
    const saved = await createItem(form)
    const id = Number(saved.id)
    await service.save(
      'rd_items',
      admin,
      { ...form, orgUnitId: 2, version: 1, lines: [{ name: 'بند' }] },
      id
    )
    const stored = await db('activities')
      .where({ resource: 'rd_items', record_id: id, action: 'update' })
      .first()
    assert.deepEqual(stored.changes.fields, ['lines'])
    // Resubmitting the same line unchanged names nothing.
    const [lineRow] = await db('rd_lines').where('item_id', id)
    await service.save(
      'rd_items',
      admin,
      { ...form, orgUnitId: 2, version: 2, lines: [{ id: lineRow.id, name: 'بند' }] },
      id
    )
    const latest = await db('activities')
      .where({ resource: 'rd_items', record_id: id, action: 'update' })
      .orderBy('id', 'desc')
      .first()
    assert.deepEqual(latest.changes.fields, [])
  })
})

test.group('Upsert imports look for matches within the importer reach', (group) => {
  const imports = () =>
    new ImportBatches(db, registry, service, {
      load: async (id) => (id === admin.id ? admin : unitA),
    })
  const mapping = { 0: 'code', 1: 'title', 2: 'orgUnitId' }
  group.setup(async () => {
    await setup()
    await addUserProfileColumns()
    for (const resource of registry.all()) await createResourceTable(db, resource)
  })

  test('a match held in another unit answers as a create of it would', async ({ assert }) => {
    const elsewhere = await service.save('rd_items', admin, {
      code: 'X',
      title: 'وحدة أخرى',
      orgUnitId: 3,
    })
    await service.save('rd_items', admin, { code: 'W', title: 'قديم', orgUnitId: 2 })
    // What the importer learns from a plain create of X.
    const { message: expected } = await failure(() =>
      service.save('rd_items', unitA, { code: 'X', title: 'محاولة', orgUnitId: 2 })
    )
    assert.equal(expected, 'هذه القيمة مستخدمة في سجل آخر: الرمز')
    const content = 'code,title,orgUnitId\nX,محاولة,2\nY,جديد,2\nW,محدث,2\n'

    const created = await imports().create('rd_items', unitA, {
      fileName: 'create.csv',
      content,
      dryRun: true,
    })
    await imports().start(created.id, unitA, mapping)
    await imports().process()
    const { report: createReport } = await imports().show(created.id, unitA)
    assert.deepEqual(createReport[0], { row: 2, ok: false, message: expected })

    const upsert = await imports().create('rd_items', unitA, {
      fileName: 'upsert.csv',
      content,
      mode: 'upsert',
      matchField: 'code',
      dryRun: true,
    })
    await imports().start(upsert.id, unitA, mapping, { matchField: 'code' })
    await imports().process()
    const { report } = await imports().show(upsert.id, unitA)
    assert.deepEqual(report[0], createReport[0])
    assert.notInclude(String(report[0].message), 'السجل غير موجود')
    assert.deepEqual(report[1], { row: 3, ok: true, action: 'create' })
    assert.deepEqual(report[2], { row: 4, ok: true, action: 'update' })
    assert.notExists(await db('rd_items').where('code', 'Y').first())

    await imports().start(upsert.id, unitA, mapping, { matchField: 'code' })
    const result = await imports().process()
    assert.deepEqual(result, { id: upsert.id, processed: 3, created: 1, updated: 1, failed: 1 })
    const done = await imports().show(upsert.id, unitA)
    assert.equal(done.errors[0].message, expected)
    const x = await itemRow(elsewhere.id)
    assert.equal(x.title, 'وحدة أخرى')
    assert.equal(x.org_unit_id, 3)
    assert.equal(x.version, 1)
    const y = await db('rd_items').where('code', 'Y').first()
    assert.equal(y.org_unit_id, 2)
    assert.equal(y.created_by, unitA.id)
    const w = await db('rd_items').where('code', 'W').first()
    assert.equal(w.title, 'محدث')
    assert.equal(w.version, 2)
  })

  test('an update rule with conditions cannot reach records through an upsert match', async ({
    assert,
  }) => {
    // Upsert targets need unconditional update on the field, so the match lookup is never
    // asked for records a conditional rule would refuse to update.
    await service.save('rd_items', admin, { code: 'V', title: 'مقفل', orgUnitId: 2 })
    const conditional: Actor = {
      ...unitA,
      rules: [
        { subject: 'rd_items', action: ['view', 'create'] },
        { subject: 'rd_items', action: 'update', conditions: { title: 'قابل' } },
      ],
    }
    const scoped = new ImportBatches(db, registry, service, { load: async () => conditional })
    const refused = await failure(() =>
      scoped.create('rd_items', conditional, {
        fileName: 'v.csv',
        content: 'code,title,orgUnitId\nV,محاولة,2\n',
        mode: 'upsert',
        matchField: 'code',
        dryRun: true,
      })
    )
    assert.equal(refused.code, 'E_IMPORT_MATCH')
    assert.notInclude(
      scoped.targets('rd_items', conditional, 'upsert').map((target) => target.key),
      'code'
    )
    const v = await db('rd_items').where('code', 'V').first()
    assert.equal(v.title, 'مقفل')
  })
})

test.group('Resource migrations generated from definitions', (group) => {
  group.setup(async () => {
    await setup()
  })

  test('snapshots and additive migrations keep the group of lookup fields', async ({ assert }) => {
    const kinds = defineResource({
      name: 'rd_kinds',
      label: label('الأنواع'),
      model: BaseModel,
      scoped: false,
      fields: {
        name: { type: 'string', label: label('الاسم') },
        kind: { type: 'lookup', group: 'rd_kind', label: label('النوع') },
      },
      list: ['name'],
      form: ['name', 'kind'],
      show: ['name'],
      actions: ['view'],
      validator: passthrough,
    })
    const snapshot = JSON.parse(JSON.stringify(resourceSnapshot(kinds)))
    assert.equal(snapshot.fields.kind.group, 'rd_kind')
    // A table created without the lookup gets it back through an addition with its group.
    await createResourceTable(db, { ...kinds, fields: { name: kinds.fields.name } })
    const addition = resourceAddition(kinds, await schemaDrift(db, kinds))
    assert.equal(
      addition.fields?.kind && 'group' in addition.fields.kind && addition.fields.kind.group,
      'rd_kind'
    )
  })

  test('a definition that gained version: true gets its column from the migration', async ({
    assert,
  }) => {
    const plain = defineResource({
      name: 'rd_versioned',
      label: label('مُصدَر'),
      model: BaseModel,
      scoped: false,
      fields: { name: { type: 'string', label: label('الاسم') } },
      list: ['name'],
      form: ['name'],
      show: ['name'],
      actions: ['view', 'create', 'update'],
      validator: passthrough,
    })
    await createResourceTable(db, plain)
    await db('rd_versioned').insert({ name: 'قائم', created_by: 1, updated_by: 1 })
    const versioned = defineResource({
      ...plain,
      version: true,
      fields: { ...plain.fields, note: { type: 'text', label: label('ملاحظة') } },
      form: ['name', 'note'],
    })
    const drift = await schemaDrift(db, versioned)
    const standard = missingStandardColumns(drift)
    assert.deepEqual(standard, {
      statements: [
        'ALTER TABLE rd_versioned ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1',
      ],
      unsupported: [],
    })
    const addition = resourceAddition(versioned, drift)
    const source = additionMigrationSource(versioned.name, addition, standard.statements)
    assert.include(source, standard.statements[0])
    assert.include(source, "alterResourceTable(db, 'rd_versioned', {")
    // Applying what the migration runs brings the table in line with the definition.
    for (const sql of standard.statements) await db.raw(sql)
    await alterResourceTable(db, versioned.name, addition)
    assert.isTrue(inSync(await schemaDrift(db, versioned)))
    const local = new ResourceService(
      db,
      new ResourceRegistry().register([
        { name: 'rdv', label: label('م'), dependsOn: [], resources: [versioned] },
      ])
    )
    const listed = await local.list('rd_versioned', admin)
    assert.equal(listed.data[0].version, 1)
    const updated = await local.save(
      'rd_versioned',
      admin,
      { name: 'محدث', version: 1 },
      Number(listed.data[0].id)
    )
    assert.equal(updated.version, 2)
    // A version column alone still gets a migration, without alterResourceTable.
    const only = additionMigrationSource('rd_versioned', {}, standard.statements)
    assert.include(only, standard.statements[0])
    assert.notInclude(only, 'alterResourceTable')
  })

  test('a relation to a table created by a later migration is reported before writing', ({
    assert,
  }) => {
    const shop = resourceSnapshot({
      name: 'rd_shop',
      scoped: false,
      fields: {
        customer: { type: 'belongsTo', resource: 'rd_customers', label: label('العميل') },
        tags: { type: 'manyToMany', resource: 'rd_tags', label: label('الوسوم') },
        owner: { type: 'belongsTo', resource: 'users', label: label('المالك') },
        parent: { type: 'belongsTo', resource: 'rd_shop', label: label('الأصل') },
        region: { type: 'belongsTo', resource: 'rd_regions', label: label('المنطقة') },
      },
    } as never)
    const migrations = [
      { name: 'app/modules/geo/migrations/1_create_rd_regions', resource: 'rd_regions' },
      { name: 'app/modules/shop/migrations/2_create_rd_shop', resource: 'rd_shop' },
      { name: 'app/modules/shop/migrations/3_create_rd_customers', resource: 'rd_customers' },
      { name: 'app/modules/shop/migrations/4_create_rd_tags', resource: 'rd_tags' },
      { name: 'database/migrations/5_core' },
    ]
    assert.deepEqual(
      laterRelationTargets(shop, 'app/modules/shop/migrations/2_create_rd_shop', migrations),
      [
        {
          field: 'customer',
          target: 'rd_customers',
          migration: 'app/modules/shop/migrations/3_create_rd_customers',
        },
        {
          field: 'tags',
          target: 'rd_tags',
          migration: 'app/modules/shop/migrations/4_create_rd_tags',
        },
      ]
    )
    // Once the targets come first, nothing is reported.
    assert.deepEqual(
      laterRelationTargets(shop, 'app/modules/shop/migrations/9_create_rd_shop', [
        ...migrations,
        { name: 'app/modules/shop/migrations/9_create_rd_shop', resource: 'rd_shop' },
      ]),
      []
    )
  })
})
