import { test } from '@japa/runner'
import { createHash, randomUUID } from 'node:crypto'
import type { ApiRequest } from '@japa/api-client'
import db from '@adonisjs/lucid/services/db'
import mail from '@adonisjs/mail/services/main'
import limiter from '@adonisjs/limiter/services/main'
import User from '#models/user'
import PasswordResetNotification from '#mails/password_reset_notification'
import { signupEnabled } from '#services/signup'
import { linkOrCreateSocialUser } from '#services/social_accounts'
import { DateTime } from 'luxon'
import { IncomingMessage } from 'node:http'
import { Socket } from 'node:net'
import { RequestFactory } from '@adonisjs/core/factories/http'
import env from '#start/env'
import { compileTrustedProxies, isDirectProxyRequest } from '#services/trusted_proxies'
import {
  HEALTH_LIMIT,
  LOCKOUT_MAX_MINUTES,
  loginAccountKey,
  loginAccountLimiter,
  lockoutMinutes,
} from '#start/limiter'
import { SIGNUP_ACCEPTED } from '#controllers/new_account_controller'
import { configureSignup } from '../helpers/signup.js'

const PASSWORD = 'test-only-password-123'
const knex = () => db.connection().getWriteClient()
const makeUser = (label: string) =>
  User.create({
    email: `${label}-${randomUUID()}@example.test`,
    fullName: 'مستخدم الأمان',
    password: PASSWORD,
  })
const makeAdmin = async () => {
  const admin = await makeUser('sec-admin')
  const [role] = await knex()('roles')
    .insert({ name: `sec-admin-${randomUUID()}`, permission_level: 1 })
    .returning('id')
  await knex()('role_rules').insert({ role_id: role.id, subject: 'all', action: 'manage' })
  await knex()('user_roles').insert({ user_id: admin.id, role_id: role.id })
  return admin
}
const mintToken = (user: User, name = 'تكامل') =>
  User.accessTokens.create(user, ['read'], { name, expiresIn: '30 days' })
const tokenCount = async (user: User) => {
  const tokens = await User.accessTokens.all(user)
  return tokens.length
}
const asJson = (request: ApiRequest) => request.withCsrfToken().header('Accept', 'application/json')
const signupForm = (email: string, fullName = 'طلب تسجيل') => ({
  fullName,
  email,
  password: PASSWORD,
  passwordConfirmation: PASSWORD,
})

test.group('Security: self-signup policy and enumeration', (group) => {
  group.each.setup(async () => {
    await limiter.clear(['memory'])
  })

  test('unset SIGNUP_ENABLED closes signup (404) once an administrator exists', async ({
    client,
    assert,
    cleanup,
  }) => {
    cleanup(configureSignup(undefined))
    await makeAdmin()
    assert.isFalse(await signupEnabled())
    const page = await client.get('/signup')
    page.assertStatus(404)
    const email = `closed-${randomUUID()}@example.test`
    const submitted = await client
      .post('/signup')
      .withCsrfToken()
      .redirects(0)
      .form(signupForm(email))
    submitted.assertStatus(404)
    assert.lengthOf(await knex()('users').where({ email }), 0)
    // Guests are not offered a link to the closed form.
    const login = await client.get('/login').withInertia()
    assert.isFalse(login.body().props.signupEnabled)
  })

  test('unset SIGNUP_ENABLED keeps signup open while no administrator exists', async ({
    assert,
  }) => {
    // Inside a rolled-back transaction the application has no administrator.
    const trx = await knex().transaction()
    try {
      await trx('user_roles').delete()
      assert.isTrue(await signupEnabled(trx, undefined))
      assert.isFalse(await signupEnabled(trx, false))
    } finally {
      await trx.rollback()
    }
  })

  test('SIGNUP_ENABLED=true reopens signup and false closes it', async ({
    client,
    assert,
    cleanup,
  }) => {
    await makeAdmin()
    cleanup(configureSignup(true))
    const open = await client.get('/signup').withInertia()
    open.assertStatus(200)
    assert.equal(open.body().component, 'auth/signup')
    const email = `open-${randomUUID()}@example.test`
    const created = await client
      .post('/signup')
      .withCsrfToken()
      .redirects(0)
      .form(signupForm(email))
    created.assertStatus(302)
    assert.lengthOf(await knex()('users').where({ email }), 1)
    configureSignup(false)
    const closed = await client.get('/signup')
    closed.assertStatus(404)
    const refusedEmail = `refused-${randomUUID()}@example.test`
    const refused = await client
      .post('/signup')
      .withCsrfToken()
      .redirects(0)
      .form(signupForm(refusedEmail))
    refused.assertStatus(404)
    assert.lengthOf(await knex()('users').where({ email: refusedEmail }), 0)
  })

  test('registered and invited addresses get the same answer as a new one and nothing changes', async ({
    client,
    assert,
    cleanup,
  }) => {
    cleanup(configureSignup(true))
    const existing = await makeUser('registered')
    const before = await knex()('users').where({ id: existing.id }).first()
    const invitedEmail = `invited-${randomUUID()}@example.test`
    await knex()('user_invitations').insert({
      email: invitedEmail,
      full_name: 'مدعو',
      token_hash: createHash('sha256').update(randomUUID()).digest('hex'),
      expires_at: new Date(Date.now() + 3600_000),
    })
    const outcome = async (email: string, accept: 'html' | 'json') => {
      await limiter.clear(['memory'])
      const request = client.post('/signup').withCsrfToken().redirects(0)
      if (accept === 'json') request.header('Accept', 'application/json')
      const response = await request.form(signupForm(email, 'محاولة استيلاء'))
      response.assertFlashMessage('success', SIGNUP_ACCEPTED)
      return { status: response.status(), location: response.header('location') }
    }
    for (const accept of ['html', 'json'] as const) {
      const fresh = await outcome(`fresh-${randomUUID()}@example.test`, accept)
      assert.deepEqual(fresh, { status: 302, location: '/login' })
      assert.deepEqual(await outcome(existing.email.toUpperCase(), accept), fresh)
      assert.deepEqual(await outcome(invitedEmail, accept), fresh)
    }
    // The registered account keeps its name and password hash; no invited account appears.
    const after = await knex()('users').where({ id: existing.id }).first()
    assert.equal(after.password, before.password)
    assert.equal(after.full_name, before.full_name)
    assert.lengthOf(await knex()('users').where({ email: invitedEmail }), 0)
    assert.lengthOf(await knex()('users').whereRaw('lower(email) = ?', [existing.email]), 1)
  })

  test('closed signup stops OAuth from creating users but still signs in existing ones', async ({
    assert,
    cleanup,
  }) => {
    cleanup(configureSignup(undefined))
    await makeAdmin()
    const allowCreate = await signupEnabled()
    assert.isFalse(allowCreate)
    const unique = randomUUID()
    const unknown = `oauth-closed-${unique}@example.test`
    const refused = await linkOrCreateSocialUser(
      { provider: 'github', providerId: `gh-closed-${unique}`, email: unknown, name: null },
      { allowCreate }
    )
    assert.isTrue(refused.closed)
    assert.lengthOf(await knex()('users').where({ email: unknown }), 0)
    assert.lengthOf(
      await knex()('social_accounts').where({ provider_id: `gh-closed-${unique}` }),
      0
    )

    const existing = await makeUser('oauth-existing')
    existing.emailVerifiedAt = DateTime.now()
    await existing.save()
    const profile = {
      provider: 'google' as const,
      providerId: `gg-closed-${unique}`,
      email: existing.email.toUpperCase(),
      name: null,
    }
    const linked = await linkOrCreateSocialUser(profile, { allowCreate })
    assert.equal(linked.user?.id, existing.id)
    assert.isFalse(linked.created)
    // The established link keeps signing the same user in while signup stays closed.
    const again = await linkOrCreateSocialUser(profile, { allowCreate })
    assert.equal(again.user?.id, existing.id)
    assert.lengthOf(await knex()('social_accounts').where({ user_id: existing.id }), 1)
  })
})

test.group('Security: API tokens end with the credential and access decisions', (group) => {
  group.each.setup(async () => {
    await limiter.clear(['memory'])
  })

  test('password recovery deletes every API token of the user', async ({ client, assert }) => {
    const { mails } = mail.fake()
    try {
      const user = await makeUser('token-reset')
      await mintToken(user)
      await mintToken(user, 'ثانٍ')
      assert.equal(await tokenCount(user), 2)
      await client.post('/password/forgot').withCsrfToken().redirects(0).form({ email: user.email })
      const [sent] = mails.sent(
        (entry) => entry instanceof PasswordResetNotification
      ) as PasswordResetNotification[]
      const token = sent.resetUrl.split('/').pop()!
      const reset = await client
        .post(`/password/reset/${token}`)
        .withCsrfToken()
        .redirects(0)
        .form({ password: 'recovered-password-1', passwordConfirmation: 'recovered-password-1' })
      reset.assertHeader('location', '/login')
      assert.equal(await tokenCount(user), 0)
      const [activity] = await knex()('activities').where({
        resource: 'users',
        record_id: user.id,
        action: 'password_reset',
      })
      assert.equal(activity.changes.tokensRevoked, 2)
    } finally {
      mail.restore()
    }
  })

  test('changing the password deletes API tokens; a wrong current password keeps them', async ({
    client,
    assert,
  }) => {
    const user = await makeUser('token-change')
    const token = await mintToken(user)
    const refused = await client
      .post('/account/password')
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)
      .form({
        currentPassword: 'not-the-password',
        password: 'changed-password-1',
        passwordConfirmation: 'changed-password-1',
      })
    refused.assertStatus(302)
    assert.equal(await tokenCount(user), 1)
    const changed = await client
      .post('/account/password')
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)
      .form({
        currentPassword: PASSWORD,
        password: 'changed-password-1',
        passwordConfirmation: 'changed-password-1',
      })
    changed.assertStatus(302)
    assert.equal(await tokenCount(user), 0)
    // The old bearer token no longer authenticates the API.
    const api = await client
      .get('/api/v1/openapi.json')
      .bearerToken(token.value!.release())
      .header('Accept', 'application/json')
    api.assertStatus(401)
  })

  test('administrative session revocation also deletes the user API tokens', async ({
    client,
    assert,
  }) => {
    const admin = await makeAdmin()
    const user = await makeUser('token-admin-sessions')
    await mintToken(user)
    const response = await asJson(
      client.post(`/admin/users/${user.id}/revoke-sessions`).loginAs(admin)
    )
    response.assertStatus(200)
    assert.equal(response.body().data.tokens, 1)
    assert.equal(await tokenCount(user), 0)
  })

  test('administrators list token metadata and revoke all tokens; members cannot', async ({
    client,
    assert,
  }) => {
    const admin = await makeAdmin()
    const member = await makeUser('token-member')
    const user = await makeUser('token-owner')
    const minted = await mintToken(user, 'تقارير')
    await mintToken(user, 'مزامنة')

    const shown = await client
      .get(`/admin/users/${user.id}`)
      .loginAs(admin)
      .header('Accept', 'application/json')
    shown.assertStatus(200)
    const tokens = shown.body().tokens as Record<string, unknown>[]
    assert.sameMembers(
      tokens.map((token) => token.name),
      ['تقارير', 'مزامنة']
    )
    for (const token of tokens) {
      assert.sameMembers(Object.keys(token), [
        'id',
        'name',
        'access',
        'createdAt',
        'lastUsedAt',
        'expiresAt',
      ])
      assert.isString(token.expiresAt)
    }
    // The secret and its hash never leave the server.
    assert.notInclude(JSON.stringify(shown.body()), minted.value!.release())
    assert.notInclude(JSON.stringify(shown.body()), 'hash')

    const secret = minted.value!.release()
    const api = () =>
      client.get('/api/v1/openapi.json').bearerToken(secret).header('Accept', 'application/json')
    const before = await api()
    before.assertStatus(200)

    const denied = await asJson(
      client.post(`/admin/users/${user.id}/revoke-tokens`).loginAs(member)
    )
    denied.assertStatus(403)
    assert.equal(await tokenCount(user), 2)

    const revoked = await asJson(
      client.post(`/admin/users/${user.id}/revoke-tokens`).loginAs(admin)
    )
    revoked.assertStatus(200)
    assert.equal(revoked.body().data.count, 2)
    assert.equal(await tokenCount(user), 0)
    // The revoked bearer token no longer authenticates the API.
    const after = await api()
    after.assertStatus(401)
    const [activity] = await knex()('activities').where({
      resource: 'core.users',
      record_id: user.id,
      action: 'revoke_tokens',
    })
    assert.equal(activity.actor_id, admin.id)
    assert.equal(activity.changes.count, 2)

    const missing = await asJson(client.post('/admin/users/999999999/revoke-tokens').loginAs(admin))
    missing.assertStatus(404)
  })
})

test.group('Security: login lockout, health throttle and session fixation', (group) => {
  group.each.setup(async () => {
    await limiter.clear(['memory'])
  })

  test('failures from one address lock only that address, with an escalating wait', async ({
    client,
    assert,
  }) => {
    const user = await makeUser('lock-scope')
    const attempt = (ip: string, password: string) =>
      client
        .post('/login')
        .withCsrfToken()
        .redirects(0)
        .header('Accept', 'application/json')
        .header('X-Forwarded-For', ip)
        .form({ email: user.email, password })
    for (let index = 0; index < 5; index++) {
      const failed = await attempt('203.0.113.10', 'wrong-password-1')
      failed.assertStatus(401)
    }
    // The fifth failure locks the (account, address A) pair for one minute and records it.
    const [locked] = await knex()('activities').where({
      resource: 'users',
      record_id: user.id,
      action: 'login_locked',
    })
    assert.equal(locked.changes.minutes, 1)
    assert.equal(locked.changes.lockouts, 1)
    assert.equal(locked.changes.ip, '203.0.113.10')
    assert.isTrue(await loginAccountLimiter.isBlocked(loginAccountKey(user.email, '203.0.113.10')))
    assert.isAbove(
      await loginAccountLimiter.availableIn(loginAccountKey(user.email, '203.0.113.10')),
      0
    )
    // Address B is untouched: the owner signs in normally.
    assert.isFalse(await loginAccountLimiter.isBlocked(loginAccountKey(user.email, '203.0.113.20')))
    const elsewhere = await client
      .post('/login')
      .withCsrfToken()
      .redirects(0)
      .header('X-Forwarded-For', '203.0.113.20')
      .form({ email: user.email, password: PASSWORD })
    elsewhere.assertStatus(302)
    elsewhere.assertHeader('location', '/')

    assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map(lockoutMinutes), [1, 2, 4, 8, 16, 32, 60, 60])
    assert.equal(LOCKOUT_MAX_MINUTES, 60)
  })

  test('the public health probe is throttled per address', async ({ client }) => {
    const probe = (ip: string) => client.get('/health').header('X-Forwarded-For', ip)
    for (let index = 0; index < HEALTH_LIMIT; index++) {
      const allowed = await probe('192.0.2.50')
      if (allowed.status() === 429) throw new Error(`throttled early at ${index}`)
    }
    const limited = await probe('192.0.2.50')
    limited.assertStatus(429)
    const other = await probe('192.0.2.51')
    if (other.status() === 429) throw new Error('another address must not be throttled')
  })

  test('login replaces the pre-login session id (no session fixation)', async ({
    client,
    assert,
  }) => {
    const user = await makeUser('fixation')
    // An attacker plants a session id (with data) in the victim's browser before login.
    const planted = randomUUID()
    const plant = client.get('/login').withSession({ marker: 'planted' })
    plant.sessionClient.sessionId = planted
    const page = await plant
    page.assertStatus(200)
    assert.equal(page.cookie('adonis-session')?.value, planted)
    assert.equal(page.session().marker, 'planted')

    const request = client.post('/login').withCsrfToken().redirects(0)
    request.sessionClient.sessionId = planted
    const login = await request.form({ email: user.email, password: PASSWORD })
    login.assertHeader('location', '/')
    const after = login.cookie('adonis-session')?.value
    assert.isString(after)
    assert.notEqual(after, planted)
    const rows = await knex()('user_sessions').where({ user_id: user.id }).select('id')
    assert.deepEqual(
      rows.map((row) => row.id),
      [after]
    )
    if (env.get('SESSION_DRIVER') === 'database')
      assert.lengthOf(await knex()('sessions').where({ id: planted }), 0)

    // The planted id is not signed in; the new one is.
    const attacker = client.get('/account/profile').redirects(0)
    attacker.sessionClient.sessionId = planted
    const denied = await attacker
    denied.assertStatus(302)
    denied.assertHeader('location', '/login')
    const victim = client.get('/account/profile').withInertia()
    victim.sessionClient.sessionId = after!
    const allowed = await victim
    allowed.assertStatus(200)
  })

  test('a second lockout of the same account and address waits twice as long', async ({
    client,
    assert,
  }) => {
    const user = await makeUser('lock-escalation')
    const ip = '203.0.113.30'
    const key = loginAccountKey(user.email, ip)
    const seedFailures = async (count: number) => {
      for (let index = 0; index < count; index++)
        await loginAccountLimiter
          .penalize(key, async () => {
            throw new Error('wrong password')
          })
          .catch(() => {})
    }
    const failOverHttp = () =>
      client
        .post('/login')
        .withCsrfToken()
        .redirects(0)
        .header('Accept', 'application/json')
        .header('X-Forwarded-For', ip)
        .form({ email: user.email, password: 'wrong-password-1' })
    // Earlier failures are seeded; the exhausting one goes through the controller.
    await seedFailures(4)
    const firstFailure = await failOverHttp()
    firstFailure.assertStatus(401)
    const first = await loginAccountLimiter.availableIn(key)
    assert.isAtMost(first, 60)
    assert.isAbove(first, 0)
    // The first wait elapses (simulated), then the same pair fails again.
    await loginAccountLimiter.delete(key)
    await seedFailures(4)
    const secondFailure = await failOverHttp()
    secondFailure.assertStatus(401)
    const second = await loginAccountLimiter.availableIn(key)
    assert.isAbove(second, 60)
    assert.isAtMost(second, 120)
    const locks = await knex()('activities')
      .where({ resource: 'users', record_id: user.id, action: 'login_locked' })
      .orderBy('id')
    assert.deepEqual(
      locks.map((row) => [row.changes.minutes, row.changes.lockouts]),
      [
        [1, 1],
        [2, 2],
      ]
    )
  })

  test('the proxy probe itself is never throttled; relayed requests are', async ({ client }) => {
    // A loopback peer (trusted by default) sending no X-Forwarded-For is the proxy probe.
    for (let index = 0; index < HEALTH_LIMIT + 5; index++) {
      const probe = await client.get('/health')
      if (probe.status() === 429) throw new Error(`proxy probe throttled at ${index}`)
    }
  })
})

test.group('Security: trusted proxies decide the client address', () => {
  const requestFrom = (trusted: string | undefined, peer: string, forwardedFor?: string) => {
    const req = new IncomingMessage(new Socket())
    Object.defineProperty(req.socket, 'remoteAddress', { value: peer })
    if (forwardedFor) req.headers['x-forwarded-for'] = forwardedFor
    return new RequestFactory()
      .merge({ req, config: { trustProxy: compileTrustedProxies(trusted) } })
      .create()
  }

  test('TRUSTED_PROXIES compiles names, addresses and CIDRs; unset trusts loopback only', ({
    assert,
  }) => {
    const unset = compileTrustedProxies(undefined)
    for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1'])
      assert.isTrue(unset(address, 0), address)
    for (const address of ['172.18.0.3', '10.0.0.2', '203.0.113.1'])
      assert.isFalse(unset(address, 0), address)

    const compose = compileTrustedProxies('loopback, uniquelocal')
    for (const address of ['127.0.0.1', '172.18.0.3', '10.1.2.3', '192.168.1.9', 'fd00::1'])
      assert.isTrue(compose(address, 0), address)
    for (const address of ['203.0.113.1', '172.32.0.1', '2001:db8::1', 'not-an-ip'])
      assert.isFalse(compose(address, 0), address)

    const explicit = compileTrustedProxies('198.51.100.7,2001:db8::/32')
    assert.isTrue(explicit('198.51.100.7', 0))
    assert.isTrue(explicit('2001:db8::5', 0))
    assert.isFalse(explicit('127.0.0.1', 0))
    assert.throws(() => compileTrustedProxies('10.0.0.0/40'), /TRUSTED_PROXIES/)
    assert.throws(() => compileTrustedProxies('everyone'), /TRUSTED_PROXIES/)
  })

  test('a forged X-Forwarded-For from an untrusted peer is ignored; a trusted hop is honoured', ({
    assert,
  }) => {
    const email = 'owner@example.test'
    // Unset (loopback only): a public peer cannot choose its address or lockout bucket.
    const forged = requestFrom(undefined, '203.0.113.66', '198.51.100.1')
    assert.equal(forged.ip(), '203.0.113.66')
    assert.equal(loginAccountKey(email, forged.ip()), `login_account:${email}:203.0.113.66`)
    // Compose: the Caddy container address is trusted, so each client gets its own bucket.
    const viaProxyA = requestFrom('loopback,uniquelocal', '172.18.0.5', '198.51.100.1')
    const viaProxyB = requestFrom('loopback,uniquelocal', '172.18.0.5', '198.51.100.2')
    assert.equal(viaProxyA.ip(), '198.51.100.1')
    assert.equal(viaProxyB.ip(), '198.51.100.2')
    assert.notEqual(loginAccountKey(email, viaProxyA.ip()), loginAccountKey(email, viaProxyB.ip()))
    // Without TRUSTED_PROXIES the same Caddy hop would collapse everyone into one address.
    assert.equal(requestFrom(undefined, '172.18.0.5', '198.51.100.1').ip(), '172.18.0.5')
    // A client prepending a fake address through the proxy gains nothing beyond the last hop.
    assert.equal(
      requestFrom('loopback,uniquelocal', '172.18.0.5', '203.0.113.9, 198.51.100.3').ip(),
      '198.51.100.3'
    )
  })

  test('only a trusted peer without forwarded headers counts as the proxy probe', ({ assert }) => {
    const compose = compileTrustedProxies('loopback,uniquelocal')
    const raw = (peer: string, forwardedFor?: string) =>
      requestFrom(undefined, peer, forwardedFor).request
    assert.isTrue(isDirectProxyRequest(raw('172.18.0.5'), compose))
    assert.isFalse(isDirectProxyRequest(raw('172.18.0.5', '198.51.100.1'), compose))
    assert.isFalse(isDirectProxyRequest(raw('203.0.113.66'), compose))
  })
})
