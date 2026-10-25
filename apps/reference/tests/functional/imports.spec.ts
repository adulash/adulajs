import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { adula } from '#services/adula'
import { seedActor, type UiActor } from '#tests/helpers/ui_fixtures'

const json = { Accept: 'application/json' }
const knex = () => db.connection().getWriteClient()

test.group('CSV imports over HTTP', (group) => {
  let clerk: UiActor
  let viewer: UiActor
  group.setup(async () => {
    clerk = await seedActor([{ subject: 'orders', action: 'manage' }], {
      fullName: 'مدخل البيانات',
      level: 0,
    })
    viewer = await seedActor([{ subject: 'orders', action: 'view' }], {
      orgUnitId: clerk.orgUnitId,
      level: 0,
    })
  })

  test('upload, map and import orders; the batch reports failed rows', async ({
    client,
    assert,
  }) => {
    const csv = `ملاحظات,orgUnitId,تاريخ الإصدار\nمستورد أول,${clerk.orgUnitId},2026-10-01\nمستورد ثان,${clerk.orgUnitId},30/02/2026\n`
    const uploaded = await client
      .post('/resources/orders/imports')
      .loginAs(clerk.user)
      .withCsrfToken()
      .headers(json)
      .file('file', Buffer.from(csv), { filename: 'orders.csv', contentType: 'text/csv' })
    uploaded.assertStatus(201)
    const batch = uploaded.body().data
    assert.deepEqual(batch.mapping, { 0: 'notes', 1: 'orgUnitId', 2: 'issuedAt' })

    const foreign = await client.get(`/imports/${batch.id}`).loginAs(viewer.user).headers(json)
    foreign.assertStatus(404)
    const started = await client
      .post(`/imports/${batch.id}/start`)
      .loginAs(clerk.user)
      .withCsrfToken()
      .headers(json)
      .json({ mapping: batch.mapping })
    started.assertStatus(200)
    await adula().imports.process()
    const page = await client
      .get('/imports')
      .loginAs(clerk.user)
      .header('Accept', 'text/html')
      .withInertia()
    page.assertStatus(200)
    const [done] = page.body().props.batches
    assert.equal(done.status, 'done')
    assert.equal(done.created, 1)
    assert.equal(done.failed, 1)
    assert.equal(done.errors[0].row, 3)
    const imported = await knex()('orders').where('notes', 'مستورد أول').first()
    assert.equal(imported.created_by, clerk.user.id)
  })

  test('users without create permission cannot upload', async ({ client }) => {
    const response = await client
      .post('/resources/orders/imports')
      .loginAs(viewer.user)
      .withCsrfToken()
      .headers(json)
      .file('file', Buffer.from('notes\nx\n'), { filename: 'x.csv' })
    response.assertStatus(403)
  })
})

test.group('Import templates, dry runs and upserts over the API', (group) => {
  let partner: UiActor
  let creator: UiActor
  group.setup(async () => {
    partner = await seedActor([{ subject: 'customers', action: 'manage' }], {
      fullName: 'مسؤول العملاء',
      level: 0,
    })
    creator = await seedActor(
      [
        { subject: 'customers', action: 'view' },
        { subject: 'customers', action: 'create' },
      ],
      {
        level: 0,
      }
    )
  })

  async function token(client: any, user: UiActor['user'], access: 'read' | 'write') {
    const response = await client
      .post('/account/tokens')
      .loginAs(user)
      .withCsrfToken()
      .headers(json)
      .json({ name: `استيراد ${access}`, access, expiresInDays: 30 })
    response.assertStatus(201)
    return response.body().data.secret as string
  }

  test('the session template is an Arabic CSV with a BOM and marked required columns', async ({
    client,
    assert,
  }) => {
    const response = await client.get('/resources/customers/imports/template').loginAs(partner.user)
    response.assertStatus(200)
    assert.match(response.header('content-type') ?? '', /^text\/csv/)
    assert.include(response.header('content-disposition') ?? '', 'customers-template.csv')
    const body = response.text()
    assert.isTrue(body.startsWith('\uFEFF'))
    assert.equal(body.slice(1).trim(), 'اسم العميل *,البريد الإلكتروني')
    const denied = await client
      .get('/resources/orders/imports/template')
      .loginAs(partner.user)
      .headers(json)
    denied.assertStatus(403)
  })

  test('a token creates a JSON batch, dry-runs it, then upserts it for real', async ({
    client,
    assert,
  }) => {
    const suffix = Date.now()
    const existing = `عميل قائم ${suffix}`
    const fresh = `عميل جديد ${suffix}`
    await adula().resources.save('customers', await adula().actors.load(partner.user.id), {
      name: existing,
      email: 'old@example.test',
    })
    const secret = await token(client, partner.user, 'write')
    const bearer = { Authorization: `Bearer ${secret}` }

    const template = await client
      .get('/api/v1/resources/customers/imports/template')
      .qs({ mode: 'upsert' })
      .headers(bearer)
    template.assertStatus(200)
    const created = await client
      .post('/api/v1/resources/customers/imports')
      .headers(bearer)
      .json({
        fileName: 'customers.csv',
        content: `${template.text()}${existing},new@example.test\n${fresh},fresh@example.test\n`,
        mode: 'upsert',
        matchField: 'name',
        dryRun: true,
      })
    created.assertStatus(201)
    const batch = created.body().data
    assert.equal(batch.mode, 'upsert')
    assert.equal(batch.matchField, 'name')
    assert.isTrue(batch.dryRun)
    assert.deepEqual(batch.mapping, { 0: 'name', 1: 'email' })

    const queued = await client
      .post(`/api/v1/imports/${batch.id}/start`)
      .headers(bearer)
      .json({ mapping: batch.mapping })
    queued.assertStatus(200)
    assert.equal(queued.body().data.status, 'queued')
    await adula().imports.process()
    const validated = await client.get(`/api/v1/imports/${batch.id}`).headers(bearer)
    validated.assertStatus(200)
    assert.equal(validated.body().data.status, 'validated')
    assert.deepEqual(
      validated.body().data.report.map((row: { action: string }) => row.action),
      ['update', 'create']
    )
    assert.notExists(await knex()('customers').where('name', fresh).first())

    const started = await client
      .post(`/api/v1/imports/${batch.id}/start`)
      .headers(bearer)
      .json({ mapping: batch.mapping })
    started.assertStatus(200)
    assert.isFalse(started.body().data.dryRun)
    await adula().imports.process()
    const done = await client.get(`/api/v1/imports/${batch.id}`).headers(bearer)
    assert.equal(done.body().data.status, 'done')
    assert.equal(done.body().data.created, 1)
    assert.equal(done.body().data.updated, 1)
    const updated = await knex()('customers').where('name', existing).first()
    assert.equal(updated.email, 'new@example.test')
    assert.equal(updated.updated_by, partner.user.id)
    const listed = await client.get('/api/v1/imports').headers(bearer)
    assert.include(
      listed.body().data.map((item: { id: number }) => item.id),
      batch.id
    )

    const readOnly = await token(client, partner.user, 'read')
    const refused = await client
      .post('/api/v1/resources/customers/imports')
      .header('Authorization', `Bearer ${readOnly}`)
      .json({ fileName: 'x.csv', content: 'name\nx\n' })
    refused.assertStatus(403)
  })

  test('upsert needs update permission as well as create', async ({ client }) => {
    const secret = await token(client, creator.user, 'write')
    const response = await client
      .post('/api/v1/resources/customers/imports')
      .header('Authorization', `Bearer ${secret}`)
      .json({ fileName: 'x.csv', content: 'name\nx\n', mode: 'upsert', matchField: 'name' })
    response.assertStatus(403)
    const plain = await client
      .post('/api/v1/resources/customers/imports')
      .header('Authorization', `Bearer ${secret}`)
      .json({ fileName: 'x.csv', content: 'name\nx\n' })
    plain.assertStatus(201)
  })
})
