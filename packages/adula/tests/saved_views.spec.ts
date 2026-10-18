import { test } from '@japa/runner'
import { SavedViews } from '../index.js'
import { admin, db, reader, registry, setup } from './helpers.js'
import { failure } from './helpers/failure.js'

test.group('Saved views', (group) => {
  group.setup(setup)
  group.each.setup(async () => {
    await db('saved_views').del()
  })

  const views = () => new SavedViews(db, registry)

  test('stores and lists a validated query', async ({ assert }) => {
    const saved = await views().save('orders', admin, {
      name: '  الطلبات المفتوحة  ',
      query: { search: 'عاجل', sort: 'total', direction: 'desc', filters: { status: 'open' } },
    })
    assert.equal(saved.name, 'الطلبات المفتوحة')
    assert.isTrue(saved.own)
    assert.isFalse(saved.shared)
    assert.deepEqual(saved.query, {
      search: 'عاجل',
      sort: 'total',
      direction: 'desc',
      filters: { status: 'open' },
    })
    const listed = await views().list('orders', admin)
    assert.lengthOf(listed, 1)
    assert.deepEqual(listed[0].query, saved.query)
  })

  test('saving the same name twice replaces the query rather than duplicating it', async ({
    assert,
  }) => {
    await views().save('orders', admin, { name: 'عرضي', query: { sort: 'total' } })
    await views().save('orders', admin, {
      name: 'عرضي',
      query: { filters: { status: 'closed' } },
      shared: true,
    })
    const listed = await views().list('orders', admin)
    assert.lengthOf(listed, 1)
    assert.isTrue(listed[0].shared)
    assert.deepEqual(listed[0].query, { filters: { status: 'closed' } })
  })

  test('refuses fields the resource does not expose for query', async ({ assert }) => {
    const unsortable = await failure(() =>
      views().save('orders', admin, { name: 'خطأ', query: { sort: 'internalNote' } })
    )
    assert.equal(unsortable.code, 'E_VIEW_QUERY')
    assert.equal(unsortable.status, 422)
    const unfilterable = await failure(() =>
      views().save('orders', admin, { name: 'خطأ', query: { filters: { notes: 'x' } } })
    )
    assert.equal(unfilterable.code, 'E_VIEW_QUERY')
    const unknownKey = await failure(() =>
      views().save('orders', admin, { name: 'خطأ', query: { limit: 500 } })
    )
    assert.equal(unknownKey.code, 'E_VIEW_QUERY')
    const danglingDirection = await failure(() =>
      views().save('orders', admin, { name: 'خطأ', query: { direction: 'asc' } })
    )
    assert.equal(danglingDirection.code, 'E_VIEW_QUERY')
    assert.lengthOf(await views().list('orders', admin), 0)
  })

  test('a stored view whose field stopped being queryable is dropped from the listing', async ({
    assert,
  }) => {
    await db('saved_views').insert({
      resource: 'orders',
      name: 'قديم',
      query: JSON.stringify({ sort: 'internalNote' }),
      user_id: admin.id,
    })
    assert.lengthOf(await views().list('orders', admin), 0)
  })

  test('shared views reach other users while private ones stay hidden', async ({ assert }) => {
    await views().save('orders', admin, { name: 'مشترك', query: {}, shared: true })
    await views().save('orders', admin, { name: 'خاص', query: {} })
    const seen = await views().list('orders', reader)
    assert.deepEqual(
      seen.map((view) => view.name),
      ['مشترك']
    )
    assert.isFalse(seen[0].own)
  })

  test('only the owner removes a view', async ({ assert }) => {
    const saved = await views().save('orders', admin, { name: 'للحذف', query: {}, shared: true })
    const denied = await failure(() => views().remove('orders', reader, saved.id))
    assert.equal(denied.status, 404)
    await views().remove('orders', admin, saved.id)
    assert.lengthOf(await views().list('orders', admin), 0)
  })

  test('an actor without view permission is refused', async ({ assert }) => {
    const stranger = { ...reader, rules: [{ subject: 'customers', action: 'view' }] }
    const error = await failure(() => views().list('orders', stranger))
    assert.equal(error.status, 403)
  })

  test('text search is refused on a resource without searchable fields', async ({ assert }) => {
    const error = await failure(() =>
      views().save('order_lines', admin, { name: 'بحث', query: { search: 'x' } })
    )
    assert.equal(error.code, 'E_VIEW_QUERY')
  })

  test('a view cannot query fields its author may not query', async ({ assert }) => {
    const sorted = await failure(() =>
      views().save('orders', reader, { name: 'حسب الإجمالي', query: { sort: 'total' } })
    )
    assert.equal(sorted.status, 403)
    assert.equal(sorted.code, 'E_FIELD_FORBIDDEN')
    assert.lengthOf(await db('saved_views'), 0)
  })

  test("own views are listed before colleagues' shared views", async ({ assert }) => {
    await views().save('orders', admin, { name: 'أ مشترك', query: {}, shared: true })
    await views().save('orders', reader, { name: 'ي خاص', query: {} })
    const listed = await views().list('orders', reader)
    assert.deepEqual(
      listed.map((view) => [view.name, view.own]),
      [
        ['ي خاص', true],
        ['أ مشترك', false],
      ]
    )
  })
})
