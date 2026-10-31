import { test } from '@japa/runner'
import { ResourceService, buildAbility, canQueryField } from '../index.js'
import type { Actor } from '../index.js'
import { admin, db, order, reader, registry, setup } from './helpers.js'
import { failure } from './helpers/failure.js'
import { powerless } from './helpers/actors.js'

test.group('Authorized aggregates', (group) => {
  const service = () => new ResourceService(db, registry)
  group.setup(async () => {
    await setup()
    const row = (id: number, unit: number, status: string, total: number, docStatus = 0) => ({
      id,
      number: `AGG-${id}`,
      org_unit_id: unit,
      created_by: 1,
      updated_by: 1,
      status,
      total,
      doc_status: docStatus,
      internal_note: `سري ${id}`,
    })
    await db('orders').insert([
      row(1, 2, 'open', 1000),
      row(2, 2, 'open', 2500, 1),
      row(3, 2, 'closed', 400),
      row(4, 4, 'open', 700),
      row(5, 3, 'open', 9000),
      { ...row(6, 2, 'closed', 50), deleted_at: db.fn.now() },
    ])
  })

  test('groups, counts and totals only the records the actor may view', async ({ assert }) => {
    const all = await service().aggregate('orders', admin, {
      groupBy: ['status'],
      sum: ['total'],
    })
    assert.isFalse(all.truncated)
    assert.deepEqual(all.rows, [
      { group: { status: 'closed' }, count: 1, sum: { total: '400' } },
      { group: { status: 'open' }, count: 4, sum: { total: '13200' } },
    ])
    // The reader works in unit 1.2 (and its child 1.2.4): unit 1.3 is not counted.
    const scoped = await service().aggregate('orders', reader, { groupBy: ['status'] })
    assert.deepEqual(scoped.rows, [
      { group: { status: 'closed' }, count: 1 },
      { group: { status: 'open' }, count: 3 },
    ])
    const documents = await service().aggregate('orders', reader, {
      groupBy: ['docStatus'],
      filters: { status: 'open' },
    })
    assert.deepEqual(documents.rows, [
      { group: { docStatus: 0 }, count: 2 },
      { group: { docStatus: 1 }, count: 1 },
    ])
    const large = await service().aggregate('orders', admin, {
      where: { total: { $gt: '900' }, status: 'open' },
      sum: ['total'],
    })
    assert.deepEqual(large.rows, [{ group: {}, count: 3, sum: { total: '12500' } }])
  })

  test('fields the actor may not query are refused instead of leaking values', async ({
    assert,
  }) => {
    // total needs permission level 1; internalNote is hidden (level 1) as well.
    const total = await failure(() => service().aggregate('orders', reader, { sum: ['total'] }))
    assert.equal(total.code, 'E_FIELD_FORBIDDEN')
    const hidden = await failure(() =>
      service().aggregate('orders', reader, { groupBy: ['internalNote'] })
    )
    assert.equal(hidden.code, 'E_FIELD_FORBIDDEN')
    const byTotal = await failure(() =>
      service().aggregate('orders', reader, { where: { total: { $gt: '100' } } })
    )
    assert.equal(byTotal.code, 'E_FIELD_FORBIDDEN')
    const creator = await failure(() =>
      service().aggregate('orders', admin, { where: { createdBy: 1 } })
    )
    assert.equal(creator.code, 'E_FIELD_FORBIDDEN')
    const inherited = await failure(() =>
      service().aggregate('orders', admin, { groupBy: ['constructor'] })
    )
    assert.equal(inherited.code, 'E_FIELD_FORBIDDEN')
    const text = await failure(() => service().aggregate('orders', admin, { sum: ['notes'] }))
    assert.equal(text.code, 'E_FIELD_FORBIDDEN')
    const many = await failure(() =>
      service().aggregate('orders', admin, { groupBy: ['status', 'notes', 'number', 'total'] })
    )
    assert.equal(many.code, 'E_AGGREGATE')
    // A conditional rule makes every field of the subject unsafe to group by, but the
    // count of records it allows is still available.
    const conditional: Actor = {
      ...reader,
      rules: [{ subject: 'orders', action: 'view', conditions: { status: 'open' } }],
    }
    const grouped = await failure(() =>
      service().aggregate('orders', conditional, { groupBy: ['status'] })
    )
    assert.equal(grouped.code, 'E_FIELD_FORBIDDEN')
    const counted = await service().aggregate('orders', conditional)
    assert.deepEqual(counted.rows, [{ group: {}, count: 3 }])
    assert.isFalse(
      canQueryField(order, conditional, buildAbility(conditional.rules, registry.all()), 'status')
    )
    const denied = await failure(() =>
      service().aggregate('customers', powerless(), { groupBy: ['name'] })
    )
    assert.equal(denied.status, 403)
  })
})
