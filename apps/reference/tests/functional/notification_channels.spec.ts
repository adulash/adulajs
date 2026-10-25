import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test } from '@japa/runner'
import type { ApiRequest } from '@japa/api-client'
import db from '@adonisjs/lucid/services/db'
import encryption from '@adonisjs/core/services/encryption'
import mail from '@adonisjs/mail/services/main'
import limiter from '@adonisjs/limiter/services/main'
import {
  HTTP_CHANNEL_SETTING_KEY,
  HttpChannelSettings,
  notifyWithTemplate,
  signWebhook,
} from 'adula'
import { adula } from '#services/adula'
import env from '#start/env'
import { deliverNotificationChannels } from '#services/notification_channels'
import { seedActor, type UiActor } from '#tests/helpers/ui_fixtures'

const knex = () => db.connection().getWriteClient()
const asJson = (request: ApiRequest) => request.withCsrfToken().header('Accept', 'application/json')

type Received = { headers: Record<string, string>; body: string }

/** A local SMS/WhatsApp provider; WEBHOOKS_ALLOW_PRIVATE lets the test reach loopback. */
async function fakeProvider() {
  const received: Received[] = []
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => (body += chunk))
    request.on('end', () => {
      received.push({ headers: request.headers as Record<string, string>, body })
      response.writeHead(202).end('accepted')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/sms`,
    received,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

test.group('Notification channels', (group) => {
  let admin: UiActor
  let member: UiActor
  let other: UiActor
  let provider: Awaited<ReturnType<typeof fakeProvider>>
  /** Each test configures the provider itself, so none depends on another's order. */
  const configureProvider = async () => {
    const { secret } = await adula().channelSettings.save(
      admin.user.id,
      { enabled: true, kind: 'sms', url: provider.url },
      { rotate: true }
    )
    return secret!
  }
  /** A fresh user with SMS enabled at `phone` and e-mail on or off. */
  const subscriber = async (phone: string, mailOn: boolean) => {
    const actor = await seedActor([{ subject: 'orders', action: 'view' }], { level: 0 })
    await knex()('user_notification_channels').insert([
      {
        user_id: actor.user.id,
        channel: 'sms',
        enabled: true,
        address: phone,
        confirmed_at: knex().fn.now(),
      },
      { user_id: actor.user.id, channel: 'mail', enabled: mailOn, address: null },
    ])
    return actor
  }
  group.each.setup(async () => {
    await limiter.clear(['memory'])
  })
  group.setup(async () => {
    admin = await seedActor([{ subject: 'all', action: 'manage' }], { fullName: 'مدير القنوات' })
    member = await seedActor([{ subject: 'orders', action: 'view' }], { level: 0 })
    other = await seedActor([{ subject: 'orders', action: 'view' }], { level: 0 })
    provider = await fakeProvider()
    return async () => {
      await provider.close()
      await knex()('settings').where('key', HTTP_CHANNEL_SETTING_KEY).delete()
    }
  })

  test('only administrators configure the provider; its secret is sealed and shown once', async ({
    client,
    assert,
  }) => {
    for (const [verb, path] of [
      ['put', '/admin/settings/channels'],
      ['post', '/admin/settings/channels/rotate'],
      ['post', '/admin/settings/channels/test'],
    ] as const) {
      const denied = await asJson(client[verb](path).loginAs(member.user)).json({})
      denied.assertStatus(403)
    }
    const invalid = await asJson(client.put('/admin/settings/channels').loginAs(admin.user)).json({
      enabled: true,
      kind: 'pager',
      url: provider.url,
    })
    invalid.assertStatus(422)

    const saved = await asJson(client.put('/admin/settings/channels').loginAs(admin.user)).json({
      enabled: true,
      kind: 'sms',
      url: provider.url,
    })
    saved.assertStatus(200)
    const secret = saved.body().data.secret as string
    assert.isString(secret)
    assert.deepInclude(saved.body().data.config, { enabled: true, kind: 'sms', hasSecret: true })
    const row = await knex()('settings').where('key', HTTP_CHANNEL_SETTING_KEY).first()
    assert.notInclude(JSON.stringify(row.value), secret)
    assert.equal(encryption.decrypt<string>(row.value.secret), secret)

    // Neither the settings list nor the page carries the secret or its sealed value.
    const listed = await asJson(client.get('/admin/settings').loginAs(admin.user))
    listed.assertStatus(200)
    assert.notInclude(JSON.stringify(listed.body()), secret)
    assert.notInclude(JSON.stringify(listed.body()), row.value.secret)
    const page = await client
      .get('/admin/settings')
      .header('Accept', 'text/html')
      .withInertia()
      .loginAs(admin.user)
    page.assertStatus(200)
    assert.deepInclude(page.body().props.messagingChannel, { kind: 'sms', url: provider.url })
    assert.notInclude(JSON.stringify(page.body().props), row.value.secret)
    // The generic settings editor cannot overwrite the provider.
    const generic = await asJson(client.put('/admin/settings').loginAs(admin.user)).json({
      key: HTTP_CHANNEL_SETTING_KEY,
      scope: 'system',
      value: { enabled: true, kind: 'sms', url: 'https://attacker.example' },
    })
    generic.assertStatus(403)

    const again = await asJson(client.put('/admin/settings/channels').loginAs(admin.user)).json({
      enabled: true,
      kind: 'sms',
      url: provider.url,
    })
    assert.isNull(again.body().data.secret)
    const rotated = await asJson(client.post('/admin/settings/channels/rotate').loginAs(admin.user))
    rotated.assertStatus(200)
    const fresh = rotated.body().data.secret as string
    assert.notEqual(fresh, secret)

    const tested = await asJson(
      client.post('/admin/settings/channels/test').loginAs(admin.user)
    ).json({ to: '+966500000099' })
    tested.assertStatus(200)
    assert.deepEqual(tested.body().data, { sent: true, error: null })
    const request = provider.received.at(-1)!
    assert.equal(JSON.parse(request.body).to, '+966500000099')
    assert.equal(
      request.headers['x-adula-signature'],
      `sha256=${signWebhook(fresh, request.headers['x-adula-timestamp'], request.body)}`
    )
  })

  test('a user changes only their own channels from the profile', async ({ client, assert }) => {
    await configureProvider()
    const user = await seedActor([{ subject: 'orders', action: 'view' }], { level: 0 })
    const page = await client
      .get('/account/profile')
      .header('Accept', 'text/html')
      .withInertia()
      .loginAs(user.user)
    page.assertStatus(200)
    assert.deepEqual(
      page.body().props.notificationChannels.map((row: { key: string }) => row.key),
      ['in_app', 'mail', 'sms']
    )

    const missing = await asJson(
      client.put('/account/notification-channels').loginAs(user.user)
    ).json({ channels: [{ key: 'sms', enabled: true }] })
    missing.assertStatus(422)
    const locked = await asJson(
      client.put('/account/notification-channels').loginAs(user.user)
    ).json({ channels: [{ key: 'in_app', enabled: false }] })
    locked.assertStatus(422)

    // A number is never stored without its confirmation code.
    const unconfirmed = await asJson(
      client.put('/account/notification-channels').loginAs(user.user)
    ).json({ channels: [{ key: 'sms', enabled: true, address: '+966 50 000 0001' }] })
    unconfirmed.assertStatus(422)
    assert.equal(unconfirmed.body().error.code, 'E_CHANNEL_CONFIRM')

    // A user id in the body is ignored: the signed-in user is the only subject.
    const saved = await asJson(
      client.put('/account/notification-channels').loginAs(user.user)
    ).json({ userId: other.user.id, channels: [{ key: 'mail', enabled: false }] })
    saved.assertStatus(200)
    assert.deepInclude(
      saved.body().data.find((row: { key: string }) => row.key === 'mail'),
      { enabled: false }
    )
    const rows = await knex()('user_notification_channels').whereIn('user_id', [
      user.user.id,
      other.user.id,
    ])
    assert.isTrue(rows.every((row) => row.user_id === user.user.id))
    assert.lengthOf(rows, 1)
    // The change is logged with the acting user, never with the phone number.
    const logged = await knex()('activities')
      .where({
        resource: 'users',
        record_id: user.user.id,
        action: 'notification_channels_updated',
      })
      .first()
    assert.equal(logged.actor_id, user.user.id)
    assert.deepInclude(logged.changes.channels, { key: 'mail', enabled: false })

    const anonymous = await client
      .put('/account/notification-channels')
      .header('Accept', 'application/json')
      .json({ channels: [] })
    assert.notEqual(anonymous.status(), 200)
  })

  test('an administrator acting as a user cannot change their channels', async ({
    client,
    assert,
  }) => {
    await configureProvider()
    const target = await subscriber('+966500000020', true)
    const response = await asJson(
      client
        .put('/account/notification-channels')
        .loginAs(target.user)
        .withSession({ impersonator_id: { adminId: admin.user.id, targetId: target.user.id } })
    ).json({ channels: [{ key: 'sms', enabled: true, address: '+966599999999' }] })
    response.assertStatus(403)
    assert.equal(response.body().error.code, 'E_IMPERSONATING')
    const before = provider.received.length
    for (const [path, body] of [
      ['/account/notification-channels/sms/code', { address: '+966599999999' }],
      ['/account/notification-channels/sms/confirm', { code: '123456' }],
    ] as const) {
      const refused = await asJson(
        client
          .post(path)
          .loginAs(target.user)
          .withSession({ impersonator_id: { adminId: admin.user.id, targetId: target.user.id } })
      ).json(body)
      refused.assertStatus(403)
      assert.equal(refused.body().error.code, 'E_IMPERSONATING')
    }
    assert.equal(provider.received.length, before)
    const row = await knex()('user_notification_channels')
      .where({ user_id: target.user.id, channel: 'sms' })
      .first()
    assert.equal(row.address, '+966500000020')
    const logged = await knex()('activities').where({
      record_id: target.user.id,
      action: 'notification_channels_updated',
    })
    assert.lengthOf(logged, 0)
  })

  test('the worker step delivers through the provider and skips users who opted out', async ({
    assert,
  }) => {
    const secret = await configureProvider()
    const texter = await subscriber('+966500000031', false)
    const mailer = await seedActor([{ subject: 'orders', action: 'view' }], { level: 0 })
    const { messages } = mail.fake()
    try {
      await notifyWithTemplate(
        knex(),
        texter.user.id,
        'assignment.created',
        { title: 'مراجعة العقد', resource: 'الطلبات', id: 5 },
        undefined,
        { resource: 'orders', recordId: 5 }
      )
      // `mailer` never enabled SMS: nothing is queued for them.
      await notifyWithTemplate(knex(), mailer.user.id, 'assignment.created', { title: 'ب' })
      const queued = await knex()('notification_deliveries as d')
        .join('notifications as n', 'n.id', 'd.notification_id')
        .whereIn('n.user_id', [texter.user.id, mailer.user.id])
        .select('d.id', 'n.user_id')
      assert.deepEqual(
        queued.map((row) => row.user_id),
        [texter.user.id]
      )
      await deliverNotificationChannels()
      const mine = provider.received.filter(
        (request) => JSON.parse(request.body).id === queued[0].id
      )
      assert.lengthOf(mine, 1)
      const body = JSON.parse(mine[0].body)
      assert.equal(body.to, '+966500000031')
      assert.equal(body.text, 'مراجعة العقد — الطلبات #5')
      assert.equal(body.link, new URL('/resources/orders/5', env.get('APP_URL')).toString())
      assert.equal(
        mine[0].headers['x-adula-signature'],
        `sha256=${signWebhook(secret, mine[0].headers['x-adula-timestamp'], mine[0].body)}`
      )
      const delivery = await knex()('notification_deliveries').where('id', queued[0].id).first()
      assert.equal(delivery.state, 'sent')
      // The texter turned e-mail off; the other user still receives it.
      const states = await knex()('notifications')
        .whereIn('user_id', [texter.user.id, mailer.user.id])
        .orderBy('id')
        .pluck('mail_state')
      assert.deepEqual(states, ['skipped', 'sent'])
      messages.assertSentCount({ to: mailer.user.email }, 1)
      messages.assertSentCount({ to: texter.user.email }, 0)

      // Turning the provider off: queued messages are dropped, not sent later.
      await notifyWithTemplate(knex(), texter.user.id, 'assignment.created', { title: 'ج' })
      const current = await knex()('settings').where('key', HTTP_CHANNEL_SETTING_KEY).first()
      await knex()('settings')
        .where('key', HTTP_CHANNEL_SETTING_KEY)
        .update({ value: JSON.stringify({ ...current.value, enabled: false }) })
      const sentBefore = provider.received.length
      await deliverNotificationChannels()
      const dropped = await knex()('notification_deliveries as d')
        .join('notifications as n', 'n.id', 'd.notification_id')
        .where('n.user_id', texter.user.id)
        .orderBy('d.created_at', 'desc')
        .first('d.state', 'd.error_category')
      assert.deepEqual(dropped, { state: 'skipped', error_category: 'channel-unavailable' })
      assert.equal(provider.received.length, sentBefore)
    } finally {
      mail.restore()
    }
  })

  test('e-mail keeps flowing and SMS waits when the provider lookup fails', async ({ assert }) => {
    await configureProvider()
    const reader = await subscriber('+966500000041', true)
    const original = HttpChannelSettings.prototype.resolve
    const { messages } = mail.fake()
    HttpChannelSettings.prototype.resolve = async () => {
      throw new Error('broken provider setting')
    }
    try {
      await notifyWithTemplate(knex(), reader.user.id, 'assignment.created', { title: 'د' })
      await deliverNotificationChannels()
      const row = await knex()('notifications').where('user_id', reader.user.id).first()
      assert.equal(row.mail_state, 'sent')
      messages.assertSentCount({ to: reader.user.email }, 1)
      // A failed read proves nothing about the provider: the SMS stays queued.
      const waiting = await knex()('notification_deliveries')
        .where('notification_id', row.id)
        .first()
      assert.equal(waiting.state, 'pending')
      assert.isNull(waiting.error_category)

      HttpChannelSettings.prototype.resolve = original
      await deliverNotificationChannels()
      const sent = await knex()('notification_deliveries').where('id', waiting.id).first()
      assert.equal(sent.state, 'sent')
      assert.lengthOf(
        provider.received.filter((request) => JSON.parse(request.body).id === waiting.id),
        1
      )
    } finally {
      HttpChannelSettings.prototype.resolve = original
      mail.restore()
    }
  })

  test('a new number is enabled by the code sent to it, and codes are throttled', async ({
    client,
    assert,
  }) => {
    await configureProvider()
    const user = await seedActor([{ subject: 'orders', action: 'view' }], { level: 0 })
    const before = provider.received.length
    const requested = await asJson(
      client.post('/account/notification-channels/sms/code').loginAs(user.user)
    ).json({ address: '+966 50 000 0051' })
    requested.assertStatus(200)
    assert.isString(requested.body().data.expiresAt)
    const [message] = provider.received.slice(before)
    const body = JSON.parse(message.body)
    assert.equal(body.to, '+966500000051')
    const code = /: (\d{6})\./.exec(body.text)![1]
    // Not enabled until confirmed, and the code itself is not stored.
    assert.lengthOf(await knex()('user_notification_channels').where('user_id', user.user.id), 0)
    const stored = await knex()('notification_channel_confirmations')
      .where('user_id', user.user.id)
      .first()
    assert.notInclude(Object.values(stored).map(String), code)

    // A second code within a minute is refused by the channel; the route allows three per
    // fifteen minutes, then the limiter answers 429 itself.
    for (let attempt = 0; attempt < 2; attempt++) {
      const early = await asJson(
        client.post('/account/notification-channels/sms/code').loginAs(user.user)
      ).json({ address: '+966500000052' })
      early.assertStatus(429)
      assert.equal(early.body().error.code, 'E_CHANNEL_CODE_WAIT')
    }
    const limited = await asJson(
      client.post('/account/notification-channels/sms/code').loginAs(user.user)
    ).json({ address: '+966500000052' })
    limited.assertStatus(429)
    assert.notEqual(limited.body().error?.code, 'E_CHANNEL_CODE_WAIT')
    assert.lengthOf(provider.received.slice(before), 1)
    const wrong = await asJson(
      client.post('/account/notification-channels/sms/confirm').loginAs(user.user)
    ).json({ code: code === '000000' ? '111111' : '000000' })
    wrong.assertStatus(422)
    assert.equal(wrong.body().error.code, 'E_CHANNEL_CODE')
    const confirmed = await asJson(
      client.post('/account/notification-channels/sms/confirm').loginAs(user.user)
    ).json({ code })
    confirmed.assertStatus(200)
    assert.deepInclude(
      confirmed.body().data.find((row: { key: string }) => row.key === 'sms'),
      { enabled: true, address: '+966500000051' }
    )
    const logged = await knex()('activities')
      .where({ record_id: user.user.id, action: 'notification_channel_confirmed' })
      .first()
    assert.equal(logged.actor_id, user.user.id)
    assert.equal(logged.changes.channel, 'sms')
    assert.notInclude(JSON.stringify(logged.changes), '966500000051')

    // «حذف الرقم» removes the confirmed number and turns the channel off.
    const removed = await asJson(
      client.put('/account/notification-channels').loginAs(user.user)
    ).json({ channels: [{ key: 'sms', enabled: false, address: '' }] })
    removed.assertStatus(200)
    const row = await knex()('user_notification_channels')
      .where({ user_id: user.user.id, channel: 'sms' })
      .first()
    assert.deepInclude(row, { enabled: false, address: null, confirmed_at: null })
  })

  test('provider test messages are throttled', async ({ client, assert }) => {
    await configureProvider()
    for (let attempt = 0; attempt < 5; attempt++) {
      const tested = await asJson(
        client.post('/admin/settings/channels/test').loginAs(admin.user)
      ).json({ to: '+966500000099' })
      tested.assertStatus(200)
    }
    const limited = await asJson(
      client.post('/admin/settings/channels/test').loginAs(admin.user)
    ).json({ to: '+966500000099' })
    limited.assertStatus(429)
    assert.isString(JSON.stringify(limited.body()))
  })
})
