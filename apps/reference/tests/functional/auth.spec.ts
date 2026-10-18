import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import { createHash, randomUUID } from 'node:crypto'
import type { ApiRequest } from '@japa/api-client'
import db from '@adonisjs/lucid/services/db'
import mail from '@adonisjs/mail/services/main'
import { SMTPTransport } from '@adonisjs/mail/transports/smtp'
import limiter from '@adonisjs/limiter/services/main'
import env from '#start/env'
import { LOGIN_ADDRESS_LIMIT, loginAccountKey, loginAccountLimiter } from '#start/limiter'
import { SIGNUP_ACCEPTED } from '#controllers/new_account_controller'
import { configureSignup } from '../helpers/signup.js'
import User from '#models/user'
import PasswordResetNotification from '#mails/password_reset_notification'
import { linkOrCreateSocialUser, socialProviders } from '#services/social_accounts'
import { listUserSessions, sessionHandle as h } from '#services/sessions'

const PASSWORD = 'test-only-password-123'
const knex = () => db.connection().getWriteClient()
const makeUser = (label: string) =>
  User.create({
    email: `${label}-${randomUUID()}@example.test`,
    fullName: 'مستخدم المصادقة',
    password: PASSWORD,
  })
const activities = (userId: number, action: string) =>
  knex()('activities').where({ resource: 'users', record_id: userId, action })
/** Pins the request to a known session id so several requests act as one device. */
const from = (id: ReturnType<typeof randomUUID>, request: ApiRequest) => {
  request.sessionClient.sessionId = id
  return request
}

test.group('Authentication lifecycle', (group) => {
  // The in-process limiter store is shared by the suite; each test starts clean.
  group.each.setup(async () => {
    await limiter.clear(['memory'])
    // Earlier suites create administrators; these tests exercise an explicitly open signup.
    return configureSignup(true)
  })

  test('login records the session and activity; a failed login is logged for known users', async ({
    client,
    assert,
  }) => {
    const user = await makeUser('login')
    const failed = await client
      .post('/login')
      .withCsrfToken()
      .redirects(0)
      .form({ email: user.email, password: 'wrong-password-1' })
    failed.assertStatus(302)
    failed.assertHeader('location', '/login')
    assert.lengthOf(await activities(user.id, 'login_failed'), 1)
    assert.lengthOf(await listUserSessions(user.id), 0)

    const ok = await client
      .post('/login')
      .withCsrfToken()
      .redirects(0)
      .form({ email: user.email, password: PASSWORD })
    ok.assertStatus(302)
    ok.assertHeader('location', '/')
    const sessions = await listUserSessions(user.id)
    assert.lengthOf(sessions, 1)
    assert.isString(sessions[0].ip)
    const [login] = await activities(user.id, 'login')
    assert.equal(login.actor_id, user.id)
    assert.equal(login.changes.ip, sessions[0].ip)
  })

  test('logout closes the session row and is logged', async ({ client, assert }) => {
    const user = await makeUser('logout')
    const sessionId = randomUUID()
    const response = await from(
      sessionId,
      client.post('/logout').loginAs(user).withCsrfToken().redirects(0)
    )
    response.assertStatus(302)
    response.assertHeader('location', '/login')
    const row = await knex()('user_sessions').where({ id: sessionId }).first()
    assert.isNotNull(row.revoked_at)
    assert.lengthOf(await activities(user.id, 'logout'), 1)
  })

  test('recovery e-mail carries a single-use token that resets the password and revokes sessions', async ({
    client,
    assert,
  }) => {
    const { mails } = mail.fake()
    try {
      const user = await makeUser('recover')
      const seeded = await from(
        randomUUID(),
        client.get('/account/profile').loginAs(user).withInertia()
      )
      seeded.assertStatus(200)
      assert.lengthOf(await listUserSessions(user.id), 1)

      const request = await client
        .post('/password/forgot')
        .withCsrfToken()
        .redirects(0)
        .form({ email: user.email.toUpperCase() })
      request.assertStatus(302)
      request.assertHeader('location', '/password/forgot')
      mails.assertSentCount(PasswordResetNotification, 1)
      const [sent] = mails.sent(
        (entry) => entry instanceof PasswordResetNotification
      ) as PasswordResetNotification[]
      assert.equal(sent.subject, 'إعادة تعيين كلمة المرور')
      assert.isTrue(sent.resetUrl.startsWith(`${env.get('APP_URL')}/password/reset/`))
      const token = sent.resetUrl.split('/').pop()!
      const stored = await knex()('password_reset_tokens').where({ user_id: user.id }).first()
      assert.equal(stored.token_hash, createHash('sha256').update(token).digest('hex'))
      assert.isNull(stored.used_at)
      assert.closeTo(new Date(stored.expires_at).getTime(), Date.now() + 3600_000, 60_000)
      assert.lengthOf(await activities(user.id, 'password_reset_requested'), 1)

      const page = await client.get(`/password/reset/${token}`).withInertia()
      page.assertStatus(200)
      assert.equal(page.body().component, 'auth/reset')
      assert.isTrue(page.body().props.valid)
      page.assertHeader('referrer-policy', 'no-referrer')
      page.assertHeader('cache-control', 'no-store')
      const beforeReset = await User.findOrFail(user.id)
      assert.isNull(beforeReset.emailVerifiedAt)

      const reset = await client
        .post(`/password/reset/${token}`)
        .withCsrfToken()
        .redirects(0)
        .form({ password: 'new-password-456', passwordConfirmation: 'new-password-456' })
      reset.assertStatus(302)
      reset.assertHeader('location', '/login')
      await user.refresh()
      assert.isTrue(await user.verifyPassword('new-password-456'))
      // Completing mailed recovery proves ownership of the address.
      assert.isNotNull(user.emailVerifiedAt)
      assert.lengthOf(await listUserSessions(user.id), 0)
      assert.lengthOf(await activities(user.id, 'password_reset'), 1)
      assert.lengthOf(await activities(user.id, 'session_revoked'), 1)

      const reused = await client
        .post(`/password/reset/${token}`)
        .withCsrfToken()
        .redirects(0)
        .form({ password: 'another-password-789', passwordConfirmation: 'another-password-789' })
      reused.assertStatus(302)
      reused.assertHeader('location', '/password/forgot')
      await user.refresh()
      assert.isTrue(await user.verifyPassword('new-password-456'))
      const invalidPage = await client.get(`/password/reset/${token}`).withInertia()
      assert.isFalse(invalidPage.body().props.valid)
    } finally {
      mail.restore()
    }
  })

  test('SMTP failure keeps recovery responses generic and revokes the failed token', async ({
    client,
    assert,
  }) => {
    const previous = mail.config.mailers.smtp
    await mail.close('smtp')
    mail.config.mailers.smtp = () => {
      const transport = new SMTPTransport({ host: '127.0.0.1', port: 1025 })
      transport.send = async () => {
        throw new Error('private SMTP credentials')
      }
      return transport
    }
    try {
      const user = await makeUser('smtp-failure')
      const known = await client
        .post('/password/forgot')
        .withCsrfToken()
        .redirects(0)
        .form({ email: user.email })
      const unknown = await client
        .post('/password/forgot')
        .withCsrfToken()
        .redirects(0)
        .form({ email: `unknown-${randomUUID()}@example.test` })
      known.assertStatus(302)
      unknown.assertStatus(302)
      known.assertHeader('location', '/password/forgot')
      unknown.assertHeader('location', '/password/forgot')
      assert.deepEqual(known.body(), unknown.body())
      assert.lengthOf(await knex()('password_reset_tokens').where('user_id', user.id), 0)
      const failures = await activities(user.id, 'password_reset_delivery_failed')
      assert.lengthOf(failures, 1)
      assert.notInclude(JSON.stringify(failures), 'private SMTP')
    } finally {
      await mail.close('smtp')
      mail.config.mailers.smtp = previous
    }
  })

  test('recovery answers identically for unknown e-mails and rejects invalid or expired tokens', async ({
    client,
    assert,
  }) => {
    const { mails } = mail.fake()
    try {
      const unknown = await client
        .post('/password/forgot')
        .withCsrfToken()
        .redirects(0)
        .form({ email: `nobody-${randomUUID()}@example.test` })
      unknown.assertStatus(302)
      unknown.assertHeader('location', '/password/forgot')
      mails.assertNoneSent()

      const user = await makeUser('expired')
      const invalid = await client
        .post(`/password/reset/${'x'.repeat(43)}`)
        .withCsrfToken()
        .redirects(0)
        .form({ password: 'new-password-456', passwordConfirmation: 'new-password-456' })
      invalid.assertStatus(302)
      invalid.assertHeader('location', '/password/forgot')

      const token = randomUUID()
      await knex()('password_reset_tokens').insert({
        user_id: user.id,
        token_hash: createHash('sha256').update(token).digest('hex'),
        expires_at: new Date(Date.now() - 1000),
      })
      const expired = await client
        .post(`/password/reset/${token}`)
        .withCsrfToken()
        .redirects(0)
        .form({ password: 'new-password-456', passwordConfirmation: 'new-password-456' })
      expired.assertStatus(302)
      expired.assertHeader('location', '/password/forgot')
      await user.refresh()
      assert.isTrue(await user.verifyPassword(PASSWORD))
      assert.lengthOf(await activities(user.id, 'password_reset'), 0)
    } finally {
      mail.restore()
    }
  })

  test('a disabled user is refused at login and signed out mid-session', async ({
    client,
    assert,
  }) => {
    const user = await makeUser('disabled')
    const before = await client.get('/account/profile').loginAs(user).withInertia()
    before.assertStatus(200)

    await knex()('users').where({ id: user.id }).update({ disabled_at: knex().fn.now() })
    const after = await client.get('/account/profile').loginAs(user).redirects(0)
    after.assertStatus(302)
    after.assertHeader('location', '/login')
    const json = await client
      .get('/account/profile')
      .loginAs(user)
      .header('Accept', 'application/json')
    json.assertStatus(401)
    // Pages without the auth middleware no longer see the user either.
    const home = await client.get('/').loginAs(user).withInertia()
    assert.isUndefined(home.body().props.user)

    const login = await client
      .post('/login')
      .withCsrfToken()
      .redirects(0)
      .form({ email: user.email, password: PASSWORD })
    login.assertStatus(302)
    login.assertHeader('location', '/login')
    const [refused] = await activities(user.id, 'login_failed')
    assert.equal(refused.changes.reason, 'disabled')
    assert.lengthOf(await activities(user.id, 'login'), 0)
  })

  test('sessions are listed per device; revocation signs the device out immediately', async ({
    client,
    assert,
  }) => {
    const user = await makeUser('sessions')
    const other = await makeUser('sessions-other')
    const [a, b, c, d] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()]
    const device = (id: ReturnType<typeof randomUUID>) =>
      from(id, client.get('/account/sessions').loginAs(user).withInertia())
    const ids = (response: { body(): { props: { sessions: { id: string }[] } } }) =>
      response.body().props.sessions.map((entry) => entry.id)

    const first = await device(a)
    first.assertStatus(200)
    assert.equal(first.body().component, 'account/sessions')
    assert.equal(first.body().props.currentSessionId, h(a))
    assert.deepEqual(ids(first), [h(a)])
    // Pages receive opaque handles, never the live session-store id.
    assert.notInclude(JSON.stringify(first.body().props), a)
    const second = await device(b)
    assert.sameMembers(ids(second), [h(a), h(b)])

    // Revoke B from A.
    const revoked = await from(
      a,
      client
        .delete(`/account/sessions/${h(b)}`)
        .loginAs(user)
        .withCsrfToken()
        .redirects(0)
    )
    revoked.assertStatus(302)
    revoked.assertHeader('location', '/account/sessions')
    const signedOutB = await from(b, client.get('/account/profile').loginAs(user).redirects(0))
    signedOutB.assertStatus(302)
    signedOutB.assertHeader('location', '/login')
    const stillA = await device(a)
    stillA.assertStatus(200)

    // Another user's session cannot be revoked through the account screen.
    const foreign = await from(c, client.get('/account/profile').loginAs(other).withInertia())
    foreign.assertStatus(200)
    const forbidden = await from(
      a,
      client
        .delete(`/account/sessions/${h(c)}`)
        .loginAs(user)
        .withCsrfToken()
        .header('Accept', 'application/json')
    )
    forbidden.assertStatus(404)
    assert.lengthOf(await listUserSessions(other.id), 1)

    // Revoke all others from A, then A itself.
    const fourth = await device(d)
    fourth.assertStatus(200)
    const purged = await from(
      a,
      client.delete('/account/sessions').loginAs(user).withCsrfToken().redirects(0)
    )
    purged.assertStatus(302)
    const remaining = await listUserSessions(user.id)
    assert.deepEqual(
      remaining.map((entry) => entry.id),
      [h(a)]
    )
    const self = await from(
      a,
      client
        .delete(`/account/sessions/${h(a)}`)
        .loginAs(user)
        .withCsrfToken()
        .redirects(0)
    )
    self.assertStatus(302)
    self.assertHeader('location', '/login')
    const gone = await from(a, client.get('/account/profile').loginAs(user).redirects(0))
    gone.assertStatus(302)
    gone.assertHeader('location', '/login')
    assert.lengthOf(await listUserSessions(user.id), 0)
    const revocations = await activities(user.id, 'session_revoked')
    assert.lengthOf(revocations, 3)
    assert.sameDeepMembers(
      revocations.map((row) => row.changes.sessionIds),
      [[h(b)], [h(d)], [h(a)]]
    )
  })

  test('the admin session screen requires manage-all and revokes any user session', async ({
    client,
    assert,
  }) => {
    const admin = await makeUser('admin')
    const member = await makeUser('member')
    const [role] = await knex()('roles')
      .insert({ name: `sessions-admin-${randomUUID()}`, permission_level: 1 })
      .returning('id')
    await knex()('role_rules').insert({ role_id: role.id, subject: 'all', action: 'manage' })
    await knex()('user_roles').insert({ user_id: admin.id, role_id: role.id })

    const denied = await client
      .get('/admin/sessions')
      .loginAs(member)
      .header('Accept', 'application/json')
    denied.assertStatus(403)
    const deniedRevoke = await client
      .delete(`/admin/sessions/${randomUUID()}`)
      .loginAs(member)
      .withCsrfToken()
      .header('Accept', 'application/json')
    deniedRevoke.assertStatus(403)

    const memberSession = randomUUID()
    const seeded = await from(
      memberSession,
      client.get('/account/profile').loginAs(member).withInertia()
    )
    seeded.assertStatus(200)

    const listing = await client.get('/admin/sessions').loginAs(admin).withInertia()
    listing.assertStatus(200)
    assert.equal(listing.body().component, 'admin/sessions/index')
    const rows = listing.body().props.sessions as { id: string; email: string }[]
    const target = rows.find((row) => row.id === h(memberSession))
    assert.exists(target)
    assert.equal(target!.email, member.email)

    const revoke = await client
      .delete(`/admin/sessions/${h(memberSession)}`)
      .loginAs(admin)
      .withCsrfToken()
      .redirects(0)
    revoke.assertStatus(302)
    revoke.assertHeader('location', '/admin/sessions')
    const after = await from(
      memberSession,
      client.get('/account/profile').loginAs(member).redirects(0)
    )
    after.assertStatus(302)
    after.assertHeader('location', '/login')
    const [activity] = await activities(member.id, 'session_revoked')
    assert.equal(activity.actor_id, admin.id)
    assert.deepEqual(activity.changes.sessionIds, [h(memberSession)])
  })

  test('profile updates the name; changing the password verifies the current one and ends other sessions', async ({
    client,
    assert,
  }) => {
    const user = await makeUser('profile')
    const [a, b] = [randomUUID(), randomUUID()]
    for (const id of [a, b]) {
      const page = await from(id, client.get('/account/profile').loginAs(user).withInertia())
      page.assertStatus(200)
      assert.equal(page.body().component, 'account/profile')
    }

    const renamed = await client
      .patch('/account/profile')
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)
      .form({ fullName: 'اسم محدّث' })
    renamed.assertStatus(302)
    renamed.assertHeader('location', '/account/profile')
    await user.refresh()
    assert.equal(user.fullName, 'اسم محدّث')
    const [updated] = await activities(user.id, 'profile_updated')
    assert.deepEqual(updated.changes.fields, ['fullName'])
    assert.equal(updated.changes.previous.fullName, 'مستخدم المصادقة')

    const refused = await from(
      a,
      client.post('/account/password').loginAs(user).withCsrfToken().redirects(0)
    ).form({
      currentPassword: 'not-the-password-1',
      password: 'changed-password-456',
      passwordConfirmation: 'changed-password-456',
    })
    refused.assertStatus(302)
    refused.assertHeader('location', '/account/profile')
    assert.deepEqual(refused.flashMessage('inputErrorsBag'), {
      currentPassword: ['كلمة المرور الحالية غير صحيحة'],
    })
    await user.refresh()
    assert.isTrue(await user.verifyPassword(PASSWORD))

    const changed = await from(
      a,
      client.post('/account/password').loginAs(user).withCsrfToken().redirects(0)
    ).form({
      currentPassword: PASSWORD,
      password: 'changed-password-456',
      passwordConfirmation: 'changed-password-456',
    })
    changed.assertStatus(302)
    await user.refresh()
    assert.isTrue(await user.verifyPassword('changed-password-456'))
    const remaining = await listUserSessions(user.id)
    assert.deepEqual(
      remaining.map((entry) => entry.id),
      [h(a)]
    )
    assert.lengthOf(await activities(user.id, 'password_changed'), 1)
  })

  test('unconfigured or unknown OAuth providers are not found; the login page lists only configured ones', async ({
    client,
    assert,
  }) => {
    const configured = socialProviders().map((provider) => provider.name)
    const login = await client.get('/login').withInertia()
    login.assertStatus(200)
    assert.deepEqual(
      login.body().props.socialProviders.map((provider: { name: string }) => provider.name),
      configured
    )
    const candidates = ['unknown', 'github', 'google'].filter(
      (name) => !configured.includes(name as 'github' | 'google')
    )
    assert.isAtLeast(candidates.length, 1)
    for (const provider of candidates) {
      const redirect = await client.get(`/oauth/${provider}/redirect`).redirects(0)
      redirect.assertStatus(404)
      const callback = await client.get(`/oauth/${provider}/callback?code=x&state=y`).redirects(0)
      callback.assertStatus(404)
    }
  })

  test('an OAuth identity links to the user with the same verified e-mail or creates one, exactly once', async ({
    assert,
  }) => {
    const unique = randomUUID()
    const email = `oauth-${unique}@example.test`
    const created = await linkOrCreateSocialUser({
      provider: 'github',
      providerId: `gh-${unique}`,
      email,
      name: 'مستخدم GitHub',
    })
    assert.isTrue(created.created)
    assert.isFalse(created.linked)
    assert.equal(created.user!.email, email)
    assert.equal(created.user!.fullName, 'مستخدم GitHub')
    assert.isNotNull(created.user!.emailVerifiedAt)
    assert.isFalse(await created.user!.verifyPassword(''))
    assert.lengthOf(await knex()('social_accounts').where({ user_id: created.user!.id }), 1)

    const again = await linkOrCreateSocialUser({
      provider: 'github',
      providerId: `gh-${unique}`,
      email: `changed-${unique}@example.test`,
      name: null,
    })
    assert.isFalse(again.created)
    assert.equal(again.user!.id, created.user!.id)
    assert.lengthOf(await knex()('social_accounts').where({ user_id: created.user!.id }), 1)

    // A self-registered address was never proven: the provider identity is not attached to it.
    const existing = await makeUser('link')
    const refused = await linkOrCreateSocialUser({
      provider: 'google',
      providerId: `gg-${unique}`,
      email: existing.email.toUpperCase(),
      name: null,
    })
    assert.isTrue(refused.unverified)
    assert.lengthOf(await knex()('social_accounts').where({ user_id: existing.id }), 0)

    existing.emailVerifiedAt = DateTime.now()
    await existing.save()
    const linked = await linkOrCreateSocialUser({
      provider: 'google',
      providerId: `gg-${unique}`,
      email: existing.email.toUpperCase(),
      name: null,
    })
    assert.isFalse(linked.created)
    assert.isTrue(linked.linked)
    assert.equal(linked.user!.id, existing.id)
    assert.deepEqual(
      await knex()('social_accounts')
        .where({ user_id: existing.id })
        .select('provider', 'provider_id'),
      [{ provider: 'google', provider_id: `gg-${unique}` }]
    )
    assert.lengthOf(await User.query().where('email', existing.email), 1)
  })

  test('login is limited to five attempts per minute per address and e-mail', async ({
    client,
    assert,
  }) => {
    const email = `limited-${randomUUID()}@example.test`
    const attempt = (address: string) =>
      client
        .post('/login')
        .withCsrfToken()
        .redirects(0)
        .header('Accept', 'application/json')
        .form({ email: address, password: 'wrong-password-1' })
    for (let index = 0; index < 5; index++) {
      const allowed = await attempt(email)
      allowed.assertStatus(401)
    }
    const blocked = await attempt(email)
    blocked.assertStatus(429)
    assert.equal(
      blocked.body().errors[0].message,
      'محاولات كثيرة في وقت قصير. انتظر دقيقة ثم حاول مجدداً.'
    )
    const otherEmail = await attempt(`other-${randomUUID()}@example.test`)
    otherEmail.assertStatus(401)
  })

  test('signup, recovery and OAuth endpoints are limited per address', async ({ client }) => {
    const signup = () =>
      client
        .post('/signup')
        .withCsrfToken()
        .redirects(0)
        .form({
          fullName: 'مستخدم جديد',
          email: `signup-${randomUUID()}@example.test`,
          password: PASSWORD,
          passwordConfirmation: PASSWORD,
        })
    for (let index = 0; index < 3; index++) {
      const created = await signup()
      created.assertStatus(302)
    }
    const signupBlocked = await signup()
    signupBlocked.assertStatus(429)

    const forgot = () =>
      client
        .post('/password/forgot')
        .withCsrfToken()
        .redirects(0)
        .form({ email: `nobody-${randomUUID()}@example.test` })
    for (let index = 0; index < 3; index++) {
      const accepted = await forgot()
      accepted.assertStatus(302)
    }
    const forgotBlocked = await forgot()
    forgotBlocked.assertStatus(429)

    for (let index = 0; index < 10; index++) {
      const missing = await client.get('/oauth/unknown/redirect').redirects(0)
      missing.assertStatus(404)
    }
    const oauthBlocked = await client.get('/oauth/unknown/redirect').redirects(0)
    oauthBlocked.assertStatus(429)
  })

  test('e-mail is a case-insensitive identity for signup, storage and login', async ({
    client,
    assert,
  }) => {
    const local = `Mixed-${randomUUID()}`
    const signup = (email: string) =>
      client
        .post('/signup')
        .withCsrfToken()
        .redirects(0)
        .header('Accept', 'application/json')
        .form({
          fullName: 'حالة الأحرف',
          email,
          password: PASSWORD,
          passwordConfirmation: PASSWORD,
        })
    const created = await signup(`${local}@Example.Test`)
    created.assertStatus(302)
    created.assertHeader('location', '/login')
    const [row] = await knex()('users').whereRaw('lower(email) = ?', [
      `${local}@example.test`.toLowerCase(),
    ])
    assert.equal(row.email, `${local}@example.test`.toLowerCase())
    assert.isNull(row.email_verified_at)

    await limiter.clear(['memory'])
    const duplicate = await signup(`${local.toUpperCase()}@EXAMPLE.TEST`)
    // A taken address gets the same answer as a new one; nothing is created or changed.
    duplicate.assertStatus(302)
    duplicate.assertHeader('location', '/login')
    duplicate.assertFlashMessage('success', SIGNUP_ACCEPTED)
    assert.lengthOf(
      await knex()('users').whereRaw('lower(email) = ?', [`${local}@example.test`.toLowerCase()]),
      1
    )
    // The database refuses a case variant even when application validation is bypassed.
    await assert.rejects(() =>
      knex()('users').insert({
        email: `${local}@example.test`,
        password: 'x',
        created_at: new Date(),
      })
    )

    const login = await client
      .post('/login')
      .withCsrfToken()
      .redirects(0)
      .form({ email: `${local.toUpperCase()}@example.test`, password: PASSWORD })
    login.assertStatus(302)
    login.assertHeader('location', '/')
  })

  test('a pending invitation reserves its address against self-signup', async ({
    client,
    assert,
  }) => {
    const email = `invited-${randomUUID()}@example.test`
    await knex()('user_invitations').insert({
      email,
      full_name: 'مدعو',
      token_hash: createHash('sha256').update(randomUUID()).digest('hex'),
      expires_at: new Date(Date.now() + 3600_000),
    })
    const response = await client
      .post('/signup')
      .withCsrfToken()
      .redirects(0)
      .header('Accept', 'application/json')
      .form({ fullName: 'منتحل', email, password: PASSWORD, passwordConfirmation: PASSWORD })
    // Same answer as a new signup, so the form does not reveal the invitation.
    response.assertStatus(302)
    response.assertHeader('location', '/login')
    response.assertFlashMessage('success', SIGNUP_ACCEPTED)
    assert.lengthOf(await knex()('users').where({ email }), 0)
  })

  test('failed logins lock an account from one address until recovery proves ownership', async ({
    client,
    assert,
  }) => {
    const { mails } = mail.fake()
    try {
      const user = await makeUser('lockout')
      // The app trusts X-Forwarded-For from loopback (AdonisJS default), so tests choose the address.
      const ip = '198.51.100.7'
      // Failures recorded for this client's address (the per-minute limiter would stop it first).
      for (let index = 0; index < 5; index++)
        await loginAccountLimiter
          .penalize(loginAccountKey(user.email, ip), async () => {
            throw new Error('wrong password')
          })
          .catch(() => {})
      const locked = await client
        .post('/login')
        .withCsrfToken()
        .redirects(0)
        .header('Accept', 'application/json')
        .header('X-Forwarded-For', ip)
        .form({ email: user.email, password: PASSWORD })
      locked.assertStatus(401)
      assert.include(locked.body().errors[0].message, 'تجاوزت محاولات الدخول الفاشلة')
      const [refused] = await activities(user.id, 'login_failed')
      assert.equal(refused.changes.reason, 'locked')

      await client.post('/password/forgot').withCsrfToken().redirects(0).form({ email: user.email })
      const [sent] = mails.sent(
        (entry) => entry instanceof PasswordResetNotification
      ) as PasswordResetNotification[]
      const token = sent.resetUrl.split('/').pop()!
      const reset = await client
        .post(`/password/reset/${token}`)
        .withCsrfToken()
        .redirects(0)
        .header('X-Forwarded-For', ip)
        .form({ password: 'recovered-password-1', passwordConfirmation: 'recovered-password-1' })
      reset.assertHeader('location', '/login')
      const unlocked = await client
        .post('/login')
        .withCsrfToken()
        .redirects(0)
        .header('X-Forwarded-For', ip)
        .form({ email: user.email, password: 'recovered-password-1' })
      unlocked.assertHeader('location', '/')
    } finally {
      mail.restore()
    }
  })

  test('one address is limited across e-mails and password changes are limited per user', async ({
    client,
  }) => {
    for (let index = 0; index < LOGIN_ADDRESS_LIMIT; index++) {
      const attempt = await client
        .post('/login')
        .withCsrfToken()
        .header('Accept', 'application/json')
        .form({ email: `spray-${randomUUID()}@example.test`, password: 'wrong-password-1' })
      attempt.assertStatus(401)
    }
    const sprayed = await client
      .post('/login')
      .withCsrfToken()
      .header('Accept', 'application/json')
      .form({ email: `spray-${randomUUID()}@example.test`, password: 'wrong-password-1' })
    sprayed.assertStatus(429)

    const user = await makeUser('change-limit')
    const change = () =>
      client.post('/account/password').loginAs(user).withCsrfToken().redirects(0).form({
        currentPassword: 'not-the-password',
        password: 'changed-password-1',
        passwordConfirmation: 'changed-password-1',
      })
    for (let index = 0; index < 5; index++) {
      const allowed = await change()
      allowed.assertStatus(302)
    }
    const limited = await change()
    limited.assertStatus(429)
  })
})
