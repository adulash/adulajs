import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import User from '#models/user'
import { seedActor, type UiActor } from '#tests/helpers/ui_fixtures'

const json = { Accept: 'application/json' }
const knex = () => db.connection().getWriteClient()

// API tokens belong to administrators (owner decision, 2.3.0). The token still carries its
// owner's rules, so the owner here is an administrator denied the customers resource, and
// the bearer API must keep that denial and the field levels.
const administrator = [
  { subject: 'all', action: 'manage' },
  { subject: 'customers', action: 'manage', inverted: true },
]

test.group('Personal API tokens and the resource API', (group) => {
  let owner: UiActor
  let otherAdministrator: UiActor
  let reader: UiActor
  group.setup(async () => {
    owner = await seedActor(administrator, { fullName: 'مالك الرمز', level: 0 })
    otherAdministrator = await seedActor(administrator, { fullName: 'مدير آخر', level: 0 })
    reader = await seedActor([{ subject: 'customers', action: 'view' }], {
      fullName: 'قارئ',
      level: 0,
    })
  })

  async function token(client: any, user: UiActor['user'], access: 'read' | 'write') {
    const response = await client
      .post('/admin/tokens')
      .loginAs(user)
      .withCsrfToken()
      .headers(json)
      .json({ name: `تكامل ${access}`, access, expiresInDays: 30 })
    response.assertStatus(201)
    return response.body().data as { token: { id: number }; secret: string }
  }

  test('a write token creates and reads records with the owner permissions', async ({
    client,
    assert,
  }) => {
    const { secret } = await token(client, owner.user, 'write')
    assert.match(secret, /^adula_/)
    const stored = await knex()('auth_access_tokens').where('tokenable_id', owner.user.id).first()
    assert.notInclude(stored.hash, secret)

    // No cookies, no CSRF token: bearer authentication only.
    const created = await client
      .post('/api/v1/resources/orders')
      .header('Authorization', `Bearer ${secret}`)
      .header('Accept', '*/*')
      .json({ notes: 'عبر الواجهة البرمجية', orgUnitId: owner.orgUnitId })
    created.assertStatus(201)
    const id = created.body().data.id
    const shown = await client
      .get(`/api/v1/resources/orders/${id}`)
      .header('Authorization', `Bearer ${secret}`)
    shown.assertStatus(200)
    assert.equal(shown.body().data.notes, 'عبر الواجهة البرمجية')
    // Dashboards count through the same authorization as the list (#27).
    const counted = await client
      .get('/api/v1/resources/orders/aggregate')
      .qs({ groupBy: 'docStatus', where: JSON.stringify({ notes: 'عبر الواجهة البرمجية' }) })
      .header('Authorization', `Bearer ${secret}`)
    counted.assertStatus(200)
    assert.deepEqual(counted.body().data.rows, [{ group: { docStatus: 0 }, count: 1 }])
    const refused = await client
      .get('/api/v1/resources/orders/aggregate')
      .qs({ groupBy: 'internalNote' })
      .header('Authorization', `Bearer ${secret}`)
    refused.assertStatus(403)
    assert.equal(refused.body().error.code, 'E_FIELD_FORBIDDEN')
    const forbidden = await client
      .get('/api/v1/resources/customers')
      .header('Authorization', `Bearer ${secret}`)
    forbidden.assertStatus(403)

    const document = await client
      .get('/api/v1/openapi.json')
      .header('Authorization', `Bearer ${secret}`)
    document.assertStatus(200)
    assert.equal(document.body().openapi, '3.1.0')
    assert.property(document.body().paths, '/api/v1/resources/orders')
    assert.property(document.body().paths, '/api/v1/resources/orders/aggregate')
    assert.notProperty(document.body().paths, '/api/v1/resources/customers')
  })

  test('read tokens cannot write; revoked, invalid and session-only calls are refused', async ({
    client,
    assert,
  }) => {
    const read = await token(client, owner.user, 'read')
    const list = await client
      .get('/api/v1/resources/orders')
      .header('Authorization', `Bearer ${read.secret}`)
    list.assertStatus(200)
    const write = await client
      .post('/api/v1/resources/orders')
      .header('Authorization', `Bearer ${read.secret}`)
      .json({ notes: 'x', orgUnitId: owner.orgUnitId })
    write.assertStatus(403)
    assert.equal(write.body().error.code, 'E_TOKEN_SCOPE')

    const revoked = await client
      .delete(`/admin/tokens/${read.token.id}`)
      .loginAs(owner.user)
      .withCsrfToken()
      .headers(json)
    revoked.assertStatus(200)
    const after = await client
      .get('/api/v1/resources/orders')
      .header('Authorization', `Bearer ${read.secret}`)
    after.assertStatus(401)
    const invalid = await client
      .get('/api/v1/resources/orders')
      .header('Authorization', 'Bearer adula_not-a-real-token')
    invalid.assertStatus(401)
    const session = await client.get('/api/v1/resources/orders').loginAs(owner.user).headers(json)
    session.assertStatus(401)
  })

  test('administrators cannot revoke tokens of others and disabled users lose API access', async ({
    client,
  }) => {
    const mine = await token(client, owner.user, 'read')
    const foreign = await client
      .delete(`/admin/tokens/${mine.token.id}`)
      .loginAs(otherAdministrator.user)
      .withCsrfToken()
      .headers(json)
    foreign.assertStatus(404)
    await knex()('users').where('id', owner.user.id).update({ disabled_at: knex().fn.now() })
    try {
      const response = await client
        .get('/api/v1/resources/orders')
        .header('Authorization', `Bearer ${mine.secret}`)
      response.assertStatus(401)
    } finally {
      await knex()('users').where('id', owner.user.id).update({ disabled_at: null })
    }
  })

  test('a non-administrator gets 403 on every token address', async ({ client, assert }) => {
    const mine = await token(client, owner.user, 'read')
    const requests = [
      ['get', '/admin/tokens'],
      ['post', '/admin/tokens'],
      ['delete', `/admin/tokens/${mine.token.id}`],
      ['get', '/account/tokens'],
      ['post', '/account/tokens'],
      ['delete', `/account/tokens/${mine.token.id}`],
    ] as const
    for (const [method, url] of requests) {
      const response = await client
        .request(url, method.toUpperCase())
        .loginAs(reader.user)
        .withCsrfToken()
        .headers(json)
        .json({ name: 'محاولة', access: 'read', expiresInDays: 30 })
      response.assertStatus(403)
      assert.equal(response.body().error.code, 'E_FORBIDDEN', `${method} ${url}`)
    }
    // A browser visit gets the administration's forbidden page, also 403.
    const page = await client.get('/admin/tokens').loginAs(reader.user)
    page.assertStatus(403)
    // Nothing was minted, and the administrator's token survived the refused revoke.
    assert.lengthOf(await User.accessTokens.all(reader.user), 0)
    const kept = await User.accessTokens.all(owner.user)
    assert.isTrue(kept.some((row) => Number(row.identifier) === mine.token.id))
  })

  test("the old address sends an administrator to the settings tab, keeping a script's method", async ({
    client,
    assert,
  }) => {
    const page = await client.get('/account/tokens').loginAs(owner.user).redirects(0)
    page.assertStatus(302)
    assert.equal(page.header('location'), '/admin/tokens')
    const create = await client
      .post('/account/tokens')
      .loginAs(owner.user)
      .withCsrfToken()
      .headers(json)
      .redirects(0)
    create.assertStatus(308)
    assert.equal(create.header('location'), '/admin/tokens')
    const revoke = await client
      .delete('/account/tokens/7')
      .loginAs(owner.user)
      .withCsrfToken()
      .headers(json)
      .redirects(0)
    revoke.assertStatus(308)
    assert.equal(revoke.header('location'), '/admin/tokens/7')
  })

  test("a non-administrator's existing token is refused when used, not deleted", async ({
    client,
    assert,
  }) => {
    // Minted before 2.3.0, when every user could create one.
    const earlier = await User.accessTokens.create(reader.user, ['read', 'write'], {
      name: 'قبل 2.3.0',
      expiresIn: '30 days',
    })
    const secret = earlier.value!.release()
    for (const request of [
      client.get('/api/v1/resources/customers'),
      client.get('/api/v1/openapi.json'),
      client.post('/api/v1/resources/customers').json({ name: 'x' }),
    ]) {
      const response = await request.header('Authorization', `Bearer ${secret}`)
      response.assertStatus(403)
      assert.equal(response.body().error.code, 'E_TOKEN_ADMIN_ONLY')
    }
    // The row stays: the user's administration page lists it and revokes it.
    assert.lengthOf(await User.accessTokens.all(reader.user), 1)
    const listed = await client
      .get(`/admin/users/${reader.user.id}`)
      .loginAs(owner.user)
      .header('Accept', 'application/json')
    const body = listed.body()
    const tokens = (body.tokens ?? body.props?.tokens) as { name: string | null }[] | undefined
    assert.deepEqual(
      tokens?.map((row) => row.name),
      ['قبل 2.3.0']
    )
    const revoked = await client
      .post(`/admin/users/${reader.user.id}/revoke-tokens`)
      .loginAs(owner.user)
      .withCsrfToken()
      .headers(json)
    revoked.assertStatus(200)
    assert.lengthOf(await User.accessTokens.all(reader.user), 0)
  })

  test('a token stops working when its owner stops being an administrator', async ({
    client,
    assert,
  }) => {
    const promoted = await seedActor(administrator, { level: 0 })
    const minted = await token(client, promoted.user, 'read')
    const before = await client
      .get('/api/v1/resources/orders')
      .header('Authorization', `Bearer ${minted.secret}`)
    before.assertStatus(200)
    await knex()('user_roles').where('user_id', promoted.user.id).delete()
    const after = await client
      .get('/api/v1/resources/orders')
      .header('Authorization', `Bearer ${minted.secret}`)
    after.assertStatus(403)
    assert.equal(after.body().error.code, 'E_TOKEN_ADMIN_ONLY')
  })
})
