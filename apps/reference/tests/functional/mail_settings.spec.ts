import { test } from '@japa/runner'
import { randomUUID } from 'node:crypto'
import type { ApiRequest } from '@japa/api-client'
import db from '@adonisjs/lucid/services/db'
import mail from '@adonisjs/mail/services/main'
import env from '#start/env'
import User from '#models/user'
import { smtpSink } from '../helpers/smtp.js'

// Variables the tests change; restored as raw process values, so an unset one is removed.
const KEYS = [
  'WEBHOOKS_ALLOW_PRIVATE',
  'MAIL_SETTINGS_SOURCE',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_SECURE',
  'SMTP_REQUIRE_TLS',
  'SMTP_USERNAME',
  'SMTP_PASSWORD',
  'MAIL_FROM_ADDRESS',
] as const

test.group('In-app mail settings', (group) => {
  let admin: User
  let member: User
  const unique = randomUUID().replaceAll('-', '').slice(0, 10)
  const secret = `smtp-secret-${unique}`
  const wrong = `smtp-wrong-${unique}`
  const knex = () => db.connection().getWriteClient()
  const asJson = (request: ApiRequest) =>
    request.withCsrfToken().header('Accept', 'application/json')
  const asPage = (request: ApiRequest) => request.header('Accept', 'text/html').withInertia()
  let saved: Record<string, unknown> = {}
  let savedProcess: Record<string, string | undefined> = {}
  const forget = () =>
    knex()('settings')
      .where({ key: 'mail.delivery_test', scope: 'user', scope_id: String(admin.id) })
      .delete()
  const send = async (client: any) => {
    await forget()
    return asJson(client.post('/admin/settings/mail/test').loginAs(admin))
  }
  const store = (client: any, values: Record<string, unknown>) =>
    asJson(client.put('/admin/settings/mail').loginAs(admin)).json(values)

  group.setup(async () => {
    admin = await User.create({
      fullName: 'مدير البريد',
      email: `mail-admin-${unique}@example.test`,
      password: 'test-only-password-123',
    })
    member = await User.create({
      fullName: 'عضو البريد',
      email: `mail-member-${unique}@example.test`,
      password: 'test-only-password-123',
    })
    const [role] = await knex()('roles')
      .insert({ name: `mail-admin-${unique}`, permission_level: 1 })
      .returning('id')
    await knex()('role_rules').insert({ role_id: role.id, subject: 'all', action: 'manage' })
    await knex()('user_roles').insert({ user_id: admin.id, role_id: role.id })
  })
  group.each.setup(async () => {
    saved = Object.fromEntries(KEYS.map((key) => [key, env.get(key)]))
    savedProcess = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]))
    // The sink listens on loopback, which only an explicit opt-in allows.
    env.set('WEBHOOKS_ALLOW_PRIVATE', true)
    await mail.close('smtp')
    return async () => {
      for (const key of KEYS) {
        env.set(key, saved[key] as never)
        if (savedProcess[key] === undefined) delete process.env[key]
        else process.env[key] = savedProcess[key]
      }
      await knex()('settings').where('key', 'mail.smtp').delete()
      await forget()
      await mail.close('smtp')
    }
  })

  test('saved settings send at once, without a restart, and the password never leaves', async ({
    client,
    assert,
  }) => {
    const sink = await smtpSink({ auth: { user: 'mailer@example.test', pass: secret } })
    try {
      const values = {
        preset: 'custom',
        host: '127.0.0.1',
        port: sink.port,
        security: 'none',
        username: 'mailer@example.test',
        fromName: 'نظام الاختبار',
        fromAddress: 'sender@example.test',
      }
      const savedSettings = await store(client, values)
      savedSettings.assertStatus(200)
      assert.isFalse(savedSettings.body().data.hasPassword)
      // The password has its own JSON-only endpoint, so it is never flashed as old input.
      const mixed = await store(client, { ...values, password: secret })
      mixed.assertStatus(422)
      const form = await client
        .put('/admin/settings/mail/password')
        .loginAs(admin)
        .withCsrfToken()
        .form({ password: secret })
      form.assertStatus(415)
      const password = await asJson(
        client.put('/admin/settings/mail/password').loginAs(admin)
      ).json({ password: secret })
      password.assertStatus(200)
      assert.isTrue(password.body().data.hasPassword)

      const sent = await send(client)
      sent.assertStatus(200)
      assert.deepEqual(sink.logins, ['mailer@example.test'])
      assert.lengthOf(sink.messages, 1)
      assert.include(sink.messages[0], 'sender@example.test')

      // A new sender applies to the next message in the same process: no restart, no reload.
      ;(await store(client, { fromAddress: 'billing@example.test' })).assertStatus(200)
      ;(await send(client)).assertStatus(200)
      assert.lengthOf(sink.messages, 2)
      assert.include(sink.messages[1], 'billing@example.test')
      assert.notInclude(sink.messages[1], 'sender@example.test')

      // A wrong password reads as a refused login, in Arabic, with the field to fix.
      ;(
        await asJson(client.put('/admin/settings/mail/password').loginAs(admin)).json({
          password: wrong,
        })
      ).assertStatus(200)
      const refused = await send(client)
      refused.assertStatus(502)
      assert.equal(refused.body().error.code, 'E_MAIL_TEST_SEND')
      assert.include(refused.body().error.message, 'رفض خادم البريد اسم المستخدم')

      const page = await asPage(client.get('/admin/settings').loginAs(admin))
      const props = page.body().props
      assert.equal(props.mailReadiness.source, 'settings')
      assert.isTrue(props.mailReadiness.configured)
      assert.isTrue(props.mailSettings.hasPassword)
      assert.equal(props.mailSettings.fromAddress, 'billing@example.test')
      const setup = await asPage(client.get('/admin/setup').loginAs(admin))

      const surfaces = [
        JSON.stringify(savedSettings.body()),
        JSON.stringify(mixed.body()),
        JSON.stringify(password.body()),
        JSON.stringify(refused.body()),
        JSON.stringify(props),
        JSON.stringify(setup.body().props),
        JSON.stringify(await knex()('activities').where('resource', 'core.mail')),
        JSON.stringify(
          await knex()('settings').whereIn('key', ['mail.smtp', 'mail.delivery_test'])
        ),
        JSON.stringify((await asJson(client.get('/admin/settings').loginAs(admin))).body()),
      ]
      for (const surface of surfaces) {
        assert.notInclude(surface, secret)
        assert.notInclude(surface, wrong)
      }
      const audit = await knex()('activities')
        .where({ resource: 'core.mail', actor_id: admin.id })
        .whereIn('action', ['settings.update', 'password.set'])
      assert.isAtLeast(audit.length, 4)

      const removed = await asJson(client.delete('/admin/settings/mail/password').loginAs(admin))
      removed.assertStatus(200)
      assert.isFalse(removed.body().data.hasPassword)
    } finally {
      await sink.close()
    }
  })

  test('the environment applies while nothing is stored, and MAIL_SETTINGS_SOURCE=environment overrides', async ({
    client,
    assert,
  }) => {
    const fromEnvironment = await smtpSink()
    const fromSettings = await smtpSink()
    try {
      env.set('SMTP_HOST', '127.0.0.1')
      env.set('SMTP_PORT', fromEnvironment.port)
      env.set('SMTP_SECURE', false)
      env.set('SMTP_REQUIRE_TLS', false)
      env.set('SMTP_USERNAME', '')
      env.set('SMTP_PASSWORD', '')
      env.set('MAIL_FROM_ADDRESS', 'environment@example.test')
      ;(await send(client)).assertStatus(200)
      // The environment's sender is read at start, as before; only the connection is checked.
      assert.lengthOf(fromEnvironment.messages, 1)
      let props = (await asPage(client.get('/admin/settings').loginAs(admin))).body().props
      assert.equal(props.mailReadiness.source, 'environment')
      assert.isFalse(props.mailSettings.configured)

      ;(
        await store(client, {
          preset: 'custom',
          host: '127.0.0.1',
          port: fromSettings.port,
          security: 'none',
          username: '',
          fromName: '',
          fromAddress: 'settings@example.test',
        })
      ).assertStatus(200)
      ;(await send(client)).assertStatus(200)
      assert.lengthOf(fromSettings.messages, 1)
      assert.include(fromSettings.messages[0], 'settings@example.test')
      assert.lengthOf(fromEnvironment.messages, 1)

      // The server's own override wins over the stored settings, which stay saved.
      env.set('MAIL_SETTINGS_SOURCE', 'environment')
      ;(await send(client)).assertStatus(200)
      assert.lengthOf(fromEnvironment.messages, 2)
      assert.lengthOf(fromSettings.messages, 1)
      props = (await asPage(client.get('/admin/settings').loginAs(admin))).body().props
      assert.isFalse(props.mailSettingsApply)
      assert.equal(props.mailReadiness.source, 'environment')
      assert.isTrue(props.mailSettings.configured)
    } finally {
      await fromEnvironment.close()
      await fromSettings.close()
    }
  })

  test('only administrators change mail settings, and internal hosts need the opt-in', async ({
    client,
    assert,
  }) => {
    const values = { host: 'smtp.gmail.com', port: 465, security: 'tls', fromAddress: 'a@b.co' }
    const requests = [
      client.put('/admin/settings/mail').json(values),
      client.put('/admin/settings/mail/password').json({ password: secret }),
      client.delete('/admin/settings/mail/password'),
    ]
    for (const request of requests) {
      const response = await request
        .loginAs(member)
        .withCsrfToken()
        .header('Accept', 'application/json')
      response.assertStatus(403)
    }
    assert.isUndefined(await knex()('settings').where('key', 'mail.smtp').first())

    env.set('WEBHOOKS_ALLOW_PRIVATE', false)
    for (const host of ['127.0.0.1', '169.254.169.254', '10.0.0.8']) {
      const refused = await store(client, { ...values, host })
      refused.assertStatus(422)
      assert.equal(refused.body().error.code, 'E_MAIL_HOST')
    }
    const injected = await store(client, {
      ...values,
      host: '127.0.0.1',
      fromName: 'x\r\nBcc: victim@example.test',
    })
    injected.assertStatus(422)
    assert.isUndefined(await knex()('settings').where('key', 'mail.smtp').first())
  })
})
