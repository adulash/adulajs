import { test } from '@japa/runner'
import { randomUUID } from 'node:crypto'
import { crc32, deflateSync } from 'node:zlib'
import db from '@adonisjs/lucid/services/db'
import drive from '@adonisjs/drive/services/main'
import type { ApiClient } from '@japa/api-client'
import User from '#models/user'

// Profile pictures (ADR 050, #158): uploads are untrusted, reads need a session, and only
// the user or an administrator changes a picture.

function chunk(type: string, data: Buffer = Buffer.alloc(0)) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0)
  return Buffer.concat([head, data, crc])
}
function png(side = 64, extra: Buffer[] = []) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(side, 0)
  header.writeUInt32BE(side, 4)
  header[8] = 8
  header[9] = 2
  const row = Buffer.alloc(1 + side * 3, 0x55)
  row[0] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    ...extra,
    chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: side }, () => row)))),
    chunk('IEND'),
  ])
}

test.group('Profile pictures', (group) => {
  let owner: User
  let colleague: User
  let admin: User
  const knex = () => db.connection().getWriteClient()
  const avatarRows = (userId: number) =>
    knex()('attachments')
      .where({ resource: 'core_users', field: 'avatar', record_id: userId })
      .whereNull('deleted_at')

  group.setup(async () => {
    const suffix = randomUUID()
    const password = 'a-long-test-password-123'
    owner = await User.create({
      fullName: 'سارة أحمد',
      email: `avatar-owner-${suffix}@example.test`,
      password,
    })
    colleague = await User.create({
      fullName: 'خالد سعيد',
      email: `avatar-colleague-${suffix}@example.test`,
      password,
    })
    admin = await User.create({
      fullName: 'مدير الصور',
      email: `avatar-admin-${suffix}@example.test`,
      password,
    })
    const [role] = await knex()('roles')
      .insert({ name: `avatar-admin-${suffix}`, permission_level: 1 })
      .returning('id')
    await knex()('role_rules').insert({ role_id: role.id, subject: 'all', action: 'manage' })
    await knex()('user_roles').insert({ user_id: admin.id, role_id: role.id })
  })

  const upload = (client: ApiClient, url: string, user: User, bytes: Buffer, filename = 'me.png') =>
    client
      .post(url)
      .loginAs(user)
      .withCsrfToken()
      .header('Accept', 'application/json')
      .file('avatar', bytes, { filename, contentType: 'image/png' })

  test('a user uploads, replaces and removes their own picture without metadata', async ({
    client,
    assert,
  }) => {
    const gps = chunk('tEXt', Buffer.from('GPS\0Latitude 24.7136 Longitude 46.6753'))
    const first = await upload(client, '/account/avatar', owner, png(64, [gps]))
    first.assertStatus(200)
    const [row] = await avatarRows(owner.id)
    assert.equal(row.mime_type, 'image/png')
    assert.equal(row.original_name, 'avatar.png')
    assert.match(row.path, new RegExp(`^avatars/${owner.id}/[0-9a-f-]{36}\\.png$`))
    const stored = Buffer.from(await drive.use(row.disk).getBytes(row.path))
    assert.notInclude(stored.toString('latin1'), 'Latitude')

    const second = await upload(client, '/account/avatar', owner, png(96))
    second.assertStatus(200)
    const rows = await avatarRows(owner.id)
    assert.lengthOf(rows, 1)
    assert.isAbove(Number(rows[0].id), Number(row.id))
    // The replaced picture is gone, row and file.
    assert.isFalse(await drive.use(row.disk).exists(row.path))

    const read = await client.get(`/users/${owner.id}/avatar`).loginAs(colleague)
    read.assertStatus(200)
    read.assertHeader('content-type', 'image/png')
    read.assertHeader('x-content-type-options', 'nosniff')
    read.assertHeader('content-security-policy', "default-src 'none'; sandbox")
    read.assertHeader('content-disposition', 'inline')
    read.assertHeader('cache-control', 'private, max-age=300')
    const versioned = await client
      .get(`/users/${owner.id}/avatar?v=${rows[0].id}`)
      .loginAs(colleague)
    versioned.assertHeader('cache-control', 'private, max-age=31536000, immutable')
    // A picture row is not an attachment any record can serve.
    const asAttachment = await client.get(`/attachments/${rows[0].id}`).loginAs(owner)
    asAttachment.assertStatus(404)

    const removed = await client
      .delete('/account/avatar')
      .loginAs(owner)
      .withCsrfToken()
      .header('Accept', 'application/json')
    removed.assertStatus(200)
    assert.lengthOf(await avatarRows(owner.id), 0)
    assert.isFalse(await drive.use(rows[0].disk).exists(rows[0].path))
    const response1 = await client.get(`/users/${owner.id}/avatar`).loginAs(colleague)
    response1.assertStatus(404)
    // Removing again is a harmless no-op.
    const again = await client
      .delete('/account/avatar')
      .loginAs(owner)
      .withCsrfToken()
      .header('Accept', 'application/json')
    again.assertStatus(200)
    const actions = await knex()('activities')
      .where({ resource: 'users', record_id: owner.id })
      .whereIn('action', ['avatar_updated', 'avatar_removed'])
      .orderBy('id')
      .pluck('action')
    assert.deepEqual(actions, ['avatar_updated', 'avatar_updated', 'avatar_removed'])
  })

  test('non-image, disguised, oversized and huge pictures are refused', async ({
    client,
    assert,
  }) => {
    const cases: [Buffer, string, string][] = [
      [Buffer.from('MZ\x90\x00 not an image', 'latin1'), 'setup.exe', 'E_AVATAR_TYPE'],
      [Buffer.from('plain text'), 'notes.txt', 'E_AVATAR_TYPE'],
      [
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>'),
        'photo.png',
        'E_AVATAR_TYPE',
      ],
      [
        Buffer.concat([Buffer.from('<html><script>alert(1)</script>'), png()]),
        'photo.png',
        'E_AVATAR_TYPE',
      ],
      [png(4000), 'huge.png', 'E_AVATAR_DIMENSIONS'],
      [png(64, [chunk('tEXt', Buffer.alloc(1100 * 1024, 0x41))]), 'big.png', 'E_AVATAR_TYPE'],
    ]
    for (const [bytes, filename, code] of cases) {
      const response = await upload(client, '/account/avatar', colleague, bytes, filename)
      response.assertStatus(422)
      // The body parser refuses wrong types and sizes first; the sanitizer refuses the rest.
      assert.oneOf(response.body().error.code, [code, 'E_AVATAR_TYPE', 'E_AVATAR_SIZE'])
    }
    assert.lengthOf(await avatarRows(colleague.id), 0)
    const missing = await client
      .post('/account/avatar')
      .loginAs(colleague)
      .withCsrfToken()
      .header('Accept', 'application/json')
    missing.assertStatus(422)
  })

  test('nobody else changes a user picture, and reads need a session', async ({
    client,
    assert,
  }) => {
    const response2 = await upload(client, '/account/avatar', owner, png())
    response2.assertStatus(200)
    const [before] = await avatarRows(owner.id)

    // A colleague cannot use the administration routes for another user.
    const foreign = await upload(client, `/admin/users/${owner.id}/avatar`, colleague, png(80))
    foreign.assertStatus(403)
    const foreignDelete = await client
      .delete(`/admin/users/${owner.id}/avatar`)
      .loginAs(colleague)
      .withCsrfToken()
      .header('Accept', 'application/json')
    foreignDelete.assertStatus(403)
    // A user id in the body of the account route is ignored: it changes only the caller.
    const sneaky = await client
      .post('/account/avatar')
      .loginAs(colleague)
      .withCsrfToken()
      .header('Accept', 'application/json')
      .fields({ userId: String(owner.id) })
      .file('avatar', png(72), { filename: 'x.png', contentType: 'image/png' })
    sneaky.assertStatus(200)
    const [after] = await avatarRows(owner.id)
    assert.equal(after.id, before.id)
    assert.lengthOf(await avatarRows(colleague.id), 1)

    // An administrator acting as the user cannot change it; the change outlives the session.
    const impersonated = await client
      .post('/account/avatar')
      .loginAs(owner)
      .withSession({ impersonator_id: { adminId: admin.id, targetId: owner.id } })
      .withCsrfToken()
      .header('Accept', 'application/json')
      .file('avatar', png(72), { filename: 'x.png', contentType: 'image/png' })
    impersonated.assertStatus(403)
    assert.equal(impersonated.body().error.code, 'E_AVATAR_IMPERSONATING')

    const guest = await client.get(`/users/${owner.id}/avatar`).header('Accept', 'application/json')
    assert.oneOf(guest.status(), [401, 302])
    const response3 = await client.get('/users/abc/avatar').loginAs(colleague)
    response3.assertStatus(404)
    const response4 = await client.get('/users/99999999/avatar').loginAs(colleague)
    response4.assertStatus(404)
  })

  test('an administrator sets and removes another user picture from the user page', async ({
    client,
    assert,
  }) => {
    const set = await upload(client, `/admin/users/${colleague.id}/avatar`, admin, png(128))
    set.assertStatus(200)
    const [row] = await avatarRows(colleague.id)
    assert.equal(row.uploaded_by, admin.id)
    const page = await client
      .get(`/admin/users/${colleague.id}`)
      .loginAs(admin)
      .header('Accept', 'text/html')
      .withInertia()
    assert.equal(page.body().props.avatarUrl, `/users/${colleague.id}/avatar?v=${row.id}`)
    const removed = await client
      .delete(`/admin/users/${colleague.id}/avatar`)
      .loginAs(admin)
      .withCsrfToken()
      .header('Accept', 'application/json')
    removed.assertStatus(200)
    assert.lengthOf(await avatarRows(colleague.id), 0)
    const logged = await knex()('activities')
      .where({ resource: 'core.users', record_id: colleague.id })
      .whereIn('action', ['avatar_updated', 'avatar_removed'])
      .orderBy('id')
      .select('action', 'actor_id')
    assert.deepEqual(
      logged.map((entry) => [entry.action, entry.actor_id]),
      [
        ['avatar_updated', admin.id],
        ['avatar_removed', admin.id],
      ]
    )
  })

  test('the shared account prop carries the versioned picture URL', async ({ client, assert }) => {
    const response5 = await upload(client, '/account/avatar', owner, png())
    response5.assertStatus(200)
    const [row] = await avatarRows(owner.id)
    const page = await client
      .get('/account/profile')
      .loginAs(owner)
      .header('Accept', 'text/html')
      .withInertia()
    assert.equal(page.body().props.account.avatarUrl, `/users/${owner.id}/avatar?v=${row.id}`)
    const other = await client
      .get('/account/profile')
      .loginAs(admin)
      .header('Accept', 'text/html')
      .withInertia()
    assert.isNull(other.body().props.account.avatarUrl)
  })
})
