import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { seedActor, type UiActor } from '#tests/helpers/ui_fixtures'

const json = { Accept: 'application/json' }

/** Per-user interface preferences over HTTP (ADR 049, #153-#157). */
test.group('Account preferences', (group) => {
  let owner: UiActor
  let other: UiActor
  group.setup(async () => {
    owner = await seedActor([{ subject: 'customers', action: 'view' }])
    other = await seedActor([{ subject: 'customers', action: 'view' }])
  })
  group.each.setup(async () => {
    await db.from('settings').where('scope', 'user').whereLike('key', 'preference.%').delete()
  })

  test('the shared prop carries defaults, then the stored values of the signed-in user only', async ({
    client,
    assert,
  }) => {
    const before = await client.get('/').loginAs(owner.user).withInertia()
    before.assertStatus(200)
    assert.deepEqual(before.body().props.preferences, {
      'shell.sidebar': 'expanded',
      'shell.layout': null,
      'shell.theme': 'light',
      'shell.navOrder': [],
    })

    const saved = await client
      .put('/account/preferences/shell.theme')
      .loginAs(owner.user)
      .withCsrfToken()
      .headers(json)
      .json({ value: 'dark' })
    saved.assertStatus(200)
    assert.deepEqual(saved.body(), { data: { key: 'shell.theme', value: 'dark' } })

    const mine = await client.get('/').loginAs(owner.user).withInertia()
    assert.equal(mine.body().props.preferences['shell.theme'], 'dark')
    const theirs = await client.get('/').loginAs(other.user).withInertia()
    assert.equal(theirs.body().props.preferences['shell.theme'], 'light')

    // Rendered on <html> before the first paint.
    const page = await client.get('/').loginAs(owner.user).header('Accept', 'text/html')
    assert.match(page.text(), /<html[^>]*class="dark"[^>]*data-theme="dark"/)
  })

  test('validates keys and values and resets to the default', async ({ client, assert }) => {
    const send = (key: string, value: unknown) =>
      client
        .put(`/account/preferences/${key}`)
        .loginAs(owner.user)
        .withCsrfToken()
        .headers(json)
        .json({ value })
    const unknown = await send('shell.unknown', 'x')
    unknown.assertStatus(404)
    assert.equal(unknown.body().error.code, 'E_PREFERENCE_UNKNOWN')
    const invalid = await send('shell.sidebar', 'floating')
    invalid.assertStatus(422)
    assert.equal(invalid.body().error.code, 'E_PREFERENCE_VALUE')
    const order = await send('shell.navOrder', ['module.sales', 'NOT VALID'])
    order.assertStatus(422)

    const icons = await send('shell.sidebar', 'icons')
    icons.assertStatus(200)
    const reset = await client
      .delete('/account/preferences/shell.sidebar')
      .loginAs(owner.user)
      .withCsrfToken()
      .headers(json)
    reset.assertStatus(200)
    assert.deepEqual(reset.body(), { data: { key: 'shell.sidebar', value: 'expanded' } })
    const rows = await db.from('settings').where('scope', 'user').whereLike('key', 'preference.%')
    assert.lengthOf(rows, 0)
  })

  test('requires a session, CSRF, and refuses changes while impersonating', async ({
    client,
    assert,
  }) => {
    const anonymous = await client
      .put('/account/preferences/shell.theme')
      .withCsrfToken()
      .headers(json)
      .json({ value: 'dark' })
    assert.oneOf(anonymous.status(), [401, 302])
    const noCsrf = await client
      .put('/account/preferences/shell.theme')
      .loginAs(owner.user)
      .headers(json)
      .json({ value: 'dark' })
    assert.notEqual(noCsrf.status(), 200)

    const impersonated = await client
      .put('/account/preferences/shell.theme')
      .loginAs(owner.user)
      .withSession({ impersonator_id: { adminId: other.user.id, targetId: owner.user.id } })
      .withCsrfToken()
      .headers(json)
      .json({ value: 'dark' })
    impersonated.assertStatus(403)
    assert.equal(impersonated.body().error.code, 'E_IMPERSONATING')
    const rows = await db.from('settings').where('scope', 'user').whereLike('key', 'preference.%')
    assert.lengthOf(rows, 0)
  })

  test('the system layout default reaches every page through uiPreferences', async ({
    client,
    assert,
  }) => {
    await db
      .table('settings')
      .insert({
        key: 'ui.preferences',
        scope: 'system',
        scope_id: '0',
        value: JSON.stringify({
          calendar: 'gregory',
          confirmDialogClose: true,
          pageTransitions: true,
          layout: 'top',
          layoutUserChoice: true,
        }),
      })
      .onConflict(['key', 'scope', 'scope_id'])
      .merge(['value'])
    try {
      const page = await client.get('/').loginAs(owner.user).withInertia()
      assert.equal(page.body().props.uiPreferences.layout, 'top')
      assert.isTrue(page.body().props.uiPreferences.layoutUserChoice)
    } finally {
      await db.from('settings').where({ key: 'ui.preferences', scope: 'system' }).delete()
    }
  })
})
