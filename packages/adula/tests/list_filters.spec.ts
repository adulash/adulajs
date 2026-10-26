import { test } from '@japa/runner'
import { ResourceService, SavedViews } from '../index.js'
import { admin, db } from './helpers.js'
import { failure } from './helpers/failure.js'
import { clerk, listRegistry, setupListItems } from './helpers/list_items.js'

const service = () => new ResourceService(db, listRegistry)
async function titles(filters: Record<string, unknown>, actor = admin) {
  const page = await service().list('list_items', actor, { filters, sort: 'title' })
  return page.data.map((row) => row.title)
}

test.group('List filter operators (ADR 046)', (group) => {
  group.setup(() => setupListItems())

  test('in matches any of the values, from an array, a comma string or index keys', async ({
    assert,
  }) => {
    assert.deepEqual(await titles({ status: { in: 'open,closed' } }), ['Alpha', 'Beta', 'Gamma'])
    assert.deepEqual(await titles({ status: { in: ['closed'] } }), ['Beta'])
    assert.deepEqual(await titles({ qty: { in: ['5', '15'] } }), ['Alpha', 'Gamma'])
    assert.deepEqual(await titles({ customerId: { in: '1' } }), ['Alpha'])
    assert.deepEqual(await titles({ ownerId: { in: [1, 2] } }), ['Alpha', 'Beta'])
    // Query strings parse long `in[]` lists as objects with index keys.
    assert.deepEqual(await titles({ title: { in: { 0: 'Beta', 1: 'Delta' } } }), ['Beta', 'Delta'])
    // Organization scope still applies: Delta lives in unit 1.3.
    assert.deepEqual(await titles({ note: { in: 'x,y' } }, clerk()), ['Gamma'])
  })

  test('gte and lte are inclusive bounds, alone or together', async ({ assert }) => {
    assert.deepEqual(await titles({ qty: { gte: '10' } }), ['Beta', 'Gamma'])
    assert.deepEqual(await titles({ qty: { gte: '6', lte: 14 } }), ['Beta'])
    assert.deepEqual(await titles({ qty: { lte: '10' } }), ['Alpha', 'Beta'])
    assert.deepEqual(await titles({ amount: { gte: '2000' } }), ['Beta'])
    assert.deepEqual(await titles({ due: { lte: '2026-01-31' } }), ['Alpha'])
    assert.deepEqual(await titles({ due: { gte: '2026-01-10', lte: '2026-02-01' } }), [
      'Alpha',
      'Beta',
    ])
    assert.deepEqual(await titles({ seenAt: { gte: '2026-01-15T00:00:00.000Z' } }), ['Beta'])
  })

  test('empty matches NULL, and the empty string on text fields', async ({ assert }) => {
    assert.deepEqual(await titles({ note: { empty: 'true' } }), ['Alpha', 'Beta'])
    assert.deepEqual(await titles({ note: { empty: false } }), ['Delta', 'Gamma'])
    assert.deepEqual(await titles({ qty: { empty: true } }), ['Delta'])
    assert.deepEqual(await titles({ active: { empty: 'true' } }), ['Delta', 'Gamma'])
    assert.deepEqual(await titles({ status: { empty: 'false' } }), ['Alpha', 'Beta', 'Gamma'])
    // Scalars keep their equality meaning next to operators.
    assert.deepEqual(await titles({ status: 'open', qty: { gte: '10' } }), ['Gamma'])
    assert.deepEqual(await titles({ active: 'false' }), ['Beta'])
  })

  test('invalid operands, unknown or mixed operators are 422 E_FILTER', async ({ assert }) => {
    const many = Array.from({ length: 51 }, (_, index) => String(index + 1))
    for (const filters of [
      { qty: { in: 'a,b' } },
      { qty: { in: ['5', '1.5'] } },
      { qty: { gte: '1.5' } },
      { qty: { gte: '' } },
      { qty: { lte: null } },
      { amount: { gte: '10.50' } },
      { due: { gte: '2026-13-01' } },
      { seenAt: { lte: '2026-01-01' } },
      { status: { in: [] } },
      { status: { in: '' } },
      { status: { in: [null] } },
      { status: { in: [['open']] } },
      { qty: { in: many } },
      { note: { empty: 'yes' } },
      { note: { like: 'x' } },
      { qty: { in: '5', gte: '1' } },
      { qty: {} },
      { qty: [5] },
      { customerId: { in: '0' } },
    ]) {
      const error = await failure(() => service().list('list_items', admin, { filters }))
      assert.equal(error.status, 422, JSON.stringify(filters))
      assert.equal(error.code, 'E_FILTER', JSON.stringify(filters))
    }
  })

  test('operators are gated by field type', async ({ assert }) => {
    for (const filters of [
      { active: { in: ['true'] } },
      { due: { in: ['2026-01-10'] } },
      { amount: { in: ['1000'] } },
      { title: { gte: 'A' } },
      { status: { lte: 'open' } },
      { active: { gte: 'true' } },
      { ownerId: { gte: '1' } },
    ]) {
      const error = await failure(() => service().list('list_items', admin, { filters }))
      assert.equal(error.code, 'E_FILTER', JSON.stringify(filters))
    }
  })

  test('operators on a field the actor may not query are refused like equality', async ({
    assert,
  }) => {
    // secret needs permission level 1: the clerk can neither filter it nor probe it.
    for (const filters of [
      { secret: 7 },
      { secret: { gte: '1' } },
      { secret: { in: '7' } },
      { secret: { empty: 'false' } },
    ]) {
      const error = await failure(() => service().list('list_items', clerk(), { filters }))
      assert.equal(error.code, 'E_FILTER', JSON.stringify(filters))
    }
    assert.deepEqual(await titles({ secret: { gte: '1' } }), ['Alpha'])
  })

  test('aggregate accepts the same operators', async ({ assert }) => {
    const { rows } = await service().aggregate('list_items', admin, {
      filters: { qty: { gte: '6' }, status: { in: 'open,closed' } },
      sum: ['amount'],
    })
    assert.deepEqual(rows, [{ group: {}, count: 2, sum: { amount: '2500' } }])
    const error = await failure(() =>
      service().aggregate('list_items', admin, { filters: { qty: { gte: 'x' } } })
    )
    assert.equal(error.code, 'E_FILTER')
  })

  test('saved views store operator filters, validate them on save and drop them on read', async ({
    assert,
  }) => {
    const views = new SavedViews(db, listRegistry)
    const query = {
      filters: { status: { in: ['open', 'closed'] }, qty: { gte: '6', lte: '20' } },
    }
    const saved = await views.save('list_items', admin, { name: 'نطاق', query })
    assert.deepEqual(saved.query, query)
    const [stored] = await views.list('list_items', admin)
    assert.deepEqual(stored.query, query)
    for (const filters of [
      { qty: { gte: 'x' } },
      { qty: { like: '1' } },
      { active: { in: ['true'] } },
      { status: { in: [] } },
    ]) {
      const error = await failure(() =>
        views.save('list_items', admin, { name: 'خطأ', query: { filters } })
      )
      assert.equal(error.status, 422, JSON.stringify(filters))
      assert.equal(error.code, 'E_VIEW_QUERY')
    }
    const forbidden = await failure(() =>
      views.save('list_items', clerk(), {
        name: 'سري',
        query: { filters: { secret: { gte: '1' } } },
      })
    )
    assert.equal(forbidden.status, 403)
    assert.equal(forbidden.code, 'E_FIELD_FORBIDDEN')
    // A stored operator that no longer validates is dropped, not run.
    await db('saved_views').insert({
      user_id: admin.id,
      resource: 'list_items',
      name: 'قديم',
      query: JSON.stringify({ filters: { qty: { between: [1, 2] } } }),
      shared: false,
    })
    const listed = await views.list('list_items', admin)
    assert.deepEqual(
      listed.map((view) => view.name),
      ['نطاق']
    )
  })
})
