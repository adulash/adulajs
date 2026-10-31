import { test } from '@japa/runner'
import { BaseModel } from '@adonisjs/lucid/orm'
import {
  ResourceService,
  ResourceRegistry,
  AdulaError,
  createResourceTable,
  defineResource,
} from '../index.js'
import type { RecordData } from '../index.js'
import { db, setup, admin, customer, order, line } from './helpers.js'
import { ace, powerless } from './helpers/actors.js'

// A shipment belongs to an order and always lives in the order's organization unit (#45).
// Its validator and hooks prove that system writes keep the resource's own rules (#44).
const shipment = defineResource({
  name: 'shipments',
  label: { ar: 'الشحنات', en: 'Shipments' },
  model: BaseModel,
  scoped: true,
  scope: { from: 'orderId' },
  version: true,
  fields: {
    orderId: {
      type: 'belongsTo',
      resource: 'orders',
      required: true,
      label: { ar: 'الطلب', en: 'Order' },
    },
    carrier: { type: 'string', required: true, label: { ar: 'الناقل', en: 'Carrier' } },
    weight: { type: 'integer', label: { ar: 'الوزن', en: 'Weight' } },
    status: {
      type: 'lookup',
      group: 'order_status',
      label: { ar: 'الحالة', en: 'Status' },
    },
    code: { type: 'string', label: { ar: 'الرمز', en: 'Code' } },
    score: { type: 'integer', label: { ar: 'التقييم', en: 'Score' } },
  },
  list: ['orderId', 'carrier', 'status'],
  form: ['orderId', 'carrier', 'weight', 'status'],
  show: ['orderId', 'carrier', 'weight', 'status', 'code', 'score'],
  actions: ['view', 'create', 'update', 'delete'],
  validator: {
    validate: async (data) => {
      const values = data as RecordData
      if (typeof values.carrier !== 'string' || !values.carrier)
        throw new AdulaError(422, 'E_VALIDATION', 'carrier is required')
      if (values.weight !== undefined && values.weight !== null && Number(values.weight) < 0)
        throw new AdulaError(422, 'E_VALIDATION', 'weight must not be negative')
      return values
    },
  },
  hooks: {
    beforeSave: async (record) => {
      record.code = `${String(record.carrier).toUpperCase()}-${record.orderId}`
    },
  },
})
const registry = new ResourceRegistry().register([
  { name: 'customers', label: customer.label, dependsOn: [], resources: [customer] },
  {
    name: 'orders',
    label: order.label,
    dependsOn: ['customers'],
    resources: [order, line, shipment],
  },
])
const service = new ResourceService(db, registry)
// Reader works in unit 1.2 only; an order in unit 3 is outside that scope.
const outsider = ace()

async function orderIn(unit: number) {
  return service.save('orders', admin, { notes: `unit ${unit}`, orgUnitId: unit })
}

test.group('Inherited organization scope (#45)', (group) => {
  group.setup(async () => {
    await setup()
    await createResourceTable(db, shipment)
  })

  test('definitions require a required belongsTo parent that is scoped', ({ assert }) => {
    const base = { ...shipment, fields: { ...shipment.fields } }
    assert.throws(
      () => defineResource({ ...base, scoped: false }),
      /scope.from requires scoped: true/
    )
    assert.throws(
      () => defineResource({ ...base, scope: { from: 'carrier' } }),
      /required belongsTo field/
    )
    assert.throws(
      () =>
        defineResource({
          ...base,
          fields: { ...base.fields, orderId: { ...base.fields.orderId, required: false } },
        }),
      /required belongsTo field/
    )
    const loose = defineResource({
      ...base,
      name: 'loose_shipments',
      fields: {
        ...base.fields,
        orderId: { ...base.fields.orderId, resource: 'customers' },
      },
    })
    assert.throws(
      () =>
        new ResourceRegistry().register([
          { name: 'customers', label: customer.label, dependsOn: [], resources: [customer, loose] },
        ]),
      /must reference a scoped resource/
    )
  })

  test('the unit is copied from the parent before authorization and cannot be chosen', async ({
    assert,
  }) => {
    const parent = await orderIn(4)
    // The reader works in 1.2 and may create in its child unit 4 without sending a unit.
    const created = await service.save('shipments', outsider, {
      orderId: parent.id,
      carrier: 'aramex',
    })
    assert.equal(created.orgUnitId, 4)
    assert.equal(created.code, `ARAMEX-${parent.id}`)
    await assert.rejects(
      () => service.save('shipments', outsider, { orderId: parent.id, carrier: 'x', orgUnitId: 2 }),
      /not writable: orgUnitId/
    )
    const editor = await service.editor('shipments', outsider)
    assert.equal(editor.scopeFrom, 'orderId')
    assert.deepEqual(editor.orgUnits, [])
  })

  test('a parent outside the actor scope is refused before anything is written', async ({
    assert,
  }) => {
    const parent = await orderIn(3)
    const before = await db('shipments').count<{ count: string }[]>('* as count')
    const error = await service
      .save('shipments', outsider, { orderId: parent.id, carrier: 'dhl' })
      .catch((caught) => caught)
    assert.instanceOf(error, AdulaError)
    assert.equal(error.status, 404)
    const after = await db('shipments').count<{ count: string }[]>('* as count')
    assert.equal(after[0].count, before[0].count)
  })

  test('moving the parent re-homes its children through one call', async ({ assert }) => {
    const parent = await orderIn(2)
    const child = await service.save('shipments', admin, { orderId: parent.id, carrier: 'smsa' })
    assert.equal(child.orgUnitId, 2)
    await service.save(
      'orders',
      admin,
      { notes: 'moved', orgUnitId: 3, version: parent.version },
      Number(parent.id)
    )
    const moved = await service.rehome('orders', Number(parent.id), {
      actorId: admin.id,
      reason: 'order moved',
    })
    assert.equal(moved, 1)
    const stored = await db('shipments').where('id', Number(child.id)).first()
    assert.equal(stored.org_unit_id, 3)
    assert.equal(stored.version, 2)
    // The reader lost access together with the parent.
    await assert.rejects(() => service.show('shipments', Number(child.id), outsider), /غير موجود/)
    assert.equal(
      await service.rehome('orders', Number(parent.id), { actorId: admin.id }),
      0,
      'rehome is idempotent'
    )
  })
})

test.group('System writes (#44)', (group) => {
  group.setup(async () => {
    await setup()
    await createResourceTable(db, shipment)
  })
  const nobody = powerless({ orgPaths: [] })

  test('module code writes without role rules but through validator, hooks and audit', async ({
    assert,
  }) => {
    const parent = await orderIn(3)
    // The author holds no rule and no unit; save() refuses, systemSave() records them.
    await assert.rejects(
      () => service.save('shipments', nobody, { orderId: parent.id, carrier: 'aramex' }),
      /صلاحية/
    )
    const created = await service.systemSave(
      'shipments',
      { orderId: parent.id, carrier: 'aramex', status: 'open', score: 7 },
      undefined,
      { actorId: nobody.id, reason: 'visit completed' }
    )
    assert.equal(created.orgUnitId, 3)
    assert.equal(created.code, `ARAMEX-${parent.id}`)
    assert.equal(created.score, 7, 'fields outside the form are writable by module code')
    assert.equal(created.createdBy, nobody.id)
    assert.equal(created.version, 1)
    const activity = await db('activities')
      .where({ resource: 'shipments', record_id: created.id })
      .first()
    assert.equal(activity.actor_id, nobody.id)
    assert.deepInclude(activity.changes, { system: true, reason: 'visit completed' })
    assert.exists(
      await db('outbox')
        .where('event', 'orders.shipments.created')
        .whereRaw("payload->>'id' = ?", [String(created.id)])
        .first()
    )
  })

  test('partial updates keep required values, bump the version and record field history', async ({
    assert,
  }) => {
    const parent = await orderIn(2)
    const created = await service.systemSave(
      'shipments',
      { orderId: parent.id, carrier: 'smsa', weight: 3 },
      undefined,
      { actorId: admin.id }
    )
    const updated = await service.systemSave(
      'shipments',
      { status: 'closed' },
      Number(created.id),
      { actorId: nobody.id, reason: 'delivered' }
    )
    assert.equal(updated.status, 'closed')
    assert.equal(updated.carrier, 'smsa')
    assert.equal(updated.weight, 3)
    assert.equal(updated.version, 2)
    assert.equal(updated.updatedBy, nobody.id)
    const change = await db('field_changes')
      .where({ resource: 'shipments', record_id: created.id, field: 'status' })
      .first()
    assert.deepEqual([change.before, change.after], [null, 'closed'])
    await assert.rejects(
      () =>
        service.systemSave('shipments', { status: 'open' }, Number(created.id), {
          actorId: admin.id,
          version: 1,
        }),
      /تم تعديل السجل/
    )
  })

  test('validator, lookups, relations and field rules still refuse bad values', async ({
    assert,
  }) => {
    const parent = await orderIn(2)
    const options = { actorId: admin.id }
    const refused = async (values: RecordData, pattern: RegExp, id?: number) =>
      assert.rejects(() => service.systemSave('shipments', values, id, options), pattern)
    await refused({ orderId: parent.id, carrier: 'x', weight: -1 }, /weight must not be negative/)
    await refused({ orderId: parent.id, carrier: 'x', status: 'unknown' }, /Invalid lookup/)
    await refused({ orderId: 999999, carrier: 'x' }, /غير موجود/)
    await refused({ orderId: parent.id, carrier: 'x', createdBy: 1 }, /not writable: createdBy/)
    await refused({ orderId: parent.id, carrier: 'x', orgUnitId: 2 }, /not writable: orgUnitId/)
    await assert.rejects(
      () => service.systemSave('orders', { number: 'X' }, undefined, options),
      /not writable: number/
    )
    await assert.rejects(
      () => service.systemSave('orders', { lines: [] }, undefined, options),
      /not writable: lines/
    )
    await assert.rejects(
      () => service.systemSave('shipments', { carrier: 'x' }, undefined, { actorId: 0 }),
      /author user id/
    )
  })

  test('scoped resources without inherited scope need an existing unit', async ({ assert }) => {
    await assert.rejects(
      () => service.systemSave('orders', { notes: 'x' }, undefined, { actorId: admin.id }),
      /الوحدة التنظيمية غير موجودة/
    )
    const created = await service.systemSave('orders', { notes: 'x', orgUnitId: 3 }, undefined, {
      actorId: admin.id,
    })
    assert.equal(created.orgUnitId, 3)
    assert.match(String(created.number), /^ORD-/)
  })

  test('submitted documents stay locked for system writes', async ({ assert }) => {
    const document = await orderIn(2)
    await service.transition('orders', Number(document.id), admin, 'submit', document.version)
    await assert.rejects(
      () =>
        service.systemSave('orders', { notes: 'changed' }, Number(document.id), {
          actorId: admin.id,
        }),
      /Only draft documents/
    )
  })

  test('system writes join the caller transaction and roll back with it', async ({ assert }) => {
    const parent = await orderIn(2)
    await assert.rejects(() =>
      db.transaction(async (trx) => {
        await service.systemSave(
          'shipments',
          { orderId: parent.id, carrier: 'rollback' },
          undefined,
          {
            actorId: admin.id,
            trx,
          }
        )
        throw new Error('module failure')
      })
    )
    assert.notExists(await db('shipments').where('carrier', 'rollback').first())
  })
})
