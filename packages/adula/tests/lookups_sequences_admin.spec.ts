import { test } from '@japa/runner'
import {
  AdulaError,
  LookupsAdmin,
  ResourceRegistry,
  ResourceService,
  SequencesAdmin,
  formatSequence,
  sequence,
} from '../index.js'
import { admin, customer, db, line, order, registry, setup } from './helpers.js'

async function failure(run: () => Promise<unknown>): Promise<AdulaError> {
  try {
    await run()
  } catch (error) {
    if (error instanceof AdulaError) return error
    throw error
  }
  throw new Error('Expected an AdulaError')
}
async function code(run: () => Promise<unknown>) {
  const error = await failure(run)
  return error.code
}
async function status(run: () => Promise<unknown>) {
  const error = await failure(run)
  return error.status
}
const activities = (resource: string) =>
  db('activities').where('resource', resource).orderBy('id', 'asc')

test.group('Lookup and sequence administration', (group) => {
  // The orders module also declares order_status.open, as a module seed would.
  const declaring = new ResourceRegistry().register([
    { name: 'customers', label: customer.label, dependsOn: [], resources: [customer] },
    {
      name: 'orders',
      label: order.label,
      dependsOn: ['customers'],
      resources: [order, line],
      lookups: { order_status: [{ key: 'open', label: { ar: 'مفتوح', en: 'Open' } }] },
    },
  ])
  const lookups = new LookupsAdmin(db, declaring)
  const sequences = new SequencesAdmin(db, registry)
  const records = new ResourceService(db, registry)
  group.setup(async () => {
    await setup()
  })

  test('groups report counts, declaring modules and the fields that use them', async ({
    assert,
  }) => {
    const groups = await lookups.groups()
    const summary = groups.find((entry) => entry.group === 'order_status')!
    assert.deepInclude(summary, { total: 2, active: 2, declared: true })
    assert.deepEqual(summary.fields, [{ resource: 'orders', field: 'status', label: 'الحالة' }])
    // Without a registry, usage is unknown rather than reported as zero.
    const values = await new LookupsAdmin(db).values('order_status')
    assert.isTrue(values.every((value) => value.usage === null))
  })

  test('create validates group, key and labels and falls back to the key in English', async ({
    assert,
  }) => {
    for (const input of [
      { group: 'Order Status', key: 'x', labelAr: 'س' },
      { group: 'order_status', key: 'Bad Key', labelAr: 'س' },
      { group: 'order_status', key: 'ok', labelAr: '   ' },
      { group: 'order_status', key: 'ok', labelAr: 'س', sort: 'first' },
    ])
      assert.equal(await status(() => lookups.create(1, input)), 422)
    const duplicate = await failure(() =>
      lookups.create(1, { group: 'order_status', key: 'open', labelAr: 'مكرر' })
    )
    assert.equal(duplicate.code, 'E_LOOKUP_EXISTS')
    const created = await lookups.create(1, {
      group: 'order_status',
      key: 'on_hold',
      labelAr: ' معلّق ',
    })
    assert.deepInclude(created, {
      key: 'on_hold',
      labelAr: 'معلّق',
      labelEn: 'on_hold',
      sort: 1,
      active: true,
      usage: 0,
      declared: false,
    })
    // A new group is created with its first value.
    const priority = await lookups.create(1, {
      group: 'ticket_priority',
      key: 'high',
      labelAr: 'عالية',
      labelEn: 'High',
    })
    assert.equal(priority.sort, 0)
    const audit = await activities('core.lookups').where('record_id', priority.id).first()
    assert.equal(audit.action, 'create')
    assert.deepInclude(audit.changes, { group: 'ticket_priority', key: 'high', labelEn: 'High' })
  })

  test('update changes labels and sort but never the key', async ({ assert }) => {
    const [held] = await db('lookups').where({ group: 'order_status', key: 'on_hold' })
    const immutable = await failure(() => lookups.update(1, held.id, { key: 'paused' }))
    assert.equal(immutable.code, 'E_LOOKUP_KEY_IMMUTABLE')
    assert.equal(await status(() => lookups.update(1, held.id, { labelAr: '' })), 422)
    assert.equal(await status(() => lookups.update(1, 999999, { labelAr: 'س' })), 404)
    const updated = await lookups.update(1, held.id, { labelAr: 'موقوف', labelEn: 'On hold' })
    assert.deepInclude(updated, { key: 'on_hold', labelAr: 'موقوف', labelEn: 'On hold' })
    const audit = await activities('core.lookups')
      .where({ record_id: held.id, action: 'update' })
      .first()
    assert.deepEqual(audit.changes.labelAr, { from: 'معلّق', to: 'موقوف' })
    // An unchanged save writes no activity.
    await lookups.update(1, held.id, { labelAr: 'موقوف' })
    assert.lengthOf(
      await activities('core.lookups').where({ record_id: held.id, action: 'update' }),
      1
    )
  })

  test('reorder sets a whole group in one call and refuses partial orders', async ({ assert }) => {
    const before = await lookups.values('order_status')
    assert.deepEqual(
      before.map((value) => value.key),
      ['closed', 'open', 'on_hold']
    )
    const ids = before.map((value) => value.id)
    for (const invalid of [[], ids.slice(1), [...ids, ids[0]], [ids[0], ids[1], 999999]])
      assert.equal(await code(() => lookups.reorder(1, 'order_status', invalid)), 'E_LOOKUP_ORDER')
    const reversed = await lookups.reorder(1, 'order_status', [...ids].reverse())
    assert.deepEqual(
      reversed.map((value) => [value.key, value.sort]),
      [
        ['on_hold', 0],
        ['open', 1],
        ['closed', 2],
      ]
    )
    const logged = await activities('core.lookups').where('action', 'reorder')
    assert.sameMembers(
      logged.map((row) => row.changes.key),
      ['on_hold', 'open', 'closed']
    )
    assert.deepEqual(logged.find((row) => row.changes.key === 'on_hold')!.changes.sort, {
      from: 1,
      to: 0,
    })
    // Saving the same order again changes nothing and writes no activity.
    await lookups.reorder(1, 'order_status', [...ids].reverse())
    assert.lengthOf(await activities('core.lookups').where('action', 'reorder'), 3)
  })

  test('a disabled stored value would block editing, so in-use values cannot be disabled', async ({
    assert,
  }) => {
    const record = await records.save('orders', admin, { orgUnitId: 2, status: 'closed' })
    await records.save('orders', admin, { orgUnitId: 2, status: 'closed' })
    const [closed] = await db('lookups').where({ group: 'order_status', key: 'closed' })
    // The premise: the record validator requires an active value on every save.
    await db('lookups').where('id', closed.id).update({ active: false })
    const blocked = await failure(() =>
      records.save('orders', admin, { notes: 'تعديل', version: record.version }, Number(record.id))
    )
    assert.equal(blocked.code, 'E_LOOKUP')
    await db('lookups').where('id', closed.id).update({ active: true })
    const edited = await records.save(
      'orders',
      admin,
      { notes: 'تعديل', version: record.version },
      Number(record.id)
    )
    assert.equal(edited.status, 'closed')

    const values = await lookups.values('order_status')
    assert.equal(values.find((value) => value.key === 'closed')!.usage, 2)
    const refused = await failure(() => lookups.disable(1, closed.id))
    assert.equal(refused.code, 'E_LOOKUP_IN_USE')
    assert.include(refused.message, '2')
    const kept = await db('lookups').where('id', closed.id).first()
    assert.isTrue(kept.active)
    // Without a registry the usage is unknown and disabling is refused.
    assert.equal(
      await code(() => new LookupsAdmin(db).disable(1, closed.id)),
      'E_LOOKUP_USAGE_UNKNOWN'
    )

    const [held] = await db('lookups').where({ group: 'order_status', key: 'on_hold' })
    const disabled = await lookups.disable(1, held.id)
    assert.isFalse(disabled.active)
    // Disabled values cannot be chosen for records.
    const rejected = await failure(() =>
      records.save('orders', admin, { orgUnitId: 2, status: 'on_hold' })
    )
    assert.equal(rejected.code, 'E_LOOKUP')
    const enabled = await lookups.enable(1, held.id)
    assert.isTrue(enabled.active)
    const toggles = await activities('core.lookups')
      .where('record_id', held.id)
      .whereIn('action', ['disable', 'enable'])
    assert.deepEqual(
      toggles.map((row) => row.action),
      ['disable', 'enable']
    )
  })

  test('only unused values that no module declares can be deleted', async ({ assert }) => {
    const [closed] = await db('lookups').where({ group: 'order_status', key: 'closed' })
    const [open] = await db('lookups').where({ group: 'order_status', key: 'open' })
    const [held] = await db('lookups').where({ group: 'order_status', key: 'on_hold' })
    assert.equal(await code(() => lookups.delete(1, closed.id)), 'E_LOOKUP_IN_USE')
    assert.equal(await code(() => lookups.delete(1, open.id)), 'E_LOOKUP_DECLARED')
    await lookups.delete(1, held.id)
    assert.notExists(await db('lookups').where('id', held.id).first())
    const audit = await activities('core.lookups').where({ record_id: held.id, action: 'delete' })
    assert.lengthOf(audit, 1)
  })

  test('sequence() output is unchanged and formatSequence matches it', async ({ assert }) => {
    const issued = await db.transaction((trx) => sequence(trx, 'INV'))
    assert.equal(issued, 'INV-000001')
    assert.equal(formatSequence('INV', '1'), issued)
    assert.equal(formatSequence('INV', 1234567n), 'INV-1234567')
  })

  test('sequences list stored and declared keys with the next number', async ({ assert }) => {
    const rows = await sequences.list()
    const ord = rows.find((row) => row.key === 'ORD')!
    // Two orders were created above.
    assert.deepInclude(ord, { value: '2', next: 'ORD-000003' })
    assert.deepEqual(ord.fields, [{ resource: 'orders', field: 'number', label: 'الرقم' }])
    assert.deepInclude(
      rows.find((row) => row.key === 'INV')!,
      { value: '1', next: 'INV-000002' }
    )
  })

  test('sequences only move forward and every adjustment is audited', async ({ assert }) => {
    for (const next of [2, 1, '0', '-5', 'abc', '1.5', '1234567890123456789'])
      assert.oneOf(await code(() => sequences.setNext(1, 'ORD', next)), [
        'E_SEQUENCE_BACKWARD',
        'E_SEQUENCE_VALUE',
      ])
    const backward = await failure(() => sequences.setNext(1, 'ORD', 2))
    assert.equal(backward.code, 'E_SEQUENCE_BACKWARD')
    assert.include(backward.message, 'ORD-000002')
    assert.equal(await status(() => sequences.setNext(1, 'MISSING', 5)), 404)
    assert.equal(await status(() => sequences.setNext(1, "x'; --", 5)), 404)

    // The current next number is accepted as a no-op without an audit row.
    const unchanged = await sequences.setNext(1, 'ORD', 3)
    assert.equal(unchanged.next, 'ORD-000003')
    assert.lengthOf(await activities('core.sequences'), 0)

    const moved = await sequences.setNext(1, 'ORD', '1000')
    assert.deepInclude(moved, { value: '999', next: 'ORD-001000' })
    const [audit] = await activities('core.sequences')
    assert.deepInclude(audit, { record_id: 0, action: 'adjust', actor_id: 1 })
    assert.deepEqual(audit.changes, { key: 'ORD', from: 'ORD-000003', to: 'ORD-001000' })
    const record = await records.save('orders', admin, { orgUnitId: 2, status: 'open' })
    assert.equal(record.number, 'ORD-001000')
  })

  test('a declared sequence without a stored row can be set ahead', async ({ assert }) => {
    const numbered = new SequencesAdmin(db, registry)
    await db('sequences').where('key', 'ORD').delete()
    const listed = await numbered.list()
    assert.deepInclude(
      listed.find((row) => row.key === 'ORD')!,
      {
        value: '0',
        next: 'ORD-000001',
      }
    )
    const ahead = await numbered.setNext(1, 'ORD', 50)
    assert.equal(ahead.next, 'ORD-000050')
    assert.equal(await db.transaction((trx) => sequence(trx, 'ORD')), 'ORD-000050')
  })
})
