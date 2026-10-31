import { test } from '@japa/runner'
import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import drive from '@adonisjs/drive/services/main'
import type { ApiClient } from '@japa/api-client'
import { grantUpload } from 'adula'
import { adula } from '#services/adula'
import { seedActor, type UiActor } from '#tests/helpers/ui_fixtures'

/**
 * ADR 047 over HTTP on real PostgreSQL: the order_documents fixture holds up to three files
 * in order (multiple: true, max 3, accepts svg/html on purpose) and order_receipts holds one
 * scan. Uploads, binding, release, authorization, preview headers, export, import and audit.
 */
type UploadedFile = {
  id: number
  name: string
  size: number
  mimeType: string
  url: string
  preview: 'image' | 'pdf' | 'text' | null
}

const json = { Accept: 'application/json' }
const knex = () => db.connection().getWriteClient()

// A real 1x1 PNG, a minimal PDF and plain text, so content sniffing agrees with the names.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
)
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'
)
const TEXT = Buffer.from('ملاحظات المستند\nسطر ثانٍ\n')
const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><script>alert(1)</script></svg>'
)
const HTML = Buffer.from('<!doctype html><html><body><script>alert(1)</script></body></html>')

const contents: Record<string, { body: Buffer; type: string }> = {
  png: { body: PNG, type: 'image/png' },
  pdf: { body: PDF, type: 'application/pdf' },
  txt: { body: TEXT, type: 'text/plain' },
  svg: { body: SVG, type: 'image/svg+xml' },
  html: { body: HTML, type: 'text/html' },
}

test.group('Multiple attachments and preview (ADR 047)', (group) => {
  let writer: UiActor
  let colleague: UiActor
  let reader: UiActor
  let outsider: UiActor
  const uploaded: number[] = []

  group.setup(async () => {
    const rules = [
      { subject: 'order_documents', action: 'manage' },
      { subject: 'order_receipts', action: 'manage' },
    ]
    writer = await seedActor(rules, { fullName: 'كاتب المستندات' })
    colleague = await seedActor(rules, { fullName: 'زميل المستندات', orgUnitId: writer.orgUnitId })
    reader = await seedActor(
      [
        { subject: 'order_documents', action: 'view' },
        { subject: 'order_receipts', action: 'view' },
      ],
      { fullName: 'قارئ المستندات', orgUnitId: writer.orgUnitId, level: 0 }
    )
    // Same rules, another organizational unit.
    outsider = await seedActor(rules, { fullName: 'مستخدم وحدة أخرى' })
    return async () => {
      const rows = await knex()('attachments').whereIn('id', uploaded)
      for (const row of rows)
        await drive
          .use('local')
          .delete(row.path)
          .catch(() => {})
    }
  })

  async function upload(
    client: ApiClient,
    actor: UiActor,
    name: string,
    extra: Record<string, string> = {},
    target: { resource: string; field: string } = { resource: 'order_documents', field: 'files' }
  ) {
    const extname = name.split('.').pop()!
    const kind = contents[extname] ?? contents.txt
    const response = await client
      .post('/attachments')
      .loginAs(actor.user)
      .withCsrfToken()
      .headers(json)
      .fields({ ...target, ...extra })
      .file('file', kind.body, { filename: name, contentType: kind.type })
    if (response.status() === 201) uploaded.push(response.body().data.id)
    return response
  }

  async function file(client: ApiClient, actor: UiActor, name: string): Promise<UploadedFile> {
    const response = await upload(client, actor, name)
    response.assertStatus(201)
    return response.body().data
  }

  function create(client: ApiClient, actor: UiActor, data: Record<string, unknown>) {
    return client
      .post('/resources/order_documents')
      .loginAs(actor.user)
      .withCsrfToken()
      .headers(json)
      .json({ orgUnitId: actor.orgUnitId, title: `مستند ${randomUUID().slice(0, 8)}`, ...data })
  }

  // The form validates every required field, so the stored title is sent with each change.
  async function update(
    client: ApiClient,
    actor: UiActor,
    id: number,
    data: Record<string, unknown>
  ) {
    const { title } = await knex()('order_documents').where('id', id).first('title')
    return client
      .patch(`/resources/order_documents/${id}`)
      .loginAs(actor.user)
      .withCsrfToken()
      .headers(json)
      .json({ title, ...data })
  }

  const ids = (value: unknown) => (value as UploadedFile[]).map((entry) => entry.id)
  const storedFiles = (id: number) =>
    knex()('order_documents')
      .where('id', id)
      .first('files')
      .then((row) => row.files as number[])
  const attachment = (id: number, column: 'deleted_at' | 'record_id') =>
    knex()('attachments')
      .where('id', id)
      .first(column)
      .then((row) => row[column])

  test('several files keep their order; reorder and removal release only the removed file', async ({
    client,
    assert,
  }) => {
    const first = await file(client, writer, 'أول.pdf')
    const second = await file(client, writer, 'ثان.png')
    const third = await file(client, writer, 'ثالث.txt')
    assert.equal(first.preview, 'pdf')
    assert.equal(second.preview, 'image')
    assert.equal(third.preview, 'text')

    const created = await create(client, writer, { files: [third.id, first.id, second.id] })
    created.assertStatus(201)
    const record = created.body().data
    assert.deepEqual(record.files, [third, first, second])
    assert.deepEqual(await storedFiles(record.id), [third.id, first.id, second.id])
    for (const entry of [first, second, third]) {
      const row = await knex()('attachments').where('id', entry.id).first()
      assert.equal(Number(row.record_id), record.id)
      assert.equal(row.resource, 'order_documents')
      assert.equal(row.field, 'files')
      assert.equal(Number(row.org_unit_id), writer.orgUnitId)
      assert.isNull(row.deleted_at)
    }
    const shown = await client
      .get(`/resources/order_documents/${record.id}`)
      .loginAs(reader.user)
      .headers(json)
    shown.assertStatus(200)
    assert.deepEqual(ids(shown.body().data.files), [third.id, first.id, second.id])

    // Reordering rewrites only the column: nothing is released or re-bound.
    const reordered = await update(client, writer, record.id, {
      files: [first.id, second.id, third.id],
      ...(record.version !== undefined ? { version: record.version } : {}),
    })
    reordered.assertStatus(200)
    assert.deepEqual(ids(reordered.body().data.files), [first.id, second.id, third.id])
    assert.deepEqual(await storedFiles(record.id), [first.id, second.id, third.id])
    assert.equal(
      Number(
        (await knex()('attachments')
          .whereIn('id', [first.id, second.id, third.id])
          .whereNull('deleted_at')
          .count('* as count')
          .first())!.count
      ),
      3
    )

    // Removing one soft-deletes its row (the file stays on disk) and keeps the others.
    const removed = await update(client, writer, record.id, {
      files: [first.id, third.id],
      ...(reordered.body().data.version !== undefined
        ? { version: reordered.body().data.version }
        : {}),
    })
    removed.assertStatus(200)
    assert.deepEqual(ids(removed.body().data.files), [first.id, third.id])
    const released = await knex()('attachments').where('id', second.id).first()
    assert.isNotNull(released.deleted_at)
    assert.exists(await stat(app.makePath('storage/uploads', released.path)))
    for (const kept of [first.id, third.id]) assert.isNull(await attachment(kept, 'deleted_at'))

    // The removed file is no longer served to anyone, preview included.
    for (const actor of [reader, writer]) {
      const gone = await client.get(second.url).loginAs(actor.user)
      gone.assertStatus(404)
      const gonePreview = await client.get(`${second.url}?preview=1`).loginAs(actor.user)
      gonePreview.assertStatus(404)
    }
    const kept = await client.get(first.url).loginAs(reader.user)
    kept.assertStatus(200)
    // A released file cannot be added back.
    const readded = await update(client, writer, record.id, {
      files: [first.id, third.id, second.id],
    })
    readded.assertStatus(422)
    assert.equal(readded.body().error.code, 'E_ATTACHMENT')
    assert.deepEqual(await storedFiles(record.id), [first.id, third.id])

    // Audit: each update records the field's before/after id arrays (field_changes).
    const audits = await knex()('field_changes as c')
      .join('activities as a', 'a.id', 'c.activity_id')
      .where({ 'c.resource': 'order_documents', 'c.record_id': record.id, 'c.field': 'files' })
      .orderBy('c.id')
      .select('a.action', 'c.before', 'c.after')
    const parsed = (value: unknown) => (typeof value === 'string' ? JSON.parse(value) : value)
    assert.deepEqual(
      audits.map((entry) => [entry.action, parsed(entry.before), parsed(entry.after)]),
      [
        ['update', [third.id, first.id, second.id], [first.id, second.id, third.id]],
        ['update', [first.id, second.id, third.id], [first.id, third.id]],
      ]
    )
  })

  test('more than max, a repeated file and foreign or bound uploads are refused', async ({
    client,
    assert,
  }) => {
    const four = [
      await file(client, writer, 'a.txt'),
      await file(client, writer, 'b.txt'),
      await file(client, writer, 'c.txt'),
      await file(client, writer, 'd.txt'),
    ]
    const tooMany = await create(client, writer, { files: four.map((entry) => entry.id) })
    tooMany.assertStatus(422)
    assert.include(JSON.stringify(tooMany.body()), 'يمكن إرفاق 3 ملفات على الأكثر')
    const repeated = await create(client, writer, { files: [four[0].id, four[0].id] })
    repeated.assertStatus(422)
    assert.include(JSON.stringify(repeated.body()), 'الملف مرفق أكثر من مرة')
    // Nothing was bound by the refused writes.
    for (const entry of four) assert.isNull(await attachment(entry.id, 'record_id'))

    // Another user's unbound upload, even in the same unit.
    const theirs = await file(client, colleague, 'زميل.txt')
    const foreign = await create(client, writer, { files: [four[0].id, theirs.id] })
    foreign.assertStatus(422)
    assert.equal(foreign.body().error.code, 'E_ATTACHMENT')
    assert.isNull(await attachment(four[0].id, 'record_id'))

    // A file bound to another record.
    const owner = await create(client, writer, { files: [four[1].id] })
    owner.assertStatus(201)
    const stolen = await create(client, writer, { files: [four[1].id] })
    stolen.assertStatus(422)
    assert.equal(stolen.body().error.code, 'E_ATTACHMENT')
    const other = await create(client, writer, { files: [four[2].id] })
    other.assertStatus(201)
    const moved = await update(client, writer, other.body().data.id, {
      files: [four[2].id, four[1].id],
    })
    moved.assertStatus(422)
    assert.equal(moved.body().error.code, 'E_ATTACHMENT')
    assert.deepEqual(await storedFiles(other.body().data.id), [four[2].id])
    assert.deepEqual(await storedFiles(owner.body().data.id), [four[1].id])
  })

  test('a file uploaded under another user grant cannot be attached elsewhere', async ({
    client,
    assert,
  }) => {
    const target = await create(client, writer, {})
    target.assertStatus(201)
    const targetId = target.body().data.id as number
    const grant = await grantUpload(knex(), adula().registry, {
      resource: 'order_documents',
      recordId: targetId,
      field: 'files',
      userId: colleague.user.id,
      actorId: writer.user.id,
    })
    const viaGrant = await upload(client, colleague, 'بإذن.txt', { grant: grant.token })
    viaGrant.assertStatus(201)
    const granted: UploadedFile = viaGrant.body().data
    // The granting user did not upload it.
    const byGranter = await update(client, writer, targetId, { files: [granted.id] })
    byGranter.assertStatus(422)
    assert.equal(byGranter.body().error.code, 'E_ATTACHMENT')
    // The uploader cannot move it to a new record or another record.
    const elsewhere = await create(client, colleague, { files: [granted.id] })
    elsewhere.assertStatus(422)
    assert.equal(elsewhere.body().error.code, 'E_ATTACHMENT')
    const another = await create(client, colleague, {})
    another.assertStatus(201)
    const onAnother = await update(client, colleague, another.body().data.id, {
      files: [granted.id],
    })
    onAnother.assertStatus(422)
    assert.equal(onAnother.body().error.code, 'E_ATTACHMENT')
    assert.isNull(await attachment(granted.id, 'record_id'))
    // On the granted record it binds.
    const onTarget = await update(client, colleague, targetId, { files: [granted.id] })
    onTarget.assertStatus(200)
    assert.deepEqual(ids(onTarget.body().data.files), [granted.id])
  })

  test('another organizational unit cannot download or preview a file, multiple or single', async ({
    client,
    assert,
  }) => {
    const image = await file(client, writer, 'صورة.png')
    const created = await create(client, writer, { files: [image.id] })
    created.assertStatus(201)
    const receiptUpload = await upload(
      client,
      writer,
      'إيصال.png',
      {},
      { resource: 'order_receipts', field: 'scan' }
    )
    receiptUpload.assertStatus(201)
    const scan: UploadedFile = receiptUpload.body().data
    const receipt = await client
      .post('/resources/order_receipts')
      .loginAs(writer.user)
      .withCsrfToken()
      .headers(json)
      .json({ orgUnitId: writer.orgUnitId, reference: `R-${randomUUID()}`, scan: scan.id })
    receipt.assertStatus(201)
    assert.equal(receipt.body().data.scan.preview, 'image')

    for (const url of [image.url, scan.url]) {
      for (const suffix of ['', '?preview=1']) {
        const own = await client.get(`${url}${suffix}`).loginAs(reader.user)
        own.assertStatus(200)
        const foreign = await client.get(`${url}${suffix}`).loginAs(outsider.user)
        foreign.assertStatus(404)
      }
    }
    const hidden = await client
      .get(`/resources/order_documents/${created.body().data.id}`)
      .loginAs(outsider.user)
      .headers(json)
    assert.oneOf(hidden.status(), [403, 404])
  })

  test('preview serves only allow-listed types inline with safe headers', async ({
    client,
    assert,
  }) => {
    const png = await file(client, writer, 'صورة.png')
    const pdf = await file(client, writer, 'تقرير.pdf')
    const txt = await file(client, writer, 'نص.txt')
    const record = await create(client, writer, { files: [png.id, pdf.id, txt.id] })
    record.assertStatus(201)

    const expectations: [UploadedFile, string, boolean][] = [
      [png, 'image/png', true],
      [pdf, 'application/pdf', false],
      [txt, 'text/plain; charset=utf-8', true],
    ]
    for (const [entry, type, sandboxed] of expectations) {
      const inline = await client.get(`${entry.url}?preview=1`).loginAs(reader.user)
      inline.assertStatus(200)
      assert.equal(inline.header('content-type'), type, entry.name)
      assert.match(inline.header('content-disposition') ?? '', /^inline; filename=/)
      assert.equal(inline.header('x-content-type-options'), 'nosniff')
      assert.equal(inline.header('cache-control'), 'private, no-store')
      const csp = inline.header('content-security-policy') ?? ''
      assert.include(csp, "default-src 'none'")
      assert.include(csp, "frame-ancestors 'self'")
      assert.equal(/(^|;)\s*sandbox(\s|;|$)/.test(csp), sandboxed, `${entry.name}: ${csp}`)
      assert.equal(inline.header('content-length'), String(entry.size))
      // Without ?preview=1 the same file downloads.
      const download = await client.get(entry.url).loginAs(reader.user)
      download.assertStatus(200)
      assert.match(download.header('content-disposition') ?? '', /^attachment; filename=/)
      assert.equal(download.header('x-content-type-options'), 'nosniff')
    }
    const text = await client.get(`${txt.url}?preview=1`).loginAs(reader.user)
    assert.equal(Buffer.from(text.text()).toString(), TEXT.toString())
  })

  test('svg, html and a file whose stored type disagrees with its name always download', async ({
    client,
    assert,
  }) => {
    const svg = await file(client, writer, 'رسم.svg')
    const html = await file(client, writer, 'صفحة.html')
    const disguised = await file(client, writer, 'مموه.png')
    assert.isNull(svg.preview)
    assert.isNull(html.preview)
    assert.equal(disguised.preview, 'image')
    // The stored content type of the .png no longer matches its extension.
    await knex()('attachments').where('id', disguised.id).update({ mime_type: 'text/html' })
    const record = await create(client, writer, { files: [svg.id, html.id, disguised.id] })
    record.assertStatus(201)
    assert.deepEqual(
      (record.body().data.files as UploadedFile[]).map((entry) => entry.preview),
      [null, null, null]
    )
    for (const entry of [svg, html, disguised]) {
      for (const suffix of ['', '?preview=1', '?preview=true']) {
        const response = await client.get(`${entry.url}${suffix}`).loginAs(reader.user)
        response.assertStatus(200)
        assert.match(
          response.header('content-disposition') ?? '',
          /^attachment; filename=/,
          `${entry.name}${suffix}`
        )
        assert.equal(response.header('x-content-type-options'), 'nosniff')
        const csp = response.header('content-security-policy') ?? ''
        assert.include(csp, "default-src 'none'")
        assert.include(csp, 'sandbox')
        assert.notInclude(csp, "frame-ancestors 'self'")
      }
    }
  })

  test('export lists file names in order; import refuses the attachment column', async ({
    client,
    assert,
  }) => {
    const stamp = `تصدير${randomUUID().slice(0, 8)}`
    const first = await file(client, writer, 'العقد.pdf')
    const second = await file(client, writer, 'الفاتورة.png')
    const created = await create(client, writer, { title: stamp, files: [second.id, first.id] })
    created.assertStatus(201)
    const exported = await client
      .get('/resources/order_documents/export')
      .qs({ search: stamp })
      .loginAs(reader.user)
      .headers(json)
    exported.assertStatus(200)
    assert.match(exported.header('content-type') ?? '', /^text\/csv/)
    const text = exported.text()
    assert.include(text, stamp)
    assert.include(text, 'الملفات')
    assert.include(text, 'الفاتورة.png، العقد.pdf')

    const csv = `العنوان,الملفات\nمستورد ${stamp},ملف.pdf\n`
    const batch = await client
      .post('/resources/order_documents/imports')
      .loginAs(writer.user)
      .withCsrfToken()
      .headers(json)
      .file('file', Buffer.from(csv), { filename: 'documents.csv', contentType: 'text/csv' })
    batch.assertStatus(201)
    const started = await client
      .post(`/imports/${batch.body().data.id}/start`)
      .loginAs(writer.user)
      .withCsrfToken()
      .headers(json)
      .json({ mapping: { 0: 'title', 1: 'files' } })
    started.assertStatus(422)
    assert.equal(started.body().error.code, 'E_IMPORT_MAPPING')
    assert.include(
      JSON.stringify(started.body()),
      'لا يمكن استيراد المرفقات من ملف؛ ارفعها من صفحة السجل: الملفات'
    )
  })
})
