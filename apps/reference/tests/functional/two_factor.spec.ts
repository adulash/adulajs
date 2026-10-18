import { test } from '@japa/runner'
import { randomUUID } from 'node:crypto'
import type { ApiClient, ApiResponse } from '@japa/api-client'
import type { SessionData } from '@adonisjs/session/types'
import db from '@adonisjs/lucid/services/db'
import limiter from '@adonisjs/limiter/services/main'
import User from '#models/user'
import { PENDING_KEY, credentialFingerprint } from '#services/two_factor'
import { AUTHENTICATED_AT_KEY, REAUTH_WINDOW_MS } from '#services/sign_in'
import {
  TWO_FACTOR_ACCOUNT_LIMIT,
  twoFactorAccountKey,
  twoFactorAccountLimiter,
  twoFactorAttemptKey,
  twoFactorAttemptLimiter,
} from '#start/limiter'
import {
  enrolTwoFactor,
  requireTwoFactorForAdministrators,
  totpCode,
} from '../helpers/two_factor.js'

/**
 * Two-factor authentication over real HTTP and PostgreSQL. A `Browser` keeps one
 * session cookie and its data across requests, so the half-authenticated challenge,
 * session regeneration and revocation behave as in production.
 */

const knex = () => db.connection().getWriteClient()
const PASSWORD = 'two-factor-test-password-123'
const COOKIE = 'adonis-session'
const STEP = 30_000

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete'
type SendOptions = { body?: Record<string, unknown>; html?: boolean; ip?: string }

class Browser {
  id: string = randomUUID()
  values: SessionData = {}
  constructor(private client: ApiClient) {}

  async send(method: Method, url: string, options: SendOptions = {}): Promise<ApiResponse> {
    const request = this.client[method](url)
      .header('Accept', options.html ? 'text/html' : 'application/json')
      .redirects(0)
      .withCsrfToken()
    if (options.ip) request.header('X-Forwarded-For', options.ip)
    request.sessionClient.sessionId = this.id as ReturnType<typeof randomUUID>
    if (Object.keys(this.values).length) request.withSession(this.values)
    if (options.body) request.json(options.body as never)
    const response = await request
    const cookie = response.cookie(COOKIE)
    if (!cookie?.value) return response
    this.id = String(cookie.value)
    const stored: SessionData = response.session() ?? {}
    this.values = Object.fromEntries(
      Object.entries(stored).filter(([key]) => !key.startsWith('__flash'))
    )
    return response
  }

  /** Password step; the response redirects to the challenge when 2FA is enabled. */
  async password(user: User, ip?: string) {
    const response = await this.send('post', '/login', {
      body: { email: user.email, password: PASSWORD },
      ip,
    })
    response.assertStatus(302)
    return response
  }

  code(code: string, ip?: string, html = false) {
    return this.send('post', '/login/two-factor', { body: { code }, ip, html })
  }

  get userId() {
    return this.values.auth_web as number | undefined
  }

  /**
   * A copy of this half-authenticated session for concurrent requests. Each copy gets
   * its own session id only so the test client's per-request CSRF secrets do not
   * overwrite one another; the limits under test are keyed by user and address.
   */
  fork() {
    const twin = new Browser(this.client)
    twin.values = structuredClone(this.values)
    return twin
  }
}

const makeUser = (label: string) =>
  User.create({
    email: `2fa-${label}-${randomUUID()}@example.test`,
    fullName: 'مستخدم التحقق',
    password: PASSWORD,
  })
const makeAdmin = async (label = 'admin') => {
  const admin = await makeUser(label)
  const [role] = await knex()('roles')
    .insert({ name: `2fa-admin-${randomUUID()}`, permission_level: 1 })
    .returning('id')
  await knex()('role_rules').insert({ role_id: role.id, subject: 'all', action: 'manage' })
  await knex()('user_roles').insert({ user_id: admin.id, role_id: role.id })
  return admin
}
const authActivities = (userId: number, action: string) =>
  knex()('activities').where({ resource: 'users', record_id: userId, action }).orderBy('id')
const lastUsedStep = async (userId: number) => {
  const row = await knex()('user_two_factor').where({ user_id: userId }).first()
  return row?.last_used_step ?? null
}
/** Awaits a request and asserts its status. */
async function expectStatus(pending: PromiseLike<ApiResponse>, status: number) {
  const response = await pending
  response.assertStatus(status)
  return response
}
/** A code for the next time step: enrolment already consumed the current one. */
const nextCode = (secret: string, steps = 1) => totpCode(secret, Date.now() + steps * STEP)

test.group('Two-factor: enrolment and self-service', (group) => {
  group.each.setup(async () => {
    await limiter.clear(['memory'])
  })

  test('begin returns the secret once, confirm needs a valid code, begin is refused once enabled', async ({
    client,
    assert,
  }) => {
    const user = await makeUser('enrol')
    const browser = new Browser(client)
    await browser.password(user)
    assert.equal(browser.userId, user.id)

    const begun = await browser.send('post', '/account/two-factor/begin')
    begun.assertStatus(200)
    const enrolment = begun.body().data
    assert.match(enrolment.otpauthUrl, /^otpauth:\/\/totp\//)
    assert.include(enrolment.otpauthUrl, `secret=${enrolment.secret}`)
    assert.equal(enrolment.account, user.email)
    assert.isString(enrolment.issuer)
    assert.isNull(enrolment.qrDataUri)
    // The stored secret is sealed, not the base32 value.
    const row = await knex()('user_two_factor').where({ user_id: user.id }).first()
    assert.notInclude(row.secret, enrolment.secret)
    assert.isNull(row.enabled_at)

    const pendingProfile = await client.get('/account/profile').withInertia().loginAs(user)
    assert.deepEqual(pendingProfile.body().props.twoFactor, {
      enabled: false,
      pending: true,
      recoveryRemaining: 0,
      required: false,
    })

    const wrong = await browser.send('post', '/account/two-factor/confirm', {
      body: { code: '000000' },
    })
    wrong.assertStatus(422)
    assert.equal(wrong.body().error.code, 'E_TWO_FACTOR_CODE')
    const confirmed = await browser.send('post', '/account/two-factor/confirm', {
      body: { code: totpCode(enrolment.secret) },
    })
    confirmed.assertStatus(200)
    const codes: string[] = confirmed.body().data.recoveryCodes
    assert.lengthOf(codes, 10)
    for (const code of codes) assert.match(code, /^[0-9A-Z]{5}(-[0-9A-Z]{5}){3}$/)
    assert.lengthOf(await authActivities(user.id, 'two_factor_enabled'), 1)

    const again = await browser.send('post', '/account/two-factor/begin')
    again.assertStatus(409)
    assert.equal(again.body().error.code, 'E_TWO_FACTOR_ENABLED')

    const profile = await client.get('/account/profile').withInertia().loginAs(user)
    assert.deepEqual(profile.body().props.twoFactor, {
      enabled: true,
      pending: false,
      recoveryRemaining: 10,
      required: false,
    })
    assert.notInclude(JSON.stringify(profile.body().props), enrolment.secret)
  })

  test('regenerating recovery codes needs a current authenticator code', async ({
    client,
    assert,
  }) => {
    const user = await makeUser('regenerate')
    const { secret, recoveryCodes } = await enrolTwoFactor(user.id, user.email)
    const regenerate = (code: string) =>
      client
        .post('/account/two-factor/recovery-codes')
        .withCsrfToken()
        .header('Accept', 'application/json')
        .loginAs(user)
        .json({ code })
    const withRecovery = await regenerate(recoveryCodes[0])
    withRecovery.assertStatus(422)
    assert.equal(withRecovery.body().error.code, 'E_TWO_FACTOR_CODE')
    const fresh = await regenerate(nextCode(secret))
    fresh.assertStatus(200)
    const codes: string[] = fresh.body().data.recoveryCodes
    assert.lengthOf(codes, 10)
    assert.notInclude(codes, recoveryCodes[1])
    assert.lengthOf(await authActivities(user.id, 'two_factor_recovery_regenerated'), 1)
    // The previous set no longer signs in.
    const browser = new Browser(client)
    await browser.password(user)
    const old = await browser.code(recoveryCodes[1])
    old.assertStatus(401)
    const used = await browser.code(codes[0])
    used.assertStatus(200)
  })

  test('disabling needs the password and a current code or a recovery code', async ({
    client,
    assert,
  }) => {
    const user = await makeUser('disable')
    const { recoveryCodes } = await enrolTwoFactor(user.id, user.email)
    const disable = (body: Record<string, unknown>) =>
      client
        .delete('/account/two-factor')
        .withCsrfToken()
        .header('Accept', 'application/json')
        .loginAs(user)
        .json(body)
    const noPassword = await disable({ code: recoveryCodes[0] })
    noPassword.assertStatus(422)
    assert.equal(noPassword.body().error.code, 'E_PASSWORD')
    const wrongPassword = await disable({ password: 'not-the-password', code: recoveryCodes[0] })
    assert.equal(wrongPassword.body().error.code, 'E_PASSWORD')
    const noCode = await disable({ password: PASSWORD, code: '123456' })
    noCode.assertStatus(422)
    assert.equal(noCode.body().error.code, 'E_TWO_FACTOR_CODE')
    assert.lengthOf(await knex()('user_two_factor').where({ user_id: user.id }), 1)

    const disabled = await disable({ password: PASSWORD, code: recoveryCodes[0] })
    disabled.assertStatus(200)
    assert.lengthOf(await knex()('user_two_factor').where({ user_id: user.id }), 0)
    assert.lengthOf(await knex()('user_two_factor_recovery_codes').where({ user_id: user.id }), 0)
    const [logged] = await authActivities(user.id, 'two_factor_disabled')
    assert.equal(logged.changes.secondFactor, 'recovery')
    const twice = await disable({ password: PASSWORD, code: recoveryCodes[1] })
    twice.assertStatus(409)
    // Sign-in no longer asks for a code.
    const browser = new Browser(client)
    const login = await browser.password(user)
    login.assertHeader('location', '/')
    assert.equal(browser.userId, user.id)
  })

  test('an administrator impersonating a user cannot change their two-factor settings', async ({
    client,
    assert,
  }) => {
    const admin = await makeAdmin('impersonator')
    const member = await makeUser('impersonated')
    const { secret } = await enrolTwoFactor(member.id, member.email)
    const browser = new Browser(client)
    await browser.password(admin)
    await expectStatus(browser.send('post', `/admin/users/${member.id}/impersonate`), 200)
    assert.equal(browser.userId, member.id)
    for (const [method, url, body] of [
      ['post', '/account/two-factor/begin', {}],
      ['post', '/account/two-factor/confirm', { code: nextCode(secret) }],
      ['post', '/account/two-factor/recovery-codes', { code: nextCode(secret) }],
      ['delete', '/account/two-factor', { password: PASSWORD, code: nextCode(secret) }],
    ] as const) {
      const response = await browser.send(method, url, { body })
      response.assertStatus(403)
      assert.equal(response.body().error.code, 'E_IMPERSONATING')
    }
    const row = await knex()('user_two_factor').where({ user_id: member.id }).first()
    assert.isNotNull(row.enabled_at)
    assert.lengthOf(
      await knex()('user_two_factor_recovery_codes').where({ user_id: member.id }),
      10
    )
    await expectStatus(browser.send('post', '/impersonation/stop'), 200)
  })
})

test.group('Two-factor: sign-in challenge', (group) => {
  group.each.setup(async () => {
    await limiter.clear(['memory'])
  })

  test('the password alone creates no session user; the code completes the sign-in', async ({
    client,
    assert,
  }) => {
    const user = await makeUser('challenge')
    const { secret } = await enrolTwoFactor(user.id, user.email)
    const browser = new Browser(client)
    const before = browser.id
    const login = await browser.password(user)
    login.assertHeader('location', '/login/two-factor')
    assert.notEqual(browser.id, before, 'the first factor regenerates the session id')
    assert.isUndefined(browser.userId)
    const pending = browser.values[PENDING_KEY] as Record<string, unknown>
    assert.deepInclude(pending, { userId: user.id, method: 'password' })
    assert.isAbove(Number(pending.expiresAt), Date.now())
    assert.lengthOf(await authActivities(user.id, 'login'), 0)
    assert.lengthOf(await knex()('user_sessions').where({ user_id: user.id }), 0)

    // Protected pages still treat the browser as a guest.
    const profile = await browser.send('get', '/account/profile', { html: true })
    profile.assertStatus(302)
    profile.assertHeader('location', '/login')
    const page = await browser.send('get', '/login/two-factor', { html: true })
    page.assertStatus(200)
    const inertia = await client.get('/login/two-factor').withInertia().withSession(browser.values)
    // A fresh client session carries the same pending data: the page gets no secrets.
    assert.equal(inertia.body().component, 'auth/two_factor')
    assert.deepEqual(inertia.body().props.errors ?? {}, {})
    assert.notInclude(JSON.stringify(inertia.body().props), secret)

    const wrong = await browser.code('000000')
    wrong.assertStatus(401)
    assert.isUndefined(browser.userId)
    assert.lengthOf(await authActivities(user.id, 'two_factor_failed'), 1)

    const pendingId = browser.id
    const done = await browser.code(nextCode(secret))
    done.assertStatus(200)
    assert.deepEqual(done.body().data, { signedIn: true, secondFactor: 'totp' })
    assert.equal(browser.userId, user.id)
    assert.notEqual(browser.id, pendingId, 'the second factor regenerates the session id')
    assert.notProperty(browser.values, PENDING_KEY)
    const [logged] = await authActivities(user.id, 'login')
    assert.equal(logged.changes.secondFactor, 'totp')
    const sessions = await knex()('user_sessions').where({ user_id: user.id })
    assert.deepEqual(
      sessions.map((row) => row.id),
      [browser.id]
    )
    await expectStatus(browser.send('get', '/account/profile', { html: true }), 200)
  })

  test('an HTML form gets redirects and an Arabic message', async ({ client, assert }) => {
    const user = await makeUser('challenge-html')
    const { secret } = await enrolTwoFactor(user.id, user.email)
    const browser = new Browser(client)
    await browser.password(user)
    const wrong = await browser.code('111111', undefined, true)
    wrong.assertStatus(302)
    wrong.assertHeader('location', '/login/two-factor')
    assert.deepEqual(wrong.flashMessage('inputErrorsBag'), { code: ['رمز التحقق غير صحيح'] })
    const done = await browser.code(nextCode(secret), undefined, true)
    done.assertStatus(302)
    done.assertHeader('location', '/')
  })

  test('a code is accepted once: the same time step cannot sign in again', async ({
    client,
    assert,
  }) => {
    const user = await makeUser('replay')
    const { secret } = await enrolTwoFactor(user.id, user.email)
    const code = nextCode(secret)
    const first = new Browser(client)
    await first.password(user)
    await expectStatus(first.code(code), 200)
    const step = await lastUsedStep(user.id)
    const second = new Browser(client)
    await second.password(user)
    const replayed = await second.code(code)
    replayed.assertStatus(401)
    assert.isUndefined(second.userId)
    assert.equal(await lastUsedStep(user.id), step)
  })

  test('a recovery code signs in once and is logged with the remaining count', async ({
    client,
    assert,
  }) => {
    const user = await makeUser('recovery')
    const { recoveryCodes } = await enrolTwoFactor(user.id, user.email)
    const first = new Browser(client)
    await first.password(user)
    // Typed in lower case with spaces, as people copy them.
    const used = await first.code(recoveryCodes[3].toLowerCase().replace(/-/g, ' '))
    used.assertStatus(200)
    assert.equal(used.body().data.secondFactor, 'recovery')
    const [recovery] = await authActivities(user.id, 'two_factor_recovery_used')
    assert.equal(recovery.changes.remaining, 9)
    const [login] = await authActivities(user.id, 'login')
    assert.equal(login.changes.secondFactor, 'recovery')

    const second = new Browser(client)
    await second.password(user)
    const again = await second.code(recoveryCodes[3])
    again.assertStatus(401)
    assert.isUndefined(second.userId)
  })

  test('five failures lock the account and address with an escalating wait; a locked attempt never verifies', async ({
    client,
    assert,
  }) => {
    const user = await makeUser('lockout')
    const { secret } = await enrolTwoFactor(user.id, user.email)
    const ip = '203.0.113.70'
    const browser = new Browser(client)
    await browser.password(user, ip)
    for (let index = 0; index < 5; index++) await expectStatus(browser.code('000000', ip), 401)
    const [locked] = await authActivities(user.id, 'two_factor_locked')
    assert.deepInclude(locked.changes, { scope: 'address', minutes: 1, lockouts: 1, ip })
    const key = twoFactorAttemptKey(user.id, ip)
    assert.isTrue(await twoFactorAttemptLimiter.isBlocked(key))
    assert.isAtMost(await twoFactorAttemptLimiter.availableIn(key), 60)

    // The right code is refused while locked and is not consumed.
    const step = await lastUsedStep(user.id)
    const refused = await browser.code(nextCode(secret), ip)
    refused.assertStatus(401)
    assert.include(refused.body().errors[0].message, 'تجاوزت محاولات رمز التحقق')
    assert.isUndefined(browser.userId)
    assert.equal(await lastUsedStep(user.id), step)
    const failures = await authActivities(user.id, 'two_factor_failed')
    const lockedAttempt = failures.at(-1)!
    assert.equal(lockedAttempt.changes.reason, 'locked')

    // The first wait elapses (simulated); five more failures lock for twice as long. Four
    // are seeded so the address stays under the per-minute HTTP throttle; the fifth is HTTP.
    await twoFactorAttemptLimiter.delete(key)
    for (let index = 0; index < 4; index++) await twoFactorAttemptLimiter.increment(key)
    await expectStatus(browser.code('000000', ip), 401)
    const second = await twoFactorAttemptLimiter.availableIn(key)
    assert.isAbove(second, 60)
    assert.isAtMost(second, 120)
    const locks = await authActivities(user.id, 'two_factor_locked')
    assert.deepEqual(
      locks.map((row) => [row.changes.minutes, row.changes.lockouts]),
      [
        [1, 1],
        [2, 2],
      ]
    )

    // Another address is a separate pair; the right code works there.
    const elsewhere = await browser.code(nextCode(secret), '203.0.113.71')
    elsewhere.assertStatus(200)
    assert.equal(browser.userId, user.id)
  })

  test('failures across addresses hit a per-account ceiling', async ({ client, assert }) => {
    const user = await makeUser('ceiling')
    const { secret } = await enrolTwoFactor(user.id, user.email)
    const key = twoFactorAccountKey(user.id)
    // Earlier failures from many addresses are seeded; the exhausting one goes over HTTP.
    for (let index = 1; index < TWO_FACTOR_ACCOUNT_LIMIT; index++)
      await twoFactorAccountLimiter.increment(key)
    const browser = new Browser(client)
    await browser.password(user, '198.51.100.1')
    await expectStatus(browser.code('000000', '198.51.100.2'), 401)
    const locks = await authActivities(user.id, 'two_factor_locked')
    assert.deepEqual(
      locks.map((row) => row.changes.scope),
      ['account']
    )
    assert.isTrue(await twoFactorAccountLimiter.isBlocked(key))
    const refused = await browser.code(nextCode(secret), '198.51.100.3')
    refused.assertStatus(401)
    assert.isUndefined(browser.userId)
  })

  test('an expired or missing challenge returns to the login page', async ({ client, assert }) => {
    const user = await makeUser('expiry')
    const { secret } = await enrolTwoFactor(user.id, user.email)
    const browser = new Browser(client)
    await browser.password(user)
    const pending = browser.values[PENDING_KEY] as Record<string, unknown>
    browser.values[PENDING_KEY] = { ...pending, expiresAt: Date.now() - 1000 }
    const expired = await browser.code(nextCode(secret), undefined, true)
    expired.assertStatus(302)
    expired.assertHeader('location', '/login')
    const bag = expired.flashMessage('inputErrorsBag') as { email: string[] }
    assert.include(bag.email[0], 'انتهت مهلة')
    assert.isUndefined(browser.userId)
    assert.notProperty(browser.values, PENDING_KEY)

    const guest = await new Browser(client).send('get', '/login/two-factor', { html: true })
    guest.assertStatus(302)
    guest.assertHeader('location', '/login')
  })

  test('a user disabled during the challenge is refused', async ({ client, assert }) => {
    const user = await makeUser('disabled')
    const { secret } = await enrolTwoFactor(user.id, user.email)
    const browser = new Browser(client)
    await browser.password(user)
    await knex()('users').where({ id: user.id }).update({ disabled_at: knex().fn.now() })
    const refused = await browser.code(nextCode(secret), undefined, true)
    refused.assertStatus(302)
    refused.assertHeader('location', '/login')
    assert.isUndefined(browser.userId)
  })

  test('an OAuth first factor is logged as oauth_login with the second factor', async ({
    client,
    assert,
  }) => {
    const user = await makeUser('oauth')
    const { secret } = await enrolTwoFactor(user.id, user.email)
    const browser = new Browser(client)
    // The OAuth callback stores the same pending shape through completeSignIn.
    browser.values[PENDING_KEY] = {
      userId: user.id,
      method: 'oauth',
      provider: 'github',
      created: false,
      fingerprint: await credentialFingerprint(user.id),
      expiresAt: Date.now() + 60_000,
    }
    await expectStatus(browser.code(nextCode(secret)), 200)
    const [logged] = await authActivities(user.id, 'oauth_login')
    assert.deepInclude(logged.changes, { provider: 'github', created: false, secondFactor: 'totp' })
  })
})

test.group('Two-factor: administration', (group) => {
  group.each.setup(async () => {
    await limiter.clear(['memory'])
  })

  test('an administrator resets a lost authenticator; sessions and tokens end', async ({
    client,
    assert,
  }) => {
    const admin = await makeAdmin('resetter')
    const member = await makeUser('lost-device')
    const { secret } = await enrolTwoFactor(member.id, member.email)
    const memberBrowser = new Browser(client)
    await memberBrowser.password(member)
    await expectStatus(memberBrowser.code(nextCode(secret)), 200)
    await expectStatus(memberBrowser.send('get', '/account/profile', { html: true }), 200)
    const token = await User.accessTokens.create(member, ['read'], { name: 'تكامل' })
    const api = () =>
      client
        .get('/api/v1/openapi.json')
        .bearerToken(token.value!.release())
        .header('Accept', 'application/json')
    await expectStatus(api(), 200)

    const shown = await client
      .get(`/admin/users/${member.id}`)
      .header('Accept', 'application/json')
      .loginAs(admin)
    shown.assertStatus(200)
    assert.deepInclude(shown.body().twoFactor, { enabled: true, recoveryRemaining: 10 })
    assert.isString(shown.body().twoFactor.enabledAt)
    assert.notInclude(JSON.stringify(shown.body()), secret)

    const reset = await client
      .post(`/admin/users/${member.id}/reset-two-factor`)
      .withCsrfToken()
      .header('Accept', 'application/json')
      .loginAs(admin)
    reset.assertStatus(200)
    assert.deepInclude(reset.body().data, { removed: true, tokens: 1 })
    assert.isAtLeast(reset.body().data.sessions, 1)
    assert.lengthOf(await knex()('user_two_factor').where({ user_id: member.id }), 0)
    assert.lengthOf(await knex()('user_two_factor_recovery_codes').where({ user_id: member.id }), 0)
    const [audit] = await knex()('activities').where({
      resource: 'core.users',
      record_id: member.id,
      action: 'two_factor_reset',
    })
    assert.equal(audit.actor_id, admin.id)
    assert.deepInclude(audit.changes, { removed: true, recoveryCodes: 10, tokens: 1 })
    // The member's browser session and API token no longer work.
    const after = await memberBrowser.send('get', '/account/profile', { html: true })
    after.assertStatus(302)
    await expectStatus(api(), 401)
    // The next sign-in needs only the password.
    const fresh = new Browser(client)
    const freshLogin = await fresh.password(member)
    freshLogin.assertHeader('location', '/')
  })

  test('self-reset is refused, members are forbidden and unknown users are 404', async ({
    client,
    assert,
  }) => {
    const admin = await makeAdmin('self-reset')
    const member = await makeUser('not-admin')
    const reset = (id: number, as: User) =>
      client
        .post(`/admin/users/${id}/reset-two-factor`)
        .withCsrfToken()
        .header('Accept', 'application/json')
        .loginAs(as)
    const self = await reset(admin.id, admin)
    self.assertStatus(409)
    assert.equal(self.body().error.code, 'E_SELF_TWO_FACTOR_RESET')
    await expectStatus(reset(admin.id, member), 403)
    await expectStatus(reset(999999999, admin), 404)
  })

  test('administrators must enrol before using the administration (default: required)', async ({
    client,
    assert,
    cleanup,
  }) => {
    cleanup(await requireTwoFactorForAdministrators(undefined))
    const adminList = (user: User) =>
      client.get('/admin/users').header('Accept', 'application/json').loginAs(user)
    const admin = await makeAdmin('forced')
    const member = await makeUser('forced-member')

    const html = await client.get('/admin/users').redirects(0).loginAs(admin)
    html.assertStatus(302)
    html.assertHeader('location', '/account/profile?enrol=two-factor')
    assert.equal(html.flashMessage('error'), 'فعّل التحقق بخطوتين لحسابك قبل استخدام لوحة الإدارة.')
    const json = await client
      .get('/admin/users')
      .header('Accept', 'application/json')
      .loginAs(admin)
    json.assertStatus(403)
    assert.equal(json.body().error.code, 'E_TWO_FACTOR_REQUIRED')
    const profile = await client.get('/account/profile').withInertia().loginAs(admin)
    assert.deepInclude(profile.body().props.twoFactor, { enabled: false, required: true })
    // Members get the usual refusal, not an enrolment prompt.
    const forbidden = await client
      .get('/admin/users')
      .header('Accept', 'application/json')
      .loginAs(member)
    assert.equal(forbidden.body().error.code, 'E_FORBIDDEN')
    const memberProfile = await client.get('/account/profile').withInertia().loginAs(member)
    assert.isFalse(memberProfile.body().props.twoFactor.required)

    await enrolTwoFactor(admin.id, admin.email)
    await expectStatus(adminList(admin), 200)

    // An explicit true behaves like the default; false switches enforcement off.
    const other = await makeAdmin('forced-other')
    await requireTwoFactorForAdministrators(true)
    await expectStatus(adminList(other), 403)
    await requireTwoFactorForAdministrators(false)
    await expectStatus(adminList(other), 200)
  })

  test('an enrolled administrator impersonating under enforcement can still stop', async ({
    client,
    assert,
    cleanup,
  }) => {
    cleanup(await requireTwoFactorForAdministrators(undefined))
    const admin = await makeAdmin('enforced-impersonator')
    const member = await makeUser('enforced-target')
    const { secret } = await enrolTwoFactor(admin.id, admin.email)
    const browser = new Browser(client)
    await browser.password(admin)
    await expectStatus(browser.code(nextCode(secret)), 200)
    await expectStatus(browser.send('post', `/admin/users/${member.id}/impersonate`), 200)
    assert.equal(browser.userId, member.id)
    // The impersonated member is checked as a member, not prompted to enrol.
    const admin403 = await browser.send('get', '/admin/users')
    assert.equal(admin403.body().error.code, 'E_FORBIDDEN')
    const stopped = await browser.send('post', '/impersonation/stop')
    stopped.assertStatus(200)
    assert.equal(browser.userId, admin.id)
    await expectStatus(browser.send('get', '/admin/users'), 200)
  })
})

test.group('Two-factor: security review fixes', (group) => {
  group.each.setup(async () => {
    await limiter.clear(['memory'])
  })

  test('concurrent wrong codes from many addresses never verify beyond the account ceiling', async ({
    client,
    assert,
  }) => {
    const user = await makeUser('burst')
    const { secret } = await enrolTwoFactor(user.id, user.email)
    const browser = new Browser(client)
    await browser.password(user, '192.0.2.1')
    // Five attempts are left before the account-wide ceiling.
    const key = twoFactorAccountKey(user.id)
    for (let index = 0; index < TWO_FACTOR_ACCOUNT_LIMIT - 5; index++)
      await twoFactorAccountLimiter.increment(key)
    const responses = await Promise.all(
      Array.from({ length: 30 }, (_, index) =>
        browser.fork().code('000000', `192.0.2.${10 + index}`)
      )
    )
    for (const response of responses) response.assertStatus(401)
    const failures = await authActivities(user.id, 'two_factor_failed')
    // Only attempts that reached code verification are logged without a reason.
    assert.lengthOf(
      failures.filter((row) => !row.changes.reason),
      5
    )
    assert.lengthOf(
      failures.filter((row) => row.changes.reason === 'locked'),
      25
    )
    assert.isTrue(await twoFactorAccountLimiter.isBlocked(key))
    const locks = await authActivities(user.id, 'two_factor_locked')
    assert.deepEqual(
      locks.map((row) => row.changes.scope),
      ['account']
    )
    // The right code is refused unchecked once the ceiling is reached.
    const step = await lastUsedStep(user.id)
    const refused = await browser.code(nextCode(secret), '192.0.2.200')
    refused.assertStatus(401)
    assert.include(refused.body().errors[0].message, 'تجاوزت محاولات رمز التحقق')
    assert.equal(await lastUsedStep(user.id), step)
    assert.isUndefined(browser.userId)
  })

  test('concurrent wrong codes from one address verify at most five', async ({
    client,
    assert,
  }) => {
    const user = await makeUser('burst-pair')
    await enrolTwoFactor(user.id, user.email)
    const browser = new Browser(client)
    const ip = '192.0.2.99'
    await browser.password(user, ip)
    // Under the per-minute address throttle (10), all arrive at once.
    const responses = await Promise.all(
      Array.from({ length: 9 }, () => browser.fork().code('000000', ip))
    )
    assert.deepEqual(
      responses.map((response) => response.status()),
      responses.map(() => 401),
      JSON.stringify(responses.map((response) => response.body()))
    )
    const failures = await authActivities(user.id, 'two_factor_failed')
    assert.lengthOf(
      failures.filter((row) => !row.changes.reason),
      5
    )
    assert.isTrue(await twoFactorAttemptLimiter.isBlocked(twoFactorAttemptKey(user.id, ip)))
    // Refusals at a locked address do not use up the account-wide ceiling.
    const account = await twoFactorAccountLimiter.get(twoFactorAccountKey(user.id))
    assert.equal(account?.consumed, 5)
  })

  test('a valid code gives its unit back to the account ceiling and clears the pair', async ({
    client,
    assert,
  }) => {
    const user = await makeUser('giveback')
    const { secret } = await enrolTwoFactor(user.id, user.email)
    const browser = new Browser(client)
    const ip = '192.0.2.50'
    await browser.password(user, ip)
    await expectStatus(browser.code('000000', ip), 401)
    await expectStatus(browser.code(nextCode(secret), ip), 200)
    const account = await twoFactorAccountLimiter.get(twoFactorAccountKey(user.id))
    assert.equal(account?.consumed, 1)
    assert.isNull(await twoFactorAttemptLimiter.get(twoFactorAttemptKey(user.id, ip)))
  })

  test('starting enrolment needs a sign-in within ten minutes or the password', async ({
    client,
    assert,
  }) => {
    const user = await makeUser('reauth')
    const browser = new Browser(client)
    await browser.password(user)
    const marker = browser.values[AUTHENTICATED_AT_KEY] as { userId: number; at: number }
    assert.equal(marker.userId, user.id)
    assert.isAtMost(Date.now() - marker.at, 60_000)
    // Fresh: no password needed.
    await expectStatus(browser.send('post', '/account/two-factor/begin'), 200)

    // Stale (the sign-in was eleven minutes ago): the password is required.
    browser.values[AUTHENTICATED_AT_KEY] = {
      userId: user.id,
      at: Date.now() - REAUTH_WINDOW_MS - 60_000,
    }
    const stale = await browser.send('post', '/account/two-factor/begin')
    stale.assertStatus(403)
    assert.deepEqual(stale.body().error, {
      code: 'E_REAUTH_REQUIRED',
      message: 'أكّد كلمة المرور للمتابعة.',
    })
    const wrong = await browser.send('post', '/account/two-factor/begin', {
      body: { password: 'not-the-password' },
    })
    wrong.assertStatus(422)
    assert.equal(wrong.body().error.code, 'E_PASSWORD')
    assert.lengthOf(await authActivities(user.id, 'password_confirmation_failed'), 1)
    // The right password succeeds and refreshes the session for the next ten minutes.
    await expectStatus(
      browser.send('post', '/account/two-factor/begin', { body: { password: PASSWORD } }),
      200
    )
    await expectStatus(browser.send('post', '/account/two-factor/begin'), 200)

    // A marker for another user, or none at all (sessions from before this rule), is stale.
    // (Another user keeps these under the per-user throttle of five a minute.)
    const other = await makeUser('reauth-other')
    const otherBrowser = new Browser(client)
    await otherBrowser.password(other)
    otherBrowser.values[AUTHENTICATED_AT_KEY] = { userId: user.id, at: Date.now() }
    await expectStatus(otherBrowser.send('post', '/account/two-factor/begin'), 403)
    const legacy = await client
      .post('/account/two-factor/begin')
      .withCsrfToken()
      .header('Accept', 'application/json')
      .loginAs(other)
    legacy.assertStatus(403)
    assert.equal(legacy.body().error.code, 'E_REAUTH_REQUIRED')
  })

  test('self-service code and password failures are logged and share the account ceiling', async ({
    client,
    assert,
  }) => {
    const user = await makeUser('selfservice')
    const { secret } = await enrolTwoFactor(user.id, user.email)
    const send = (method: 'post' | 'delete', url: string, body: Record<string, unknown>) =>
      client[method](url)
        .withCsrfToken()
        .header('Accept', 'application/json')
        .loginAs(user)
        .json(body)
    const key = twoFactorAccountKey(user.id)

    const wrongPassword = await send('delete', '/account/two-factor', {
      password: 'not-the-password',
      code: nextCode(secret),
    })
    assert.equal(wrongPassword.body().error.code, 'E_PASSWORD')
    const [passwordFailure] = await authActivities(user.id, 'password_confirmation_failed')
    assert.equal(passwordFailure.changes.operation, 'disable_two_factor')
    // A wrong password never reaches the code, so nothing is counted yet.
    assert.isNull(await twoFactorAccountLimiter.get(key))

    const wrongCode = await send('delete', '/account/two-factor', {
      password: PASSWORD,
      code: '000000',
    })
    assert.equal(wrongCode.body().error.code, 'E_TWO_FACTOR_CODE')
    const counted = await twoFactorAccountLimiter.get(key)
    assert.equal(counted?.consumed, 1)

    // Earlier failures elsewhere bring the account to the edge; a wrong regenerate locks it.
    for (let index = 1; index < TWO_FACTOR_ACCOUNT_LIMIT - 1; index++)
      await twoFactorAccountLimiter.increment(key)
    const wrongRegenerate = await send('post', '/account/two-factor/recovery-codes', {
      code: '000000',
    })
    assert.equal(wrongRegenerate.body().error.code, 'E_TWO_FACTOR_CODE')
    const failures = await authActivities(user.id, 'two_factor_failed')
    assert.deepEqual(
      failures.map((row) => row.changes.operation),
      ['disable', 'regenerate']
    )
    const [locked] = await authActivities(user.id, 'two_factor_locked')
    assert.equal(locked.changes.scope, 'account')

    // Locked: even the right code is refused unchecked, here and at sign-in.
    const step = await lastUsedStep(user.id)
    const refused = await send('post', '/account/two-factor/recovery-codes', {
      code: nextCode(secret),
    })
    refused.assertStatus(429)
    assert.equal(refused.body().error.code, 'E_TWO_FACTOR_LOCKED')
    assert.equal(await lastUsedStep(user.id), step)
    const browser = new Browser(client)
    await browser.password(user)
    await expectStatus(browser.code(nextCode(secret, 2)), 401)
    assert.isUndefined(browser.userId)
  })

  test('a password change during a pending challenge ends it', async ({ client, assert }) => {
    const user = await makeUser('fingerprint')
    const { secret } = await enrolTwoFactor(user.id, user.email)
    const browser = new Browser(client)
    await browser.password(user)
    const pending = browser.values[PENDING_KEY] as Record<string, unknown>
    assert.isString(pending.fingerprint)

    // The password is reset (by the owner elsewhere or an administrator) before the code.
    user.password = 'a-brand-new-password-456'
    await user.save()
    const step = await lastUsedStep(user.id)
    const refused = await browser.code(nextCode(secret), undefined, true)
    refused.assertStatus(302)
    refused.assertHeader('location', '/login')
    const bag = refused.flashMessage('inputErrorsBag') as { email: string[] }
    assert.include(bag.email[0], 'انتهت مهلة')
    assert.notProperty(browser.values, PENDING_KEY)
    assert.isUndefined(browser.userId)
    assert.equal(await lastUsedStep(user.id), step)
    const failures = await authActivities(user.id, 'two_factor_failed')
    assert.equal(failures.at(-1)!.changes.reason, 'credentials_changed')
    const again = await browser.code(nextCode(secret))
    again.assertStatus(401)
    assert.isUndefined(browser.userId)
  })

  test('a secret the current key cannot open is a handled refusal', async ({ client, assert }) => {
    const user = await makeUser('rotated')
    const { secret } = await enrolTwoFactor(user.id, user.email)
    const browser = new Browser(client)
    await browser.password(user)
    await knex()('user_two_factor')
      .where({ user_id: user.id })
      .update({ secret: 'sealed-under-another-key' })
    const refused = await browser.code(nextCode(secret))
    refused.assertStatus(401)
    assert.include(refused.body().errors[0].message, 'مدير النظام')
    assert.isUndefined(browser.userId)
    const failures = await authActivities(user.id, 'two_factor_failed')
    assert.equal(failures.at(-1)!.changes.reason, 'unreadable_secret')
    // Not counted as a guess.
    const account = await twoFactorAccountLimiter.get(twoFactorAccountKey(user.id))
    assert.equal(account?.consumed ?? 0, 0)
    const profile = await client.get('/account/profile').withInertia().loginAs(user)
    profile.assertStatus(200)
    assert.isTrue(profile.body().props.twoFactor.enabled)
  })
})

test.group('Two-factor: administrator power outside /admin', (group) => {
  group.each.setup(async () => {
    await limiter.clear(['memory'])
  })

  const mcp = (client: ApiClient, user: User) =>
    client
      .post('/mcp')
      .withCsrfToken()
      .loginAs(user)
      .header('Accept', 'application/json')
      .header('MCP-Session-Id', 'two-factor-test')
      .json({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
  const mint = (client: ApiClient, user: User, html = false) =>
    client
      .post('/account/tokens')
      .withCsrfToken()
      .header('Accept', html ? 'text/html' : 'application/json')
      .redirects(0)
      .loginAs(user)
      .json({ name: 'تكامل', access: 'read', expiresInDays: 30 })
  const bearer = (client: ApiClient, secret: string) =>
    client.get('/api/v1/openapi.json').header('Authorization', `Bearer ${secret}`)
  const sessions = (client: ApiClient, user: User) =>
    client.get('/admin/sessions').header('Accept', 'application/json').loginAs(user)

  test('an unenrolled administrator cannot use sessions, tokens, the API or MCP until enrolled', async ({
    client,
    assert,
    cleanup,
  }) => {
    cleanup(await requireTwoFactorForAdministrators(undefined))
    const admin = await makeAdmin('outside')
    const member = await makeUser('outside-member')
    // A token minted before the requirement applied (or before a reset).
    const earlier = await User.accessTokens.create(admin, ['read'], { name: 'قديم' })
    const earlierSecret = earlier.value!.release()

    const list = await sessions(client, admin)
    list.assertStatus(403)
    assert.equal(list.body().error.code, 'E_TWO_FACTOR_REQUIRED')
    const page = await client.get('/admin/sessions').redirects(0).loginAs(admin)
    page.assertStatus(302)
    page.assertHeader('location', '/account/profile?enrol=two-factor')

    const minted = await mint(client, admin)
    minted.assertStatus(403)
    assert.equal(minted.body().error.code, 'E_TWO_FACTOR_REQUIRED')
    const mintPage = await mint(client, admin, true)
    mintPage.assertStatus(302)
    mintPage.assertHeader('location', '/account/profile?enrol=two-factor')
    assert.lengthOf(await knex()('auth_access_tokens').where({ tokenable_id: admin.id }), 1)

    const api = await bearer(client, earlierSecret)
    api.assertStatus(403)
    assert.equal(api.body().error.code, 'E_TWO_FACTOR_REQUIRED')
    const tools = await mcp(client, admin)
    tools.assertStatus(403)
    assert.equal(tools.body().error.code, 'E_TWO_FACTOR_REQUIRED')

    // Members are not administrators: none of this applies to them.
    const memberToken = await mint(client, member)
    memberToken.assertStatus(201)
    await expectStatus(bearer(client, memberToken.body().data.secret), 200)
    await expectStatus(mcp(client, member), 200)

    // Enrolled, the same administrator passes every gate with the same token.
    await enrolTwoFactor(admin.id, admin.email)
    await expectStatus(sessions(client, admin), 200)
    await expectStatus(mint(client, admin), 201)
    await expectStatus(bearer(client, earlierSecret), 200)
    await expectStatus(mcp(client, admin), 200)
  })

  test('with the requirement switched off an unenrolled administrator passes', async ({
    client,
    cleanup,
  }) => {
    cleanup(await requireTwoFactorForAdministrators(false))
    const admin = await makeAdmin('outside-off')
    await expectStatus(sessions(client, admin), 200)
    const minted = await mint(client, admin)
    minted.assertStatus(201)
    await expectStatus(bearer(client, minted.body().data.secret), 200)
    await expectStatus(mcp(client, admin), 200)
  })
})
