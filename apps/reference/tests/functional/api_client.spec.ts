import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test } from '@japa/runner'
import ts from 'typescript'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import { adula } from '#services/adula'
import { seedActor, type UiActor } from '#tests/helpers/ui_fixtures'

const json = { Accept: 'application/json' }
const knex = () => db.connection().getWriteClient()

test.group('Generated API client', (group) => {
  let owner: UiActor
  let secret: string | undefined
  group.setup(async () => {
    // Level 0: the money total (level 1) and the hidden internal note are not readable.
    owner = await seedActor([{ subject: 'orders', action: 'manage' }], {
      fullName: 'مالك العميل البرمجي',
      level: 0,
    })
  })

  async function token(client: any) {
    const response = await client
      .post('/account/tokens')
      .loginAs(owner.user)
      .withCsrfToken()
      .headers(json)
      .json({ name: 'عميل مولد', access: 'write', expiresInDays: 30 })
    response.assertStatus(201)
    return response.body().data.secret as string
  }

  test('client.ts and client.d.ts describe only what the token owner may use', async ({
    client,
    assert,
  }) => {
    secret = await token(client)
    const source = await client.get('/api/v1/client.ts').header('Authorization', `Bearer ${secret}`)
    source.assertStatus(200)
    assert.match(source.header('content-type') ?? '', /^text\/plain/)
    const text = source.text()
    assert.include(text, 'export interface OrdersClient')
    assert.include(text, 'export function createAdulaClient(')
    assert.notInclude(text, 'CustomersClient')
    assert.notMatch(text, /^\s+customers: \[/m)
    assert.notInclude(text, 'internalNote')
    assert.notMatch(text, /^\s+total\?:/m)

    const declarations = await client
      .get('/api/v1/client.d.ts')
      .header('Authorization', `Bearer ${secret}`)
    declarations.assertStatus(200)
    assert.include(declarations.text(), 'export declare function createAdulaClient(')
    assert.notInclude(declarations.text(), 'CustomersClient')

    const anonymous = await client.get('/api/v1/client.ts')
    anonymous.assertStatus(401)
  })

  test('the generated runtime lists, creates and shows records on the running server', async ({
    client,
    assert,
  }) => {
    secret ??= await token(client)
    const response = await client
      .get('/api/v1/client.ts')
      .header('Authorization', `Bearer ${secret}`)
    response.assertStatus(200)
    const directory = await mkdtemp(join(tmpdir(), 'adula-reference-client-'))
    try {
      const file = join(directory, 'client.mjs')
      await writeFile(
        file,
        ts.transpileModule(response.text(), {
          compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
        }).outputText
      )
      const generated = await import(pathToFileURL(file).href)
      const api = generated.createAdulaClient({
        baseUrl: `http://${env.get('HOST')}:${env.get('PORT')}`,
        token: secret,
      })
      const created = await api.resources.orders.create({
        notes: 'عبر العميل المولد',
        orgUnitId: owner.orgUnitId,
      })
      assert.isAbove(created.id, 0)
      assert.equal(created.docStatus, 0)
      const shown = await api.resources.orders.show(created.id)
      assert.equal(shown.notes, 'عبر العميل المولد')
      assert.notProperty(shown, 'internalNote')
      const page = await api.resources.orders.list({ limit: 100, sort: 'id', direction: 'desc' })
      assert.equal(page.data[0].id, created.id)
      assert.property(page.meta, 'nextCursor')
      const updated = await api.resources.orders.update(created.id, {
        notes: 'تعديل',
        version: shown.version,
      })
      assert.equal(updated.notes, 'تعديل')
      // Resources the owner may not view are absent from the client entirely.
      assert.isUndefined(api.resources.customers)
      const missing = await api.resources.orders.show(999999999).catch((error: unknown) => error)
      assert.instanceOf(missing, generated.AdulaApiError)
      assert.equal((missing as { status: number }).status, 404)
      assert.equal((missing as { code: string }).code, 'E_NOT_FOUND')

      // Imports through the client: template, dry run with a per-row report, then the real run.
      const template: string = await api.imports.template('orders')
      assert.include(template, 'ملاحظات')
      const csv = `notes,orgUnitId,issuedAt\nمستورد بالعميل,${owner.orgUnitId},2026-10-01\nصف خاطئ,${owner.orgUnitId},30/02/2026\n`
      const uploaded = await api.imports.create('orders', {
        fileName: 'orders.csv',
        content: Buffer.from(csv).toString('base64'),
        encoding: 'base64',
        dryRun: true,
      })
      assert.equal(uploaded.status, 'mapping')
      assert.isTrue(uploaded.dryRun)
      assert.deepEqual(uploaded.mapping, { 0: 'notes', 1: 'orgUnitId', 2: 'issuedAt' })
      const queued = await api.imports.start(uploaded.id, { mapping: uploaded.mapping })
      assert.equal(queued.status, 'queued')
      await adula().imports.process()
      const validated = await api.imports.show(uploaded.id)
      assert.equal(validated.status, 'validated')
      assert.equal(validated.created, 1)
      assert.equal(validated.failed, 1)
      assert.deepEqual(
        validated.report.map((row: { row: number; ok: boolean; action?: string }) => [
          row.row,
          row.ok,
          row.action,
        ]),
        [
          [2, true, 'create'],
          [3, false, undefined],
        ]
      )
      assert.isNotEmpty(validated.report[1].message)
      // The dry run rolled every row back.
      assert.isUndefined(await knex()('orders').where('notes', 'مستورد بالعميل').first())

      const real = await api.imports.start(uploaded.id, {
        mapping: validated.mapping,
        dryRun: false,
      })
      assert.isFalse(real.dryRun)
      await adula().imports.process()
      const done = await api.imports.show(uploaded.id)
      assert.equal(done.status, 'done')
      assert.equal(done.created, 1)
      assert.equal(done.failed, 1)
      assert.isOk(await knex()('orders').where('notes', 'مستورد بالعميل').first())
      const listed = await api.imports.list()
      assert.include(
        listed.map((batch: { id: number }) => batch.id),
        uploaded.id
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
