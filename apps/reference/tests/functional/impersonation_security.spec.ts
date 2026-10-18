import { test } from '@japa/runner'
import { randomUUID } from 'node:crypto'
import type { ApiClient, ApiResponse } from '@japa/api-client'
import db from '@adonisjs/lucid/services/db'
import limiter from '@adonisjs/limiter/services/main'
import hash from '@adonisjs/core/services/hash'
import type { SessionData } from '@adonisjs/session/types'
import mail from '@adonisjs/mail/services/main'
import { grantUpload } from 'adula'
import User from '#models/user'
import { adula } from '#services/adula'

/**
 * Adversarial checks for administrator impersonation over real HTTP and
 * PostgreSQL. A `Browser` keeps one session cookie across requests (like a
 * real browser) so that session regeneration, logout and revocation behave as
 * in production instead of being re-seeded per request with `loginAs`.
 */

const knex = () => db.connection().getWriteClient()
const password = 'impersonation-test-password-123'
const COOKIE = 'adonis-session'
const IMPERSONATOR_KEY = 'impersonator_id'

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete'
type SendOptions = {
  body?: Record<string, unknown>
  csrf?: boolean
  /** Multipart upload: form fields plus one text file named "file". */
  upload?: { fields: Record<string, string>; content: Buffer; filename: string }
}
type Rule = { subject: string; action: string }

class Browser {
  id: string = randomUUID()
  values: SessionData = {}
  constructor(private client: ApiClient) {}

  /** Sends a request with this browser's cookie, then keeps whatever the server set. */
  async send(method: Method, url: string, options: SendOptions = {}): Promise<ApiResponse> {
    const request = this.client[method](url).header('Accept', 'application/json').redirects(0)
    if (options.csrf !== false) request.withCsrfToken()
    request.sessionClient.sessionId = this.id as ReturnType<typeof randomUUID>
    if (Object.keys(this.values).length) request.withSession(this.values)
    if (options.body) request.json(options.body as never)
    if (options.upload)
      request.fields(options.upload.fields).file('file', options.upload.content, {
        filename: options.upload.filename,
        contentType: 'text/plain',
      })
    const response = await request
    const cookie = response.cookie(COOKIE)
    // Unmatched routes skip the session middleware; a browser then keeps its cookie.
    if (!cookie?.value) return response
    this.id = String(cookie.value)
    const stored: SessionData = response.session() ?? {}
    this.values = Object.fromEntries(
      Object.entries(stored).filter(([key]) => !key.startsWith('__flash'))
    )
    return response
  }

  /** Sends a request and asserts its status. */
  async expect(method: Method, url: string, status: number, options: SendOptions = {}) {
    const response = await this.send(method, url, options)
    response.assertStatus(status)
    return response
  }

  async login(user: User) {
    const response = await this.send('post', '/login', {
      body: { email: user.email, password },
    })
    response.assertStatus(302)
    return response
  }

  get userId() {
    return this.values.auth_web as number | undefined
  }
}

async function makeUser(label: string, rules: Rule[] = [], orgUnitId?: number) {
  const user = await User.create({
    fullName: `انتحال ${label}`,
    email: `imp-${label}-${randomUUID()}@example.test`,
    password,
  })
  if (rules.length) {
    const [role] = await knex()('roles')
      .insert({ name: `imp-${label}-${randomUUID()}`, permission_level: 1 })
      .returning('id')
    await knex()('role_rules').insert(rules.map((rule) => ({ role_id: role.id, ...rule })))
    await knex()('user_roles').insert({
      user_id: user.id,
      role_id: role.id,
      org_unit_id: orgUnitId ?? null,
    })
  }
  return user
}

const ADMIN: Rule[] = [{ subject: 'all', action: 'manage' }]

const activities = (recordId: number, action: string) =>
  knex()('activities').where({ resource: 'core.users', record_id: recordId, action })

test.group('Impersonation security', (group) => {
  let orgUnitId: number

  group.setup(async () => {
    const version = await knex().raw('SHOW server_version_num')
    const number = Number(version.rows[0].server_version_num)
    if (number < 170000 || number >= 180000)
      throw new Error('Impersonation authorization tests require PostgreSQL 17')
    const [org] = await knex()('org_units')
      .insert({ name: 'وحدة الانتحال', type: 'root', path: `imp_${randomUUID().slice(0, 8)}` })
      .returning('id')
    orgUnitId = org.id
  })
  group.each.setup(async () => {
    await limiter.clear(['memory'])
  })

  test('non-administrators, anonymous requests and requests without CSRF cannot impersonate', async ({
    client,
    assert,
  }) => {
    const admin = await makeUser('admin', ADMIN)
    const target = await makeUser('target')
    const candidates = [
      await makeUser('plain'),
      await makeUser('inviter', [{ subject: 'core.users', action: 'invite' }]),
      await makeUser('users-manager', [{ subject: 'core.users', action: 'manage' }]),
      // "manage all" granted only inside one org unit is not deployment administration.
      await makeUser('scoped-admin', ADMIN, orgUnitId),
    ]
    for (const user of candidates) {
      const browser = new Browser(client)
      await browser.login(user)
      const denied = await browser.send('post', `/admin/users/${target.id}/impersonate`)
      denied.assertStatus(403)
      assert.equal(browser.userId, user.id)
      assert.notProperty(browser.values, IMPERSONATOR_KEY)
    }

    const anonymous = await new Browser(client).send(
      'post',
      `/admin/users/${target.id}/impersonate`
    )
    anonymous.assertStatus(401)

    const browser = new Browser(client)
    await browser.login(admin)
    const noCsrf = await browser.send('post', `/admin/users/${target.id}/impersonate`, {
      csrf: false,
    })
    noCsrf.assertStatus(403)
    assert.equal(browser.userId, admin.id)
    assert.notProperty(browser.values, IMPERSONATOR_KEY)
    assert.lengthOf(await activities(target.id, 'impersonate'), 0)
  })

  test('administrators cannot impersonate themselves, administrators, disabled or missing users', async ({
    client,
    assert,
  }) => {
    const admin = await makeUser('admin', ADMIN)
    const otherAdmin = await makeUser('other-admin', ADMIN)
    const disabled = await makeUser('disabled')
    await knex()('users').where('id', disabled.id).update({ disabled_at: knex().fn.now() })
    const browser = new Browser(client)
    await browser.login(admin)

    const cases: [string, number, string][] = [
      [String(admin.id), 422, 'E_SELF_IMPERSONATE'],
      [String(otherAdmin.id), 403, 'E_IMPERSONATE_ADMIN'],
      [String(disabled.id), 422, 'E_USER_DISABLED'],
      ['2147483000', 404, ''],
      ['0', 404, ''],
      ['-1', 404, ''],
      ['abc', 404, ''],
    ]
    for (const [id, status, code] of cases) {
      const response = await browser.send('post', `/admin/users/${id}/impersonate`)
      response.assertStatus(status)
      if (code) assert.equal(response.body().error.code, code)
      assert.equal(browser.userId, admin.id, `still the administrator after ${id}`)
      assert.notProperty(browser.values, IMPERSONATOR_KEY)
    }
    for (const id of [admin.id, otherAdmin.id, disabled.id])
      assert.lengthOf(await activities(id, 'impersonate'), 0)

    // Defence in depth: a session that already carries an impersonator is refused.
    const target = await makeUser('target')
    const nested = await client
      .post(`/admin/users/${target.id}/impersonate`)
      .loginAs(admin)
      .withSession({ [IMPERSONATOR_KEY]: { adminId: otherAdmin.id, targetId: admin.id } })
      .withCsrfToken()
      .header('Accept', 'application/json')
    nested.assertStatus(422)
    assert.equal(nested.body().error.code, 'E_ALREADY_IMPERSONATING')
  })

  test('start and stop regenerate the session id and are audited with the real administrator', async ({
    client,
    assert,
  }) => {
    const admin = await makeUser('admin', ADMIN)
    const target = await makeUser('target')
    const browser = new Browser(client)
    await browser.login(admin)

    const beforeStart = browser.id
    const started = await browser.send('post', `/admin/users/${target.id}/impersonate`)
    started.assertStatus(200)
    assert.equal(browser.userId, target.id)
    assert.deepEqual(browser.values[IMPERSONATOR_KEY], { adminId: admin.id, targetId: target.id })
    assert.notEqual(browser.id, beforeStart, 'session id regenerated on start')

    const shell = await browser.send('get', '/notifications?limit=1')
    shell.assertStatus(200)

    const beforeStop = browser.id
    const stopped = await browser.send('post', '/impersonation/stop')
    stopped.assertStatus(200)
    assert.equal(stopped.body().data.id, admin.id)
    assert.equal(browser.userId, admin.id)
    assert.notProperty(browser.values, IMPERSONATOR_KEY)
    assert.notEqual(browser.id, beforeStop, 'session id regenerated on stop')

    const [start] = await activities(target.id, 'impersonate')
    assert.equal(start.actor_id, admin.id)
    const [stop] = await activities(target.id, 'stop_impersonation')
    assert.equal(stop.actor_id, admin.id)

    // Stopping twice, stopping without impersonation and anonymous stop are refused.
    const again = await browser.send('post', '/impersonation/stop')
    again.assertStatus(422)
    assert.equal(again.body().error.code, 'E_NOT_IMPERSONATING')
    assert.equal(browser.userId, admin.id)
    const anonymous = await new Browser(client).send('post', '/impersonation/stop')
    anonymous.assertStatus(401)
    const noCsrf = await client
      .post('/impersonation/stop')
      .loginAs(target)
      .withSession({ [IMPERSONATOR_KEY]: { adminId: admin.id, targetId: target.id } })
      .header('Accept', 'application/json')
    noCsrf.assertStatus(403)
  })

  test('superseded session rows are closed when impersonation starts and stops', async ({
    client,
    assert,
  }) => {
    const admin = await makeUser('admin', ADMIN)
    const target = await makeUser('target')
    const browser = new Browser(client)
    await browser.login(admin)
    const adminSession = browser.id
    await browser.send('post', `/admin/users/${target.id}/impersonate`)
    await browser.send('get', '/notifications?limit=1')
    const impersonationSession = browser.id
    await browser.send('post', '/impersonation/stop')
    await browser.send('get', '/notifications?limit=1')

    // Only the session the browser still holds may remain listed as live.
    const live = await knex()('user_sessions')
      .whereIn('id', [adminSession, impersonationSession, browser.id])
      .whereNull('revoked_at')
      .select('id', 'user_id')
    assert.deepEqual(
      live.map((row) => row.id),
      [browser.id],
      'orphaned administrator and impersonation sessions stay listed as live'
    )
  })

  test('the impersonated session has only the target rights and cannot escalate or nest', async ({
    client,
    assert,
  }) => {
    const admin = await makeUser('admin', ADMIN)
    const target = await makeUser('target', [{ subject: 'customers', action: 'manage' }])
    const third = await makeUser('third')
    const [adminRole] = await knex()('user_roles').where('user_id', admin.id).select('role_id')
    const browser = new Browser(client)
    await browser.login(admin)
    await browser.expect('post', `/admin/users/${target.id}/impersonate`, 200)

    for (const [method, url, body] of [
      ['get', '/admin/users', undefined],
      ['get', `/admin/users/${third.id}`, undefined],
      ['post', `/admin/users/${target.id}/roles`, { roleId: adminRole.role_id }],
      ['post', `/admin/users/${third.id}/impersonate`, undefined],
      ['post', `/admin/users/${admin.id}/disable`, undefined],
      ['put', '/admin/settings', { key: 'ui.theme', scope: 'system', value: '{}' }],
      ['post', '/admin/roles', { name: `escalate-${randomUUID()}` }],
    ] as const) {
      const response = await browser.send(method, url, { body })
      response.assertStatus(403)
    }
    // The cross-user session screen checks "manage all" in its controller.
    await browser.expect('get', '/admin/sessions', 403)
    assert.lengthOf(
      await knex()('user_roles').where({ user_id: target.id, role_id: adminRole.role_id }),
      0
    )
    assert.lengthOf(await activities(third.id, 'impersonate'), 0)
    assert.equal(browser.userId, target.id)
    assert.deepEqual(browser.values[IMPERSONATOR_KEY], { adminId: admin.id, targetId: target.id })

    // A personal API token would outlive the session, so none can be minted as the target.
    const mint = await browser.send('post', '/account/tokens', {
      body: { name: 'leftover', access: 'write', expiresInDays: 365 },
    })
    mint.assertStatus(403)
    assert.equal(mint.body().error.code, 'E_IMPERSONATING')
    assert.lengthOf(await knex()('auth_access_tokens').where('tokenable_id', target.id), 0)

    // The password cannot be changed without the target's current password.
    const targetRow = () => knex()('users').where('id', target.id).first()
    const { password: before } = await targetRow()
    const changed = await browser.send('post', '/account/password', {
      body: {
        currentPassword: 'not-the-real-password-123',
        password: 'taken-over-password-123',
        passwordConfirmation: 'taken-over-password-123',
      },
    })
    assert.oneOf(changed.status(), [302, 422])
    const after = await targetRow()
    assert.equal(after.password, before)
    assert.isFalse(await hash.verify(after.password, 'taken-over-password-123'))

    // The e-mail address is not editable through the profile.
    const emailBefore = after.email
    await browser.send('patch', '/account/profile', {
      body: { fullName: 'اسم جديد', email: `taken-${randomUUID()}@example.test` },
    })
    const { email: emailAfter } = await targetRow()
    assert.equal(emailAfter, emailBefore)
  })

  test('resource writes while impersonating name the target and the administrator', async ({
    client,
    assert,
  }) => {
    const admin = await makeUser('admin', ADMIN)
    const target = await makeUser('target', [{ subject: 'customers', action: 'manage' }])
    const browser = new Browser(client)
    await browser.login(admin)
    await browser.expect('post', `/admin/users/${target.id}/impersonate`, 200)
    const created = await browser.send('post', '/resources/customers', {
      body: { name: `عميل الانتحال ${randomUUID()}` },
    })
    created.assertStatus(201)
    const [activity] = await knex()('activities').where({
      resource: 'customers',
      record_id: created.body().data.id,
      action: 'create',
    })
    assert.equal(activity.actor_id, target.id)
    assert.equal(activity.changes.impersonatedBy, admin.id)
    const [event] = await knex()('outbox')
      .whereRaw(`payload->>'resource' = 'customers'`)
      .whereRaw(`(payload->>'id')::int = ?`, [created.body().data.id])
    assert.equal(event.payload.impersonatorId, admin.id)
  })

  test('uploads, saved views and invitations while impersonating record the administrator', async ({
    client,
    assert,
  }) => {
    const admin = await makeUser('admin', ADMIN)
    const target = await makeUser('target', [
      { subject: 'orders', action: 'manage' },
      { subject: 'core.users', action: 'invite' },
    ])
    await knex()('user_org_units').insert({ user_id: target.id, org_unit_id: orgUnitId })
    const browser = new Browser(client)
    await browser.login(admin)
    await browser.expect('post', `/admin/users/${target.id}/impersonate`, 200)
    const content = Buffer.from(`ملف الانتحال ${randomUUID()}`)

    const plain = await browser.expect('post', '/attachments', 201, {
      upload: { fields: { resource: 'orders', field: 'contract' }, content, filename: 'عقد.txt' },
    })
    const stored = await knex()('attachments').where('id', plain.body().data.id).first()
    assert.equal(stored.uploaded_by, target.id)
    assert.equal(stored.data.impersonatedBy, admin.id)

    const order = await browser.expect('post', '/resources/orders', 201, {
      body: { orgUnitId, notes: `طلب الانتحال ${randomUUID()}` },
    })
    const orderId = order.body().data.id as number
    const grant = await grantUpload(knex(), adula().registry, {
      resource: 'orders',
      recordId: orderId,
      field: 'contract',
      userId: target.id,
      actorId: admin.id,
    })
    await browser.expect('post', '/attachments', 201, {
      upload: { fields: { grant: grant.token }, content, filename: 'دليل.txt' },
    })
    const [granted] = await knex()('activities').where({
      resource: 'orders',
      record_id: orderId,
      action: 'upload_via_grant',
    })
    assert.equal(granted.actor_id, target.id)
    assert.equal(granted.changes.impersonatedBy, admin.id)

    const view = await browser.expect('post', '/resources/orders/views', 200, {
      body: { name: `عرض ${randomUUID().slice(0, 8)}`, query: {} },
    })
    const viewId = view.body().data.id as number
    await browser.expect('delete', `/resources/orders/views/${viewId}`, 200)
    const views = await knex()('activities')
      .where({ resource: 'core.saved_views', record_id: viewId })
      .orderBy('id')
    assert.deepEqual(
      views.map((row) => row.action),
      ['saved_view_saved', 'saved_view_removed']
    )
    for (const row of views) {
      assert.equal(row.actor_id, target.id)
      assert.equal(row.changes.impersonatedBy, admin.id)
    }

    const { mails } = mail.fake()
    try {
      const invited = await browser.expect('post', '/users/invite', 200, {
        body: { fullName: 'مدعو الانتحال', email: `imp-invite-${randomUUID()}@example.test` },
      })
      mails.assertSentCount(1)
      const entries = await knex()('activities')
        .where({ resource: 'core.user_invitations', record_id: invited.body().data.id })
        .whereIn('action', ['invitation_created', 'invitation_sent'])
      assert.lengthOf(entries, 2)
      for (const row of entries) {
        assert.equal(row.actor_id, target.id)
        assert.equal(row.changes.impersonatedBy, admin.id)
      }
    } finally {
      mail.restore()
    }
  })

  test('self-service account changes while impersonating record the administrator', async ({
    client,
    assert,
  }) => {
    const admin = await makeUser('admin', ADMIN)
    const target = await makeUser('target')
    const own = new Browser(client)
    await own.login(target)
    const browser = new Browser(client)
    await browser.login(admin)
    await browser.expect('post', `/admin/users/${target.id}/impersonate`, 200)

    const profile = await browser.send('patch', '/account/profile', {
      body: { fullName: 'اسم غيّره المسؤول' },
    })
    profile.assertStatus(302)
    const purge = await browser.send('delete', '/account/sessions')
    purge.assertStatus(302)
    // The target's own browser was signed out by the administrator acting as the target.
    await own.expect('get', '/notifications?limit=1', 401)

    const rows = await knex()('activities')
      .where({ resource: 'users', record_id: target.id })
      .whereIn('action', ['profile_updated', 'session_revoked'])
    assert.lengthOf(rows, 2)
    for (const row of rows)
      assert.isTrue(
        row.actor_id === admin.id || row.changes?.impersonatedBy === admin.id,
        `${row.action} is attributed to the target alone (actor ${row.actor_id})`
      )
  })

  test('logging out while impersonating does not leave the administrator identity in the browser', async ({
    client,
    assert,
  }) => {
    const admin = await makeUser('admin', ADMIN)
    const target = await makeUser('target')
    const nextUser = await makeUser('next')
    const browser = new Browser(client)
    await browser.login(admin)
    await browser.expect('post', `/admin/users/${target.id}/impersonate`, 200)
    await browser.expect('post', '/logout', 302)
    assert.isUndefined(browser.userId)
    const leftover = browser.values[IMPERSONATOR_KEY]

    // Another person signs in on the same browser with their own credentials.
    await browser.login(nextUser)
    assert.equal(browser.userId, nextUser.id)
    const stop = await browser.send('post', '/impersonation/stop')
    const adminArea = await browser.send('get', '/admin/users')
    assert.deepEqual(
      {
        leftover,
        stop: stop.status(),
        user: browser.userId,
        adminArea: adminArea.status(),
      },
      { leftover: undefined, stop: 422, user: nextUser.id, adminArea: 403 },
      'a plain user signing in after the logout became the administrator'
    )
  })

  test('a revoked impersonation session cannot be turned into an administrator session', async ({
    client,
    assert,
  }) => {
    const admin = await makeUser('admin', ADMIN)
    const otherAdmin = await makeUser('other-admin', ADMIN)
    const target = await makeUser('target')
    const browser = new Browser(client)
    await browser.login(admin)
    await browser.expect('post', `/admin/users/${target.id}/impersonate`, 200)
    await browser.expect('get', '/notifications?limit=1', 200)

    // A second administrator ends every session of the target, including this one.
    const revoker = new Browser(client)
    await revoker.login(otherAdmin)
    await revoker.expect('post', `/admin/users/${target.id}/revoke-sessions`, 200)
    await browser.expect('get', '/notifications?limit=1', 401)
    assert.isUndefined(browser.userId)
    await browser.expect('post', '/impersonation/stop', 401)

    // The target signs in on that browser and tries to resume the administrator.
    await browser.login(target)
    const stop = await browser.send('post', '/impersonation/stop')
    const adminArea = await browser.send('get', '/admin/users')
    assert.deepEqual(
      { stop: stop.status(), user: browser.userId, adminArea: adminArea.status() },
      { stop: 422, user: target.id, adminArea: 403 },
      'the target signed in on the revoked browser and became the administrator'
    )
  })

  test('disabling the target ends the impersonation session at the next request', async ({
    client,
    assert,
  }) => {
    const admin = await makeUser('admin', ADMIN)
    const target = await makeUser('target')
    const browser = new Browser(client)
    await browser.login(admin)
    await browser.expect('post', `/admin/users/${target.id}/impersonate`, 200)
    await knex()('users').where('id', target.id).update({ disabled_at: knex().fn.now() })
    await browser.expect('get', '/notifications?limit=1', 401)
    assert.isUndefined(browser.userId)
  })

  test('an administrator disabled or demoted mid-impersonation does not regain administration', async ({
    client,
    assert,
  }) => {
    const target = await makeUser('target')

    const disabledAdmin = await makeUser('disabled-admin', ADMIN)
    const first = new Browser(client)
    await first.login(disabledAdmin)
    await first.expect('post', `/admin/users/${target.id}/impersonate`, 200)
    await knex()('users').where('id', disabledAdmin.id).update({ disabled_at: knex().fn.now() })
    await first.send('post', '/impersonation/stop')
    await first.expect('get', '/admin/users', 401)
    assert.isUndefined(first.userId)

    const demoted = await makeUser('demoted-admin', ADMIN)
    const second = new Browser(client)
    await second.login(demoted)
    await second.expect('post', `/admin/users/${target.id}/impersonate`, 200)
    await knex()('user_roles').where('user_id', demoted.id).delete()
    await second.expect('post', '/impersonation/stop', 200)
    assert.equal(second.userId, demoted.id)
    await second.expect('get', '/admin/users', 403)
  })

  test('an expired session store entry cannot stop or continue an impersonation', async ({
    client,
  }) => {
    const admin = await makeUser('admin', ADMIN)
    const target = await makeUser('target')
    const browser = new Browser(client)
    await browser.login(admin)
    await browser.expect('post', `/admin/users/${target.id}/impersonate`, 200)
    // Expiry removes the store entry; the cookie alone carries nothing.
    browser.values = {}
    await browser.expect('post', '/impersonation/stop', 401)
    await browser.expect('get', '/notifications?limit=1', 401)
  })
})
