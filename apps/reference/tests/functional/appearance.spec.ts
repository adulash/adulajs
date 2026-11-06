import { test } from '@japa/runner'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import db from '@adonisjs/lucid/services/db'
import type { ApiClient, ApiRequest } from '@japa/api-client'
import User from '#models/user'
import { adula } from '#services/adula'

// Appearance and occasion themes (ADR 053): only administrators change them, everyone sees
// the result, logos are untrusted uploads, and an occasion ends by itself.

const json = (request: ApiRequest) =>
  request.withCsrfToken().header('Accept', 'application/json').header('Content-Type', 'application/json')
const asPage = (request: ApiRequest) => request.header('Accept', 'text/html').withInertia()
const logoBytes = (format: 'png' | 'jpeg' = 'png') =>
  sharp({ create: { width: 120, height: 40, channels: 3, background: '#006c35' } })
    .toFormat(format)
    .toBuffer()

test.group('Appearance and occasions', (group) => {
  let admin: User
  let member: User
  const knex = () => db.connection().getWriteClient()
  const appearance = () => adula().appearance
  const realClock = appearance().clock

  group.setup(async () => {
    const suffix = randomUUID()
    const password = 'a-long-test-password-123'
    admin = await User.create({ email: `appearance-admin-${suffix}@example.test`, password })
    member = await User.create({ email: `appearance-member-${suffix}@example.test`, password })
    const [adminRole, memberRole] = await knex()('roles')
      .insert([
        { name: `appearance-admin-${suffix}`, permission_level: 1 },
        // Everything on records, but not the administration (`all/manage`).
        { name: `appearance-member-${suffix}`, permission_level: 0 },
      ])
      .returning('id')
    await knex()('role_rules').insert([
      { role_id: adminRole.id, subject: 'all', action: 'manage' },
      { role_id: memberRole.id, subject: 'orders', action: 'manage' },
    ])
    await knex()('user_roles').insert([
      { user_id: admin.id, role_id: adminRole.id },
      { user_id: member.id, role_id: memberRole.id },
    ])
  })
  group.each.setup(async () => {
    appearance().clock = realClock
    await knex()('appearance_occasions').delete()
    await knex()('settings').where('key', 'appearance.identity').delete()
    await knex()('attachments').where('resource', 'core_appearance').delete()
    // Writes through the HTTP routes clear the cache; direct table changes above do not.
    appearance().clock = () => new Date('2026-01-01T09:00:00Z')
  })
  group.teardown(() => {
    appearance().clock = realClock
  })

  const upload = (client: ApiClient, user: User, bytes: Buffer, filename: string, type: string) =>
    client
      .post('/admin/appearance/logos')
      .loginAs(user)
      .withCsrfToken()
      .header('Accept', 'application/json')
      .file('logo', bytes, { filename, contentType: type })

  test('only administrators open or change the appearance (PostgreSQL roles)', async ({
    client,
    assert,
  }) => {
    const page = await asPage(client.get('/admin/appearance').loginAs(member))
    page.assertStatus(403)
    for (const request of [
      json(client.put('/admin/appearance').loginAs(member)).json({ company: 'x' }),
      json(client.post('/admin/appearance/occasions').loginAs(member)).json({}),
      json(client.delete('/admin/appearance').loginAs(member)),
    ]) {
      const response = await request
      response.assertStatus(403)
      assert.equal(response.body().error.code, 'E_FORBIDDEN')
    }
    const logo = await upload(client, member, await logoBytes(), 'logo.png', 'image/png')
    logo.assertStatus(403)
    const guest = await json(client.put('/admin/appearance')).json({ company: 'x' })
    assert.oneOf(guest.status(), [401, 302])
    assert.isUndefined(await knex()('settings').where('key', 'appearance.identity').first())
    const own = await asPage(client.get('/admin/appearance').loginAs(admin))
    own.assertStatus(200)
    assert.equal(own.body().component, 'admin/appearance/index')
  })

  test('a saved identity reaches every page, guests included, and refuses weak colours', async ({
    client,
    assert,
  }) => {
    const weak = await json(client.put('/admin/appearance').loginAs(admin)).json({
      primaryColor: '#ffd400',
    })
    weak.assertStatus(422)
    assert.equal(weak.body().error.code, 'E_APPEARANCE_CONTRAST')
    const css = await json(client.put('/admin/appearance').loginAs(admin)).json({
      primaryColor: '#006c35;}body{display:none',
    })
    css.assertStatus(422)
    const form = await client
      .put('/admin/appearance')
      .loginAs(admin)
      .withCsrfToken()
      .form({ company: 'x' })
    form.assertStatus(415)

    const saved = await json(client.put('/admin/appearance').loginAs(admin)).json({
      company: 'شركة عدولة',
      loginTitle: '<script>alert(1)</script>',
      primaryColor: '#006C35',
      guestTitle: '',
    })
    saved.assertStatus(200)
    const login = await asPage(client.get('/login'))
    login.assertStatus(200)
    const shared = login.body().props.appearance
    assert.equal(shared.company, 'شركة عدولة')
    // Stored and sent as plain text; the page renders it as text, never as markup.
    assert.equal(shared.login.title, '<script>alert(1)</script>')
    assert.isNull(shared.guestHome.title)
    assert.equal(shared.theme.light['--primary'], '#006c35')
    assert.isNull(shared.occasion)

    // The generic settings screen cannot write around the checks.
    const around = await json(client.put('/admin/settings').loginAs(admin)).json({
      key: 'appearance.identity',
      scope: 'system',
      value: JSON.stringify({ primaryColor: 'red;}' }),
    })
    around.assertStatus(403)

    const actions = await knex()('activities')
      .where({ resource: 'core.appearance', actor_id: admin.id })
      .pluck('action')
    assert.include(actions, 'identity.update')

    const reset = await json(client.delete('/admin/appearance').loginAs(admin))
    reset.assertStatus(200)
    const after = await asPage(client.get('/login'))
    assert.notEqual(after.body().props.appearance.company, 'شركة عدولة')
    assert.isNull(after.body().props.appearance.theme)
  })

  test('logos: only PNG, JPEG or WebP; a preview is private until saved, then public', async ({
    client,
    assert,
  }) => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>'
    )
    const refused = await upload(client, admin, svg, 'logo.png', 'image/png')
    refused.assertStatus(422)
    const renamed = await upload(client, admin, svg, 'logo.svg', 'image/svg+xml')
    renamed.assertStatus(422)

    const uploaded = await upload(client, admin, await logoBytes('jpeg'), 'logo.jpg', 'image/jpeg')
    uploaded.assertStatus(200)
    const { id, url } = uploaded.body().data
    assert.equal(url, `/appearance/logos/${id}`)
    const hidden = await client.get(url)
    hidden.assertStatus(404)
    const preview = await client.get(url).loginAs(admin)
    preview.assertStatus(200)
    assert.equal(preview.header('cache-control'), 'private, no-store')

    await json(client.put('/admin/appearance').loginAs(admin)).json({ logoId: id })
    const shown = await client.get(url)
    shown.assertStatus(200)
    assert.equal(shown.header('content-type'), 'image/jpeg')
    assert.equal(shown.header('x-content-type-options'), 'nosniff')
    assert.include(shown.header('content-security-policy'), 'sandbox')
    assert.include(shown.header('cache-control'), 'immutable')
    const login = await asPage(client.get('/login'))
    assert.equal(login.body().props.appearance.logoUrl, url)

    // Another attachment id is not an appearance logo.
    const avatarLike = await client.get('/appearance/logos/999999999')
    avatarLike.assertStatus(404)
  })

  test('an occasion applies on its dates, overlaps are refused and it ends by itself', async ({
    client,
    assert,
  }) => {
    await json(client.put('/admin/appearance').loginAs(admin)).json({ primaryColor: '#1d4ed8' })
    const created = await json(client.post('/admin/appearance/occasions').loginAs(admin)).json({
      name: 'اليوم الوطني',
      startsOn: '2026-09-20',
      endsOn: '2026-09-23',
      primaryColor: '#006c35',
      banner: 'كل عام والوطن بخير',
      loginTitle: 'أهلًا في يومنا الوطني',
    })
    created.assertStatus(200)
    const overlap = await json(client.post('/admin/appearance/occasions').loginAs(admin)).json({
      name: 'متداخلة',
      startsOn: '2026-09-23',
      endsOn: '2026-09-25',
      banner: 'x',
    })
    overlap.assertStatus(409)
    assert.equal(overlap.body().error.code, 'E_APPEARANCE_OVERLAP')

    const at = async (instant: string) => {
      appearance().clock = () => new Date(instant)
      return (await asPage(client.get('/login'))).body().props.appearance
    }
    assert.isNull((await at('2026-09-19T12:00:00Z')).occasion)
    const during = await at('2026-09-21T12:00:00Z')
    assert.equal(during.occasion.name, 'اليوم الوطني')
    assert.equal(during.banner, 'كل عام والوطن بخير')
    assert.equal(during.login.title, 'أهلًا في يومنا الوطني')
    assert.equal(during.theme.light['--primary'], '#006c35')
    // The day after the end date, with no job or restart: the base identity is back.
    const after = await at('2026-09-24T00:00:00+03:00')
    assert.isNull(after.occasion)
    assert.isNull(after.banner)
    assert.equal(after.theme.light['--primary'], '#1d4ed8')

    const page = await asPage(client.get('/admin/appearance').loginAs(admin))
    assert.equal(page.body().props.occasions[0].status, 'ended')
    const removed = await json(
      client.delete(`/admin/appearance/occasions/${created.body().data.id}`).loginAs(admin)
    )
    removed.assertStatus(200)
    assert.lengthOf(await knex()('appearance_occasions'), 0)
  })
})
