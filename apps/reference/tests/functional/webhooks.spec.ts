import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { consumeEvent, signWebhook, type DomainEvent } from 'adula'
import { adula } from '#services/adula'
import { listeners } from '#start/listeners'
import { seedActor, type UiActor } from '#tests/helpers/ui_fixtures'

const json = { Accept: 'application/json' }
const knex = () => db.connection().getWriteClient()

test.group('Outgoing webhooks over HTTP', (group) => {
  let admin: UiActor
  let member: UiActor
  group.setup(async () => {
    admin = await seedActor([{ subject: 'all', action: 'manage' }], { fullName: 'مدير الربط' })
    member = await seedActor([{ subject: 'orders', action: 'manage' }], {
      orgUnitId: admin.orgUnitId,
      level: 0,
    })
  })

  test('an administrator subscribes an endpoint that receives a signed order event', async ({
    client,
    assert,
  }) => {
    const bodies: { signature: string; timestamp: string; body: string }[] = []
    const server = createServer((request, response) => {
      let body = ''
      request.on('data', (chunk) => (body += chunk))
      request.on('end', () => {
        bodies.push({
          signature: String(request.headers['x-adula-signature']),
          timestamp: String(request.headers['x-adula-timestamp']),
          body,
        })
        response.writeHead(200).end('ok')
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const port = (server.address() as AddressInfo).port
      const page = await client.get('/admin/webhooks').loginAs(admin.user).headers(json)
      page.assertStatus(200)
      assert.exists(
        page.body().events.find((event: { key: string }) => event.key === 'orders.orders.created')
      )
      const created = await client
        .post('/admin/webhooks')
        .loginAs(admin.user)
        .withCsrfToken()
        .headers(json)
        .json({
          name: 'المحاسبة',
          url: `http://127.0.0.1:${port}/in`,
          events: ['orders.orders.created'],
        })
      created.assertStatus(201)
      const secret = created.body().data.secret
      const listed = await client.get('/admin/webhooks').loginAs(admin.user).headers(json)
      assert.notInclude(JSON.stringify(listed.body()), secret)

      const order = await adula().resources.save(
        'orders',
        await adula().actors.load(member.user.id),
        {
          notes: 'طلب يصل للمحاسبة',
          orgUnitId: admin.orgUnitId,
        }
      )
      const row = await knex()('outbox')
        .where('event', 'orders.orders.created')
        .whereRaw("payload->>'id' = ?", [String(order.id)])
        .first()
      const event: DomainEvent = { id: row.id, event: row.event, payload: row.payload }
      for (const listener of listeners) await consumeEvent(knex(), listener, event)
      // The guarded, address-pinned client the worker uses (private targets allowed in tests).
      await adula().webhooks.deliver()
      assert.lengthOf(bodies, 1)
      assert.equal(
        bodies[0].signature,
        `sha256=${signWebhook(secret, bodies[0].timestamp, bodies[0].body)}`
      )
      assert.equal(JSON.parse(bodies[0].body).recordId, order.id)
      const log = await client
        .get(`/admin/webhooks/${created.body().data.webhook.id}/deliveries`)
        .loginAs(admin.user)
        .headers(json)
      assert.equal(log.body().data[0].status, 'delivered')
    } finally {
      server.close()
    }
  })

  test('non-administrators cannot manage webhooks', async ({ client }) => {
    const list = await client.get('/admin/webhooks').loginAs(member.user).headers(json)
    list.assertStatus(403)
    const create = await client
      .post('/admin/webhooks')
      .loginAs(member.user)
      .withCsrfToken()
      .headers(json)
      .json({ name: 'x', url: 'https://example.com', events: ['orders.orders.created'] })
    create.assertStatus(403)
  })
})
