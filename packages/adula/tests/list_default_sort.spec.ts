import { test } from '@japa/runner'
import { ResourceRegistry, ResourceService, defineResource } from '../index.js'
import { admin, customer, db } from './helpers.js'
import { failure } from './helpers/failure.js'
import { item, listRegistry, setupListItems } from './helpers/list_items.js'

/**
 * Owner decision 27 (2.3.0, «الأحدث أولاً»): with no sort chosen, a list shows the newest
 * records first, by creation time and then by id. A sort the user picks, or one the resource
 * declares, still wins.
 */

const service = (registry = listRegistry) => new ResourceService(db, registry)

async function titles(
  options: Parameters<ResourceService['list']>[2] = {},
  registry = listRegistry
) {
  const page = await service(registry).list('list_items', admin, options)
  return page.data.map((row) => row.title)
}

/** Every title, page by page (one row per page), following the cursors. */
async function paged(options: Parameters<ResourceService['list']>[2] = {}) {
  const seen: unknown[] = []
  let cursor: string | undefined
  do {
    const page = await service().list('list_items', admin, { ...options, limit: 1, cursor })
    seen.push(...page.data.map((row) => row.title))
    cursor = page.meta.nextCursor ?? undefined
  } while (cursor && seen.length < 10)
  return seen
}

test.group('List default order: newest first (decision 27)', (group) => {
  group.setup(async () => {
    await setupListItems()
    // Creation times that disagree with the ids, so the order shows which one decides:
    // Gamma (id 3) is newest, one microsecond after Alpha (id 1); Beta (2) and Delta (4) were
    // created at the same moment, so the id breaks the tie.
    const created = {
      Gamma: '2026-03-01 10:00:00.000002+00',
      Alpha: '2026-03-01 10:00:00.000001+00',
      Beta: '2026-01-01 08:00:00+00',
      Delta: '2026-01-01 08:00:00+00',
    }
    for (const [title, at] of Object.entries(created))
      await db('list_items').where({ title }).update({ created_at: at })
    const ids = await db('list_items').orderBy('id').pluck('title')
    if (ids.join() !== 'Alpha,Beta,Gamma,Delta') throw new Error(`Unexpected ids: ${ids.join()}`)
  })

  test('with no sort, the newest records come first, then the higher id', async ({ assert }) => {
    assert.deepEqual(await titles(), ['Gamma', 'Alpha', 'Delta', 'Beta'])
  })

  test('paging keeps that order exactly, to the microsecond and across ties', async ({
    assert,
  }) => {
    assert.deepEqual(await paged(), ['Gamma', 'Alpha', 'Delta', 'Beta'])
    // A direction alone reverses the default order: the oldest first.
    assert.deepEqual(await paged({ direction: 'asc' }), ['Beta', 'Delta', 'Alpha', 'Gamma'])
  })

  test('exports follow the default order', async ({ assert }) => {
    const file = await service().export('list_items', admin)
    const rows = file.content
      .replace('﻿', '')
      .trim()
      .split('\r\n')
      .slice(1)
      .map((line) => line.slice(1, line.indexOf('"', 1)))
    assert.deepEqual(rows, ['Gamma', 'Alpha', 'Delta', 'Beta'])
  })

  test('a sort the user picks wins, ascending unless a direction is given', async ({ assert }) => {
    assert.deepEqual(await titles({ sort: 'title' }), ['Alpha', 'Beta', 'Delta', 'Gamma'])
    assert.deepEqual(await titles({ sort: 'title', direction: 'desc' }), [
      'Gamma',
      'Delta',
      'Beta',
      'Alpha',
    ])
    assert.deepEqual(await titles({ sort: 'id' }), ['Alpha', 'Beta', 'Gamma', 'Delta'])
  })

  test('the creation time is not a sort a request can name', async ({ assert }) => {
    for (const sort of ['_created', 'createdAt', 'created_at']) {
      const error = await failure(() => service().list('list_items', admin, { sort }))
      assert.equal(error.status, 422, sort)
      assert.equal(error.code, 'E_SORT', sort)
    }
  })

  test('a cursor of another order or with a malformed time is refused', async ({ assert }) => {
    const first = await service().list('list_items', admin, { limit: 1 })
    const cursor = first.meta.nextCursor!
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString())
    assert.equal(decoded.value, '2026-03-01 10:00:00.000002+00')
    const forged = Buffer.from(JSON.stringify({ ...decoded, value: 'yesterday' })).toString(
      'base64url'
    )
    for (const [options, label] of [
      [{ cursor: forged }, 'malformed time'],
      [{ cursor, sort: 'title' }, 'another sort'],
      [{ cursor, direction: 'asc' as const }, 'another direction'],
    ] as const) {
      const error = await failure(() =>
        service().list('list_items', admin, { limit: 1, ...options })
      )
      assert.equal(error.status, 422, label)
    }
  })

  test('a declared default sort replaces newest first; the user still wins', async ({ assert }) => {
    const declared = defineResource({ ...item, defaultSort: { field: 'qty', direction: 'desc' } })
    const registry = new ResourceRegistry().register([
      { name: 'customers', label: customer.label, dependsOn: [], resources: [customer] },
      { name: 'lists', label: declared.label, dependsOn: ['customers'], resources: [declared] },
    ])
    // Quantities: Gamma 15, Beta 10, Alpha 5, Delta none (last).
    assert.deepEqual(await titles({}, registry), ['Gamma', 'Beta', 'Alpha', 'Delta'])
    assert.deepEqual(await titles({ sort: 'title' }, registry), ['Alpha', 'Beta', 'Delta', 'Gamma'])
    // Ascending when the declaration gives no direction.
    const ascending = defineResource({ ...item, defaultSort: { field: 'title' } })
    const plain = new ResourceRegistry().register([
      { name: 'customers', label: customer.label, dependsOn: [], resources: [customer] },
      { name: 'lists', label: ascending.label, dependsOn: ['customers'], resources: [ascending] },
    ])
    assert.deepEqual(await titles({}, plain), ['Alpha', 'Beta', 'Delta', 'Gamma'])
  })

  test('a declared default sort must name id or a sortable field', ({ assert }) => {
    assert.throws(
      () => defineResource({ ...item, defaultSort: { field: 'note' } }),
      /defaultSort must name id or a sortable field/
    )
    assert.throws(
      () =>
        defineResource({
          ...item,
          defaultSort: { field: 'title', direction: 'down' as 'asc' },
        }),
      /defaultSort direction must be asc or desc/
    )
  })
})
