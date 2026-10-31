import { test } from '@japa/runner'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { rm, stat } from 'node:fs/promises'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import drive from '@adonisjs/drive/services/main'
import type { ApiClient } from '@japa/api-client'
import User from '#models/user'
import { PENDING_UPLOAD_LIMIT, UNBOUND_UPLOAD_TTL_MS, grantUpload } from 'adula'
import { adula } from '#services/adula'

type UploadedFile = {
  id: number
  name: string
  size: number
  mimeType: string
  url: string
  preview: string | null
}

function ace(args: string[]) {
  return new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ['ace', ...args], {
      cwd: app.appRoot,
      env: { ...process.env, NODE_ENV: 'test' },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout?.on('data', (data) => {
      output += data
    })
    child.stderr?.on('data', (data) => {
      output += data
    })
    child.once('error', reject)
    child.once('exit', (code) => resolve({ code, output }))
  })
}

test.group('Attachment upload, download and storage migration', (group) => {
  let writer: User
  let reader: User
  let outsider: User
  let denied: User
  let limited: User
  let orgUnitId: number
  const knex = () => db.connection().getWriteClient()
  const diskOf = async (id: number) => {
    const stored = await knex()('attachments').where('id', id).first('disk')
    return stored.disk as string
  }
  const uploaded: UploadedFile[] = []
  // Text bodies are buffered by the API client, so downloads can be compared byte for byte.
  const content = Buffer.from(`عقد اختبار ${randomUUID()}\nسطر ثانٍ\n`)

  group.setup(async () => {
    const suffix = randomUUID()
    const users: User[] = []
    for (const label of ['writer', 'reader', 'outside', 'denied', 'limited'])
      users.push(
        await User.create({
          fullName: 'مستخدم المرفقات',
          email: `${label}-${suffix}@example.test`,
          password: 'a-long-test-password-123',
        })
      )
    ;[writer, reader, outsider, denied, limited] = users
    const [org, outside] = await knex()('org_units')
      .insert([
        { name: 'وحدة المرفقات', type: 'root', path: `attach_${suffix.replaceAll('-', '_')}` },
        { name: 'وحدة أخرى', type: 'root', path: `attach_out_${suffix.replaceAll('-', '_')}` },
      ])
      .returning('id')
    orgUnitId = org.id
    const [writeRole, readRole, limitedRole] = await knex()('roles')
      .insert([
        { name: `attach-writer-${suffix}`, permission_level: 1 },
        { name: `attach-reader-${suffix}`, permission_level: 0 },
        { name: `attach-limited-${suffix}`, permission_level: 1 },
      ])
      .returning('id')
    await knex()('role_rules').insert([
      { role_id: writeRole.id, subject: 'all', action: 'manage' },
      { role_id: readRole.id, subject: 'all', action: 'view' },
      { role_id: limitedRole.id, subject: 'all', action: 'manage' },
      {
        role_id: limitedRole.id,
        subject: 'orders',
        action: 'view',
        fields: JSON.stringify(['contract']),
        inverted: true,
      },
    ])
    await knex()('user_roles').insert([
      { user_id: writer.id, role_id: writeRole.id },
      { user_id: reader.id, role_id: readRole.id },
      { user_id: outsider.id, role_id: writeRole.id },
      { user_id: limited.id, role_id: limitedRole.id },
    ])
    await knex()('user_org_units').insert([
      { user_id: writer.id, org_unit_id: orgUnitId },
      { user_id: reader.id, org_unit_id: orgUnitId },
      { user_id: limited.id, org_unit_id: orgUnitId },
      { user_id: outsider.id, org_unit_id: outside.id },
    ])
    return async () => {
      const rows = await knex()('attachments').whereIn(
        'id',
        uploaded.map((file) => file.id)
      )
      for (const row of rows)
        for (const disk of ['local', 'local_test_archive'] as const)
          await drive
            .use(disk)
            .delete(row.path)
            .catch(() => {})
      await rm(app.makePath('storage/uploads-test-archive'), { recursive: true, force: true })
    }
  })

  const upload =
    (user: User, name = 'عقد التوريد.txt', extra: Record<string, string> = {}) =>
    async (client: ApiClient) => {
      const response = await client
        .post('/attachments')
        .loginAs(user)
        .withCsrfToken()
        .header('Accept', 'application/json')
        .fields({ resource: 'orders', field: 'contract', ...extra })
        .file('file', content, { filename: name, contentType: 'text/plain' })
      if (response.status() === 201) uploaded.push(response.body().data)
      return response
    }

  test('uploads require authentication, a permitted attachment field and a file', async ({
    client,
    assert,
  }) => {
    const anonymous = await client
      .post('/attachments')
      .withCsrfToken()
      .header('Accept', 'application/json')
    anonymous.assertStatus(401)
    const forbidden = await upload(denied)(client)
    forbidden.assertStatus(403)
    const readOnly = await upload(reader)(client)
    readOnly.assertStatus(403)
    const unknownResource = await upload(writer, 'x.txt', { resource: 'nothing' })(client)
    unknownResource.assertStatus(404)
    const wrongField = await upload(writer, 'x.txt', { field: 'notes' })(client)
    wrongField.assertStatus(422)
    assert.equal(wrongField.body().error.code, 'E_FIELD_INVALID')
    const missingFile = await client
      .post('/attachments')
      .loginAs(writer)
      .withCsrfToken()
      .header('Accept', 'application/json')
      .fields({ resource: 'orders', field: 'contract' })
    missingFile.assertStatus(422)
    assert.equal(missingFile.body().error.code, 'E_FILE_REQUIRED')
    assert.equal(
      await knex()('attachments')
        .where('uploaded_by', writer.id)
        .count('* as count')
        .first()
        .then((row) => Number(row!.count)),
      0
    )
  })

  test('a stored upload is private to its uploader until it is bound to a record', async ({
    client,
    assert,
  }) => {
    const created = await upload(writer)(client)
    created.assertStatus(201)
    const file: UploadedFile = created.body().data
    assert.deepEqual(Object.keys(file).sort(), ['id', 'mimeType', 'name', 'preview', 'size', 'url'])
    // Plain text previews inline as text (ADR 047).
    assert.equal(file.preview, 'text')
    assert.equal(file.name, 'عقد التوريد.txt')
    assert.equal(file.size, content.length)
    assert.equal(file.mimeType, 'text/plain')
    assert.equal(file.url, `/attachments/${file.id}`)
    const row = await knex()('attachments').where('id', file.id).first()
    assert.equal(row.disk, 'local')
    assert.equal(row.uploaded_by, writer.id)
    assert.isNull(row.record_id)
    assert.equal(row.resource, 'orders')
    assert.equal(row.field, 'contract')
    assert.match(row.path, /^resources\/orders\/contract\/[0-9a-f-]{36}\.txt$/)
    assert.notInclude(row.path, '\\')
    const info = await stat(app.makePath('storage/uploads', row.path))
    assert.equal(info.size, content.length)
    assert.equal(row.data.path, row.path)
    const own = await client.get(file.url).loginAs(writer)
    own.assertStatus(200)
    assert.equal(own.header('content-type'), 'text/plain')
    assert.equal(own.header('content-length'), String(content.length))
    assert.equal(
      own.header('content-disposition'),
      `attachment; filename="___ _______.txt"; filename*=UTF-8''${encodeURIComponent('عقد التوريد.txt')}`
    )
    assert.equal(own.header('x-content-type-options'), 'nosniff')
    assert.equal(Buffer.from(own.text()).toString(), content.toString())
    const foreign = await client.get(file.url).loginAs(outsider)
    foreign.assertStatus(404)
    const unauthenticated = await client.get(file.url).header('Accept', 'application/json')
    unauthenticated.assertStatus(401)
    const missing = await client.get('/attachments/999999').loginAs(writer)
    missing.assertStatus(404)
    const malformed = await client.get('/attachments/abc').loginAs(writer)
    malformed.assertStatus(404)
  })

  test('binding an upload applies record scope, ability and field rules to downloads', async ({
    client,
    assert,
  }) => {
    const created = await upload(writer, 'عقد.txt')(client)
    created.assertStatus(201)
    const file: UploadedFile = created.body().data
    const order = await client
      .post('/resources/orders')
      .loginAs(writer)
      .withCsrfToken()
      .header('Accept', 'application/json')
      .json({ orgUnitId, notes: `طلب بمرفق ${randomUUID()}`, contract: file.id })
    order.assertStatus(201)
    assert.deepEqual(order.body().data.contract, file)
    const stored = await knex()('orders').where('id', order.body().data.id).first()
    assert.equal(stored.contract, file.id)
    const bound = await knex()('attachments').where('id', file.id).first()
    assert.equal(bound.record_id, order.body().data.id)
    assert.equal(bound.org_unit_id, orgUnitId)
    const shown = await client
      .get(`/resources/orders/${order.body().data.id}`)
      .loginAs(reader)
      .header('Accept', 'application/json')
    shown.assertStatus(200)
    assert.deepEqual(shown.body().data.contract, file)
    const listed = await client
      .get('/resources/orders?limit=100')
      .loginAs(reader)
      .header('Accept', 'application/json')
    listed.assertStatus(200)
    assert.deepEqual(
      listed.body().data.find((row: { id: number }) => row.id === order.body().data.id).contract,
      file
    )
    const editor = await client
      .get(`/resources/orders/${order.body().data.id}/edit`)
      .loginAs(writer)
      .header('Accept', 'application/json')
    editor.assertStatus(200)
    assert.deepEqual(editor.body().record.contract, file)
    const asReader = await client.get(file.url).loginAs(reader)
    asReader.assertStatus(200)
    assert.equal(asReader.header('content-length'), String(content.length))
    const asOutsider = await client.get(file.url).loginAs(outsider)
    asOutsider.assertStatus(404)
    const asDenied = await client.get(file.url).loginAs(denied)
    asDenied.assertStatus(404)
    const fieldForbidden = await client.get(file.url).loginAs(limited)
    fieldForbidden.assertStatus(404)
    const limitedShow = await client
      .get(`/resources/orders/${order.body().data.id}`)
      .loginAs(limited)
      .header('Accept', 'application/json')
    limitedShow.assertStatus(200)
    assert.notProperty(limitedShow.body().data, 'contract')
    // Replacing releases the old row; the previous file is no longer served but stays on disk.
    const replacement = await upload(writer, 'عقد جديد.txt')(client)
    replacement.assertStatus(201)
    const replaced = await client
      .patch(`/resources/orders/${order.body().data.id}`)
      .loginAs(writer)
      .withCsrfToken()
      .header('Accept', 'application/json')
      .json({ contract: replacement.body().data.id, version: order.body().data.version })
    replaced.assertStatus(200)
    assert.deepEqual(replaced.body().data.contract, replacement.body().data)
    const released = await knex()('attachments').where('id', file.id).first()
    assert.isNotNull(released.deleted_at)
    assert.exists(await stat(app.makePath('storage/uploads', released.path)))
    const gone = await client.get(file.url).loginAs(writer)
    gone.assertStatus(404)
    const reuse = await client
      .post('/resources/orders')
      .loginAs(writer)
      .withCsrfToken()
      .header('Accept', 'application/json')
      .json({ orgUnitId, notes: 'إعادة استخدام', contract: replacement.body().data.id })
    reuse.assertStatus(422)
    assert.equal(reuse.body().error.code, 'E_ATTACHMENT')
  })

  test('module code grants one user an upload for one record field without a role rule', async ({
    client,
    assert,
  }) => {
    // The denied user holds no role; module code authorized them for this order only.
    const order = await client
      .post('/resources/orders')
      .loginAs(writer)
      .withCsrfToken()
      .header('Accept', 'application/json')
      .json({ orgUnitId, notes: `طلب لإذن الرفع ${randomUUID()}` })
    order.assertStatus(201)
    const orderId = order.body().data.id as number
    const runtime = adula()
    const grant = await grantUpload(knex(), runtime.registry, {
      resource: 'orders',
      recordId: orderId,
      field: 'contract',
      userId: denied.id,
      actorId: writer.id,
    })
    const withGrant = (user: User, token: string) => upload(user, 'دليل.txt', { grant: token })

    const others = await withGrant(reader, grant.token)(client)
    others.assertStatus(403)
    assert.equal(others.body().error.code, 'E_UPLOAD_GRANT')
    const forged = await withGrant(denied, 'A'.repeat(43))(client)
    forged.assertStatus(403)
    // The grant names the field; the request cannot redirect it.
    const created = await upload(denied, 'دليل.txt', {
      grant: grant.token,
      field: 'notes',
    })(client)
    created.assertStatus(201)
    const file: UploadedFile = created.body().data
    const row = await knex()('attachments').where('id', file.id).first()
    assert.equal(row.field, 'contract')
    assert.equal(row.org_unit_id, orgUnitId)
    assert.isNull(row.record_id)
    assert.deepEqual(row.data.uploadGrant.recordId, orderId)
    const audit = await knex()('activities')
      .where({ resource: 'orders', record_id: orderId })
      .whereIn('action', ['upload_granted', 'upload_via_grant'])
      .orderBy('id')
      .select('action', 'actor_id')
    assert.deepEqual(
      audit.map((entry) => [entry.action, Number(entry.actor_id)]),
      [
        ['upload_granted', writer.id],
        ['upload_via_grant', denied.id],
      ]
    )

    // The user still cannot save the record; module code binds the upload for them.
    const direct = await client
      .put(`/resources/orders/${orderId}`)
      .loginAs(denied)
      .withCsrfToken()
      .header('Accept', 'application/json')
      .json({ contract: file.id })
    assert.oneOf(direct.status(), [403, 404])
    await runtime.resources.systemSave('orders', { contract: file.id }, orderId, {
      actorId: denied.id,
      reason: 'evidence uploaded with a grant',
    })
    const bound = await knex()('attachments').where('id', file.id).first()
    assert.equal(bound.record_id, orderId)
    const download = await client.get(file.url).loginAs(writer)
    download.assertStatus(200)

    await knex()('upload_grants').update({ expires_at: knex().raw("now() - interval '1 second'") })
    const expired = await withGrant(denied, grant.token)(client)
    expired.assertStatus(403)
  })

  test('adula:storage:migrate moves live files to another disk and keeps downloads working', async ({
    client,
    assert,
  }) => {
    const created = await upload(writer, 'نقل.txt')(client)
    created.assertStatus(201)
    const file: UploadedFile = created.body().data
    const order = await client
      .post('/resources/orders')
      .loginAs(writer)
      .withCsrfToken()
      .header('Accept', 'application/json')
      .json({ orgUnitId, notes: `طلب للنقل ${randomUUID()}`, contract: file.id })
    order.assertStatus(201)
    const row = await knex()('attachments').where('id', file.id).first()
    const unknown = await ace(['adula:storage:migrate', 'local', 'nowhere'])
    assert.equal(unknown.code, 1)
    assert.include(unknown.output, 'Unknown disk: nowhere')
    const dry = await ace(['adula:storage:migrate', 'local', 'local_test_archive', '--dry-run'])
    assert.equal(dry.code, 0, dry.output)
    assert.include(dry.output, `would copy #${file.id} ${row.path}`)
    assert.equal(await diskOf(file.id), 'local')
    await assert.rejects(() => stat(app.makePath('storage/uploads-test-archive', row.path)))
    const moved = await ace(['adula:storage:migrate', 'local', 'local_test_archive'])
    assert.equal(moved.code, 0, moved.output)
    const summary = JSON.parse(moved.output.trim().split('\n').at(-1)!)
    assert.equal(summary.failed.length, 0)
    assert.isAtLeast(summary.copied, 1)
    assert.equal(summary.remaining, 0)
    const archived = await stat(app.makePath('storage/uploads-test-archive', row.path))
    assert.equal(archived.size, content.length)
    assert.equal(await diskOf(file.id), 'local_test_archive')
    assert.equal(
      Number(
        (await knex()('attachments')
          .where({ disk: 'local' })
          .whereNull('deleted_at')
          .count('* as count')
          .first())!.count
      ),
      0
    )
    const download = await client.get(file.url).loginAs(writer)
    download.assertStatus(200)
    assert.equal(Buffer.from(download.text()).toString(), content.toString())
    const again = await ace(['adula:storage:migrate', 'local', 'local_test_archive'])
    assert.equal(again.code, 0)
    assert.include(again.output, '"total":0')
    const back = await ace(['adula:storage:migrate', 'local_test_archive', 'local'])
    assert.equal(back.code, 0, back.output)
    assert.equal(await diskOf(file.id), 'local')
  }).timeout(180000)

  test('uploads accept only allowed file types and a bounded number of unbound files', async ({
    client,
    assert,
  }) => {
    const executable = await upload(writer, 'setup.exe')(client)
    executable.assertStatus(422)
    assert.equal(executable.body().error.code, 'E_FILE_INVALID')
    const [{ count: before }] = await knex()('attachments')
      .where('uploaded_by', outsider.id)
      .count('* as count')
    assert.equal(Number(before), 0)

    const suffix = randomUUID()
    await knex()('attachments').insert(
      Array.from({ length: PENDING_UPLOAD_LIMIT }, (_, index) => ({
        disk: 'local',
        path: `resources/orders/contract/pending-${suffix}-${index}.txt`,
        name: `pending-${suffix}-${index}.txt`,
        original_name: 'pending.txt',
        size: 1,
        mime_type: 'text/plain',
        extname: 'txt',
        data: '{}',
        uploaded_by: outsider.id,
        resource: 'orders',
        field: 'contract',
      }))
    )
    const capped = await upload(outsider)(client)
    capped.assertStatus(429)
    assert.equal(capped.body().error.code, 'E_UPLOAD_LIMIT')
    await knex()('attachments').where('uploaded_by', outsider.id).delete()
  })

  test('pruning removes stale unbound uploads and their files but keeps bound ones', async ({
    client,
    assert,
  }) => {
    const stale = await upload(writer)(client)
    stale.assertStatus(201)
    const fresh = await upload(writer)(client)
    fresh.assertStatus(201)
    const bound = await upload(writer)(client)
    bound.assertStatus(201)
    const order = await client
      .post('/resources/orders')
      .loginAs(writer)
      .withCsrfToken()
      .header('Accept', 'application/json')
      .json({ orgUnitId, contract: bound.body().data.id })
    order.assertStatus(201)
    const old = new Date(Date.now() - UNBOUND_UPLOAD_TTL_MS - 60_000)
    await knex()('attachments')
      .whereIn('id', [stale.body().data.id, bound.body().data.id])
      .update({ created_at: old })
    const staleRow = await knex()('attachments').where('id', stale.body().data.id).first()
    const stalePath = staleRow.path

    const result = await ace(['adula:uploads:prune'])
    assert.equal(result.code, 0, result.output)
    assert.notExists(await knex()('attachments').where('id', stale.body().data.id).first())
    assert.isFalse(await drive.use('local').exists(stalePath))
    assert.exists(await knex()('attachments').where('id', fresh.body().data.id).first())
    assert.exists(await knex()('attachments').where('id', bound.body().data.id).first())
    const download = await client.get(bound.body().data.url).loginAs(writer)
    download.assertStatus(200)
  }).timeout(120000)
})
