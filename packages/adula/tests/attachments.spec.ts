import { test } from '@japa/runner'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import knex from 'knex'
import {
  ResourceRegistry,
  ResourceService,
  createResourceTable,
  defineResource,
  diagnoseAttachments,
  migrateStorage,
  registerUpload,
  releaseAttachment,
  findAttachment,
  grantUpload,
  redeemUploadGrant,
  pruneUploadGrants,
} from '../index.js'
import type { Actor, RecordData, StorageDisk, UploadInput } from '../index.js'
import { admin, customer, db, setup } from './helpers.js'

const document = defineResource({
  name: 'documents',
  label: { ar: 'المستندات', en: 'Documents' },
  model: customer.model,
  scoped: true,
  version: true,
  fields: {
    title: { type: 'string', required: true, label: { ar: 'العنوان', en: 'Title' } },
    file: { type: 'attachment', label: { ar: 'الملف', en: 'File' } },
    privateFile: {
      type: 'attachment',
      permissionLevel: 1,
      label: { ar: 'ملف خاص', en: 'Private file' },
    },
    hiddenFile: { type: 'attachment', label: { ar: 'ملف مخفي', en: 'Hidden file' } },
  },
  list: ['title', 'file'],
  form: ['title', 'file', 'privateFile', 'hiddenFile'],
  show: ['title', 'file', 'privateFile', 'hiddenFile'],
  hidden: ['hiddenFile'],
  actions: ['view', 'create', 'update', 'delete'],
  validator: { validate: async (data) => data as RecordData },
})
const report = defineResource({
  name: 'reports',
  label: { ar: 'التقارير', en: 'Reports' },
  model: customer.model,
  scoped: true,
  submittable: true,
  fields: {
    title: { type: 'string', required: true, label: { ar: 'العنوان', en: 'Title' } },
    evidence: { type: 'attachment', label: { ar: 'الدليل', en: 'Evidence' } },
  },
  list: ['title'],
  form: ['title', 'evidence'],
  show: ['title', 'evidence'],
  actions: ['view', 'create', 'update', 'delete', 'submit', 'cancel'],
  validator: { validate: async (data) => data as RecordData },
})
const registry = new ResourceRegistry().register([
  { name: 'customers', label: customer.label, dependsOn: [], resources: [customer] },
  { name: 'documents', label: document.label, dependsOn: [], resources: [document, report] },
])
const clerk: Actor = {
  id: 2,
  orgPaths: ['1.2'],
  permissionLevel: 0,
  rules: [{ subject: 'documents', action: ['view', 'create', 'update', 'delete'] }],
}
const service = new ResourceService(db, registry)

function upload(uploadedBy: number, extra: Partial<UploadInput> = {}) {
  const name = `${randomUUID()}.pdf`
  return registerUpload(db, {
    disk: 'local',
    path: `resources/documents/file/${name}`,
    name,
    originalName: 'عقد التوريد.pdf',
    size: 1234,
    mimeType: 'application/pdf',
    extname: 'pdf',
    data: { name, extname: 'pdf', size: 1234, mimeType: 'application/pdf' },
    uploadedBy,
    resource: 'documents',
    field: 'file',
    ...extra,
  })
}
const attachmentRow = (id: number) => db('attachments').where('id', id).first()
async function stored(id: number, column: string) {
  const row = await attachmentRow(id)
  return row[column]
}
async function effects() {
  return {
    documents: await db('documents').orderBy('id').select('id', 'file', 'version'),
    attachments: await db('attachments')
      .orderBy('id')
      .select('id', 'record_id', 'field', 'org_unit_id', 'deleted_at'),
    activities: await db('activities').count('* as count').first(),
  }
}

class MemoryDisk implements StorageDisk {
  files = new Map<string, Buffer>()
  async exists(key: string) {
    return this.files.has(key)
  }
  async getStream(key: string) {
    const file = this.files.get(key)
    if (!file) throw new Error(`ENOENT: ${key}`)
    return Readable.from([file])
  }
  async putStream(key: string, contents: Readable) {
    const chunks: Buffer[] = []
    for await (const chunk of contents) chunks.push(Buffer.from(chunk))
    this.files.set(key, Buffer.concat(chunks))
  }
  async getMetaData(key: string) {
    const file = this.files.get(key)
    if (!file) throw new Error(`ENOENT: ${key}`)
    return { contentLength: file.length }
  }
}

test.group('Attachment ownership and hydration', (group) => {
  group.setup(async () => {
    await setup()
    await createResourceTable(db, document)
    await createResourceTable(db, report)
  })

  test('registerUpload validates disk keys and metadata before inserting', async ({ assert }) => {
    const invalid: Partial<UploadInput>[] = [
      { path: '/etc/passwd', name: 'passwd' },
      { path: '../escape.pdf', name: 'escape.pdf' },
      { path: 'resources\\documents\\file\\x.pdf', name: 'x.pdf' },
      { path: 'resources/documents/file/./x.pdf', name: 'x.pdf' },
      { name: 'other-name.pdf' },
      { size: -1 },
      { size: 1.5 },
      { extname: 'P.DF' },
      { disk: '' },
      { disk: '../local' },
      { originalName: '../secret.pdf' },
      { mimeType: 'text/plain\r\nX-Injected: 1' },
      { data: [] as unknown as Record<string, unknown> },
      { uploadedBy: 0 },
      { orgUnitId: -3 },
      { resource: 'bad-name' },
      { field: 'drop table' },
    ]
    for (const extra of invalid)
      await assert.rejects(() => upload(admin.id, extra), /E_ATTACHMENT_INPUT|Invalid|must be/)
    assert.equal(Number((await db('attachments').count('* as count').first())!.count), 0)
    const row = await upload(admin.id, { mimeType: '' })
    assert.equal(row.mimeType, 'application/octet-stream')
    assert.isNull(row.recordId)
    assert.equal(row.resource, 'documents')
    assert.equal(row.field, 'file')
    assert.equal(row.originalName, 'عقد التوريد.pdf')
    const inserted = await attachmentRow(row.id)
    assert.deepEqual(inserted.data, { ...row.data })
    assert.equal(inserted.size, '1234')
    assert.equal(inserted.uploaded_by, admin.id)
    assert.isNull(inserted.deleted_at)
    assert.deepEqual(await findAttachment(db, row.id), row)
    assert.isUndefined(await findAttachment(db, 'x'))
    assert.isUndefined(await findAttachment(db, row.id + 1000))
  })

  test('saving binds an owned upload and reads hydrate summaries with one query per page', async ({
    assert,
  }) => {
    const first = await upload(admin.id)
    const saved = await service.save('documents', admin, {
      title: 'عقد',
      file: first.id,
      orgUnitId: 2,
    })
    const summary = {
      id: first.id,
      name: 'عقد التوريد.pdf',
      size: 1234,
      mimeType: 'application/pdf',
      url: `/attachments/${first.id}`,
      preview: 'pdf',
    }
    assert.deepEqual(saved.file, summary)
    assert.isNull(saved.privateFile)
    const row = await db('documents').where('id', Number(saved.id)).first()
    assert.equal(row.file, first.id)
    const bound = await attachmentRow(first.id)
    assert.equal(bound.resource, 'documents')
    assert.equal(bound.record_id, Number(saved.id))
    assert.equal(bound.field, 'file')
    assert.equal(bound.org_unit_id, 2)
    const shown = await service.show('documents', Number(saved.id), admin)
    assert.deepEqual(shown.data.file, summary)
    const editor = await service.editor('documents', admin, Number(saved.id))
    assert.deepEqual(editor.record?.file, summary)
    for (let index = 0; index < 2; index++) {
      const extra = await upload(admin.id)
      await service.save('documents', admin, {
        title: `مستند ${index}`,
        file: extra.id,
        orgUnitId: 2,
      })
    }
    const empty = await service.save('documents', admin, {
      title: 'بلا ملف',
      file: null,
      orgUnitId: 2,
    })
    assert.isNull(empty.file)
    const queries: string[] = []
    const capture = (query: { sql: string }) => queries.push(query.sql)
    db.on('query', capture)
    let listed
    try {
      listed = await service.list('documents', admin)
    } finally {
      db.removeListener('query', capture)
    }
    assert.lengthOf(
      queries.filter((sql) => sql.includes('from "attachments"')),
      1
    )
    assert.isAtLeast(listed.data.length, 4)
    assert.deepEqual(listed.data.find((entry) => entry.id === saved.id)?.file, summary)
    assert.isNull(listed.data.find((entry) => entry.id === empty.id)?.file)
    for (const entry of listed.data)
      if (entry.file !== null)
        assert.sameMembers(Object.keys(entry.file as object), [
          'id',
          'name',
          'size',
          'mimeType',
          'url',
          'preview',
        ])
  })

  test('foreign, deleted, missing, bound and mismatched uploads are rejected and roll back', async ({
    assert,
  }) => {
    const owned = await upload(admin.id)
    const holder = await service.save('documents', admin, {
      title: 'حامل المرفق',
      file: owned.id,
      orgUnitId: 2,
    })
    const foreign = await upload(clerk.id)
    const deleted = await upload(admin.id)
    await releaseAttachment(db, deleted.id)
    const otherField = await upload(admin.id, { field: 'privateFile' })
    const otherResource = await upload(admin.id, { resource: 'customers', field: null })
    const otherUnit = await upload(admin.id, { orgUnitId: 3 })
    const other = await service.save('documents', admin, { title: 'بلا مرفق', orgUnitId: 2 })
    const before = await effects()
    const cases: [number, RegExp][] = [
      [foreign.id, /لا يخصك/],
      [deleted.id, /لا يخصك/],
      [2147483647, /لا يخصك/],
      [owned.id, /مرتبط بسجل آخر/],
      [otherField.id, /حقل آخر/],
      [otherResource.id, /حقل آخر/],
      [otherUnit.id, /وحدة تنظيمية أخرى/],
    ]
    for (const [file, message] of cases) {
      await assert.rejects(
        () => service.save('documents', admin, { title: 'مرفوض', file, orgUnitId: 2 }),
        message
      )
      await assert.rejects(
        () =>
          service.save(
            'documents',
            admin,
            { title: 'تعديل مرفوض', file, version: 1 },
            Number(other.id)
          ),
        message
      )
    }
    assert.equal(await stored(owned.id, 'record_id'), Number(holder.id))
    assert.deepEqual(await effects(), before)
    // An upload scoped to a unit binds only to records of that unit.
    const scoped = await service.save('documents', admin, {
      title: 'وحدة ب',
      file: otherUnit.id,
      orgUnitId: 3,
    })
    assert.equal(await stored(otherUnit.id, 'record_id'), Number(scoped.id))
  })

  test('an upload grant lets one user upload for one record field, and only for that record', async ({
    assert,
  }) => {
    // The inspector (user 2) holds no rule on documents; module code authorized them itself.
    const inspector: Actor = { id: 2, orgPaths: ['1.2'], permissionLevel: 0, rules: [] }
    const visit = await service.save('documents', admin, { title: 'زيارة', orgUnitId: 2 })
    const other = await service.save('documents', admin, { title: 'زيارة أخرى', orgUnitId: 2 })
    const refused = async (run: () => Promise<unknown>, pattern: RegExp) =>
      assert.rejects(run, pattern)

    await refused(
      () =>
        grantUpload(db, registry, {
          resource: 'documents',
          recordId: visit.id as number,
          field: 'title',
          userId: inspector.id,
        }),
      /مرفقات/
    )
    await refused(
      () =>
        grantUpload(db, registry, {
          resource: 'documents',
          recordId: 999999,
          field: 'file',
          userId: inspector.id,
        }),
      /السجل غير موجود/
    )
    await refused(
      () =>
        grantUpload(db, registry, {
          resource: 'documents',
          recordId: visit.id as number,
          field: 'file',
          userId: inspector.id,
          ttlMs: 2 * 60 * 60 * 1000,
        }),
      /1 hour/
    )

    const grant = await grantUpload(db, registry, {
      resource: 'documents',
      recordId: visit.id as number,
      field: 'file',
      userId: inspector.id,
      actorId: admin.id,
    })
    assert.match(grant.token, /^[A-Za-z0-9_-]{43}$/)
    const storedGrant = await db('upload_grants').orderBy('id', 'desc').first()
    assert.notEqual(storedGrant.token_hash, grant.token, 'only the token hash is stored')
    const issued = await db('activities')
      .where({ resource: 'documents', record_id: visit.id, action: 'upload_granted' })
      .first()
    assert.deepInclude(issued.changes, { field: 'file', userId: inspector.id })
    assert.equal(Number(issued.actor_id), admin.id)

    // Another user, a malformed token and an expired grant redeem to nothing.
    assert.isNull(await redeemUploadGrant(db, registry, grant.token, admin.id))
    assert.isNull(await redeemUploadGrant(db, registry, 'x'.repeat(43), inspector.id))
    assert.isNull(await redeemUploadGrant(db, registry, { token: grant.token }, inspector.id))
    const redeemed = await redeemUploadGrant(db, registry, grant.token, inspector.id)
    assert.deepEqual(redeemed, {
      id: Number(storedGrant.id),
      resource: 'documents',
      recordId: visit.id as number,
      field: 'file',
      orgUnitId: 2,
    })

    // The grant must match the upload's resource and field; the unit comes from the record.
    await refused(
      () => upload(inspector.id, { field: 'privateFile', grant: redeemed! }),
      /another field/
    )
    const evidence = await upload(inspector.id, { orgUnitId: 3, grant: redeemed! })
    assert.equal(evidence.orgUnitId, 2)
    assert.deepInclude(evidence.data, { uploadGrant: { id: redeemed!.id, recordId: visit.id } })
    const logged = await db('activities')
      .where({ resource: 'documents', record_id: visit.id, action: 'upload_via_grant' })
      .first()
    assert.deepInclude(logged.changes, { attachmentId: evidence.id, field: 'file' })

    // A plain upload cannot pretend to be granted.
    const forged = await upload(inspector.id, {
      data: { uploadGrant: { id: 1, recordId: visit.id } },
    })
    assert.notProperty(forged.data, 'uploadGrant')

    // The granted upload binds to the granted record only, never to another or a new one.
    await refused(
      () =>
        service.systemSave('documents', { file: evidence.id }, other.id as number, {
          actorId: inspector.id,
          reason: 'evidence',
        }),
      /لسجل آخر/
    )
    await refused(
      () =>
        service.systemSave(
          'documents',
          { title: 'جديد', file: evidence.id, orgUnitId: 2 },
          undefined,
          {
            actorId: inspector.id,
            reason: 'evidence',
          }
        ),
      /لسجل آخر/
    )
    await service.systemSave('documents', { file: evidence.id }, visit.id as number, {
      actorId: inspector.id,
      reason: 'inspection evidence',
    })
    assert.equal(await stored(evidence.id, 'record_id'), visit.id)

    // Grants expire and are pruned.
    await db('upload_grants').update({ expires_at: db.raw("now() - interval '1 second'") })
    assert.isNull(await redeemUploadGrant(db, registry, grant.token, inspector.id))
    assert.isAtLeast(Number(await pruneUploadGrants(db)), 1)
    assert.lengthOf(await db('upload_grants'), 0)
  })

  test('grants follow the record: none for locked or deleted records, none redeemed after', async ({
    assert,
  }) => {
    const inspector = 2
    const draft = await service.save('reports', admin, { title: 'مسودة', orgUnitId: 2 })
    const submitted = await service.save('reports', admin, { title: 'معتمد', orgUnitId: 2 })
    await db('reports').where('id', Number(submitted.id)).update({ doc_status: 1 })
    const cancelled = await service.save('reports', admin, { title: 'ملغى', orgUnitId: 2 })
    await db('reports').where('id', Number(cancelled.id)).update({ doc_status: 2 })
    const deleted = await service.save('documents', admin, { title: 'محذوف', orgUnitId: 2 })
    await db('documents').where('id', Number(deleted.id)).update({ deleted_at: db.fn.now() })
    const grant = (resource: string, recordId: number, field: string) =>
      grantUpload(db, registry, { resource, recordId, field, userId: inspector })
    for (const id of [submitted.id, cancelled.id])
      await assert.rejects(() => grant('reports', Number(id), 'evidence'), /معتمد أو ملغى/)
    await assert.rejects(() => grant('documents', Number(deleted.id), 'file'), /السجل غير موجود/)

    // A grant issued for a draft stops redeeming once the document is submitted or deleted,
    // and redeems the record's current unit after the record moves.
    const issued = await grant('reports', Number(draft.id), 'evidence')
    await db('reports').where('id', Number(draft.id)).update({ org_unit_id: 4 })
    const moved = await redeemUploadGrant(db, registry, issued.token, inspector)
    assert.equal(moved?.orgUnitId, 4)
    await db('reports').where('id', Number(draft.id)).update({ doc_status: 1 })
    assert.isNull(await redeemUploadGrant(db, registry, issued.token, inspector))
    await db('reports')
      .where('id', Number(draft.id))
      .update({ doc_status: 0, deleted_at: db.fn.now() })
    assert.isNull(await redeemUploadGrant(db, registry, issued.token, inspector))
  })

  test('replacing and clearing release the previous upload while keeping its metadata', async ({
    assert,
  }) => {
    const first = await upload(admin.id)
    const saved = await service.save('documents', admin, {
      title: 'استبدال',
      file: first.id,
      orgUnitId: 2,
    })
    const second = await upload(admin.id)
    const replaced = await service.save(
      'documents',
      admin,
      { file: second.id, version: 1 },
      Number(saved.id)
    )
    assert.equal((replaced.file as { id: number }).id, second.id)
    const released = await attachmentRow(first.id)
    assert.isNotNull(released.deleted_at)
    assert.equal(released.record_id, Number(saved.id))
    assert.equal(released.path, first.path)
    assert.equal(await stored(second.id, 'record_id'), Number(saved.id))
    const same = await service.save(
      'documents',
      admin,
      { file: second.id, version: 2 },
      Number(saved.id)
    )
    assert.equal((same.file as { id: number }).id, second.id)
    assert.isNull(await stored(second.id, 'deleted_at'))
    await assert.rejects(
      () => service.save('documents', admin, { file: first.id, version: 3 }, Number(saved.id)),
      /لا يخصك/
    )
    const moved = await service.save(
      'documents',
      admin,
      { orgUnitId: 3, version: 3 },
      Number(saved.id)
    )
    assert.equal(moved.orgUnitId, 3)
    assert.equal(await stored(second.id, 'org_unit_id'), 3)
    const cleared = await service.save(
      'documents',
      admin,
      { file: null, version: 4 },
      Number(saved.id)
    )
    assert.isNull(cleared.file)
    const clearedRow = await db('documents').where('id', Number(saved.id)).first()
    assert.isNull(clearedRow.file)
    assert.isNotNull(await stored(second.id, 'deleted_at'))
    await assert.rejects(
      () => service.save('documents', admin, { file: second.id, version: 5 }, Number(saved.id)),
      /لا يخصك/
    )
  })

  test('hidden and permission-level attachment fields follow the serialization rules', async ({
    assert,
  }) => {
    const visible = await upload(clerk.id)
    const created = await service.save('documents', clerk, {
      title: 'مستند الموظف',
      file: visible.id,
      orgUnitId: 2,
    })
    const restricted = await upload(admin.id, { field: 'privateFile' })
    const hidden = await upload(admin.id, { field: 'hiddenFile' })
    await assert.rejects(
      () =>
        service.save(
          'documents',
          clerk,
          { privateFile: restricted.id, version: 1 },
          Number(created.id)
        ),
      /Field is forbidden/
    )
    const updated = await service.save(
      'documents',
      admin,
      { privateFile: restricted.id, hiddenFile: hidden.id, version: 1 },
      Number(created.id)
    )
    assert.equal((updated.privateFile as { id: number }).id, restricted.id)
    assert.equal((updated.hiddenFile as { id: number }).id, hidden.id)
    const shown = await service.show('documents', Number(created.id), clerk)
    assert.equal((shown.data.file as { id: number }).id, visible.id)
    assert.notProperty(shown.data, 'privateFile')
    assert.notProperty(shown.data, 'hiddenFile')
    const listed = await service.list('documents', clerk)
    const entry = listed.data.find((row) => row.id === created.id)!
    assert.equal((entry.file as { id: number }).id, visible.id)
    assert.notProperty(entry, 'privateFile')
    assert.notProperty(entry, 'hiddenFile')
    const editor = await service.editor('documents', clerk, Number(created.id))
    assert.notInclude(
      editor.fields.map((field) => field.key),
      'privateFile'
    )
    assert.notProperty(editor.record!, 'hiddenFile')
    const full = await service.show('documents', Number(created.id), admin)
    assert.equal((full.data.privateFile as { id: number }).id, restricted.id)
    assert.equal((full.data.hiddenFile as { id: number }).id, hidden.id)
  })

  test('storage migration copies verified files, repoints rows per file and is resumable', async ({
    assert,
  }) => {
    const source = new MemoryDisk()
    const target = new MemoryDisk()
    const disks = { origin: source, archive: target }
    const use = (name: string) => disks[name as keyof typeof disks]
    const content = (label: string) => Buffer.from(`ملف ${label}`)
    const create = async (label: string, extra: Partial<UploadInput> = {}) => {
      const name = `${randomUUID()}.txt`
      return registerUpload(db, {
        disk: 'origin',
        path: `migration/${name}`,
        name,
        originalName: `${label}.txt`,
        size: content(label).length,
        mimeType: 'text/plain',
        extname: 'txt',
        data: {},
        uploadedBy: admin.id,
        ...extra,
      })
    }
    const fresh = await create('جديد')
    source.files.set(fresh.path, content('جديد'))
    const present = await create('موجود')
    source.files.set(present.path, content('موجود'))
    target.files.set(present.path, content('موجود'))
    const corrupt = await create('تالف')
    source.files.set(corrupt.path, content('تالف'))
    target.files.set(corrupt.path, Buffer.from('x'))
    const missing = await create('مفقود')
    const removed = await create('محذوف')
    source.files.set(removed.path, content('محذوف'))
    await releaseAttachment(db, removed.id)
    const elsewhere = await create('آخر', { disk: 'archive' })
    for (const [from, to] of [
      ['origin', 'nope'],
      ['nope', 'archive'],
      ['origin', 'origin'],
    ])
      await assert.rejects(
        () => migrateStorage(db, { from, to, disks: Object.keys(disks), use }),
        /Unknown disk|must differ/
      )
    const dry = await migrateStorage(db, {
      from: 'origin',
      to: 'archive',
      disks: Object.keys(disks),
      use,
      dryRun: true,
    })
    assert.include(dry, { total: 4, copied: 0, skipped: 0, remaining: 4, dryRun: true })
    assert.isFalse(target.files.has(fresh.path))
    assert.equal(await stored(fresh.id, 'disk'), 'origin')
    const lines: string[] = []
    const run = await migrateStorage(db, {
      from: 'origin',
      to: 'archive',
      disks: Object.keys(disks),
      use,
      report: (line) => lines.push(line),
    })
    assert.include(run, { total: 4, copied: 2, skipped: 1, remaining: 1, dryRun: false })
    assert.deepEqual(
      run.failed.map((entry) => entry.id),
      [missing.id]
    )
    assert.match(run.failed[0].reason, /ENOENT/)
    assert.equal(target.files.get(fresh.path)?.toString(), 'ملف جديد')
    assert.equal(target.files.get(corrupt.path)?.toString(), 'ملف تالف')
    assert.isTrue(source.files.has(fresh.path))
    for (const id of [fresh.id, present.id, corrupt.id])
      assert.equal(await stored(id, 'disk'), 'archive')
    assert.equal(await stored(missing.id, 'disk'), 'origin')
    assert.equal(await stored(removed.id, 'disk'), 'origin')
    assert.equal(await stored(elsewhere.id, 'disk'), 'archive')
    assert.lengthOf(
      lines.filter((line) => line.startsWith('failed')),
      1
    )
    source.files.set(missing.path, content('مفقود'))
    const resumed = await migrateStorage(db, {
      from: 'origin',
      to: 'archive',
      disks: Object.keys(disks),
      use,
    })
    assert.include(resumed, { total: 1, copied: 1, skipped: 0, remaining: 0 })
    assert.deepEqual(resumed.failed, [])
    assert.equal(await stored(missing.id, 'disk'), 'archive')
    const nothing = await migrateStorage(db, {
      from: 'origin',
      to: 'archive',
      disks: Object.keys(disks),
      use,
    })
    assert.equal(nothing.total, 0)
  })

  test('doctor reports bound, unbound and stale uploads as information', async ({ assert }) => {
    await db('attachments').update({ deleted_at: db.fn.now() }).whereNull('deleted_at')
    const bound = await upload(admin.id)
    await service.save('documents', admin, { title: 'إحصاء', file: bound.id, orgUnitId: 2 })
    await upload(admin.id)
    const stale = await upload(admin.id)
    await db('attachments')
      .where('id', stale.id)
      .update({ created_at: new Date(Date.now() - 2 * 86400000).toISOString() })
    const finding = await diagnoseAttachments(db)
    assert.equal(finding.status, 'info')
    assert.equal(finding.check, 'attachments')
    assert.equal(
      finding.message,
      '1 bound attachments, 2 unbound uploads (1 older than 24 hours), 3702 bytes in 3 live files'
    )
    const elsewhere = knex({
      client: 'pg',
      connection: db.client.config.connection,
      searchPath: ['adula_missing_schema'],
    })
    try {
      const missing = await diagnoseAttachments(elsewhere)
      assert.equal(missing.status, 'warn')
      assert.include(missing.message, 'migration:run')
    } finally {
      await elsewhere.destroy()
    }
  })
})
