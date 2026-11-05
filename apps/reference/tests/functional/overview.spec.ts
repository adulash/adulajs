import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import type { ApiClient } from '@japa/api-client'
import type User from '#models/user'
import { adula } from '#services/adula'
import { seedActor, type UiActor } from '#tests/helpers/ui_fixtures'

// The personal overview (ADR 050, #159): each user arranges the widgets they may see, and a
// widget they may not see never appears, whatever their saved layout says.

const TOTAL = 'dashboard.orders_overview.ordersTotal'
const COUNT = 'dashboard.orders_overview.orders'
const BUILTINS = ['core.welcome', 'core.tasks', 'core.notifications', 'core.modules']

type Widget = { id: string; kind: string; hidden: boolean; data?: { value?: unknown } | null }

test.group('Personal overview', (group) => {
  let wide: UiActor
  let narrow: UiActor
  const knex = () => db.connection().getWriteClient()

  group.setup(async () => {
    wide = await seedActor([{ subject: 'all', action: 'manage' }], { level: 1 })
    // Orders without the level-1 total field.
    narrow = await seedActor([{ subject: 'orders', action: 'view' }], { level: 0 })
    const creator = await adula().actors.load(wide.user.id)
    await adula().resources.save('orders', creator, {
      notes: 'طلب النظرة العامة',
      total: '424242',
      orgUnitId: wide.orgUnitId,
    })
  })
  group.each.setup(async () => {
    await knex()('settings')
      .where({ scope: 'user', key: 'preference.overview.layout' })
      .whereIn('scope_id', [String(wide.user.id), String(narrow.user.id)])
      .delete()
  })

  const page = async (client: ApiClient, user: User) => {
    const response = await client.get('/').loginAs(user).header('Accept', 'text/html').withInertia()
    response.assertStatus(200)
    return response.body().props.overview as { widgets: Widget[]; customized: boolean }
  }
  const save = (client: ApiClient, user: User, value: unknown) =>
    client
      .put('/account/preferences/overview.layout')
      .loginAs(user)
      .withCsrfToken()
      .header('Accept', 'application/json')
      .json({ value })

  test('the default arrangement lists built-ins and readable widgets only', async ({
    client,
    assert,
  }) => {
    const full = await page(client, wide.user)
    assert.deepEqual(
      full.widgets.map((widget) => widget.id),
      [...BUILTINS, COUNT, TOTAL]
    )
    assert.isFalse(full.customized)
    const total = full.widgets.find((widget) => widget.id === TOTAL)!
    assert.equal(total.data?.value, '424242')

    const limited = await page(client, narrow.user)
    assert.deepEqual(
      limited.widgets.map((widget) => widget.id),
      [...BUILTINS, COUNT]
    )
  })

  test('a user cannot add a widget they may not see', async ({ client, assert }) => {
    // The stored layout is well formed, so the preference store keeps it ...
    const stored = await save(client, narrow.user, { order: [TOTAL, COUNT], hidden: [] })
    stored.assertStatus(200)
    // ... but the overview is decided as the viewer on every read: no widget, no number.
    const response = await client
      .get('/')
      .loginAs(narrow.user)
      .header('Accept', 'text/html')
      .withInertia()
    const overview = response.body().props.overview as { widgets: Widget[] }
    assert.notInclude(
      overview.widgets.map((widget) => widget.id),
      TOTAL
    )
    assert.equal(overview.widgets[0].id, COUNT)
    assert.notInclude(JSON.stringify(response.body()), '424242')

    // The same stored layout for a user who may read the total shows it first.
    const response1 = await save(client, wide.user, { order: [TOTAL, COUNT], hidden: [] })
    response1.assertStatus(200)
    const full = await page(client, wide.user)
    assert.equal(full.widgets[0].id, TOTAL)
  })

  test('hidden widgets stay listed for the dialog but carry no data; reset restores', async ({
    client,
    assert,
  }) => {
    const arrangedSave = await save(client, wide.user, {
      order: ['core.modules', COUNT, 'gone.widget'],
      hidden: [TOTAL, 'core.welcome'],
    })
    arrangedSave.assertStatus(200)
    const arranged = await page(client, wide.user)
    assert.deepEqual(
      arranged.widgets.map((widget) => widget.id),
      ['core.modules', COUNT, 'core.welcome', 'core.tasks', 'core.notifications', TOTAL]
    )
    assert.isTrue(arranged.customized)
    const total = arranged.widgets.find((widget) => widget.id === TOTAL)!
    assert.isTrue(total.hidden)
    assert.isNull(total.data)

    const reset = await client
      .delete('/account/preferences/overview.layout')
      .loginAs(wide.user)
      .withCsrfToken()
      .header('Accept', 'application/json')
    reset.assertStatus(200)
    const restored = await page(client, wide.user)
    assert.deepEqual(
      restored.widgets.map((widget) => widget.id),
      [...BUILTINS, COUNT, TOTAL]
    )
    assert.isFalse(restored.customized)
  })

  test('malformed layouts are refused and guests keep the start page', async ({
    client,
    assert,
  }) => {
    for (const value of [
      { order: [COUNT], hidden: [], extra: true },
      { order: ['<script>'], hidden: [] },
      { order: Array.from({ length: 101 }, (_, index) => `w${index}`), hidden: [] },
      { order: 'core.welcome', hidden: [] },
      ['core.welcome'],
    ]) {
      const response = await save(client, wide.user, value)
      response.assertStatus(422)
      assert.equal(response.body().error.code, 'E_PREFERENCE_VALUE')
    }
    const guest = await client.get('/').header('Accept', 'text/html').withInertia()
    guest.assertStatus(200)
    assert.isUndefined(guest.body().props.overview)
  })
})
