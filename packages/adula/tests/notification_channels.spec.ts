import { randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test } from '@japa/runner'
import {
  CHANNEL_MAX_ATTEMPTS,
  HTTP_CHANNEL_SETTING_KEY,
  HttpChannelSettings,
  NotificationChannels,
  SettingsAdmin,
  createOutboundPoster,
  httpNotificationChannel,
  mailChannel,
  notifyWithTemplate,
  phoneAddress,
  signWebhook,
} from '../index.js'
import type { MailSender, NotificationChannel, SecretBox } from '../index.js'
import { db, setup } from './helpers.js'
import { failure } from './helpers/failure.js'
import { addUserProfileColumns, seedActor } from './helpers/actors.js'

const box: SecretBox = {
  seal: (value) => `sealed:${Buffer.from(value).toString('base64')}`,
  open: (value) =>
    value.startsWith('sealed:') ? Buffer.from(value.slice(7), 'base64').toString() : null,
}
// The fake provider listens on loopback, so only these tests allow private targets.
const testPolicy = { allowPrivateTargets: true }

type Received = { headers: Record<string, string>; body: string }

/** A local HTTP provider answering with the given statuses in turn (the last one repeats). */
async function fakeProvider(statuses: number[] = [200]) {
  const received: Received[] = []
  const server: Server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => (body += chunk))
    request.on('end', () => {
      received.push({ headers: request.headers as Record<string, string>, body })
      const status = statuses[Math.min(received.length - 1, statuses.length - 1)]
      response.writeHead(status).end('provider-internal-detail')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/messages`
  return {
    url,
    received,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

function smsChannel(url: string, secret = 'provider-secret') {
  return httpNotificationChannel({
    key: 'sms',
    url,
    secret,
    post: createOutboundPoster(testPolicy),
    link: (target) => `https://app.example.test/resources/${target.resource}/${target.recordId}`,
  })
}

const mails: string[] = []
const send: MailSender = async (message) => {
  mails.push(`${message.to}:${message.subject}`)
}

async function due() {
  await db('notification_deliveries')
    .where('state', 'pending')
    .update({ next_attempt_at: db.fn.now() })
}

test.group('Notification channels', (group) => {
  group.setup(async () => {
    await setup()
    await addUserProfileColumns()
    await seedActor({ id: 3 }, { email: 'off@example.test', disabled: true })
  })
  group.each.setup(async () => {
    mails.length = 0
    await db('notification_deliveries').del()
    await db('user_notification_channels').del()
    await db('notifications').del()
    await db('message_templates').del()
    await db('settings').where('key', HTTP_CHANNEL_SETTING_KEY).del()
  })

  test('preferences default to in-app and e-mail and validate every change', async ({ assert }) => {
    const channels = new NotificationChannels(db, [mailChannel(send), smsChannel('https://x')])
    const defaults = await channels.preferences(1)
    assert.deepEqual(
      defaults.map(({ key, enabled, locked, address }) => ({ key, enabled, locked, address })),
      [
        { key: 'in_app', enabled: true, locked: true, address: null },
        { key: 'mail', enabled: true, locked: false, address: null },
        { key: 'sms', enabled: false, locked: false, address: null },
      ]
    )
    const locked = await failure(channels.update(1, [{ key: 'in_app', enabled: false }]))
    assert.equal(locked.code, 'E_CHANNEL_LOCKED')
    const missing = await failure(channels.update(1, [{ key: 'sms', enabled: true }]))
    assert.equal(missing.code, 'E_CHANNEL_ADDRESS')
    const invalid = await failure(
      channels.update(1, [{ key: 'sms', enabled: true, address: '05-abc' }])
    )
    assert.equal(invalid.code, 'E_CHANNEL_ADDRESS')
    const unknown = await failure(channels.update(1, [{ key: 'fax', enabled: true }]))
    assert.equal(unknown.code, 'E_CHANNEL_UNKNOWN')
    assert.lengthOf(await db('user_notification_channels'), 0)

    const saved = await channels.update(1, [
      { key: 'mail', enabled: false },
      { key: 'sms', enabled: true, address: '+966 50 000 0001' },
    ])
    assert.deepEqual(
      saved.map(({ key, enabled, address }) => ({ key, enabled, address })),
      [
        { key: 'in_app', enabled: true, address: null },
        { key: 'mail', enabled: false, address: null },
        { key: 'sms', enabled: true, address: '+966500000001' },
      ]
    )
    // Another user's choices are untouched.
    const other = await channels.preferences(2)
    assert.deepEqual(
      other.map((row) => row.enabled),
      [true, true, false]
    )
    // Turning the channel off keeps the number for later.
    const off = await channels.update(1, [{ key: 'sms', enabled: false, address: '+966500000001' }])
    assert.deepEqual(
      off.find((row) => row.key === 'sms'),
      { ...off.find((row) => row.key === 'sms')!, enabled: false, address: '+966500000001' }
    )
    // Omitting the address keeps the stored number too, whether turning off or back on.
    await channels.update(1, [{ key: 'sms', enabled: false }])
    const omitted = await channels.update(1, [{ key: 'sms', enabled: true }])
    assert.equal(omitted.find((row) => row.key === 'sms')?.address, '+966500000001')
    assert.isTrue(omitted.find((row) => row.key === 'sms')?.enabled)
    // An explicitly empty address removes it.
    const cleared = await channels.update(1, [{ key: 'sms', enabled: false, address: '' }])
    assert.isNull(cleared.find((row) => row.key === 'sms')?.address)
  })

  test('notifyWithTemplate queues one delivery per enabled channel in the same transaction', async ({
    assert,
  }) => {
    const channels = new NotificationChannels(db, [mailChannel(send), smsChannel('https://x')])
    await channels.update(1, [
      { key: 'mail', enabled: false },
      { key: 'sms', enabled: true, address: '+966500000001' },
    ])
    await notifyWithTemplate(db, 1, 'assignment.created', { title: 'أ', resource: 'ط', id: 1 })
    await notifyWithTemplate(db, 2, 'assignment.created', { title: 'ب', resource: 'ط', id: 2 })
    // Templates without external delivery stay in the application.
    await notifyWithTemplate(db, 1, 'comment.created', { author: 'x', resource: 'ط', id: 3 })
    const rows = await db('notifications').orderBy('id')
    assert.deepEqual(
      rows.map((row) => [row.user_id, row.template_key, row.mail_state]),
      [
        [1, 'assignment.created', 'skipped'],
        [2, 'assignment.created', 'pending'],
        [1, 'comment.created', null],
      ]
    )
    const deliveries = await db('notification_deliveries')
    assert.lengthOf(deliveries, 1)
    assert.equal(deliveries[0].notification_id, rows[0].id)
    assert.equal(deliveries[0].channel, 'sms')
    assert.equal(deliveries[0].state, 'pending')

    await db
      .transaction(async (trx) => {
        await notifyWithTemplate(trx, 1, 'assignment.created', { title: 'ج' })
        throw new Error('rollback')
      })
      .catch(() => {})
    assert.lengthOf(await db('notifications'), 3)
    assert.lengthOf(await db('notification_deliveries'), 1)
  })

  test('the dispatcher sends e-mail and a signed provider request exactly once', async ({
    assert,
  }) => {
    const provider = await fakeProvider([200])
    try {
      const channels = new NotificationChannels(db, [mailChannel(send), smsChannel(provider.url)])
      await channels.update(1, [{ key: 'sms', enabled: true, address: '+966500000001' }])
      await notifyWithTemplate(
        db,
        1,
        'assignment.created',
        { title: 'مراجعة', resource: 'الطلبات', id: 7 },
        undefined,
        { resource: 'orders', recordId: 7 }
      )
      const result = await channels.deliver()
      assert.deepEqual(result, { sent: 2, failed: 0, skipped: 0 })
      assert.deepEqual(mails, ['admin@example.test:مهمة جديدة مسندة إليك'])
      assert.lengthOf(provider.received, 1)
      const [request] = provider.received
      const body = JSON.parse(request.body)
      const delivery = await db('notification_deliveries').first()
      assert.deepEqual(body, {
        id: delivery.id,
        channel: 'sms',
        to: '+966500000001',
        subject: 'مهمة جديدة مسندة إليك',
        text: 'مراجعة — الطلبات #7',
        link: 'https://app.example.test/resources/orders/7',
        timestamp: request.headers['x-adula-timestamp'],
      })
      assert.equal(request.headers['content-type'], 'application/json')
      assert.equal(request.headers['x-adula-delivery'], delivery.id)
      assert.equal(
        request.headers['x-adula-signature'],
        `sha256=${signWebhook('provider-secret', request.headers['x-adula-timestamp'], request.body)}`
      )
      assert.equal(delivery.state, 'sent')
      assert.equal(delivery.attempts, 1)
      assert.isNotNull(delivery.sent_at)

      assert.deepEqual(await channels.deliver(), { sent: 0, failed: 0, skipped: 0 })
      assert.lengthOf(provider.received, 1)
      assert.lengthOf(mails, 1)
    } finally {
      await provider.close()
    }
  })

  test('failures are retried with backoff and keep only the error category', async ({ assert }) => {
    const provider = await fakeProvider([503, 500, 200])
    try {
      const channels = new NotificationChannels(db, [smsChannel(provider.url)])
      await channels.update(1, [{ key: 'sms', enabled: true, address: '966500000001' }])
      await notifyWithTemplate(db, 1, 'assignment.created', { title: 'أ' })
      assert.deepEqual(await channels.deliver(), { sent: 0, failed: 1, skipped: 0 })
      let row = await db('notification_deliveries').first()
      assert.equal(row.state, 'pending')
      assert.equal(row.attempts, 1)
      assert.equal(row.error_category, 'http-status:503')
      assert.isAbove(new Date(row.next_attempt_at).getTime(), Date.now() + 30_000)
      // Not due yet: nothing is claimed.
      assert.deepEqual(await channels.deliver(), { sent: 0, failed: 0, skipped: 0 })
      await due()
      await channels.deliver()
      await due()
      assert.deepEqual(await channels.deliver(), { sent: 1, failed: 0, skipped: 0 })
      row = await db('notification_deliveries').first()
      assert.equal(row.state, 'sent')
      assert.equal(row.attempts, 3)
      assert.isNull(row.error_category)
      assert.lengthOf(provider.received, 3)
      // Every attempt is the same delivery id, so the provider can deduplicate.
      assert.lengthOf(new Set(provider.received.map((request) => JSON.parse(request.body).id)), 1)
      assert.equal(JSON.parse(provider.received[0].body).to, '+966500000001')
      assert.notInclude(JSON.stringify(row), 'provider-internal-detail')
    } finally {
      await provider.close()
    }

    // An unreachable provider fails with a category until the attempts run out.
    const closed = await fakeProvider()
    await closed.close()
    const channels = new NotificationChannels(db, [smsChannel(closed.url)])
    await notifyWithTemplate(db, 1, 'assignment.created', { title: 'ب' })
    for (let attempt = 0; attempt < CHANNEL_MAX_ATTEMPTS; attempt++) {
      await due()
      await channels.deliver()
    }
    const exhausted = await db('notification_deliveries').orderBy('created_at', 'desc').first()
    assert.equal(exhausted.state, 'failed')
    assert.equal(exhausted.attempts, CHANNEL_MAX_ATTEMPTS)
    assert.equal(exhausted.error_category, 'connect')
  })

  test('a disabled preference, a disabled user or an unregistered channel sends nothing', async ({
    assert,
  }) => {
    const provider = await fakeProvider([200])
    try {
      const channels = new NotificationChannels(db, [smsChannel(provider.url)])
      // Never enabled: nothing is queued at all.
      await notifyWithTemplate(db, 2, 'assignment.created', { title: 'أ' })
      assert.lengthOf(await db('notification_deliveries'), 0)
      // Enabled when queued, turned off before delivery: skipped.
      await channels.update(1, [{ key: 'sms', enabled: true, address: '+966500000001' }])
      await notifyWithTemplate(db, 1, 'assignment.created', { title: 'ب' })
      await channels.update(1, [{ key: 'sms', enabled: false, address: '+966500000001' }])
      // A disabled user's queued message is skipped too.
      await db('user_notification_channels').insert({
        user_id: 3,
        channel: 'sms',
        enabled: true,
        address: '+966500000003',
      })
      await notifyWithTemplate(db, 3, 'assignment.created', { title: 'ج' })
      assert.deepEqual(await channels.deliver(), { sent: 0, failed: 0, skipped: 2 })
      assert.lengthOf(provider.received, 0)
      assert.deepEqual(
        await db('notification_deliveries').orderBy('error_category').pluck('state'),
        ['skipped', 'skipped']
      )

      // The provider was turned off (not registered): queued messages are not sent later.
      await channels.update(1, [{ key: 'sms', enabled: true, address: '+966500000001' }])
      await notifyWithTemplate(db, 1, 'assignment.created', { title: 'د' })
      const withoutProvider = new NotificationChannels(db, [mailChannel(send)])
      const result = await withoutProvider.deliver()
      assert.equal(result.skipped, 1)
      const latest = await db('notification_deliveries').orderBy('created_at', 'desc').first()
      assert.equal(latest.state, 'skipped')
      assert.equal(latest.error_category, 'channel-unavailable')
      await channels.deliver()
      assert.lengthOf(provider.received, 0)
    } finally {
      await provider.close()
    }
  })

  test('the provider secret is sealed in settings, returned once and rotated', async ({
    assert,
  }) => {
    const settings = new HttpChannelSettings(db, box, testPolicy)
    assert.isNull(await settings.read())
    const kind = await failure(settings.save(1, { enabled: true, kind: 'fax', url: 'https://x' }))
    assert.equal(kind.code, 'E_CHANNEL_KIND')
    const strict = new HttpChannelSettings(db, box)
    for (const url of [
      'http://sms.example.test/send',
      'https://127.0.0.1/send',
      'nope',
      'https://user:pass@sms.example.test/send',
      'https://sms.example.test/send?api_key=secret',
      'https://sms.example.test/send#token',
    ]) {
      const refused = await failure(strict.save(1, { enabled: true, kind: 'sms', url }))
      assert.equal(refused.code, 'E_CHANNEL_URL')
    }

    const provider = await fakeProvider([200])
    try {
      const first = await settings.save(1, { enabled: true, kind: 'whatsapp', url: provider.url })
      assert.isString(first.secret)
      assert.deepEqual(first.config, {
        enabled: true,
        kind: 'whatsapp',
        url: provider.url,
        hasSecret: true,
        updatedAt: first.config.updatedAt,
      })
      const row = await db('settings').where('key', HTTP_CHANNEL_SETTING_KEY).first()
      assert.notInclude(JSON.stringify(row.value), first.secret!)
      assert.equal(box.open(row.value.secret), first.secret)
      // The settings screen lists the key read-only and without the sealed value.
      const system = await new SettingsAdmin(db).list('system')
      const listed = system.find((setting) => setting.key === HTTP_CHANNEL_SETTING_KEY)!
      assert.isTrue(listed.readOnly)
      assert.notProperty(listed.value as object, 'secret')
      const generic = await failure(
        new SettingsAdmin(db).upsert(1, {
          key: HTTP_CHANNEL_SETTING_KEY,
          scope: 'system',
          value: { url: 'https://attacker.example' },
        })
      )
      assert.equal(generic.status, 403)
      const logged = await db('activities')
        .where('resource', 'core.settings')
        .whereRaw("changes->>'key' = ?", [HTTP_CHANNEL_SETTING_KEY])
      assert.lengthOf(logged, 1)
      assert.notInclude(
        JSON.stringify(await db('activities').where('resource', 'core.settings')),
        first.secret!
      )

      // Saving again keeps the secret and does not return it.
      const again = await settings.save(1, { enabled: true, kind: 'whatsapp', url: provider.url })
      assert.isNull(again.secret)
      const kept = await db('settings').where('key', HTTP_CHANNEL_SETTING_KEY).first()
      assert.equal(kept.value.secret, row.value.secret)

      const rotated = await settings.rotate(1)
      assert.isString(rotated.secret)
      assert.notEqual(rotated.secret, first.secret)

      // The configured channel signs with the current secret; a test message reaches it.
      assert.isNull(await settings.test('+966500000009'))
      const [request] = provider.received
      assert.equal(JSON.parse(request.body).channel, 'whatsapp')
      assert.equal(JSON.parse(request.body).to, '+966500000009')
      assert.equal(
        request.headers['x-adula-signature'],
        `sha256=${signWebhook(rotated.secret!, request.headers['x-adula-timestamp'], request.body)}`
      )
      const channel = await settings.channel()
      assert.equal(channel?.key, 'whatsapp')

      await settings.save(1, { enabled: false, kind: 'whatsapp', url: provider.url })
      assert.isNull(await settings.channel())
    } finally {
      await provider.close()
    }

    // A secret that cannot be opened with the current key fails deliveries as `secret`.
    await db('settings')
      .where('key', HTTP_CHANNEL_SETTING_KEY)
      .update({ value: db.raw(`jsonb_set(value::jsonb, '{secret}', '"garbage"')`) })
    await db('settings')
      .where('key', HTTP_CHANNEL_SETTING_KEY)
      .update({ value: db.raw(`jsonb_set(value::jsonb, '{enabled}', 'true')`) })
    assert.equal(await settings.test('+966500000009'), 'secret')
  })

  test('a worker whose lease was taken over neither resends nor overwrites', async ({ assert }) => {
    const calls: string[] = []
    const recording = (
      name: string,
      during?: (id: string) => Promise<void>
    ): NotificationChannel => ({
      key: 'sms',
      label: { ar: 'رسالة نصية' },
      delivery: 'opt-in',
      address: phoneAddress,
      async deliver(_message, _recipient, context) {
        calls.push(`${name}:${context.deliveryId}`)
        await during?.(context.deliveryId)
      },
    })
    const workerB = new NotificationChannels(db, [recording('B')])
    let interfered = false
    const workerA = new NotificationChannels(db, [
      recording('A', async (id) => {
        if (interfered) return
        interfered = true
        // The other claimed row's lease runs out while A is still busy: B takes and sends it.
        await db('notification_deliveries')
          .whereNot('id', id)
          .update({ next_attempt_at: db.fn.now() })
        await workerB.deliver()
        // B also takes over the row A is sending right now.
        await db('notification_deliveries').where('id', id).update({ lease_id: randomUUID() })
      }),
    ])
    for (const userId of [1, 2])
      await db('user_notification_channels').insert({
        user_id: userId,
        channel: 'sms',
        enabled: true,
        address: `+96650000000${userId}`,
      })
    await notifyWithTemplate(db, 1, 'assignment.created', { title: 'أ' })
    await notifyWithTemplate(db, 2, 'assignment.created', { title: 'ب' })

    const result = await workerA.deliver()
    // A's own send no longer holds the lease, so it writes nothing; it never resends B's row.
    assert.deepEqual(result, { sent: 0, failed: 0, skipped: 0 })
    assert.lengthOf(calls, 2)
    const [first, second] = calls.map((call) => call.split(':'))
    assert.equal(first[0], 'A')
    assert.deepEqual(second[0], 'B')
    assert.notEqual(first[1], second[1])
    const taken = await db('notification_deliveries').where('id', second[1]).first()
    assert.equal(taken.state, 'sent')
    assert.equal(taken.attempts, 1)
    const reclaimed = await db('notification_deliveries').where('id', first[1]).first()
    assert.equal(reclaimed.state, 'pending')
    assert.equal(reclaimed.attempts, 0)
  })
})
