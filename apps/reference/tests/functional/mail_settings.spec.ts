import { test } from '@japa/runner'
import { randomUUID } from 'node:crypto'
import type { ApiRequest } from '@japa/api-client'
import db from '@adonisjs/lucid/services/db'
import mail from '@adonisjs/mail/services/main'
import limiter from '@adonisjs/limiter/services/main'
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
  const expectStatus = async (request: Promise<any>, status: number) => {
    const response = await request
    response.assertStatus(status)
    return response
  }
  const bodyOf = async (request: Promise<any>) => {
    const response = await request
    return response.body()
  }
  const propsOf = async (request: Promise<any>) => {
    const body = await bodyOf(request)
    return body.props
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
    await limiter.clear(['memory'])
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
      await expectStatus(store(client, { fromAddress: 'billing@example.test' }), 200)
      await expectStatus(send(client), 200)
      assert.lengthOf(sink.messages, 2)
      assert.include(sink.messages[1], 'billing@example.test')
      assert.notInclude(sink.messages[1], 'sender@example.test')

      // A wrong password reads as a refused login, in Arabic, with the field to fix.
      await expectStatus(
        asJson(client.put('/admin/settings/mail/password').loginAs(admin)).json({
          password: wrong,
        }),
        200
      )
      const refused = await send(client)
      refused.assertStatus(502)
      assert.equal(refused.body().error.code, 'E_MAIL_TEST_SEND')
      assert.include(refused.body().error.message, 'رفض خادم البريد اسم المستخدم')

      const page = await asPage(client.get('/admin/settings/mail').loginAs(admin))
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
        JSON.stringify(await bodyOf(asJson(client.get('/admin/settings').loginAs(admin)))),
        JSON.stringify(await propsOf(asPage(client.get('/admin/settings').loginAs(admin)))),
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
      await expectStatus(send(client), 200)
      // The environment's sender is read at start, as before; only the connection is checked.
      assert.lengthOf(fromEnvironment.messages, 1)
      let props = await propsOf(asPage(client.get('/admin/settings/mail').loginAs(admin)))
      assert.equal(props.mailReadiness.source, 'environment')
      assert.isFalse(props.mailSettings.configured)

      await expectStatus(
        store(client, {
          preset: 'custom',
          host: '127.0.0.1',
          port: fromSettings.port,
          security: 'none',
          username: '',
          fromName: '',
          fromAddress: 'settings@example.test',
        }),
        200
      )
      await expectStatus(send(client), 200)
      assert.lengthOf(fromSettings.messages, 1)
      assert.include(fromSettings.messages[0], 'settings@example.test')
      assert.lengthOf(fromEnvironment.messages, 1)

      // The server's own override wins over the stored settings, which stay saved.
      env.set('MAIL_SETTINGS_SOURCE', 'environment')
      await expectStatus(send(client), 200)
      assert.lengthOf(fromEnvironment.messages, 2)
      assert.lengthOf(fromSettings.messages, 1)
      props = await propsOf(asPage(client.get('/admin/settings/mail').loginAs(admin)))
      assert.isFalse(props.mailSettingsApply)
      assert.equal(props.mailReadiness.source, 'environment')
      assert.isTrue(props.mailSettings.configured)
    } finally {
      await fromEnvironment.close()
      await fromSettings.close()
    }
  })

  test('only administrators reach the mail tab or change mail settings', async ({
    client,
    assert,
  }) => {
    const values = { host: 'smtp.gmail.com', port: 465, security: 'tls', fromAddress: 'a@b.co' }
    const requests = [
      client.get('/admin/settings/mail'),
      client.put('/admin/settings/mail').json(values),
      client.put('/admin/settings/mail/password').json({ password: secret }),
      client.delete('/admin/settings/mail/password'),
      client.post('/admin/settings/mail/test'),
    ]
    for (const request of requests) {
      const response = await request
        .loginAs(member)
        .withCsrfToken()
        .header('Accept', 'application/json')
      response.assertStatus(403)
    }
    // A page visit is refused the same way, without the settings in its props.
    const page = await asPage(client.get('/admin/settings/mail').loginAs(member))
    assert.notProperty(page.body().props ?? {}, 'mailSettings')
    assert.isUndefined(await knex()('settings').where('key', 'mail.smtp').first())
    // Nor can an administrator bypass the checks through the generic settings editor.
    const generic = await asJson(client.put('/admin/settings').loginAs(admin)).json({
      key: 'mail.smtp',
      scope: 'system',
      value: JSON.stringify({ host: '169.254.169.254', port: 25, security: 'none' }),
    })
    generic.assertStatus(403)
    assert.isUndefined(await knex()('settings').where('key', 'mail.smtp').first())
    // The general settings tab no longer carries the mail props; the «البريد» tab does.
    const general = await asPage(client.get('/admin/settings').loginAs(admin))
    assert.notProperty(general.body().props, 'mailSettings')
    const tab = await asPage(client.get('/admin/settings/mail').loginAs(admin))
    assert.equal(tab.body().component, 'admin/settings/mail')
    assert.isFalse(tab.body().props.mailSettings.configured)
  })

  test('internal hosts need the opt-in, at saving and again at sending', async ({
    client,
    assert,
  }) => {
    const values = { host: 'smtp.gmail.com', port: 465, security: 'tls', fromAddress: 'a@b.co' }
    env.set('WEBHOOKS_ALLOW_PRIVATE', false)
    for (const host of ['127.0.0.1', '169.254.169.254', '10.0.0.8', '::1']) {
      const refused = await store(client, { ...values, host })
      refused.assertStatus(422)
      assert.equal(refused.body().error.code, 'E_MAIL_HOST')
    }
    assert.isUndefined(await knex()('settings').where('key', 'mail.smtp').first())

    // Saved while the opt-in was on: once it is off, the next message is refused before any
    // connection, so a stored (or re-resolved) internal address is never reached.
    const sink = await smtpSink()
    try {
      env.set('WEBHOOKS_ALLOW_PRIVATE', true)
      const internal = { ...values, host: '127.0.0.1', port: sink.port, security: 'none' }
      await expectStatus(store(client, internal), 200)
      env.set('WEBHOOKS_ALLOW_PRIVATE', false)
      const refused = await send(client)
      refused.assertStatus(502)
      assert.equal(refused.body().error.code, 'E_MAIL_TEST_SEND')
      assert.lengthOf(sink.messages, 0)
    } finally {
      await sink.close()
    }
  })

  test('unencrypted SMTP is for internal relays only', async ({ client, assert }) => {
    // An address literal, so nothing is resolved or contacted: a public server with «بلا تشفير»
    // would carry the password and the messages in clear text.
    const values = { host: '8.8.8.8', port: 587, fromAddress: 'a@b.co' }
    const plain = await store(client, { ...values, security: 'none' })
    plain.assertStatus(422)
    assert.equal(plain.body().error.code, 'E_MAIL_SECURITY')
    assert.isUndefined(await knex()('settings').where('key', 'mail.smtp').first())
    await expectStatus(store(client, { ...values, security: 'starttls' }), 200)
    // Switching an existing public server to no encryption is refused as well.
    const switched = await store(client, { security: 'none' })
    switched.assertStatus(422)
    assert.equal(switched.body().error.code, 'E_MAIL_SECURITY')
    const kept = await knex()('settings').where('key', 'mail.smtp').first()
    assert.equal(kept.value.security, 'starttls')
    // An internal relay may still go without encryption (it needs the private opt-in).
    await expectStatus(store(client, { host: '127.0.0.1', security: 'none' }), 200)
  })

  test('sender fields cannot add headers to a message', async ({ client, assert }) => {
    // The host is valid (loopback with the opt-in), so each refusal is the field's own.
    const values = { host: '127.0.0.1', port: 2525, security: 'none', fromAddress: 'a@b.co' }
    const cases: [Record<string, string>, string][] = [
      [{ fromName: 'x\r\nBcc: victim@example.test' }, 'E_MAIL_FROM_NAME'],
      [{ fromName: 'x <victim@example.test>' }, 'E_MAIL_FROM_NAME'],
      [{ fromAddress: 'a@b.co\r\nBcc: victim@example.test' }, 'E_MAIL_FROM_ADDRESS'],
      [{ fromAddress: 'a@b.co, victim@example.test' }, 'E_MAIL_FROM_ADDRESS'],
      [{ username: 'user\r\nRCPT TO:<victim@example.test>' }, 'E_MAIL_USERNAME'],
    ]
    for (const [field, code] of cases) {
      const refused = await store(client, { ...values, ...field })
      refused.assertStatus(422)
      assert.equal(refused.body().error.code, code, JSON.stringify(field))
    }
    assert.isUndefined(await knex()('settings').where('key', 'mail.smtp').first())
    await expectStatus(store(client, values), 200)
    const password = await asJson(client.put('/admin/settings/mail/password').loginAs(admin)).json({
      password: 'a\r\nQUIT',
    })
    password.assertStatus(422)
    assert.equal(password.body().error.code, 'E_MAIL_PASSWORD')
  })

  test('«إرسال بريد تجريبي» is rate limited per administrator', async ({ client, assert }) => {
    const sink = await smtpSink()
    try {
      const internal = {
        preset: 'custom',
        host: '127.0.0.1',
        port: sink.port,
        security: 'none',
        fromAddress: 'sender@example.test',
      }
      await expectStatus(store(client, internal), 200)
      // Each request clears the one-minute cooldown first, so only the limiter can refuse.
      for (let attempt = 0; attempt < 5; attempt++) await expectStatus(send(client), 200)
      const limited = await send(client)
      limited.assertStatus(429)
      assert.lengthOf(sink.messages, 5)
    } finally {
      await sink.close()
    }
  })
})
