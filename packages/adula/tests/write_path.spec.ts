import { test } from '@japa/runner'
import { BaseModel } from '@adonisjs/lucid/orm'
import {
  BulkActions,
  ResourceService,
  ResourceRegistry,
  createResourceTable,
  defineResource,
} from '../index.js'
import type { HookContext, LifecycleHookContext, RecordData } from '../index.js'
import { db, setup, admin, reader, customer, order, line } from './helpers.js'
import { addUserProfileColumns } from './helpers/actors.js'

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
// A parent and the items that reference it through a belongsTo (#133).
const lifecycleCalls: { record: RecordData; context: LifecycleHookContext }[] = []
const parent = defineResource({
  name: 'parents',
  label: { ar: 'الآباء', en: 'Parents' },
  model: BaseModel,
  scoped: false,
  fields: { name: { type: 'string', required: true, label: { ar: 'الاسم', en: 'Name' } } },
  list: ['name'],
  form: ['name'],
  show: ['name'],
  actions: ['view', 'create', 'update', 'delete'],
  hooks: {
    beforeDelete: async (record, context) => {
      lifecycleCalls.push({ record: { ...record }, context })
      if (record.name === 'locked') throw new Error('locked parents stay')
    },
    beforeRestore: async (record, context) => {
      lifecycleCalls.push({ record: { ...record }, context })
    },
  },
})
const item = defineResource({
  name: 'items',
  label: { ar: 'العناصر', en: 'Items' },
  model: BaseModel,
  scoped: false,
  fields: {
    name: { type: 'string', required: true, label: { ar: 'الاسم', en: 'Name' } },
    parent: { type: 'belongsTo', resource: 'parents', label: { ar: 'الأب', en: 'Parent' } },
  },
  list: ['name', 'parent'],
  form: ['name', 'parent'],
  show: ['name', 'parent'],
  actions: ['view', 'create', 'update', 'delete'],
})
// A submittable voucher whose cancellation must say why (#135).
const voucher = defineResource({
  name: 'vouchers',
  label: { ar: 'السندات', en: 'Vouchers' },
  model: BaseModel,
  scoped: false,
  submittable: true,
  fields: {
    title: { type: 'string', required: true, label: { ar: 'البيان', en: 'Title' } },
    cancelReason: { type: 'text', label: { ar: 'سبب الإلغاء', en: 'Cancel reason' } },
  },
  list: ['title'],
  form: ['title'],
  show: ['title', 'cancelReason'],
  actions: ['view', 'create', 'update', 'delete', 'submit', 'cancel', 'amend'],
  cancel: { reasonField: 'cancelReason', requireReason: true },
})
const registry = new ResourceRegistry().register([
  { name: 'customers', label: customer.label, dependsOn: [], resources: [customer] },
  { name: 'orders', label: order.label, dependsOn: ['customers'], resources: [order, line] },
  { name: 'tickets', label: ticket.label, dependsOn: [], resources: [ticket] },
  { name: 'family', label: parent.label, dependsOn: [], resources: [parent, item] },
  { name: 'vouchers', label: voucher.label, dependsOn: [], resources: [voucher] },
])
const service = new ResourceService(db, registry)

/** The deleted_at of one row: null while the record is live. */
async function deletedAt(table: string, id: unknown) {
  const row = await db(table).where('id', Number(id)).first('deleted_at')
  return row.deleted_at
}

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
    const row = await db('tickets').where('id', Number(created.id)).first()
    assert.equal(row.code, 'P-1')
    assert.equal(row.name, 'new')
    // The activity entry names the changed field only.
    const activity = await db('activities')
      .where({ resource: 'tickets', record_id: Number(created.id), action: 'update' })
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

test.group('Soft delete with dependents (#133)', (group) => {
  group.setup(async () => {
    await setup()
    await createResourceTable(db, parent)
    await createResourceTable(db, item)
  })
  group.each.setup(() => {
    lifecycleCalls.length = 0
  })

  test('a referenced record is refused with its dependents named, then goes once they go', async ({
    assert,
  }) => {
    const owner = await service.save('parents', admin, { name: 'p1' })
    const child = await service.save('items', admin, { name: 'i1', parent: owner.id })
    let refusal: { status?: number; code?: string; message?: string } = {}
    try {
      await service.transition('parents', Number(owner.id), admin, 'delete')
    } catch (error) {
      refusal = error as typeof refusal
    }
    assert.equal(refusal.status, 409)
    assert.equal(refusal.code, 'E_HAS_DEPENDENTS')
    assert.include(refusal.message, 'العناصر (1)')
    assert.isNull(await deletedAt('parents', owner.id))
    // The hook ran with the stored record before the refusal.
    assert.equal(lifecycleCalls[0].context.action, 'delete')
    assert.equal(lifecycleCalls[0].context.existing?.name, 'p1')
    assert.isFalse(lifecycleCalls[0].context.system)

    await service.transition('items', Number(child.id), admin, 'delete')
    await service.transition('parents', Number(owner.id), admin, 'delete')
    assert.isNotNull(await deletedAt('parents', owner.id))
  })

  test('bulk delete refuses each referenced record with the same reason', async ({ assert }) => {
    const kept = await service.save('parents', admin, { name: 'p2' })
    const free = await service.save('parents', admin, { name: 'p3' })
    await service.save('items', admin, { name: 'i2', parent: kept.id })
    const result = await new BulkActions(registry, service).run('parents', admin, {
      action: 'delete',
      ids: [Number(kept.id), Number(free.id)],
    })
    assert.deepEqual(result.succeeded, [Number(free.id)])
    assert.equal(result.failed[0].id, Number(kept.id))
    assert.equal(result.failed[0].code, 'E_HAS_DEPENDENTS')
  })

  test('restoring a record whose parent is deleted is refused until the parent returns', async ({
    assert,
  }) => {
    const owner = await service.save('parents', admin, { name: 'p4' })
    const child = await service.save('items', admin, { name: 'i4', parent: owner.id })
    await service.transition('items', Number(child.id), admin, 'delete')
    await service.transition('parents', Number(owner.id), admin, 'delete')
    await assert.rejects(() => service.restore('items', Number(child.id), admin), /الأب/)
    try {
      await service.restore('items', Number(child.id), admin)
    } catch (error) {
      assert.equal((error as { code?: string }).code, 'E_PARENT_DELETED')
    }
    lifecycleCalls.length = 0
    await service.restore('parents', Number(owner.id), admin)
    assert.equal(lifecycleCalls[0].context.action, 'restore')
    assert.equal(lifecycleCalls[0].context.existing?.name, 'p4')
    await service.restore('items', Number(child.id), admin)
    assert.isNull(await deletedAt('items', child.id))
  })

  test('beforeDelete may refuse a delete', async ({ assert }) => {
    const owner = await service.save('parents', admin, { name: 'locked' })
    await assert.rejects(
      () => service.transition('parents', Number(owner.id), admin, 'delete'),
      /locked parents stay/
    )
    assert.isNull(await deletedAt('parents', owner.id))
  })
})

test.group('Cancel reason (#135)', (group) => {
  group.setup(async () => {
    await setup()
    await addUserProfileColumns()
    await createResourceTable(db, voucher)
  })

  async function submitted(title: string) {
    const draft = await service.save('vouchers', admin, { title })
    return service.transition('vouchers', Number(draft.id), admin, 'submit', draft.version)
  }

  test('a cancel without a reason is refused and the document stays submitted', async ({
    assert,
  }) => {
    const document = await submitted('بدون سبب')
    for (const options of [undefined, {}, { reason: '   ' }])
      assert.equal(
        await outcome(() =>
          service.transition(
            'vouchers',
            Number(document.id),
            admin,
            'cancel',
            document.version,
            undefined,
            options
          )
        ),
        '422 E_REASON_REQUIRED'
      )
    assert.equal(
      await outcome(() =>
        service.transition(
          'vouchers',
          Number(document.id),
          admin,
          'cancel',
          document.version,
          undefined,
          {
            reason: 42,
          }
        )
      ),
      '422 E_REASON'
    )
    const row = await db('vouchers').where('id', Number(document.id)).first('doc_status')
    assert.equal(row.doc_status, 1)
  })

  test('the reason is stored in its field and shown in the activity log', async ({ assert }) => {
    const document = await submitted('مع سبب')
    const cancelled = await service.transition(
      'vouchers',
      Number(document.id),
      admin,
      'cancel',
      document.version,
      undefined,
      { reason: '  خطأ في المبلغ  ' }
    )
    assert.equal(cancelled.docStatus, 2)
    assert.equal(cancelled.cancelReason, 'خطأ في المبلغ')
    const [entry] = await service.activity('vouchers', Number(document.id), admin)
    assert.equal(entry.action, 'cancel')
    assert.equal(entry.reason, 'خطأ في المبلغ')
    assert.deepEqual(entry.fields, ['cancelReason'])
    // The amended draft starts without the original's reason.
    const copy = await service.amend('vouchers', Number(document.id), admin)
    assert.isNull(copy.cancelReason ?? null)
  })

  test('cancel options are checked when the resource is defined', ({ assert }) => {
    assert.throws(
      () => defineResource({ ...voucher, cancel: { reasonField: 'title2' } }),
      /cancel.reasonField must name a string or text field/
    )
    assert.throws(
      () =>
        defineResource({
          ...ticket,
          cancel: { requireReason: true },
        }),
      /cancel options require a submittable resource/
    )
  })
})
