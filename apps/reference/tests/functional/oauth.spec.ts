import { test } from '@japa/runner'
import { createHash, randomUUID } from 'node:crypto'
import type { ApiClient, ApiRequest, ApiResponse } from '@japa/api-client'
import type { SessionData } from '@adonisjs/session/types'
import db from '@adonisjs/lucid/services/db'
import limiter from '@adonisjs/limiter/services/main'
import { DateTime } from 'luxon'
import User from '#models/user'
import env from '#start/env'
import {
  LINK_INTENT_KEY,
  OAUTH_EXPIRED,
  OAUTH_LINK_IMPERSONATING,
  OAUTH_PROVIDER_FAILED,
  OAUTH_UNAVAILABLE,
} from '#controllers/oauth_controller'
import { DISABLED_PROVIDERS_KEY } from '#services/social_accounts'
import { PENDING_KEY, TWO_FACTOR_REQUIRED_KEY as TWO_FACTOR_ADMINS_KEY } from '#services/two_factor'
import { AUTHENTICATED_AT_KEY } from '#services/sign_in'
import { configureSignup } from '../helpers/signup.js'
import {
  FakeOauthProvider,
  MICROSOFT_TEST_CLIENT,
  MICROSOFT_TEST_TENANT,
  installFakeProviders,
  unsignedJwt,
  setEnv,
} from '../helpers/fake_ally.js'
import {
  enrolTwoFactor,
  requireTwoFactorForAdministrators,
  totpCode,
} from '../helpers/two_factor.js'

/**
 * OAuth sign-in, linking and administration over real HTTP and PostgreSQL. The
 * provider is a local server (tests/helpers/fake_ally.ts); the application's
 * routes, controller, drivers' state handling and database are the real ones.
 */

const PASSWORD = 'test-only-password-123'
const UNVERIFIED_PROVIDER_EMAIL = 'يتطلب الدخول بريداً إلكترونياً موثقاً لدى المزوّد.'
const knex = () => db.connection().getWriteClient()
const provider = new FakeOauthProvider()
let githubIds = 900_000

type Provider = 'github' | 'microsoft'
type Flow = { location: URL; state: string; cookies: Record<string, string | undefined> }
const COOKIES: Record<Provider, string[]> = {
  github: ['gh_oauth_state'],
  microsoft: ['microsoft_oauth_state', 'microsoft_oauth_nonce', 'microsoft_oauth_code_verifier'],
}

const makeUser = async (label: string, extra: Partial<User> = {}) => {
  const user = await User.create({
    email: `${label}-${randomUUID()}@example.test`,
    fullName: 'مستخدم OAuth',
    password: PASSWORD,
  })
  if (Object.keys(extra).length) {
    user.merge(extra)
    await user.save()
  }
  return user
}
const makeAdmin = async () => {
  const admin = await makeUser('oauth-admin')
  const [role] = await knex()('roles')
    .insert({ name: `oauth-admin-${randomUUID()}`, permission_level: 1 })
    .returning('id')
  await knex()('role_rules').insert({ role_id: role.id, subject: 'all', action: 'manage' })
  await knex()('user_roles').insert({ user_id: admin.id, role_id: role.id })
  return admin
}
const activities = (userId: number, action: string) =>
  knex()('activities').where({ resource: 'users', record_id: userId, action })
const links = (where: Record<string, unknown>) => knex()('social_accounts').where(where)
const expectOk = async (request: PromiseLike<ApiResponse>) => {
  const response = await request
  response.assertStatus(200)
}
const asJson = (request: ApiRequest) => request.withCsrfToken().header('Accept', 'application/json')
/** Session data of a sign-in `ageMs` ago (linking needs one within ten minutes). */
const signedInAgo = (user: User, ageMs = 0): SessionData => ({
  [AUTHENTICATED_AT_KEY]: { userId: user.id, at: Date.now() - ageMs },
})

function capture(response: ApiResponse, name: Provider): Flow {
  response.assertStatus(302)
  const location = new URL(String(response.header('location')))
  return {
    location,
    state: location.searchParams.get('state') ?? '',
    cookies: Object.fromEntries(
      COOKIES[name].map((cookie) => [cookie, response.cookie(cookie)?.value as string | undefined])
    ),
  }
}
const begin = async (client: ApiClient, name: Provider) =>
  capture(await client.get(`/oauth/${name}/redirect`).redirects(0), name)

function callback(
  client: ApiClient,
  name: Provider,
  flow: Flow | null,
  query: Record<string, string>
) {
  const request = client.get(`/oauth/${name}/callback`).qs(query).redirects(0)
  for (const [cookie, value] of Object.entries(flow?.cookies ?? {}))
    if (value !== undefined) request.withEncryptedCookie(cookie, value)
  return request
}

/** Scripts a GitHub identity for a fresh code and runs the full round trip. */
async function githubSignIn(
  client: ApiClient,
  user: { email: string | null; verified?: boolean; id?: number },
  decorate: (request: ApiRequest) => ApiRequest = (request) => request
) {
  const flow = await begin(client, 'github')
  const code = `gh-${randomUUID()}`
  const id = user.id ?? githubIds++
  provider.script(code, {
    github:
      user.verified === false
        ? {
            user: { id, login: `u${id}`, name: 'مستخدم', email: null },
            emails: [{ email: user.email!, verified: false, primary: true }],
          }
        : { user: { id, login: `u${id}`, name: 'مستخدم', email: user.email } },
  })
  const response = await decorate(callback(client, 'github', flow, { code, state: flow.state }))
  return { response, id }
}

test.group('OAuth sign-in over HTTP', (group) => {
  group.setup(async () => {
    await provider.start()
    return () => provider.stop()
  })
  group.each.setup(async () => {
    await limiter.clear(['memory'])
    return installFakeProviders(provider)
  })

  test('with signup open a new verified identity creates a user and signs in', async ({
    assert,
    client,
    cleanup,
  }) => {
    cleanup(configureSignup(true))
    const email = `oauth-new-${randomUUID()}@example.test`
    const { response, id } = await githubSignIn(client, { email })
    response.assertStatus(302)
    response.assertHeader('location', '/')
    const user = await User.findByOrFail('email', email)
    assert.isNotNull(user.emailVerifiedAt)
    assert.lengthOf(
      await links({ provider: 'github', provider_id: String(id), user_id: user.id }),
      1
    )
    const [login] = await activities(user.id, 'oauth_login')
    assert.include(login.changes, { provider: 'github', created: true })
    assert.equal(response.session().auth_web, user.id)
  })

  test('with signup closed an unknown address gets the generic answer and creates nothing', async ({
    assert,
    client,
    cleanup,
  }) => {
    cleanup(configureSignup(false))
    const email = `oauth-closed-${randomUUID()}@example.test`
    const { response, id } = await githubSignIn(client, { email })
    response.assertHeader('location', '/login')
    assert.equal(response.flashMessages().error, OAUTH_UNAVAILABLE)
    assert.lengthOf(await knex()('users').where({ email }), 0)
    assert.lengthOf(await links({ provider_id: String(id) }), 0)
  })

  test('an existing verified account is linked by its verified e-mail', async ({
    assert,
    client,
    cleanup,
  }) => {
    cleanup(configureSignup(false))
    const user = await makeUser('oauth-verified', { emailVerifiedAt: DateTime.now() })
    const { response, id } = await githubSignIn(client, { email: user.email.toUpperCase() })
    response.assertHeader('location', '/')
    assert.equal(response.session().auth_web, user.id)
    assert.lengthOf(
      await links({ provider: 'github', provider_id: String(id), user_id: user.id }),
      1
    )
  })

  test('an unverified provider e-mail is refused', async ({ assert, client, cleanup }) => {
    cleanup(configureSignup(true))
    const email = `oauth-unverified-${randomUUID()}@example.test`
    const { response, id } = await githubSignIn(client, { email, verified: false })
    assert.equal(response.flashMessages().error, UNVERIFIED_PROVIDER_EMAIL)
    assert.lengthOf(await knex()('users').where({ email }), 0)
    assert.lengthOf(await links({ provider_id: String(id) }), 0)
  })

  test('a local account whose e-mail was never proven is not linked (pre-hijack defence)', async ({
    assert,
    client,
    cleanup,
  }) => {
    cleanup(configureSignup(true))
    const user = await makeUser('oauth-prehijack')
    const { response } = await githubSignIn(client, { email: user.email })
    assert.match(String(response.flashMessages().error), /لم يُثبت امتلاكه/)
    assert.isUndefined(response.session().auth_web)
    assert.lengthOf(await links({ user_id: user.id }), 0)
  })

  test('a disabled account is refused and gains no link', async ({ assert, client, cleanup }) => {
    cleanup(configureSignup(true))
    const user = await makeUser('oauth-disabled', {
      emailVerifiedAt: DateTime.now(),
      disabledAt: DateTime.now(),
    })
    const { response } = await githubSignIn(client, { email: user.email })
    assert.equal(response.flashMessages().error, 'هذا الحساب معطّل. تواصل مع مدير النظام.')
    assert.isUndefined(response.session().auth_web)
    assert.lengthOf(await links({ user_id: user.id }), 0)
  })

  test('a user with two-factor enabled is sent to the challenge, not signed in', async ({
    assert,
    client,
    cleanup,
  }) => {
    cleanup(configureSignup(false))
    const user = await makeUser('oauth-2fa', { emailVerifiedAt: DateTime.now() })
    await enrolTwoFactor(user.id, user.email)
    const { response } = await githubSignIn(client, { email: user.email })
    response.assertHeader('location', '/login/two-factor')
    assert.isUndefined(response.session().auth_web)
    assert.include(response.session()[PENDING_KEY], {
      userId: user.id,
      method: 'oauth',
      provider: 'github',
    })
    assert.lengthOf(await activities(user.id, 'oauth_login'), 0)
  })

  test('an automatic e-mail link is logged as social_linked', async ({
    assert,
    client,
    cleanup,
  }) => {
    cleanup(configureSignup(false))
    const user = await makeUser('oauth-auto-log', { emailVerifiedAt: DateTime.now() })
    const { response } = await githubSignIn(client, { email: user.email })
    response.assertHeader('location', '/')
    const [linked] = await activities(user.id, 'social_linked')
    assert.include(linked.changes, { provider: 'github', automatic: true })
    // Signing in again through the existing link creates and logs nothing new.
    const [link] = await links({ user_id: user.id })
    await githubSignIn(client, { email: user.email, id: Number(link.provider_id) })
    assert.lengthOf(await activities(user.id, 'social_linked'), 1)
  })

  test('with two-factor enabled the e-mail link waits until the code passes', async ({
    assert,
    client,
    cleanup,
  }) => {
    cleanup(configureSignup(false))
    const user = await makeUser('oauth-2fa-link', { emailVerifiedAt: DateTime.now() })
    const { secret } = await enrolTwoFactor(user.id, user.email)
    const { response, id } = await githubSignIn(client, { email: user.email })
    response.assertHeader('location', '/login/two-factor')
    // Nothing is linked before the second factor; the pending challenge carries it.
    assert.lengthOf(await links({ user_id: user.id }), 0)
    const values = response.session()
    assert.deepEqual(values[PENDING_KEY].link, { provider: 'github', providerId: String(id) })
    const challenge = (code: string) =>
      asJson(client.post('/login/two-factor')).withSession(values).json({ code })

    const failed = await challenge('000000')
    failed.assertStatus(401)
    assert.lengthOf(await links({ user_id: user.id }), 0)
    assert.lengthOf(await activities(user.id, 'social_linked'), 0)

    const passed = await challenge(totpCode(secret, Date.now() + 30_000))
    passed.assertStatus(200)
    assert.lengthOf(
      await links({ provider: 'github', provider_id: String(id), user_id: user.id }),
      1
    )
    const [linked] = await activities(user.id, 'social_linked')
    assert.include(linked.changes, { provider: 'github', automatic: true })
    const [login] = await activities(user.id, 'oauth_login')
    assert.include(login.changes, { provider: 'github', secondFactor: 'totp' })
  })

  test('a missing or mismatched state is refused before the provider is contacted', async ({
    assert,
    client,
    cleanup,
  }) => {
    cleanup(configureSignup(true))
    const flow = await begin(client, 'github')
    const code = `gh-${randomUUID()}`
    provider.script(code, { github: { user: { id: githubIds++, email: 'x@example.test' } } })
    const before = provider.tokenRequests.length
    const mismatched = await callback(client, 'github', flow, { code, state: 'forged' })
    assert.equal(mismatched.flashMessages().error, OAUTH_EXPIRED)
    // Ally alone accepts a request with neither a state cookie nor a state parameter.
    const stateless = await callback(client, 'github', null, { code })
    assert.equal(stateless.flashMessages().error, OAUTH_EXPIRED)
    const cookieless = await callback(client, 'github', null, { code, state: flow.state })
    assert.equal(cookieless.flashMessages().error, OAUTH_EXPIRED)
    assert.equal(provider.tokenRequests.length, before)
    assert.lengthOf(await knex()('users').where({ email: 'x@example.test' }), 0)
  })

  test('provider error text is logged, never reflected to the user', async ({ assert, client }) => {
    const flow = await begin(client, 'github')
    const injected = '<script>alert(1)</script> اتصل بالرقم 0500000000'
    const error = await callback(client, 'github', flow, { state: flow.state, error: injected })
    const message = String(error.flashMessages().error)
    assert.equal(message, OAUTH_PROVIDER_FAILED)
    assert.notInclude(message, '0500000000')

    const denied = await begin(client, 'github')
    const cancelled = await callback(client, 'github', denied, {
      state: denied.state,
      error: 'access_denied',
    })
    assert.equal(cancelled.flashMessages().error, 'ألغيت العملية قبل منح الإذن.')

    // A failing token exchange answers the same generic message instead of a 500.
    const failing = await begin(client, 'github')
    const code = `gh-${randomUUID()}`
    provider.script(code, { tokenStatus: 401 })
    const exchange = await callback(client, 'github', failing, { code, state: failing.state })
    exchange.assertStatus(302)
    assert.equal(exchange.flashMessages().error, OAUTH_PROVIDER_FAILED)
  })

  test('a provider disabled by an administrator 404s and leaves the login page', async ({
    assert,
    client,
    cleanup,
  }) => {
    const before = await client.get('/login').withInertia()
    assert.includeMembers(
      before.body().props.socialProviders.map((item: { name: string }) => item.name),
      ['github', 'microsoft']
    )
    const flow = await begin(client, 'github')
    await knex()('settings').insert({
      key: DISABLED_PROVIDERS_KEY,
      scope: 'system',
      scope_id: '0',
      value: JSON.stringify(['github']),
    })
    cleanup(async () => {
      await knex()('settings').where({ key: DISABLED_PROVIDERS_KEY }).delete()
    })
    const redirect = await client.get('/oauth/github/redirect').redirects(0)
    redirect.assertStatus(404)
    const back = await callback(client, 'github', flow, { code: 'x', state: flow.state })
    back.assertStatus(404)
    const user = await makeUser('oauth-off')
    const linking = await asJson(
      client.post('/account/connections/github').loginAs(user)
    ).redirects(0)
    linking.assertStatus(404)
    const after = await client.get('/login').withInertia()
    const names = after.body().props.socialProviders.map((item: { name: string }) => item.name)
    assert.notInclude(names, 'github')
    assert.include(names, 'microsoft')
  })
})

test.group('OAuth linking by a signed-in user', (group) => {
  group.setup(async () => {
    await provider.start()
    return () => provider.stop()
  })
  group.each.setup(async () => {
    await limiter.clear(['memory'])
    return installFakeProviders(provider)
  })

  /** POST /account/connections/github, then the callback with the stored intent. */
  async function link(
    client: ApiClient,
    user: User,
    identity: { id: number; email: string | null },
    session: SessionData = {}
  ) {
    const start = await client
      .post('/account/connections/github')
      .withCsrfToken()
      .loginAs(user)
      .withSession({ ...signedInAgo(user), ...session })
      .redirects(0)
    const flow = capture(start, 'github')
    if (!flow.location.href.startsWith(`${provider.base}/github/authorize`))
      throw new Error('The link request did not redirect to the provider')
    const intent = start.session()[LINK_INTENT_KEY]
    const code = `gh-${randomUUID()}`
    provider.script(code, { github: { user: { id: identity.id, email: identity.email } } })
    const response = await callback(client, 'github', flow, { code, state: flow.state })
      .loginAs(user)
      .withSession({ ...session, [LINK_INTENT_KEY]: intent })
    return { response, intent }
  }

  test('links an identity whatever its e-mail, once, and lists it on the profile', async ({
    assert,
    client,
  }) => {
    const user = await makeUser('link-any')
    const id = githubIds++
    const { response, intent } = await link(client, user, {
      id,
      email: `someone-else-${randomUUID()}@example.test`,
    })
    assert.equal(intent.userId, user.id)
    assert.equal(intent.provider, 'github')
    assert.isAbove(intent.expiresAt, Date.now())
    assert.isAtMost(intent.expiresAt, Date.now() + 10 * 60 * 1000)
    response.assertHeader('location', '/account/profile')
    assert.equal(response.flashMessages().success, 'تم ربط حساب GitHub.')
    assert.lengthOf(
      await links({ provider: 'github', provider_id: String(id), user_id: user.id }),
      1
    )
    assert.lengthOf(await activities(user.id, 'social_linked'), 1)

    const profile = await client.get('/account/profile').loginAs(user).withInertia()
    const connections = profile.body().props.connections
    assert.includeMembers(
      connections.available.map((item: { name: string }) => item.name),
      ['github', 'microsoft']
    )
    assert.lengthOf(connections.linked, 1)
    assert.include(connections.linked[0], { provider: 'github', label: 'GitHub' })
    assert.isString(connections.linked[0].linkedAt)
    assert.notProperty(connections.linked[0], 'providerId')
  })

  test('refuses an identity linked to someone else and a second identity of one provider', async ({
    assert,
    client,
  }) => {
    const owner = await makeUser('link-owner')
    const taken = githubIds++
    await knex()('social_accounts').insert({
      provider: 'github',
      provider_id: String(taken),
      user_id: owner.id,
    })
    const user = await makeUser('link-taker')
    const first = await link(client, user, { id: taken, email: null })
    assert.equal(first.response.flashMessages().error, 'حساب GitHub هذا مرتبط بمستخدم آخر.')
    assert.lengthOf(await links({ user_id: user.id }), 0)
    assert.lengthOf(await links({ user_id: owner.id }), 1)
    const [refusal] = await activities(user.id, 'social_link_refused')
    assert.include(refusal.changes, { provider: 'github', reason: 'taken' })

    await knex()('social_accounts').insert({
      provider: 'github',
      provider_id: String(githubIds++),
      user_id: user.id,
    })
    const second = await link(client, user, { id: githubIds++, email: null })
    assert.match(String(second.response.flashMessages().error), /مرتبط مسبقاً بحساب GitHub آخر/)
    assert.lengthOf(await links({ user_id: user.id }), 1)
  })

  test('linking and unlinking are refused while impersonating', async ({ assert, client }) => {
    const admin = await makeAdmin()
    const user = await makeUser('link-impersonated')
    const impersonation = { impersonator_id: { adminId: admin.id, targetId: user.id } }
    const start = await asJson(client.post('/account/connections/github'))
      .loginAs(user)
      .withSession(impersonation)
      .redirects(0)
    start.assertStatus(403)
    assert.isUndefined(start.session()[LINK_INTENT_KEY])

    // An intent planted earlier does not help either.
    const flow = await begin(client, 'github')
    const code = `gh-${randomUUID()}`
    provider.script(code, { github: { user: { id: githubIds++, email: null } } })
    const before = provider.tokenRequests.length
    const response = await callback(client, 'github', flow, { code, state: flow.state })
      .loginAs(user)
      .withSession({
        ...impersonation,
        [LINK_INTENT_KEY]: { userId: user.id, provider: 'github', expiresAt: Date.now() + 60000 },
      })
    assert.equal(response.flashMessages().error, OAUTH_LINK_IMPERSONATING)
    assert.equal(provider.tokenRequests.length, before)
    assert.lengthOf(await links({ user_id: user.id }), 0)

    await knex()('social_accounts').insert({
      provider: 'github',
      provider_id: String(githubIds++),
      user_id: user.id,
    })
    const unlink = await asJson(client.delete('/account/connections/github'))
      .loginAs(user)
      .withSession(impersonation)
    unlink.assertStatus(403)
    assert.lengthOf(await links({ user_id: user.id }), 1)
    const refusals = await activities(user.id, 'social_link_refused')
    assert.lengthOf(refusals, 3)
    assert.isTrue(refusals.every((row) => row.actor_id === admin.id))
  })

  test('a signed-in user without a matching intent is sent home unchanged', async ({
    assert,
    client,
  }) => {
    const user = await makeUser('link-nointent')
    const other = await makeUser('link-other')
    for (const intent of [
      undefined,
      { userId: other.id, provider: 'github', expiresAt: Date.now() + 60000 },
      { userId: user.id, provider: 'microsoft', expiresAt: Date.now() + 60000 },
      { userId: user.id, provider: 'github', expiresAt: Date.now() - 1 },
    ]) {
      const flow = await begin(client, 'github')
      const code = `gh-${randomUUID()}`
      provider.script(code, { github: { user: { id: githubIds++, email: user.email } } })
      const request = callback(client, 'github', flow, { code, state: flow.state }).loginAs(user)
      if (intent) request.withSession({ [LINK_INTENT_KEY]: intent })
      const response = await request
      response.assertHeader('location', '/')
      assert.isUndefined(response.session()[LINK_INTENT_KEY])
    }
    assert.lengthOf(await links({ user_id: user.id }), 0)
  })

  test('linking needs a sign-in within ten minutes or the current password', async ({
    assert,
    client,
  }) => {
    const user = await makeUser('link-reauth')
    const start = (session: SessionData, body: Record<string, unknown> = {}) =>
      client
        .post('/account/connections/github')
        .withCsrfToken()
        .loginAs(user)
        .withSession(session)
        .form(body)
        .redirects(0)
    const refused = (response: ApiResponse, message: string) => {
      response.assertHeader('location', '/account/profile')
      assert.equal(response.flashMessages().error, message)
      assert.isUndefined(response.session()[LINK_INTENT_KEY])
    }
    // A session from before this rule has no sign-in time; one 11 minutes old is stale.
    refused(await start({}), 'أكّد كلمة المرور للمتابعة.')
    const stale = signedInAgo(user, 11 * 60 * 1000)
    refused(await start(stale), 'أكّد كلمة المرور للمتابعة.')
    refused(await start(stale, { password: 'not-the-password' }), 'كلمة المرور غير صحيحة')
    assert.lengthOf(await activities(user.id, 'password_confirmation_failed'), 1)
    // The current password confirms it and refreshes the session.
    const confirmed = await start(stale, { password: PASSWORD })
    assert.isTrue(capture(confirmed, 'github').location.href.startsWith(`${provider.base}/github/`))
    const marker = confirmed.session()[AUTHENTICATED_AT_KEY]
    assert.equal(marker.userId, user.id)
    assert.isAtMost(Date.now() - marker.at, 60_000)
    // A fresh sign-in needs no password.
    const fresh = await start(signedInAgo(user, 9 * 60 * 1000))
    assert.isString(fresh.session()[LINK_INTENT_KEY]?.provider)
  })

  test('unlinking removes the identity and is audited', async ({ assert, client }) => {
    const user = await makeUser('unlink')
    await knex()('social_accounts').insert({
      provider: 'github',
      provider_id: String(githubIds++),
      user_id: user.id,
    })
    const response = await asJson(client.delete('/account/connections/github')).loginAs(user)
    response.assertStatus(200)
    assert.deepEqual(response.body().data, { provider: 'github', removed: true })
    assert.lengthOf(await links({ user_id: user.id }), 0)
    assert.lengthOf(await activities(user.id, 'social_unlinked'), 1)
    const unknown = await asJson(client.delete('/account/connections/unknown')).loginAs(user)
    unknown.assertStatus(404)
    const anonymous = await asJson(client.delete('/account/connections/github'))
    anonymous.assertStatus(401)
  })

  test('the profile page token lets the native link form reach the provider', async ({
    assert,
    client,
  }) => {
    const user = await makeUser('link-form')
    const profile = await client
      .get('/account/profile')
      .loginAs(user)
      .withSession(signedInAgo(user))
      .withInertia()
    const token = profile.body().props.csrfToken
    assert.isString(token)
    assert.isNotEmpty(token)
    // The form leaves the Inertia app, so it carries `_csrf` instead of the XSRF header.
    const submit = (csrf: string) =>
      client
        .post('/account/connections/github')
        .form({ _csrf: csrf, password: '' })
        .loginAs(user)
        .withSession(profile.session())
        .redirects(0)
    const start = await submit(token)
    assert.isTrue(capture(start, 'github').location.href.startsWith(`${provider.base}/github/`))
    const forged = await submit('not-the-token')
    assert.notInclude(String(forged.header('location') ?? ''), provider.base)
    assert.isUndefined(forged.session()[LINK_INTENT_KEY])
  })
})

test.group('Administrator authentication settings', (group) => {
  group.each.setup(async () => {
    await limiter.clear(['memory'])
    // Restores the suites' baseline: no disabled provider, two-factor not required (bootstrap).
    const restoreTwoFactor = await requireTwoFactorForAdministrators(false)
    return async () => {
      await knex()('settings').where({ key: DISABLED_PROVIDERS_KEY }).delete()
      await restoreTwoFactor()
    }
  })

  test('an administrator updates providers and the two-factor rule; a member cannot', async ({
    assert,
    client,
    cleanup,
  }) => {
    const provider2 = new FakeOauthProvider()
    await provider2.start()
    cleanup(() => provider2.stop())
    cleanup(await installFakeProviders(provider2))
    const admin = await makeAdmin()
    const member = await makeUser('auth-settings-member')
    const body = { disabledProviders: ['microsoft'], twoFactorRequiredForAdministrators: false }

    const denied = await asJson(client.put('/admin/settings/authentication').loginAs(member)).json(
      body
    )
    denied.assertStatus(403)
    assert.lengthOf(await knex()('settings').where({ key: DISABLED_PROVIDERS_KEY }), 0)

    const invalid = await asJson(client.put('/admin/settings/authentication').loginAs(admin)).json({
      disabledProviders: ['myspace'],
      twoFactorRequiredForAdministrators: 'yes',
    })
    invalid.assertStatus(422)

    const saved = await asJson(client.put('/admin/settings/authentication').loginAs(admin)).json(
      body
    )
    saved.assertStatus(200)
    assert.isFalse(saved.body().data.twoFactorRequiredForAdministrators)
    const stored = await knex()('settings')
      .where({ scope: 'system' })
      .whereIn('key', [DISABLED_PROVIDERS_KEY, TWO_FACTOR_ADMINS_KEY])
    assert.deepEqual(Object.fromEntries(stored.map((row) => [row.key, row.value])), {
      [DISABLED_PROVIDERS_KEY]: ['microsoft'],
      [TWO_FACTOR_ADMINS_KEY]: false,
    })
    const audit = await knex()('activities').where({
      resource: 'core.settings',
      actor_id: admin.id,
      action: 'upsert',
    })
    assert.sameMembers(
      audit.map((row) => row.changes.key),
      [DISABLED_PROVIDERS_KEY, TWO_FACTOR_ADMINS_KEY]
    )

    const page = await client
      .get('/admin/settings')
      .header('Accept', 'text/html')
      .withInertia()
      .loginAs(admin)
    page.assertStatus(200)
    const authentication = page.body().props.authentication
    assert.isFalse(authentication.twoFactorRequiredForAdministrators)
    assert.deepInclude(authentication.providers, {
      name: 'microsoft',
      label: 'Microsoft',
      configured: true,
      enabled: false,
      disabled: true,
    })
    assert.deepInclude(authentication.providers, {
      name: 'github',
      label: 'GitHub',
      configured: true,
      enabled: true,
      disabled: false,
    })
    const redirect = await client.get('/oauth/microsoft/redirect').redirects(0)
    redirect.assertStatus(404)
  })

  test('a provider disabled while unconfigured stays disabled when the body omits it', async ({
    assert,
    client,
    cleanup,
  }) => {
    const provider2 = new FakeOauthProvider()
    await provider2.start()
    cleanup(() => provider2.stop())
    cleanup(await installFakeProviders(provider2))
    const admin = await makeAdmin()
    const save = (disabledProviders: string[]) =>
      asJson(client.put('/admin/settings/authentication').loginAs(admin)).json({
        disabledProviders,
        twoFactorRequiredForAdministrators: false,
      })
    await expectOk(save(['microsoft']))
    // Microsoft loses its credentials; the screen has no switch for it and omits it.
    const restore = setEnv({ MICROSOFT_CLIENT_SECRET: undefined })
    cleanup(restore)
    const page = await client
      .get('/admin/settings')
      .header('Accept', 'text/html')
      .withInertia()
      .loginAs(admin)
    assert.deepInclude(page.body().props.authentication.providers, {
      name: 'microsoft',
      label: 'Microsoft',
      configured: false,
      enabled: false,
      disabled: true,
    })
    await expectOk(save([]))
    const [stored] = await knex()('settings').where({ key: DISABLED_PROVIDERS_KEY })
    assert.deepEqual(stored.value, ['microsoft'])
    // With credentials back it is still off until an administrator switches it on.
    restore()
    const redirect = await client.get('/oauth/microsoft/redirect').redirects(0)
    redirect.assertStatus(404)
    await expectOk(save([]))
    const [after] = await knex()('settings').where({ key: DISABLED_PROVIDERS_KEY })
    assert.deepEqual(after.value, [])
  })

  test('the two-factor rule defaults to required when unset', async ({ assert, client }) => {
    await requireTwoFactorForAdministrators(undefined)
    const admin = await makeAdmin()
    // An unenrolled administrator would be sent to enrol first.
    await enrolTwoFactor(admin.id, admin.email)
    const page = await client
      .get('/admin/settings')
      .header('Accept', 'text/html')
      .withInertia()
      .loginAs(admin)
    assert.isTrue(page.body().props.authentication.twoFactorRequiredForAdministrators)
  })
})

test.group('Microsoft Entra ID driver', (group) => {
  group.setup(async () => {
    await provider.start()
    return () => provider.stop()
  })
  group.each.setup(async () => {
    await limiter.clear(['memory'])
  })

  const now = () => Math.floor(Date.now() / 1000)
  const claimsFor = (flow: Flow, overrides: Record<string, unknown> = {}) => {
    const tid = (overrides.tid as string | undefined) ?? MICROSOFT_TEST_TENANT
    return {
      iss: `https://login.microsoftonline.com/${tid}/v2.0`,
      aud: MICROSOFT_TEST_CLIENT,
      exp: now() + 600,
      iat: now(),
      nbf: now(),
      nonce: flow.cookies.microsoft_oauth_nonce,
      tid,
      oid: randomUUID(),
      name: 'مستخدم Entra',
      email: `entra-${randomUUID()}@example.test`,
      ...overrides,
    }
  }
  async function signIn(client: ApiClient, overrides: Record<string, unknown> = {}) {
    await limiter.clear(['memory'])
    const flow = await begin(client, 'microsoft')
    const claims = claimsFor(flow, overrides)
    const code = `ms-${randomUUID()}`
    provider.script(code, { idToken: unsignedJwt(claims) })
    const response = await callback(client, 'microsoft', flow, { code, state: flow.state })
    return { flow, claims, response, code }
  }

  test('redirects with state, nonce, PKCE and OpenID scopes, then exchanges the code', async ({
    assert,
    client,
    cleanup,
  }) => {
    cleanup(await installFakeProviders(provider))
    cleanup(configureSignup(true))
    const { flow, claims, response, code } = await signIn(client)
    const params = flow.location.searchParams
    assert.equal(
      `${flow.location.origin}${flow.location.pathname}`,
      `${provider.base}/ms/${MICROSOFT_TEST_TENANT}/oauth2/v2.0/authorize`
    )
    assert.equal(params.get('client_id'), MICROSOFT_TEST_CLIENT)
    assert.equal(params.get('redirect_uri'), `${env.get('APP_URL')}/oauth/microsoft/callback`)
    assert.equal(params.get('scope'), 'openid profile email')
    assert.equal(params.get('response_type'), 'code')
    assert.equal(params.get('response_mode'), 'query')
    assert.equal(params.get('state'), flow.cookies.microsoft_oauth_state)
    assert.isAtLeast(flow.state.length, 32)
    assert.equal(params.get('nonce'), flow.cookies.microsoft_oauth_nonce)
    assert.isAtLeast(String(params.get('nonce')).length, 32)
    assert.equal(params.get('code_challenge_method'), 'S256')
    assert.equal(
      params.get('code_challenge'),
      createHash('sha256').update(flow.cookies.microsoft_oauth_code_verifier!).digest('base64url')
    )

    const exchange = provider.tokenRequests.find((request) => request.form.code === code)!
    assert.equal(exchange.path, `/ms/${MICROSOFT_TEST_TENANT}/oauth2/v2.0/token`)
    assert.include(exchange.form, {
      grant_type: 'authorization_code',
      client_id: MICROSOFT_TEST_CLIENT,
      client_secret: 'ms-test-secret',
      code_verifier: flow.cookies.microsoft_oauth_code_verifier,
      scope: 'openid profile email',
      redirect_uri: `${env.get('APP_URL')}/oauth/microsoft/callback`,
    })

    // A specific tenant that matches: the e-mail counts as verified and the user is created.
    response.assertHeader('location', '/')
    const user = await User.findByOrFail('email', claims.email)
    assert.lengthOf(
      await links({
        provider: 'microsoft',
        provider_id: `${MICROSOFT_TEST_TENANT}:${claims.oid}`,
        user_id: user.id,
      }),
      1
    )
  })

  test('refuses a wrong nonce, audience, issuer, foreign tenant or expired token', async ({
    assert,
    client,
    cleanup,
  }) => {
    cleanup(await installFakeProviders(provider))
    cleanup(configureSignup(true))
    const foreign = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
    const cases: Record<string, unknown>[] = [
      { nonce: 'not-the-nonce' },
      { aud: 'another-application' },
      { iss: 'https://login.microsoftonline.com/common/v2.0' },
      { iss: `https://evil.example.test/${MICROSOFT_TEST_TENANT}/v2.0` },
      { tid: foreign },
      { exp: now() - 3600 },
      { oid: 'not-a-guid' },
    ]
    for (const overrides of cases) {
      const { response, claims } = await signIn(client, overrides)
      assert.equal(response.flashMessages().error, OAUTH_PROVIDER_FAILED, JSON.stringify(overrides))
      assert.lengthOf(await knex()('users').where({ email: claims.email }), 0)
    }
    // Without the nonce cookie the callback is a state mismatch.
    const flow = await begin(client, 'microsoft')
    const code = `ms-${randomUUID()}`
    provider.script(code, { idToken: unsignedJwt(claimsFor(flow)) })
    const response = await callback(
      client,
      'microsoft',
      { ...flow, cookies: { ...flow.cookies, microsoft_oauth_nonce: undefined } },
      { code, state: flow.state }
    )
    assert.equal(response.flashMessages().error, OAUTH_EXPIRED)
  })

  test('in the trusted tenant only members have verified e-mails, not guests', async ({
    assert,
    client,
    cleanup,
  }) => {
    cleanup(await installFakeProviders(provider))
    cleanup(configureSignup(true))
    for (const guest of [
      { idp: 'live.com' },
      { idp: 'https://sts.windows.net/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/' },
      { acct: 1 },
    ]) {
      const { response, claims } = await signIn(client, guest)
      assert.equal(response.flashMessages().error, UNVERIFIED_PROVIDER_EMAIL, JSON.stringify(guest))
      assert.lengthOf(await knex()('users').where({ email: claims.email }), 0)
    }
    for (const member of [
      {},
      { acct: 0 },
      { idp: `https://sts.windows.net/${MICROSOFT_TEST_TENANT}/` },
      { acct: 1, xms_edov: true },
    ]) {
      const { response, claims } = await signIn(client, member)
      response.assertHeader('location', '/')
      assert.lengthOf(
        await knex()('users').where({ email: claims.email }),
        1,
        JSON.stringify(member)
      )
    }
  })

  test('a multi-tenant configuration treats e-mails as unverified unless xms_edov is true', async ({
    assert,
    client,
    cleanup,
  }) => {
    cleanup(await installFakeProviders(provider, { microsoftTenant: 'organizations' }))
    cleanup(configureSignup(true))
    const tid = 'abcdef01-2345-4678-89ab-cdef01234567'
    const unverified = await signIn(client, { tid })
    assert.equal(`${unverified.flow.location.pathname}`, '/ms/organizations/oauth2/v2.0/authorize')
    assert.equal(unverified.response.flashMessages().error, UNVERIFIED_PROVIDER_EMAIL)
    assert.lengthOf(await knex()('users').where({ email: unverified.claims.email }), 0)

    // Personal Microsoft accounts are not "organizations".
    const personal = await signIn(client, { tid: '9188040d-6c67-4c5b-b112-36a304b66dad' })
    assert.equal(personal.response.flashMessages().error, OAUTH_PROVIDER_FAILED)

    const proven = await signIn(client, { tid, xms_edov: true })
    proven.response.assertHeader('location', '/')
    assert.lengthOf(await knex()('users').where({ email: proven.claims.email }), 1)

    // An unverified Entra identity can still be linked explicitly by a signed-in user.
    const user = await makeUser('entra-link')
    await limiter.clear(['memory'])
    const start = await client
      .post('/account/connections/microsoft')
      .withCsrfToken()
      .loginAs(user)
      .withSession(signedInAgo(user))
      .redirects(0)
    const flow = capture(start, 'microsoft')
    const claims = claimsFor(flow, { tid })
    const code = `ms-${randomUUID()}`
    provider.script(code, { idToken: unsignedJwt(claims) })
    const linked = await callback(client, 'microsoft', flow, { code, state: flow.state })
      .loginAs(user)
      .withSession({ [LINK_INTENT_KEY]: start.session()[LINK_INTENT_KEY] })
    linked.assertHeader('location', '/account/profile')
    assert.lengthOf(
      await links({ provider: 'microsoft', provider_id: `${tid}:${claims.oid}`, user_id: user.id }),
      1
    )
  })
})
