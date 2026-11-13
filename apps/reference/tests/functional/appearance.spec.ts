import { test } from '@japa/runner'
import { randomUUID } from 'node:crypto'
import { crc32, deflateSync } from 'node:zlib'
import db from '@adonisjs/lucid/services/db'
import type { ApiClient, ApiRequest } from '@japa/api-client'
import User from '#models/user'
import { adula } from '#services/adula'

// Appearance and occasion themes (ADR 053): only administrators change them, everyone sees
// the result, logos are untrusted uploads, and an occasion ends by itself.

const json = (request: ApiRequest) =>
  request
    .withCsrfToken()
    .header('Accept', 'application/json')
    .header('Content-Type', 'application/json')
const asPage = (request: ApiRequest) => request.header('Accept', 'text/html').withInertia()
function chunk(type: string, data: Buffer = Buffer.alloc(0)) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0)
  return Buffer.concat([head, data, crc])
}
/** A solid 120×40 PNG built by hand, so the test needs no image library. */
function png(width = 120, height = 40) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 2
  const row = Buffer.alloc(1 + width * 3, 0x35)
  row[0] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
    chunk('IEND'),
  ])
}
/** A solid 120×40 JPEG (305 bytes). */
const JPEG = Buffer.from(
  '/9j/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAoAHgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFgEBAQEAAAAAAAAAAAAAAAAAAAMF/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AmwEmEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//9k=',
  'base64'
)
const logoBytes = async (format: 'png' | 'jpeg' = 'png') => (format === 'png' ? png() : JPEG)

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
    appearance().forget()
    appearance().clock = () => new Date('2026-01-01T09:00:00Z')
  })
  // Later specs see the shells' own identity.
  group.teardown(async () => {
    appearance().clock = realClock
    await knex()('appearance_occasions').delete()
    await knex()('settings').where('key', 'appearance.identity').delete()
    await knex()('attachments').where('resource', 'core_appearance').delete()
    appearance().forget()
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
      company: 'شركة أدولا',
      loginTitle: '<script>alert(1)</script>',
      primaryColor: '#006C35',
      guestTitle: '',
    })
    saved.assertStatus(200)
    const login = await asPage(client.get('/login'))
    login.assertStatus(200)
    const shared = login.body().props.appearance
    assert.equal(shared.company, 'شركة أدولا')
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
    assert.notEqual(after.body().props.appearance.company, 'شركة أدولا')
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
    assert.equal(shown.header('cache-control'), 'public, max-age=300, must-revalidate')
    const login = await asPage(client.get('/login'))
    assert.equal(login.body().props.appearance.logoUrl, url)

    // An occasion's logo stays private until the occasion starts, and again after it ends.
    const campaign = await upload(client, admin, await logoBytes('png'), 'eid.png', 'image/png')
    const campaignUrl = campaign.body().data.url
    const occasion = await json(client.post('/admin/appearance/occasions').loginAs(admin)).json({
      name: 'العيد',
      startsOn: '2026-09-20',
      endsOn: '2026-09-23',
      logoId: campaign.body().data.id,
    })
    occasion.assertStatus(200)
    appearance().clock = () => new Date('2026-09-19T12:00:00Z')
    const early = await client.get(campaignUrl)
    early.assertStatus(404)
    const adminEarly = await client.get(campaignUrl).loginAs(admin)
    adminEarly.assertStatus(200)
    assert.equal(adminEarly.header('cache-control'), 'private, no-store')
    const revalidated = await client
      .get(campaignUrl)
      .loginAs(admin)
      .header('if-none-match', String(adminEarly.header('etag')))
    revalidated.assertStatus(304)
    assert.equal(revalidated.header('cache-control'), 'private, no-store')
    appearance().clock = () => new Date('2026-09-21T12:00:00Z')
    const during = await client.get(campaignUrl)
    during.assertStatus(200)
    // The base logo stays public while the occasion overrides it.
    const base = await client.get(url)
    base.assertStatus(200)
    appearance().clock = () => new Date('2026-09-24T12:00:00Z')
    const ended = await client.get(campaignUrl)
    ended.assertStatus(404)

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
      const login = await asPage(client.get('/login'))
      return login.body().props.appearance
    }
    const before = await at('2026-09-19T12:00:00Z')
    assert.isNull(before.occasion)
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
