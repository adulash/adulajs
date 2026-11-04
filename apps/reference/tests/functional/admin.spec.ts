import { test } from '@japa/runner'
import { randomUUID } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import { Worker } from 'bullmq'
import type { ApiRequest } from '@japa/api-client'
import db from '@adonisjs/lucid/services/db'
import queue from '@nemoventures/adonis-jobs/services/main'
import { Settings } from 'adula'
import env from '#start/env'
import User from '#models/user'
import mail from '@adonisjs/mail/services/main'
import { SMTPTransport } from '@adonisjs/mail/transports/smtp'
import { smtpSink } from '../helpers/smtp.js'
import { mailPresets, presetEnvLines, smtpOptions } from '#services/mail_setup'
import { mailValues } from '#services/mail_delivery_test'

test.group('Core administration screens', (group) => {
  let admin: User
  let member: User
  let adminRoleId: number
  let viewerRoleId: number
  let rootId: number
  let rootPath: string
  const unique = randomUUID().replaceAll('-', '').slice(0, 10)
  const knex = () => db.connection().getWriteClient()
  const password = 'test-only-password-123'
  const asJson = (request: ApiRequest) =>
    request.withCsrfToken().header('Accept', 'application/json')
  const asPage = (request: ApiRequest) => request.header('Accept', 'text/html').withInertia()

  group.setup(async () => {
    admin = await User.create({
      fullName: 'مدير الإدارة',
      email: `admin-${unique}@example.test`,
      password,
    })
    member = await User.create({
      fullName: 'عضو عادي',
      email: `member-${unique}@example.test`,
      password,
    })
    rootPath = `adm${unique}`
    const [root] = await knex()('org_units')
      .insert({ name: 'جذر الإدارة', type: 'root', path: rootPath })
      .returning('id')
    rootId = root.id
    const [role] = await knex()('roles')
      .insert({ name: `admin-${unique}`, permission_level: 1 })
      .returning('id')
    adminRoleId = role.id
    await knex()('role_rules').insert({ role_id: adminRoleId, subject: 'all', action: 'manage' })
    await knex()('user_roles').insert({ user_id: admin.id, role_id: adminRoleId })
    await knex()('user_org_units').insert([
      { user_id: admin.id, org_unit_id: rootId },
      { user_id: member.id, org_unit_id: rootId },
    ])
    const [viewer] = await knex()('roles')
      .insert({ name: `viewer-${unique}` })
      .returning('id')
    viewerRoleId = viewer.id
    await knex()('user_roles').insert({ user_id: member.id, role_id: viewerRoleId })
  })

  test('setup is administrator-only and verifies real storage, Redis and notification receipt', async ({
    client,
    assert,
  }) => {
    for (const path of [
      '/admin/setup/check/storage',
      '/admin/setup/check/infrastructure',
      '/admin/setup/identity',
      '/admin/setup/notification',
      '/admin/settings/mail/test',
      '/admin/settings/mail/confirm',
    ]) {
      const denied = await asJson(client.post(path).loginAs(member)).json({ confirmed: true })
      denied.assertStatus(403)
    }
    await knex()('settings').where('key', 'like', 'setup.%').delete()
    const storage = await asJson(client.post('/admin/setup/check/storage').loginAs(admin))
    storage.assertStatus(200)
    const infrastructure = await asJson(
      client.post('/admin/setup/check/infrastructure').loginAs(admin)
    )
    infrastructure.assertStatus(200)
    const notification = await asJson(client.post('/admin/setup/notification').loginAs(admin))
    notification.assertStatus(200)
    const initial = await client
      .get('/admin/setup')
      .loginAs(admin)
      .header('Accept', 'application/json')
    initial.assertStatus(200)
    assert.equal(initial.body().storage.status, 'passed')
    assert.equal(initial.body().infrastructure.status, 'passed')
    assert.isFalse(initial.body().notification.read)
    assert.notProperty(initial.body().storage, 'fingerprint')
    const read = await asJson(
      client.post(`/notifications/${notification.body().data}/read`).loginAs(admin)
    )
    read.assertStatus(200)
    const updated = await client
      .get('/admin/setup')
      .loginAs(admin)
      .header('Accept', 'application/json')
    assert.isTrue(updated.body().notification.read)
    const unknown = await asJson(client.post('/admin/setup/check/arbitrary').loginAs(admin))
    unknown.assertStatus(422)
  })

  test('mail test requires receipt confirmation and ignores recipient injection', async ({
    client,
    assert,
  }) => {
    const sink = await smtpSink()
    const previous = mail.config.mailers.smtp
    await mail.close('smtp')
    mail.config.mailers.smtp = () =>
      new SMTPTransport({ host: '127.0.0.1', port: sink.port, secure: false, ignoreTLS: true })
    try {
      const sent = await asJson(client.post('/admin/settings/mail/test').loginAs(admin)).json({
        recipient: 'unapproved@example.test',
      })
      sent.assertStatus(200)
      assert.lengthOf(sink.messages, 1)
      assert.include(sink.messages[0], admin.email)
      assert.notInclude(sink.messages[0], 'unapproved@example.test')
      const state = await new Settings(knex()).get<{
        id: string
        recipient: string
        status: string
      }>('mail.delivery_test', 'user', String(admin.id))
      assert.equal(state?.recipient, admin.email)
      assert.equal(state?.status, 'pending')
      const page = await asPage(client.get('/admin/settings').loginAs(admin))
      assert.notProperty(page.body().props.mailTest, 'fingerprint')
      const confirmed = await asJson(
        client.post('/admin/settings/mail/confirm').loginAs(admin)
      ).json({ id: state!.id, received: true })
      confirmed.assertStatus(200)
      const fresh = await asPage(client.get('/admin/settings').loginAs(admin))
      assert.equal(fresh.body().props.mailTest.status, 'confirmed')
      const stale = await asJson(client.post('/admin/settings/mail/confirm').loginAs(admin)).json({
        id: state!.id,
        received: false,
      })
      stale.assertStatus(409)
    } finally {
      await mail.close('smtp')
      mail.config.mailers.smtp = previous
      await sink.close()
    }
  })

  test('a preset configures mail, a wrong password reads as such and gaps are refused', async ({
    client,
    assert,
  }) => {
    const secret = 'preset-secret-4d9a'
    const wrong = 'wrong-secret-7c21'
    const sink = await smtpSink({ auth: { user: 'apikey', pass: secret } })
    const keys = [
      'SMTP_HOST',
      'SMTP_PORT',
      'SMTP_SECURE',
      'SMTP_REQUIRE_TLS',
      'SMTP_USERNAME',
      'SMTP_PASSWORD',
      'MAIL_FROM_ADDRESS',
    ] as const
    const saved = Object.fromEntries(keys.map((key) => [key, env.get(key)]))
    const previous = mail.config.mailers.smtp
    const preset = mailPresets.find((item) => item.id === 'sendgrid')!
    // The administrator copies the preset's lines and fills the empty password and sender;
    // only the host and port move to the local sink, and it offers no STARTTLS.
    const lines = Object.fromEntries(
      presetEnvLines(preset)
        .split('\n')
        .map((line) => line.split('=') as [string, string])
    )
    const apply = async (smtpPassword: string) => {
      env.set('SMTP_HOST', '127.0.0.1')
      env.set('SMTP_PORT', sink.port)
      env.set('SMTP_SECURE', lines.SMTP_SECURE === 'true')
      env.set('SMTP_REQUIRE_TLS', false)
      env.set('SMTP_USERNAME', lines.SMTP_USERNAME)
      env.set('SMTP_PASSWORD', smtpPassword)
      env.set('MAIL_FROM_ADDRESS', 'no-reply@example.test')
      await mail.close('smtp')
      mail.config.mailers.smtp = () => new SMTPTransport(smtpOptions(mailValues()))
      await knex()('settings')
        .where({ key: 'mail.delivery_test', scope: 'user', scope_id: String(admin.id) })
        .delete()
    }
    try {
      assert.equal(lines.SMTP_USERNAME, 'apikey')
      assert.equal(lines.SMTP_PASSWORD, '')
      await apply(secret)
      const sent = await asJson(client.post('/admin/settings/mail/test').loginAs(admin))
      sent.assertStatus(200)
      assert.deepEqual(sink.logins, ['apikey'])
      assert.lengthOf(sink.messages, 1)

      await apply(wrong)
      const refused = await asJson(client.post('/admin/settings/mail/test').loginAs(admin))
      refused.assertStatus(502)
      assert.equal(refused.body().error.code, 'E_MAIL_TEST_SEND')
      assert.include(refused.body().error.message, 'SMTP_PASSWORD')
      assert.include(refused.body().error.message, 'رفض خادم البريد اسم المستخدم')
      const activity = await knex()('activities')
        .where({ resource: 'core.mail', action: 'test_send_failed', record_id: admin.id })
        .orderBy('id', 'desc')
        .first()
      assert.equal(activity.changes.reason, 'authentication')
      const stored = await knex()('settings')
        .where({ key: 'mail.delivery_test', scope: 'user', scope_id: String(admin.id) })
        .first()
      assert.equal(stored.value.status, 'failed')

      env.set('SMTP_PASSWORD', '')
      const incomplete = await asJson(client.post('/admin/settings/mail/test').loginAs(admin))
      incomplete.assertStatus(422)
      assert.equal(incomplete.body().error.code, 'E_MAIL_NOT_CONFIGURED')
      assert.lengthOf(sink.messages, 1)
      env.set('SMTP_PASSWORD', wrong)
      const page = await asPage(client.get('/admin/setup').loginAs(admin))
      const props = page.body().props
      assert.isTrue(props.mailReadiness.configured)
      assert.equal(
        props.mailPresets.find((item: { id: string }) => item.id === 'sendgrid').env,
        presetEnvLines(preset)
      )
      env.set('SMTP_USERNAME', '')
      const missing = await asPage(client.get('/admin/settings').loginAs(admin))
      assert.deepEqual(missing.body().props.mailReadiness.missing, ['SMTP_USERNAME'])

      const surfaces = [
        JSON.stringify(refused.body()),
        JSON.stringify(incomplete.body()),
        JSON.stringify(props),
        JSON.stringify(missing.body().props),
        JSON.stringify(await knex()('activities').where('resource', 'core.mail')),
        JSON.stringify(await knex()('settings').where('key', 'mail.delivery_test')),
      ]
      for (const surface of surfaces) {
        assert.notInclude(surface, secret)
        assert.notInclude(surface, wrong)
      }
    } finally {
      for (const key of keys) env.set(key, saved[key] as never)
      await mail.close('smtp')
      mail.config.mailers.smtp = previous
      await sink.close()
    }
  })

  test('non-administrators get 403 on every admin page and mutation', async ({
    client,
    assert,
  }) => {
    const pages = [
      '/admin',
      '/admin/users',
      `/admin/users/${member.id}`,
      '/admin/roles',
      `/admin/roles/${adminRoleId}`,
      '/admin/org-units',
      '/admin/activity',
      '/admin/jobs',
      '/admin/settings',
      '/admin/setup',
    ]
    for (const path of pages) {
      const page = await asPage(client.get(path).loginAs(member))
      page.assertStatus(403)
      assert.equal(page.body().component, 'admin/forbidden')
      const api = await client.get(path).loginAs(member).header('Accept', 'application/json')
      api.assertStatus(403)
      assert.equal(api.body().error.code, 'E_FORBIDDEN')
    }
    const mutation = await asJson(client.post(`/admin/users/${admin.id}/disable`).loginAs(member))
    mutation.assertStatus(403)
    const anonymous = await client.get('/admin/users').header('Accept', 'application/json')
    anonymous.assertStatus(401)
    const shell = await asPage(client.get('/').loginAs(member))
    assert.isFalse(shell.body().props.isAdmin)
    const adminShell = await asPage(client.get('/').loginAs(admin))
    assert.isTrue(adminShell.body().props.isAdmin)
  })

  test('matrix rules change the user navigation immediately after each write', async ({
    client,
    assert,
  }) => {
    const before = await client
      .get('/resources/tasks')
      .loginAs(member)
      .header('Accept', 'application/json')
    before.assertStatus(403)
    const set = await asJson(client.put(`/admin/roles/${viewerRoleId}/rules`).loginAs(admin)).json({
      subject: 'tasks',
      action: 'view',
    })
    set.assertStatus(200)
    assert.equal(set.body().data.subject, 'tasks')
    const visible = await asPage(client.get('/resources/tasks').loginAs(member))
    visible.assertStatus(200)
    assert.deepEqual(
      visible.body().props.navigation.map((entry: { name: string }) => entry.name),
      ['tasks']
    )
    const show = await asPage(client.get(`/admin/roles/${viewerRoleId}`).loginAs(admin))
    show.assertStatus(200)
    assert.equal(show.body().component, 'admin/roles/show')
    assert.includeMembers(
      show.body().props.matrix.subjects.map((subject: { name: string }) => subject.name),
      ['all', 'customers', 'orders', 'tasks']
    )
    assert.lengthOf(show.body().props.role.rules, 1)
    const removed = await asJson(
      client.delete(`/admin/roles/${viewerRoleId}/rules/${set.body().data.id}`).loginAs(admin)
    )
    removed.assertStatus(200)
    const after = await asPage(client.get('/').loginAs(member))
    assert.deepEqual(after.body().props.navigation, [])
    const denied = await client
      .get('/resources/tasks')
      .loginAs(member)
      .header('Accept', 'application/json')
    denied.assertStatus(403)
    const list = await asPage(client.get('/admin/roles').loginAs(admin))
    assert.equal(list.body().component, 'admin/roles/index')
    assert.exists(list.body().props.roles.find((role: { id: number }) => role.id === viewerRoleId))
  })

  test('a role key is set at creation or once later, and survives renaming', async ({
    client,
    assert,
  }) => {
    const created = await asJson(client.post('/admin/roles').loginAs(admin)).json({
      name: `مراجع ${unique}`,
      key: `reviewer_${unique}`,
      permissionLevel: 0,
    })
    created.assertStatus(200)
    const id: number = created.body().data.id
    const key: string = created.body().data.key
    const renamed = await asJson(client.patch(`/admin/roles/${id}`).loginAs(admin)).json({
      name: `المراجع ${unique}`,
    })
    renamed.assertStatus(200)
    const changed = await asJson(client.patch(`/admin/roles/${id}`).loginAs(admin)).json({
      key: 'another_key',
    })
    changed.assertStatus(409)
    assert.equal(changed.body().error.code, 'E_ROLE_KEY_FIXED')
    const invalid = await asJson(client.post('/admin/roles').loginAs(admin)).json({
      name: `سيئ ${unique}`,
      key: 'Not A Key',
    })
    invalid.assertStatus(422)
    const listed = await asJson(client.get('/admin/roles').loginAs(admin))
    const role = listed.body().data.find((entry: { id: number }) => entry.id === id)
    assert.equal(role.key, key)
    assert.equal(role.name, `المراجع ${unique}`)
    await knex()('roles').where('id', id).delete()
  })

  test('condition validation refuses unsupported operators, unknown fields and collections', async ({
    client,
    assert,
  }) => {
    const put = (body: Record<string, unknown>) =>
      asJson(client.put(`/admin/roles/${viewerRoleId}/rules`).loginAs(admin)).json({
        subject: 'orders',
        action: 'view',
        ...body,
      })
    const operator = await put({ conditions: { status: { $regex: 'x' } } })
    operator.assertStatus(422)
    assert.equal(operator.body().error.code, 'E_RULE_CONDITIONS')
    const unknown = await put({ conditions: { ghost: 1 } })
    unknown.assertStatus(422)
    const collection = await put({ conditions: { lines: 1 } })
    collection.assertStatus(422)
    const mismatch = await put({ conditions: { total: 5 } })
    mismatch.assertStatus(422)
    const fields = await put({ fields: ['ghost'] })
    fields.assertStatus(422)
    assert.equal(fields.body().error.code, 'E_RULE_FIELDS')
    const subject = await asJson(
      client.put(`/admin/roles/${viewerRoleId}/rules`).loginAs(admin)
    ).json({ subject: 'ghosts', action: 'view' })
    subject.assertStatus(422)
    // The current user is accepted for creator/updater and user fields only (#29).
    const own = await put({ conditions: { createdBy: '$actor.id' } })
    own.assertStatus(200)
    assert.deepEqual(own.body().data.conditions, { createdBy: '$actor.id' })
    const notUser = await put({ conditions: { notes: '$actor.id' } })
    notUser.assertStatus(422)
    const saved = await put({ conditions: { status: 'open' }, fields: ['notes'] })
    saved.assertStatus(200)
    assert.deepEqual(saved.body().data.conditions, { status: 'open' })
    assert.deepEqual(saved.body().data.fields, ['notes'])
    const form = await client
      .put(`/admin/roles/${viewerRoleId}/rules`)
      .loginAs(admin)
      .withCsrfToken()
      .header('Accept', 'text/html')
      .header('Referer', `/admin/roles/${viewerRoleId}`)
      .withInertia()
      .redirects(0)
      .json({ subject: 'orders', action: 'view', conditions: { status: { $regex: 'x' } } })
    assert.oneOf(form.status(), [302, 303])
    assert.include(String(form.flashMessage('error')), 'شرط غير مدعوم')
    await knex()('role_rules').where('role_id', viewerRoleId).delete()
  })

  test('org unit move updates descendant paths and the scope users see', async ({
    client,
    assert,
  }) => {
    const created = await asJson(client.post('/admin/org-units').loginAs(admin)).json({
      parentId: rootId,
      name: 'قسم أ',
      type: 'department',
    })
    created.assertStatus(200)
    const aId: number = created.body().data.id
    const child = await asJson(client.post('/admin/org-units').loginAs(admin)).json({
      parentId: aId,
      name: 'قسم ب',
      type: 'department',
    })
    const bId: number = child.body().data.id
    assert.equal(child.body().data.path, `${rootPath}.${aId}.${bId}`)
    const scoped = await User.create({ email: `scoped-${unique}@example.test`, password })
    const [role] = await knex()('roles')
      .insert({ name: `scoped-${unique}` })
      .returning('id')
    await knex()('role_rules').insert({ role_id: role.id, subject: 'tasks', action: 'view' })
    await knex()('user_roles').insert({ user_id: scoped.id, role_id: role.id })
    await knex()('user_org_units').insert({ user_id: scoped.id, org_unit_id: aId })
    const [task] = await knex()('tasks')
      .insert({
        title: 'مهمة في القسم ب',
        org_unit_id: bId,
        done: false,
        created_by: admin.id,
        updated_by: admin.id,
      })
      .returning('id')
    const visible = await client
      .get('/resources/tasks')
      .loginAs(scoped)
      .header('Accept', 'application/json')
    visible.assertStatus(200)
    assert.lengthOf(
      visible.body().data.filter((row: { id: number }) => row.id === task.id),
      1
    )
    const moved = await asJson(client.post(`/admin/org-units/${bId}/move`).loginAs(admin)).json({
      parentId: rootId,
    })
    moved.assertStatus(200)
    const row = await knex()('org_units').where('id', bId).first()
    assert.equal(String(row.path), `${rootPath}.${bId}`)
    assert.equal(row.parent_id, rootId)
    const hidden = await client
      .get('/resources/tasks')
      .loginAs(scoped)
      .header('Accept', 'application/json')
    assert.lengthOf(
      hidden.body().data.filter((entry: { id: number }) => entry.id === task.id),
      0
    )
    const tree = await asPage(client.get('/admin/org-units').loginAs(admin))
    tree.assertStatus(200)
    assert.equal(tree.body().component, 'admin/org_units/index')
    const paths = tree.body().props.units.map((unit: { path: string }) => unit.path)
    assert.isBelow(paths.indexOf(`${rootPath}.${aId}`), paths.indexOf(`${rootPath}.${bId}`))
    const cycle = await asJson(client.post(`/admin/org-units/${rootId}/move`).loginAs(admin)).json({
      parentId: bId,
    })
    cycle.assertStatus(422)
    const members = await asJson(client.delete(`/admin/org-units/${aId}`).loginAs(admin))
    members.assertStatus(409)
    assert.equal(members.body().error.code, 'E_ORG_HAS_MEMBERS')
    const records = await asJson(client.delete(`/admin/org-units/${bId}`).loginAs(admin))
    records.assertStatus(409)
    assert.equal(records.body().error.code, 'E_ORG_HAS_RECORDS')
    const renamed = await asJson(client.patch(`/admin/org-units/${bId}`).loginAs(admin)).json({
      name: 'قسم ب المعدّل',
    })
    renamed.assertStatus(200)
    assert.exists(
      await knex()('activities')
        .where({ resource: 'core.org_units', record_id: bId, action: 'move' })
        .first()
    )
  })

  test('users are searched, given roles and memberships, disabled and enabled', async ({
    client,
    assert,
  }) => {
    const index = await asPage(client.get(`/admin/users?search=member-${unique}`).loginAs(admin))
    index.assertStatus(200)
    assert.equal(index.body().component, 'admin/users/index')
    assert.deepEqual(
      index.body().props.users.data.map((user: { id: number }) => user.id),
      [member.id]
    )
    // `q` is the documented parameter shared with the other administration lists.
    const byQ = await asJson(
      client.get(`/admin/users?q=${encodeURIComponent(member.email)}`).loginAs(admin)
    )
    byQ.assertStatus(200)
    assert.deepEqual(
      byQ.body().data.map((user: { id: number }) => user.id),
      [member.id]
    )
    const assigned = await asJson(
      client.post(`/admin/users/${member.id}/roles`).loginAs(admin)
    ).json({ roleId: viewerRoleId, orgUnitId: rootId })
    assigned.assertStatus(200)
    const duplicate = await asJson(
      client.post(`/admin/users/${member.id}/roles`).loginAs(admin)
    ).json({ roleId: viewerRoleId, orgUnitId: rootId })
    duplicate.assertStatus(409)
    const show = await asPage(client.get(`/admin/users/${member.id}`).loginAs(admin))
    show.assertStatus(200)
    assert.equal(show.body().component, 'admin/users/show')
    // The page shows the member as `target`; the shell keeps the signed-in administrator.
    assert.equal(show.body().props.target.id, member.id)
    assert.equal(show.body().props.account.id, admin.id)
    // Roles that grant full administration are flagged for their own confirmation.
    assert.include(show.body().props.privilegedRoleIds, adminRoleId)
    assert.notInclude(show.body().props.privilegedRoleIds, viewerRoleId)
    const showJson = await asJson(client.get(`/admin/users/${member.id}`).loginAs(admin))
    showJson.assertStatus(200)
    assert.equal(showJson.body().user.id, member.id)
    assert.include(showJson.body().privilegedRoleIds, adminRoleId)
    const scopedAssignment = show
      .body()
      .props.target.roles.find((role: { orgUnitId: number | null }) => role.orgUnitId === rootId)
    assert.equal(scopedAssignment.role, `viewer-${unique}`)
    assert.isArray(show.body().props.roles)
    assert.isArray(show.body().props.orgUnits)
    const removed = await asJson(
      client.delete(`/admin/users/${member.id}/roles/${scopedAssignment.id}`).loginAs(admin)
    )
    removed.assertStatus(200)
    const membership = await asJson(
      client.delete(`/admin/users/${member.id}/org-units/${rootId}`).loginAs(admin)
    )
    membership.assertStatus(200)
    const restored = await asJson(
      client.post(`/admin/users/${member.id}/org-units`).loginAs(admin)
    ).json({ orgUnitId: rootId })
    restored.assertStatus(200)
    const self = await asJson(client.post(`/admin/users/${admin.id}/disable`).loginAs(admin))
    self.assertStatus(422)
    const disabled = await asJson(client.post(`/admin/users/${member.id}/disable`).loginAs(admin))
    disabled.assertStatus(200)
    const disabledRow = await knex()('users').where('id', member.id).first()
    assert.isNotNull(disabledRow.disabled_at)
    const blocked = await client
      .get('/resources/tasks')
      .loginAs(member)
      .header('Accept', 'application/json')
    blocked.assertStatus(401)
    const impersonateDisabled = await asJson(
      client.post(`/admin/users/${member.id}/impersonate`).loginAs(admin)
    )
    impersonateDisabled.assertStatus(422)
    const enabled = await asJson(client.post(`/admin/users/${member.id}/enable`).loginAs(admin))
    enabled.assertStatus(200)
    const enabledRow = await knex()('users').where('id', member.id).first()
    assert.isNull(enabledRow.disabled_at)
    const selfImpersonation = await asJson(
      client.post(`/admin/users/${admin.id}/impersonate`).loginAs(admin)
    )
    selfImpersonation.assertStatus(422)
    const impersonated = await asJson(
      client.post(`/admin/users/${member.id}/impersonate`).loginAs(admin)
    ).json({ reason: 'مراجعة طلب دعم فني للمستخدم' })
    impersonated.assertStatus(200)
    assert.exists(
      await knex()('activities')
        .where({ resource: 'core.users', record_id: member.id, action: 'impersonate' })
        .first()
    )
    const revoked = await asJson(
      client.post(`/admin/users/${member.id}/revoke-sessions`).loginAs(admin)
    )
    revoked.assertStatus(200)
    const log = await knex()('activities').where({ resource: 'core.users', record_id: member.id })
    assert.includeMembers(
      log.map((row) => row.action),
      ['assign_role', 'remove_role', 'disable', 'enable', 'revoke_sessions']
    )
  })

  test('administrators cannot impersonate administrators; impersonated writes name the administrator', async ({
    client,
    assert,
  }) => {
    const other = await User.create({
      fullName: 'مسؤول آخر',
      email: `other-admin-${randomUUID()}@example.test`,
      password: 'a-long-test-password-123',
    })
    await knex()('user_roles').insert({ user_id: other.id, role_id: adminRoleId })
    const refused = await asJson(client.post(`/admin/users/${other.id}/impersonate`).loginAs(admin))
    refused.assertStatus(403)
    assert.equal(refused.body().error.code, 'E_IMPERSONATE_ADMIN')

    // A write made during impersonation keeps the administrator next to the effective user.
    const created = await client
      .post('/resources/customers')
      .loginAs(other)
      .withSession({ impersonator_id: { adminId: admin.id, targetId: other.id } })
      .withCsrfToken()
      .header('Accept', 'application/json')
      .json({ name: `عميل منتحل ${randomUUID()}` })
    created.assertStatus(201)
    const [activity] = await knex()('activities').where({
      resource: 'customers',
      record_id: created.body().data.id,
      action: 'create',
    })
    assert.equal(activity.actor_id, other.id)
    assert.equal(activity.changes.impersonatedBy, admin.id)
  })

  test('notifications page, shared bell count and read flow', async ({ client, assert }) => {
    const [first, second] = await knex()('notifications')
      .insert([
        { user_id: member.id, title: 'الأول', body: 'نص' },
        { user_id: member.id, title: 'الثاني', body: 'نص' },
        { user_id: admin.id, title: 'لغيره', body: 'نص' },
      ])
      .returning('id')
    const page = await asPage(client.get('/notifications').loginAs(member))
    page.assertStatus(200)
    assert.equal(page.body().component, 'admin/notifications/index')
    assert.equal(page.body().props.notifications.unread, 2)
    assert.equal(page.body().props.unreadNotifications, 2)
    assert.equal(page.body().props.notifications.data[0].id, second.id)
    const foreign = await asJson(client.post(`/notifications/${first.id}/read`).loginAs(admin))
    foreign.assertStatus(404)
    const one = await asJson(client.post(`/notifications/${first.id}/read`).loginAs(member))
    one.assertStatus(200)
    const all = await asJson(client.post('/notifications/read-all').loginAs(member))
    all.assertStatus(200)
    assert.equal(all.body().data, 1)
    const after = await asPage(client.get('/notifications').loginAs(member))
    assert.equal(after.body().props.unreadNotifications, 0)
    assert.isTrue(
      after
        .body()
        .props.notifications.data.every((row: { readAt: string | null }) => row.readAt !== null)
    )
    const json = await client
      .get('/notifications?limit=1')
      .loginAs(member)
      .header('Accept', 'application/json')
    json.assertStatus(200)
    assert.lengthOf(json.body().data, 1)
    assert.isString(json.body().nextCursor)
  })

  test('settings are edited per scope with JSON validation and protected keys', async ({
    client,
    assert,
  }) => {
    const put = (body: Record<string, unknown>) =>
      asJson(client.put('/admin/settings').loginAs(admin)).json(body)
    const saved = await put({ key: 'ui.theme', scope: 'system', value: '{"dark":true}' })
    saved.assertStatus(200)
    assert.deepEqual(saved.body().data.value, { dark: true })
    const invalid = await put({ key: 'ui.theme', scope: 'system', value: '{bad' })
    invalid.assertStatus(422)
    assert.equal(invalid.body().error.code, 'E_SETTING_JSON')
    for (const key of ['backup.lastOffsite', 'scheduler.heartbeat', 'adula.version']) {
      const denied = await put({ key, scope: 'system', value: '"x"' })
      denied.assertStatus(403)
      assert.equal(denied.body().error.code, 'E_SETTING_READ_ONLY')
    }
    const scoped = await put({
      key: 'limit',
      scope: 'org_unit',
      scopeId: String(rootId),
      value: '5',
    })
    scoped.assertStatus(200)
    const missing = await put({ key: 'limit', scope: 'org_unit', scopeId: '999999', value: '5' })
    missing.assertStatus(404)
    const unitPage = await asPage(
      client.get(`/admin/settings?scope=org_unit&scopeId=${rootId}`).loginAs(admin)
    )
    unitPage.assertStatus(200)
    assert.equal(unitPage.body().component, 'admin/settings/index')
    assert.deepEqual(
      unitPage.body().props.settings.map((row: { key: string }) => row.key),
      ['limit']
    )
    await new Settings(knex()).set('backup.lastOffsite', new Date().toISOString())
    const systemPage = await asPage(client.get('/admin/settings').loginAs(admin))
    const rows = systemPage.body().props.settings as {
      id: number
      key: string
      readOnly: boolean
    }[]
    const backup = rows.find((row) => row.key === 'backup.lastOffsite')!
    assert.isTrue(backup.readOnly)
    assert.isFalse(rows.find((row) => row.key === 'ui.theme')!.readOnly)
    const protectedDelete = await asJson(
      client.delete(`/admin/settings/${backup.id}`).loginAs(admin)
    )
    protectedDelete.assertStatus(403)
    const deleted = await asJson(
      client.delete(`/admin/settings/${saved.body().data.id}`).loginAs(admin)
    )
    deleted.assertStatus(200)
    assert.notExists(await knex()('settings').where({ key: 'ui.theme', scope: 'system' }).first())
  })

  test('the backup warning is shared with administrators until an offsite backup is fresh', async ({
    client,
    assert,
  }) => {
    await knex()('settings').where('key', 'backup.lastOffsite').delete()
    const stale = await asPage(client.get('/').loginAs(admin))
    assert.isTrue(stale.body().props.backupWarning)
    const memberShell = await asPage(client.get('/').loginAs(member))
    assert.isFalse(memberShell.body().props.backupWarning)
    await new Settings(knex()).set(
      'backup.lastOffsite',
      new Date(Date.now() - 49 * 3600000).toISOString()
    )
    const old = await asPage(client.get('/').loginAs(admin))
    assert.isTrue(old.body().props.backupWarning)
    await new Settings(knex()).set('backup.lastOffsite', new Date().toISOString())
    const fresh = await asPage(client.get('/').loginAs(admin))
    assert.isFalse(fresh.body().props.backupWarning)
  })

  test('activity page lists administrative mutations with filters and keyset paging', async ({
    client,
    assert,
  }) => {
    const page = await asPage(client.get('/admin/activity?resource=core.settings').loginAs(admin))
    page.assertStatus(200)
    assert.equal(page.body().component, 'admin/activity/index')
    assert.isNotEmpty(page.body().props.activity.data)
    assert.isTrue(
      page
        .body()
        .props.activity.data.every((row: { resource: string }) => row.resource === 'core.settings')
    )
    assert.includeMembers(page.body().props.facets.resources, ['core.roles', 'core.settings'])
    assert.equal(page.body().props.filters.resource, 'core.settings')
    const first = await client
      .get('/admin/activity?limit=1')
      .loginAs(admin)
      .header('Accept', 'application/json')
    first.assertStatus(200)
    assert.lengthOf(first.body().data, 1)
    const next = await client
      .get(`/admin/activity?limit=1&cursor=${first.body().nextCursor}`)
      .loginAs(admin)
      .header('Accept', 'application/json')
    assert.isBelow(Number(next.body().data[0].id), Number(first.body().data[0].id))
    const badDate = await client
      .get('/admin/activity?from=never')
      .loginAs(admin)
      .header('Accept', 'application/json')
    badDate.assertStatus(422)
  })

  test('activity rows read as names, titles and changed fields; the actor filter lists names', async ({
    client,
    assert,
  }) => {
    const name = `عميل السجل ${randomUUID()}`
    const created = await asJson(client.post('/resources/customers').loginAs(admin)).json({
      name,
      email: `before-${unique}@example.test`,
    })
    created.assertStatus(201)
    const id = created.body().data.id
    // Both fields are submitted; only the e-mail changes.
    const updated = await asJson(client.patch(`/resources/customers/${id}`).loginAs(admin)).json({
      name,
      email: `after-${unique}@example.test`,
      version: created.body().data.version,
    })
    updated.assertStatus(200)

    const page = await asPage(
      client.get(`/admin/activity?resource=customers&actorId=${admin.id}`).loginAs(admin)
    )
    page.assertStatus(200)
    type Row = {
      recordId: number
      action: string
      changes: unknown
      resourceLabel: string
      actionLabel: string
      recordTitle: string | null
      actorName: string | null
      fieldChanges: { field: string; label: string; before: string | null; after: string | null }[]
    }
    const rows: Row[] = page.body().props.activity.data
    const update = rows.find((row) => row.recordId === id && row.action === 'update')!
    assert.exists(update)
    assert.property(update, 'changes', 'stored keys stay for JSON clients')
    assert.equal(update.resourceLabel, 'العملاء')
    assert.equal(update.actionLabel, 'تعديل')
    assert.equal(update.recordTitle, name)
    assert.equal(update.actorName, 'مدير الإدارة')
    assert.deepEqual(update.fieldChanges, [
      {
        field: 'email',
        label: 'البريد الإلكتروني',
        before: `before-${unique}@example.test`,
        after: `after-${unique}@example.test`,
      },
    ])
    const facets = page.body().props.facets
    assert.deepInclude(facets.actors, { id: admin.id, name: 'مدير الإدارة' })
    assert.equal(facets.labels.resources['core.users'], 'المستخدمون')
    assert.equal(facets.labels.actions['assign_role'], 'إسناد دور')

    // Core subjects and actions have Arabic names; user records are titled by name.
    await knex()('activities').insert({
      resource: 'core.users',
      record_id: member.id,
      actor_id: admin.id,
      action: 'assign_role',
      changes: JSON.stringify({ roleId: viewerRoleId }),
    })
    const core = await client
      .get(`/admin/activity?resource=core.users&action=assign_role&limit=1`)
      .loginAs(admin)
      .header('Accept', 'application/json')
    core.assertStatus(200)
    assert.include(core.body().data[0], {
      resourceLabel: 'المستخدمون',
      actionLabel: 'إسناد دور',
      recordTitle: 'عضو عادي',
    })

    // Option values show their labels; a field no longer defined is withheld.
    const [entry] = await knex()('activities')
      .insert({
        resource: 'suppliers',
        record_id: 2147483000,
        actor_id: admin.id,
        action: 'update',
        changes: JSON.stringify({ fields: ['kind', 'removed'] }),
      })
      .returning('id')
    await knex()('field_changes').insert([
      {
        activity_id: entry.id,
        resource: 'suppliers',
        record_id: 2147483000,
        field: 'kind',
        before: JSON.stringify('local'),
        after: JSON.stringify('international'),
      },
      {
        activity_id: entry.id,
        resource: 'suppliers',
        record_id: 2147483000,
        field: 'removed',
        before: JSON.stringify('secret-before'),
        after: JSON.stringify('secret-after'),
      },
    ])
    const supplier = await client
      .get(`/admin/activity?resource=suppliers&limit=1`)
      .loginAs(admin)
      .header('Accept', 'application/json')
    supplier.assertStatus(200)
    const [row] = supplier.body().data
    assert.equal(row.id, String(entry.id))
    assert.isNull(row.recordTitle)
    assert.deepEqual(row.fieldChanges, [
      { field: 'kind', label: 'نوع المورد', before: 'محلي', after: 'دولي' },
      { field: 'removed', label: 'removed', before: null, after: null, withheld: true },
    ])
    assert.notInclude(JSON.stringify(row.fieldChanges), 'secret')
  })

  test('jobs page shows heartbeats, outbox backlog and retries a failed queue job', async ({
    client,
    assert,
  }) => {
    const events = queue.useQueue('events')
    const jobId = `admin-probe-${unique}`
    await events.add('admin.probe', { probe: true }, { jobId, attempts: 1 })
    const worker = new Worker(
      'events',
      async () => {
        throw new Error('probe failure')
      },
      {
        prefix: events.opts.prefix,
        connection: {
          host: env.get('REDIS_HOST'),
          port: env.get('REDIS_PORT'),
          password: env.get('REDIS_PASSWORD'),
          db: Number(process.env.REDIS_TEST_DB ?? 15),
          maxRetriesPerRequest: null,
        },
      }
    )
    try {
      const deadline = Date.now() + 15000
      while (Date.now() < deadline) {
        const job = await events.getJob(jobId)
        if (job && (await job.isFailed())) break
        await sleep(100)
      }
    } finally {
      await worker.close()
    }
    const failed = await events.getJob(jobId)
    assert.isTrue(await failed!.isFailed())
    const page = await asPage(client.get('/admin/jobs').loginAs(admin))
    page.assertStatus(200)
    assert.equal(page.body().component, 'admin/jobs/index')
    const snapshot = page.body().props.queues[0]
    assert.equal(snapshot.name, 'events')
    assert.isAtLeast(snapshot.counts.failed, 1)
    const listed = snapshot.failed.find((job: { id: string }) => job.id === jobId)
    assert.equal(listed.failedReason, 'probe failure')
    assert.property(page.body().props.health.heartbeats, 'scheduler')
    assert.property(page.body().props.health.outbox, 'backlog')
    const retried = await asJson(client.post(`/admin/jobs/${jobId}/retry`).loginAs(admin))
    retried.assertStatus(200)
    const waiting = await events.getJob(jobId)
    assert.isFalse(await waiting!.isFailed())
    const again = await asJson(client.post(`/admin/jobs/${jobId}/retry`).loginAs(admin))
    again.assertStatus(422)
    const unknown = await asJson(client.post('/admin/jobs/missing-job/retry').loginAs(admin))
    unknown.assertStatus(404)
    assert.exists(
      await knex()('activities').where({ resource: 'core.jobs', action: 'retry' }).first()
    )
    await waiting!.remove()
  })
})
