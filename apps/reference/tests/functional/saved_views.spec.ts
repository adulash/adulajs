import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import {
  installSampleResources,
  removeSampleResources,
  seedActor,
  type UiActor,
} from '#tests/helpers/ui_fixtures'

const json = { Accept: 'application/json' }
const knex = () => db.connection().getWriteClient()
const base = '/resources/ui_samples/views'

test.group('Saved views over HTTP', (group) => {
  let owner: UiActor
  let colleague: UiActor
  let outsider: UiActor
  group.setup(async () => {
    owner = await seedActor([{ subject: 'all', action: 'manage' }])
    colleague = await seedActor([{ subject: 'ui_samples', action: 'view' }], {
      orgUnitId: owner.orgUnitId,
    })
    outsider = await seedActor([{ subject: 'customers', action: 'view' }], {
      orgUnitId: owner.orgUnitId,
    })
    await installSampleResources()
    return () => removeSampleResources()
  })
  group.each.setup(async () => {
    await knex()('saved_views').del()
  })

  test('a saved view is stored and listed on the generated index page', async ({
    client,
    assert,
  }) => {
    const created = await client
      .post(base)
      .loginAs(owner.user)
      .withCsrfToken()
      .headers(json)
      .json({
        name: 'العينات المفعّلة',
        query: { sort: 'quantity', direction: 'desc', filters: { enabled: 'true' } },
      })
    created.assertStatus(200)
    assert.equal(created.body().data.name, 'العينات المفعّلة')
    assert.isTrue(created.body().data.own)

    const page = await client
      .get('/resources/ui_samples')
      .loginAs(owner.user)
      .header('Accept', 'text/html')
      .withInertia()
    page.assertStatus(200)
    const views = page.body().props.view.savedViews
    assert.lengthOf(views, 1)
    assert.deepEqual(views[0].query, {
      sort: 'quantity',
      direction: 'desc',
      filters: { enabled: 'true' },
    })
  })

  test('an unsupported query key is refused before it can drive a list request', async ({
    client,
    assert,
  }) => {
    for (const query of [
      { sort: 'enabled' },
      { filters: { amount: '1' } },
      { limit: 1000 },
      { direction: 'asc' },
    ]) {
      const response = await client
        .post(base)
        .loginAs(owner.user)
        .withCsrfToken()
        .headers(json)
        .json({ name: 'مرفوض', query })
      response.assertStatus(422)
      assert.equal(response.body().error.code, 'E_VIEW_QUERY')
    }
    const rows = await knex()('saved_views').count('* as count')
    assert.equal(rows[0].count, '0')
  })

  test('shared views reach colleagues while private ones stay hidden', async ({
    client,
    assert,
  }) => {
    await client
      .post(base)
      .loginAs(owner.user)
      .withCsrfToken()
      .headers(json)
      .json({ name: 'مشترك', query: { sort: 'quantity' }, shared: true })
    await client
      .post(base)
      .loginAs(owner.user)
      .withCsrfToken()
      .headers(json)
      .json({ name: 'خاص', query: {} })
    const page = await client
      .get('/resources/ui_samples')
      .loginAs(colleague.user)
      .header('Accept', 'text/html')
      .withInertia()
    const views = page.body().props.view.savedViews
    assert.deepEqual(
      views.map((view: { name: string; own: boolean }) => [view.name, view.own]),
      [['مشترك', false]]
    )
  })

  test('a read-only colleague cannot publish a shared view', async ({ client, assert }) => {
    const refused = await client
      .post(base)
      .loginAs(colleague.user)
      .withCsrfToken()
      .headers(json)
      .json({ name: 'للجميع', query: {}, shared: true })
    refused.assertStatus(403)
    const rows = await knex()('saved_views').count('* as count')
    assert.equal(rows[0].count, '0')
  })

  test('a colleague cannot delete a view they do not own', async ({ client, assert }) => {
    const created = await client
      .post(base)
      .loginAs(owner.user)
      .withCsrfToken()
      .headers(json)
      .json({ name: 'للحذف', query: {}, shared: true })
    const id = created.body().data.id
    const denied = await client
      .delete(`${base}/${id}`)
      .loginAs(colleague.user)
      .withCsrfToken()
      .headers(json)
    denied.assertStatus(404)
    const removed = await client
      .delete(`${base}/${id}`)
      .loginAs(owner.user)
      .withCsrfToken()
      .headers(json)
    removed.assertStatus(200)
    const rows = await knex()('saved_views').count('* as count')
    assert.equal(rows[0].count, '0')
  })

  test('an actor without view permission on the resource is refused', async ({
    client,
    assert,
  }) => {
    const response = await client
      .post(base)
      .loginAs(outsider.user)
      .withCsrfToken()
      .headers(json)
      .json({ name: 'ممنوع', query: {} })
    response.assertStatus(403)
    assert.equal(response.body().error.code, 'E_FORBIDDEN')
  })

  test('anonymous clients cannot save a view', async ({ client }) => {
    const response = await client.post(base).withCsrfToken().headers(json).json({
      name: 'مجهول',
      query: {},
    })
    response.assertStatus(401)
  })
})
