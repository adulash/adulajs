import { createServer, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test } from '@japa/runner'
import {
  ResourceService,
  Webhooks,
  WEBHOOK_MAX_ATTEMPTS,
  consumeEvent,
  createOutboundPoster,
  isBlockedAddress,
  outboundErrorCategory,
  signWebhook,
  publishOutbox,
} from '../index.js'
import type { DomainEvent, HttpPoster, SecretBox, WebhookOptions } from '../index.js'
import { admin, db, registry, setup } from './helpers.js'
import { failure } from './helpers/failure.js'
import { addUserProfileColumns } from './helpers/actors.js'

/** A reversible test box; production passes the framework's authenticated encryption. */
const box: SecretBox = {
  seal: (value) => `sealed:${Buffer.from(value).toString('base64')}`,
  open: (value) =>
    value.startsWith('sealed:') ? Buffer.from(value.slice(7), 'base64').toString() : null,
}
const fetchPoster: HttpPoster = async (url, init) => {
  const response = await fetch(url, { method: 'POST', ...init })
  return { status: response.status }
}

test.group('Outgoing webhooks', (group) => {
  group.setup(async () => {
    await setup()
    await addUserProfileColumns()
  })
  group.each.setup(async () => {
    await db('webhook_deliveries').del()
    await db('webhooks').del()
    await db('processed_events').del()
    await db('outbox').del()
    await db('notifications').del()
  })

  const hooks = (options: WebhookOptions = { allowPrivateTargets: true }) =>
    new Webhooks(db, registry, box, options)

  async function drainEvents(webhooks: Webhooks) {
    const events: DomainEvent[] = []
    await publishOutbox(db, {
      dispatch: async (_, payload) => {
        events.push(payload as unknown as DomainEvent)
      },
    })
    for (const event of events) await consumeEvent(db, webhooks.listener(), event)
    return events
  }

  test('rejects insecure, credentialed and private targets unless explicitly allowed', async ({
    assert,
  }) => {
    const strict = hooks({
      allowPrivateTargets: false,
      resolve: async (host: string) =>
        host === 'intranet.example' ? ['10.0.0.5'] : ['93.184.216.34'],
    })
    const events = ['orders.orders.created']
    for (const url of [
      'http://hooks.example/x',
      'https://user:pw@hooks.example/x',
      'https://127.0.0.1/x',
      'https://[::1]/x',
      'https://169.254.169.254/latest',
      'https://intranet.example/x',
      'not a url',
    ]) {
      const error = await failure(() => strict.create(1, { name: 'x', url, events }))
      assert.equal(error.code, 'E_WEBHOOK_URL', url)
    }
    const created = await strict.create(1, { name: 'عام', url: 'https://hooks.example/x', events })
    assert.equal(created.webhook.url, 'https://hooks.example/x')
    const unknown = await failure(() =>
      strict.create(1, { name: 'x', url: 'https://hooks.example/x', events: ['orders.nope'] })
    )
    assert.equal(unknown.code, 'E_WEBHOOK_EVENTS')
    const stored = await db('webhooks').where('id', created.webhook.id).first()
    assert.notEqual(stored.secret, created.secret)
    assert.equal(box.open(stored.secret), created.secret)
  })

  test('updates cannot point an existing webhook at a private or mapped target', async ({
    assert,
  }) => {
    const strict = hooks({ allowPrivateTargets: false, resolve: async () => ['93.184.216.34'] })
    const events = ['orders.orders.created']
    for (const url of ['https://[::ffff:127.0.0.1]/', 'https://[::ffff:a9fe:a9fe]/x']) {
      const error = await failure(() => strict.create(1, { name: 'x', url, events }))
      assert.equal(error.code, 'E_WEBHOOK_URL', url)
    }
    const { webhook } = await strict.create(1, {
      name: 'عام',
      url: 'https://hooks.example/x',
      events,
    })
    for (const url of [
      'http://169.254.169.254/',
      'https://169.254.169.254/latest/meta-data',
      'https://[::ffff:127.0.0.1]/',
      'https://[::1]/x',
    ]) {
      const error = await failure(() => strict.update(webhook.id, { name: 'x', url, events }))
      assert.equal(error.status, 422, url)
      assert.equal(error.code, 'E_WEBHOOK_URL', url)
    }
    const stored = await db('webhooks').where('id', webhook.id).first()
    assert.equal(stored.url, 'https://hooks.example/x')
  })

  test('signed delivery reaches the endpoint once per event', async ({ assert }) => {
    const received: { headers: IncomingMessage['headers']; body: string }[] = []
    const server = createServer((request, response) => {
      let body = ''
      request.on('data', (chunk) => (body += chunk))
      request.on('end', () => {
        received.push({ headers: request.headers, body })
        response.writeHead(204).end()
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const port = (server.address() as AddressInfo).port
      const webhooks = hooks()
      const { webhook, secret } = await webhooks.create(1, {
        name: 'نظام المحاسبة',
        url: `http://127.0.0.1:${port}/hook`,
        events: ['orders.orders.created'],
      })
      const saved = await new ResourceService(db, registry).save('orders', admin, {
        notes: 'حدث للويب هوك',
        orgUnitId: 2,
      })
      const [event] = await drainEvents(webhooks)
      // Redelivery of the same domain event queues nothing new.
      await consumeEvent(db, webhooks.listener(), event)
      const result = await webhooks.deliver(fetchPoster)
      assert.deepEqual(result, { delivered: 1, failed: 0 })
      assert.lengthOf(received, 1)
      const [call] = received
      const timestamp = String(call.headers['x-adula-timestamp'])
      assert.equal(
        call.headers['x-adula-signature'],
        `sha256=${signWebhook(secret, timestamp, call.body)}`
      )
      const payload = JSON.parse(call.body)
      assert.equal(payload.event, 'orders.orders.created')
      assert.equal(payload.recordId, saved.id)
      assert.notProperty(payload, 'notes')
      const log = await webhooks.deliveries(webhook.id)
      assert.equal(log[0].status, 'delivered')
      assert.deepEqual(await webhooks.deliver(fetchPoster), { delivered: 0, failed: 0 })
    } finally {
      server.close()
    }
  })

  test('failures back off, stop after the last attempt, notify the creator and can be retried', async ({
    assert,
  }) => {
    const webhooks = hooks()
    const { webhook } = await webhooks.create(1, {
      name: 'معطل',
      url: 'http://127.0.0.1:9/down',
      events: ['orders.orders.created'],
    })
    await new ResourceService(db, registry).save('orders', admin, { notes: 'x', orgUnitId: 2 })
    await drainEvents(webhooks)
    const refusing: HttpPoster = async () => ({ status: 500 })
    for (let attempt = 1; attempt <= WEBHOOK_MAX_ATTEMPTS; attempt++) {
      await db('webhook_deliveries').update({ next_attempt_at: db.fn.now() })
      const result = await webhooks.deliver(refusing)
      assert.equal(result.failed, 1)
      const [row] = await db('webhook_deliveries')
      assert.equal(row.attempts, attempt)
      assert.equal(row.status, attempt < WEBHOOK_MAX_ATTEMPTS ? 'pending' : 'failed')
      if (attempt === 1)
        assert.isAbove(new Date(row.next_attempt_at).getTime(), Date.now() + 30_000)
    }
    const [hook] = await db('webhooks').where('id', webhook.id)
    assert.equal(hook.failing, 1)
    const notices = await db('notifications').where('user_id', 1)
    assert.lengthOf(notices, 1)
    assert.include(notices[0].title, 'معطل')

    const [failed] = await webhooks.deliveries(webhook.id)
    await webhooks.retry(failed.id)
    const ok = await webhooks.deliver(async () => ({ status: 200 }))
    assert.deepEqual(ok, { delivered: 1, failed: 0 })
  })

  test('inactive webhooks and unsubscribed events queue nothing', async ({ assert }) => {
    const webhooks = hooks()
    const { webhook } = await webhooks.create(1, {
      name: 'متوقف',
      url: 'http://127.0.0.1:9/x',
      events: ['orders.orders.updated'],
    })
    await new ResourceService(db, registry).save('orders', admin, { notes: 'y', orgUnitId: 2 })
    await drainEvents(webhooks)
    assert.lengthOf(await db('webhook_deliveries'), 0)
    await webhooks.update(webhook.id, {
      name: 'متوقف',
      url: 'http://127.0.0.1:9/x',
      events: ['orders.orders.created'],
      active: false,
    })
    await new ResourceService(db, registry).save('orders', admin, { notes: 'z', orgUnitId: 2 })
    await drainEvents(webhooks)
    assert.lengthOf(await db('webhook_deliveries'), 0)
  })

  test('delivery pins the first validated address so a rebinding resolver cannot redirect it', async ({
    assert,
  }) => {
    const answers = [['93.184.216.34'], ['127.0.0.1']]
    let lookups = 0
    const webhooks = hooks({
      allowPrivateTargets: false,
      resolve: async () => answers[Math.min(lookups++, answers.length - 1)],
    })
    await webhooks.create(1, {
      name: 'متغير العنوان',
      url: 'https://rebind.example/hook',
      events: ['orders.orders.created'],
    })
    assert.equal(lookups, 1)
    lookups = 0
    await new ResourceService(db, registry).save('orders', admin, { notes: 'r', orgUnitId: 2 })
    await drainEvents(webhooks)
    const targets: unknown[] = []
    const result = await webhooks.deliver(async (_url, init) => {
      targets.push(init.target)
      return { status: 200 }
    })
    assert.deepEqual(result, { delivered: 1, failed: 0 })
    // One lookup per delivery; the poster receives the address validated by it.
    assert.equal(lookups, 1)
    assert.deepEqual(targets, [{ address: '93.184.216.34', family: 4 }])

    // The next delivery resolves again and refuses the now-private answer.
    await new ResourceService(db, registry).save('orders', admin, { notes: 's', orgUnitId: 2 })
    await drainEvents(webhooks)
    const blocked = await webhooks.deliver(async () => {
      throw new Error('must not be called for a blocked target')
    })
    assert.deepEqual(blocked, { delivered: 0, failed: 1 })
    const pending = await db('webhook_deliveries').where('status', 'pending').first()
    assert.equal(pending.last_error, 'blocked-target')
  })

  test('stored delivery errors are categories, never raw messages or bodies', async ({
    assert,
  }) => {
    const webhooks = hooks()
    await webhooks.create(1, {
      name: 'تصنيف الأخطاء',
      url: 'http://127.0.0.1:9/hook',
      events: ['orders.orders.created'],
    })
    const coded = (message: string, code: string) => Object.assign(new Error(message), { code })
    const cases: [HttpPoster, string][] = [
      [async () => ({ status: 503 }), 'http-status:503'],
      [
        async () => {
          throw coded('connect ECONNREFUSED 10.1.2.3:443 secret-body', 'ECONNREFUSED')
        },
        'connect',
      ],
      [
        async () => {
          throw new TypeError('fetch failed', {
            cause: coded('getaddrinfo ENOTFOUND internal.corp', 'ENOTFOUND'),
          })
        },
        'dns',
      ],
      [
        async () => {
          throw coded('self-signed certificate', 'DEPTH_ZERO_SELF_SIGNED_CERT')
        },
        'tls',
      ],
      [
        async () => {
          throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
        },
        'timeout',
      ],
    ]
    for (const [post, category] of cases) {
      await db('webhook_deliveries').del()
      await new ResourceService(db, registry).save('orders', admin, { notes: 'e', orgUnitId: 2 })
      await drainEvents(webhooks)
      assert.deepEqual(await webhooks.deliver(post), { delivered: 0, failed: 1 })
      const [row] = await db('webhook_deliveries')
      assert.equal(row.last_error, category)
      const [logged] = await webhooks.deliveries(row.webhook_id)
      assert.equal(logged.lastError, category)
    }
  })

  test('the guarded client connects to the pinned address and keeps the original Host', async ({
    assert,
  }) => {
    const seen: { host?: string; body: string }[] = []
    const server = createServer((request, response) => {
      let body = ''
      request.on('data', (chunk) => (body += chunk))
      request.on('end', () => {
        seen.push({ host: request.headers.host, body })
        response.writeHead(202).end('response body is never stored')
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const port = (server.address() as AddressInfo).port
      const init = () => ({
        headers: { 'Content-Type': 'application/json' },
        body: '{"ok":true}',
        signal: AbortSignal.timeout(5000),
      })
      // rebind.invalid never resolves through DNS; reaching the server proves the pin is used.
      const post = createOutboundPoster({ allowPrivateTargets: true })
      const response = await post(`http://rebind.invalid:${port}/hook`, {
        ...init(),
        target: { address: '127.0.0.1', family: 4 },
      })
      assert.equal(response.status, 202)
      // Without a supplied target the client resolves once and pins that answer.
      const resolving = createOutboundPoster({
        allowPrivateTargets: true,
        resolve: async () => ['127.0.0.1'],
      })
      const resolved = await resolving(`http://pinned.invalid:${port}/`, init())
      assert.equal(resolved.status, 202)
      assert.deepEqual(seen, [
        { host: `rebind.invalid:${port}`, body: '{"ok":true}' },
        { host: `pinned.invalid:${port}`, body: '{"ok":true}' },
      ])

      // Without the opt-in the same client refuses http:// and private answers.
      const strict = createOutboundPoster({ resolve: async () => ['127.0.0.1'] })
      for (const url of [`http://127.0.0.1:${port}/`, `https://local.example:${port}/`]) {
        const refused = await strict(url, init()).catch((caught: unknown) => caught)
        assert.equal(outboundErrorCategory(refused), 'blocked-target', url)
      }
      assert.lengthOf(seen, 2)
    } finally {
      server.close()
    }
  })
})

test.group('Outbound target classification', () => {
  test('special-purpose, mapped, NAT64 and 6to4 addresses are blocked', ({ assert }) => {
    for (const address of [
      '0.0.0.0',
      '10.1.2.3',
      '100.64.0.1',
      '127.0.0.1',
      '169.254.169.254',
      '172.16.0.1',
      '192.0.0.8',
      '192.0.2.1',
      '192.88.99.1',
      '192.168.1.1',
      '198.18.0.1',
      '198.51.100.1',
      '203.0.113.1',
      '224.0.0.1',
      '240.0.0.1',
      '255.255.255.255',
      '192.31.196.1',
      '192.52.193.1',
      '192.175.48.1',
      '::ffff:0:7f00:1',
      '::ffff:0:a00:1',
      '5f00::1',
      '::',
      '::1',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      '::ffff:a9fe:a9fe',
      '64:ff9b::7f00:1',
      '64:ff9b:1::1',
      '100::1',
      '2001::1',
      '2001:db8::1',
      '2002:7f00:1::',
      'fc00::1',
      'fd12:3456::1',
      'fe80::1',
      'ff02::1',
      'not-an-ip',
    ])
      assert.isTrue(isBlockedAddress(address), address)
    for (const address of [
      '93.184.216.34',
      '8.8.8.8',
      '2606:4700::1111',
      '::ffff:93.184.216.34',
      '64:ff9b::5db8:d822',
      '::ffff:0:5db8:d822',
    ])
      assert.isFalse(isBlockedAddress(address), address)
  })

  test('URL hosts are classified after URL normalisation and resolution', async ({ assert }) => {
    const strict = createOutboundPoster({
      resolve: async (host: string) => {
        if (host === 'hooks.example') return ['93.184.216.34', '2606:4700::1111']
        if (host === 'mixed.example') return ['93.184.216.34', '10.0.0.1']
        throw Object.assign(new Error('nope'), { code: 'ENOTFOUND' })
      },
    })
    // A short-circuited signal stops allowed targets. Where the host has no route to the
    // address the connection can fail first, which still means the guard let it through.
    const init = () => ({ headers: {}, body: '', signal: AbortSignal.abort() })
    const categories: Record<string, string> = {}
    for (const url of [
      'https://[::ffff:127.0.0.1]/',
      'https://[::ffff:7f00:1]/',
      'https://100.64.0.1/',
      'https://169.254.169.254/latest',
      'https://0.0.0.0/',
      'https://[::1]/',
      'https://[fe80::1]/',
      'https://[64:ff9b::7f00:1]/',
      'https://[2002:7f00:1::]/',
      'https://0x7f.1/',
      'https://2130706433/',
      'https://0177.0.0.1/',
      'https://mixed.example/',
      'https://93.184.216.34/',
      'https://[2606:4700::1111]/',
      'https://hooks.example/x',
      'https://missing.example/',
    ])
      categories[url] = outboundErrorCategory(
        await strict(url, init()).catch((caught: unknown) => caught)
      )
    for (const [url, category] of Object.entries(categories)) {
      if (url.includes('93.184') || url.includes('2606') || url.includes('hooks.example'))
        assert.include(['timeout', 'connect'], category, `${url} is allowed by the guard`)
      else if (url.includes('missing.example')) assert.equal(category, 'dns', url)
      else assert.equal(category, 'blocked-target', url)
    }
  })
})
