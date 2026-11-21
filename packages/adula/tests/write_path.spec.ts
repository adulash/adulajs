import { test } from '@japa/runner'
import { BaseModel } from '@adonisjs/lucid/orm'
import { ResourceService, ResourceRegistry, createResourceTable, defineResource } from '../index.js'
import type { HookContext, RecordData } from '../index.js'
import { db, setup, admin, reader, customer, order, line } from './helpers.js'

// Every hook call is recorded with the record it saw and its context (#134).
const calls: { hook: 'before' | 'after'; record: RecordData; context: HookContext }[] = []

const ticket = defineResource({
  name: 'tickets',
  label: { ar: 'التذاكر', en: 'Tickets' },
  model: BaseModel,
  scoped: false,
  version: true,
  fields: {
    code: { type: 'string', required: true, label: { ar: 'الرمز', en: 'Code' } },
    name: { type: 'string', required: true, label: { ar: 'الاسم', en: 'Name' } },
    status: { type: 'lookup', group: 'order_status', label: { ar: 'الحالة', en: 'Status' } },
  },
  list: ['code', 'name', 'status'],
  form: ['code', 'name', 'status'],
  show: ['code', 'name', 'status'],
  actions: ['view', 'create', 'update', 'delete'],
  hooks: {
    beforeSave: async (record, context) => {
      calls.push({ hook: 'before', record: { ...record }, context })
      // A transition rule reads the stored value without a query.
      if (context.existing?.status === 'closed' && record.status === 'open' && !context.system)
        throw new Error('closed tickets cannot be reopened by users')
    },
    afterSave: async (record, context) => {
      calls.push({ hook: 'after', record: { ...record }, context })
    },
  },
})
const registry = new ResourceRegistry().register([
  { name: 'customers', label: customer.label, dependsOn: [], resources: [customer] },
  { name: 'orders', label: order.label, dependsOn: ['customers'], resources: [order, line] },
  { name: 'tickets', label: ticket.label, dependsOn: [], resources: [ticket] },
])
const service = new ResourceService(db, registry)

/** The refusal of a write as `status code`, or `ok`. */
async function outcome(work: () => Promise<unknown>) {
  try {
    await work()
  } catch (error) {
    const failure = error as { status?: number; code?: string }
    return `${failure.status} ${failure.code}`
  }
  return 'ok'
}

test.group('Hook context (#134)', (group) => {
  group.setup(async () => {
    await setup()
    await createResourceTable(db, ticket)
  })
  group.each.setup(() => {
    calls.length = 0
  })

  test('a user create has no stored record and names the given fields', async ({ assert }) => {
    await service.save('tickets', admin, { code: 'T-1', name: 'first', status: 'open' })
    const [before, after] = calls
    assert.equal(before.hook, 'before')
    assert.isNull(before.context.existing)
    assert.isFalse(before.context.system)
    assert.isUndefined(before.context.reason)
    assert.equal(before.context.action, 'create')
    assert.sameMembers(before.context.changes, ['code', 'name', 'status'])
    assert.equal(after.hook, 'after')
    assert.isNull(after.context.existing)
    assert.sameMembers(after.context.changes, ['code', 'name', 'status'])
  })

  test('an update sees the stored values and only the changed keys', async ({ assert }) => {
    const created = await service.save('tickets', admin, { code: 'T-2', name: 'x', status: 'open' })
    calls.length = 0
    await service.save(
      'tickets',
      admin,
      { code: 'T-2', name: 'x', status: 'closed', version: created.version },
      Number(created.id)
    )
    const [before, after] = calls
    assert.equal(before.context.existing?.status, 'open')
    assert.equal(before.context.existing?.name, 'x')
    assert.deepEqual(before.context.changes, ['status'])
    assert.isFalse(before.context.system)
    assert.equal(after.context.existing?.status, 'open')
    assert.deepEqual(after.context.changes, ['status'])
    assert.equal(after.record.status, 'closed')
  })

  test('module-code writes are marked system with their reason', async ({ assert }) => {
    const created = await service.save('tickets', admin, {
      code: 'T-3',
      name: 'y',
      status: 'closed',
    })
    // The rule refuses a user reopening, but not module code.
    await assert.rejects(
      () =>
        service.save(
          'tickets',
          admin,
          { code: 'T-3', name: 'y', status: 'open', version: created.version },
          Number(created.id)
        ),
      /cannot be reopened/
    )
    calls.length = 0
    await service.systemSave('tickets', { status: 'open' }, Number(created.id), {
      actorId: admin.id,
      reason: 'reopened by escalation',
    })
    const [before, after] = calls
    assert.isTrue(before.context.system)
    assert.equal(before.context.reason, 'reopened by escalation')
    assert.equal(before.context.existing?.status, 'closed')
    assert.deepEqual(before.context.changes, ['status'])
    assert.isTrue(after.context.system)
    assert.equal(after.context.reason, 'reopened by escalation')
  })
})

test.group('Partial update (#131)', (group) => {
  group.setup(async () => {
    await setup()
    await createResourceTable(db, ticket)
  })

  test('an update naming only the changed field keeps the stored required values', async ({
    assert,
  }) => {
    const created = await service.save('tickets', admin, { code: 'P-1', name: 'old' })
    const saved = await service.save(
      'tickets',
      admin,
      { name: 'new', version: created.version },
      Number(created.id)
    )
    assert.equal(saved.name, 'new')
    assert.equal(saved.code, 'P-1')
    const row = await db('tickets').where('id', created.id).first()
    assert.equal(row.code, 'P-1')
    assert.equal(row.name, 'new')
    // The activity entry names the changed field only.
    const activity = await db('activities')
      .where({ resource: 'tickets', record_id: created.id, action: 'update' })
      .first('changes')
    assert.deepEqual(activity.changes.fields, ['name'])
  })

  test('the merge is still validated and the version still guards the write', async ({
    assert,
  }) => {
    const created = await service.save('tickets', admin, { code: 'P-2', name: 'x' })
    assert.match(
      await outcome(() =>
        service.save('tickets', admin, { name: '  ', version: created.version }, Number(created.id))
      ),
      /^422 /
    )
    assert.equal(
      await outcome(() =>
        service.save('tickets', admin, { name: 'y', version: 99 }, Number(created.id))
      ),
      '409 E_VERSION_CONFLICT'
    )
  })

  test('an unknown or out-of-scope record answers 404 before validation', async ({ assert }) => {
    assert.equal(
      await outcome(() => service.save('tickets', admin, { name: 'x', version: 1 }, 999999)),
      '404 E_NOT_FOUND'
    )
    // The reader works in unit 1.2; an order in unit 3 is outside its scope.
    const outside = await service.save('orders', admin, { notes: 'unit 3', orgUnitId: 3 })
    assert.equal(
      await outcome(() => service.save('orders', reader, { notes: 'x' }, Number(outside.id))),
      '404 E_NOT_FOUND'
    )
  })
})
