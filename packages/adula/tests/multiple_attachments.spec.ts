import { test } from '@japa/runner'
import { randomUUID } from 'node:crypto'
import {
  FieldValueError,
  MULTIPLE_ATTACHMENT_LIMIT,
  ResourceRegistry,
  ResourceService,
  attachmentHeaders,
  attachmentLimit,
  attachmentPreview,
  createResourceTable,
  defineResource,
  definitionValidator,
  openApiDocument,
  registerUpload,
  resourceSchema,
} from '../index.js'
import type { Actor, Field, RecordData, ResourceInput, UploadInput } from '../index.js'
import { fieldSnapshot } from '../src/commands/snapshot.js'
import { fieldValue } from '../src/resource/values.js'
import { admin, customer, db, setup } from './helpers.js'

// ADR 047: several files per attachment field, in order, and inline preview of safe types.
const folder = defineResource({
  name: 'folders',
  label: { ar: 'الملفات', en: 'Folders' },
  model: customer.model,
  scoped: true,
  version: true,
  fields: {
    title: { type: 'string', required: true, label: { ar: 'العنوان', en: 'Title' } },
    files: {
      type: 'attachment',
      multiple: true,
      max: 3,
      filterable: true,
      label: { ar: 'الملفات', en: 'Files' },
    },
    scans: {
      type: 'attachment',
      multiple: true,
      required: true,
      label: { ar: 'المسوح', en: 'Scans' },
    },
  },
  list: ['title', 'files'],
  form: ['title', 'files', 'scans'],
  show: ['title', 'files', 'scans'],
  actions: ['view', 'create', 'update', 'delete'],
  validator: { validate: async (data) => data as RecordData },
})
// Inline rows upload for the child resource and field, which the child's write claims.
const binder = defineResource({
  name: 'binders',
  label: { ar: 'الملفات الورقية', en: 'Binders' },
  model: customer.model,
  scoped: true,
  fields: {
    title: { type: 'string', required: true, label: { ar: 'العنوان', en: 'Title' } },
    sheets: {
      type: 'hasMany',
      resource: 'binder_sheets',
      foreignKey: 'binderId',
      inline: true,
      label: { ar: 'الأوراق', en: 'Sheets' },
    },
  },
  list: ['title'],
  form: ['title', 'sheets'],
  show: ['title'],
  actions: ['view', 'create', 'update', 'delete'],
  validator: { validate: async (data) => data as RecordData },
})
const sheet = defineResource({
  name: 'binder_sheets',
  label: { ar: 'الأوراق', en: 'Sheets' },
  model: customer.model,
  scoped: true,
  fields: {
    binderId: {
      type: 'belongsTo',
      resource: 'binders',
      required: true,
      label: { ar: 'الملف', en: 'Binder' },
    },
    scans: {
      type: 'attachment',
      multiple: true,
      label: { ar: 'المسوح', en: 'Scans' },
    },
  },
  list: ['binderId', 'scans'],
  form: ['binderId', 'scans'],
  show: ['binderId', 'scans'],
  actions: ['view', 'create', 'update', 'delete'],
  validator: { validate: async (data) => data as RecordData },
})
const registry = new ResourceRegistry().register([
  { name: 'customers', label: customer.label, dependsOn: [], resources: [customer] },
  { name: 'folders', label: folder.label, dependsOn: [], resources: [folder, binder, sheet] },
])
const service = new ResourceService(db, registry)
const clerk: Actor = {
  id: 2,
  orgPaths: ['1.2'],
  permissionLevel: 0,
  rules: [{ subject: 'folders', action: ['view', 'create', 'update'] }],
}

function upload(field: string, extra: Partial<UploadInput> = {}) {
  const name = `${randomUUID()}.pdf`
  return registerUpload(db, {
    disk: 'local',
    path: `resources/folders/${field}/${name}`,
    name,
    originalName: `ملف ${name.slice(0, 4)}.pdf`,
    size: 100,
    mimeType: 'application/pdf',
    extname: 'pdf',
    data: {},
    uploadedBy: admin.id,
    resource: 'folders',
    field,
    ...extra,
  })
}
const attachmentRow = (id: number) => db('attachments').where('id', id).first()
async function stored(id: number, column: string) {
  const row = await attachmentRow(id)
  return row[column]
}
const ids = (value: unknown) => (value as { id: number }[]).map((file) => file.id)

function define(
  fields: Record<string, Field>,
  extra: Partial<ResourceInput<Record<string, Field>>> = {}
) {
  return () =>
    defineResource({
      name: 'probes',
      label: { ar: 'تجربة' },
      scoped: false,
      fields: { title: { type: 'string', label: { ar: 'العنوان' } }, ...fields },
      list: ['title'],
      form: Object.keys(fields),
      show: ['title'],
      actions: ['view'],
      ...extra,
    } as ResourceInput<Record<string, Field>>)
}

test.group('Multiple attachments: definition and values', () => {
  test('a definition declares max only on a multiple field, within 1 to 100', ({ assert }) => {
    const label = { ar: 'ملفات' }
    assert.throws(define({ files: { type: 'attachment', max: 3, label } }), /max needs multiple/)
    for (const max of [0, 101, 2.5, '3'])
      assert.throws(
        define({ files: { type: 'attachment', multiple: true, max, label } as unknown as Field }),
        /max must be an integer from 1 to 100/
      )
    assert.throws(
      define({ files: { type: 'attachment', multiple: 'yes', label } as unknown as Field }),
      /multiple must be true or false/
    )
    for (const flag of ['sortable', 'searchable', 'unique'])
      assert.throws(
        define({ files: { type: 'attachment', multiple: true, [flag]: true, label } as Field }),
        new RegExp(`cannot be ${flag}`)
      )
    assert.throws(
      define(
        { files: { type: 'attachment', multiple: true, label } },
        { unique: [['title', 'files']] }
      ),
      /unstored field files/
    )
    assert.doesNotThrow(define({ files: { type: 'attachment', multiple: true, max: 100, label } }))
    assert.equal(attachmentLimit(folder.fields.files), 3)
    assert.equal(attachmentLimit(folder.fields.scans), MULTIPLE_ATTACHMENT_LIMIT)
    assert.equal(attachmentLimit({ type: 'attachment', label }), 1)
  })

  test('values keep the given order, accept digit strings and refuse duplicates and excess', async ({
    assert,
  }) => {
    const files = folder.fields.files
    assert.deepEqual(fieldValue(files, [9, 3, 5]), [9, 3, 5])
    assert.deepEqual(fieldValue(files, ['9', 3]), [9, 3])
    assert.deepEqual(fieldValue(files, []), [])
    const refusal = (value: unknown) => {
      try {
        fieldValue(files, value)
      } catch (error) {
        assert.instanceOf(error, FieldValueError)
        return error as FieldValueError
      }
      assert.fail(`accepted ${JSON.stringify(value)}`)
    }
    assert.equal(refusal([4, 4])!.rule, 'attachments.distinct')
    assert.equal(refusal([4, 4])!.message, 'الملف مرفق أكثر من مرة')
    assert.equal(refusal([1, 2, 3, 4])!.rule, 'attachments.max')
    assert.equal(refusal([1, 2, 3, 4])!.message, 'يمكن إرفاق 3 ملفات على الأكثر')
    for (const value of [7, 'x', [0], [-1], [1.5], [2147483648], [null]])
      assert.equal(refusal(value)!.rule, 'attachments')
    // A single field still takes one id.
    assert.throws(() => fieldValue({ type: 'attachment', label: { ar: 'ملف' } }, [1]))
    const validated = await definitionValidator(folder).validate({
      title: 'مجلد',
      files: [5, 2],
      scans: [7],
    })
    assert.deepEqual(validated.files, [5, 2])
  })

  test('the column is jsonb without a foreign key, and the snapshot keeps multiple', ({
    assert,
  }) => {
    const schema = resourceSchema(folder)
    const files = schema.columns.find((column) => column.field === 'files')!
    assert.equal(files.type, 'jsonb')
    assert.notProperty(files, 'references')
    assert.isTrue(files.nullable)
    const scans = schema.columns.find((column) => column.field === 'scans')!
    assert.isFalse(scans.nullable)
    assert.deepInclude(fieldSnapshot(folder.fields.files), { type: 'attachment', multiple: true })
    const single = resourceSchema({
      ...folder,
      fields: { file: { type: 'attachment', label: { ar: 'ملف' } } },
    }).columns.find((column) => column.field === 'file')!
    assert.equal(single.type, 'integer')
    assert.equal(single.references, 'attachments')
  })
})

test.group('Multiple attachments: writes and reads', (group) => {
  group.setup(async () => {
    await setup()
    await createResourceTable(db, folder)
    await createResourceTable(db, binder)
    await createResourceTable(db, sheet)
  })

  test('an inline row binds files uploaded for the child resource, not for the parent', async ({
    assert,
  }) => {
    const forChild = await upload('scans', { resource: 'binder_sheets' })
    const saved = await service.save('binders', admin, {
      title: 'ملف ورقي',
      orgUnitId: 2,
      sheets: [{ scans: [forChild.id] }],
    })
    const [row] = await db('binder_sheets').where('binder_id', Number(saved.id))
    assert.deepEqual(row.scans, [forChild.id])
    assert.equal(await stored(forChild.id, 'resource'), 'binder_sheets')
    assert.equal(await stored(forChild.id, 'record_id'), row.id)
    const editor = await service.editor('binders', admin, Number(saved.id))
    const rows = editor.inline.sheets.rows
    assert.deepEqual(ids(rows[0].scans), [forChild.id])
    // An upload made for the parent resource (as the old inline control did) is refused.
    const forParent = await upload('scans', { resource: 'binders' })
    await assert.rejects(
      () =>
        service.save('binders', admin, {
          title: 'ملف آخر',
          orgUnitId: 2,
          sheets: [{ scans: [forParent.id] }],
        }),
      /مخصص لحقل آخر/
    )
    assert.isNull(await stored(forParent.id, 'record_id'))
  })

  test('saving binds every file in order and reads hydrate them in that order', async ({
    assert,
  }) => {
    const [a, b, scan] = [await upload('files'), await upload('files'), await upload('scans')]
    const saved = await service.save('folders', admin, {
      title: 'مجلد العقود',
      files: [b.id, a.id],
      scans: [scan.id],
      orgUnitId: 2,
    })
    assert.deepEqual(ids(saved.files), [b.id, a.id])
    assert.deepEqual((saved.files as unknown[])[0], {
      id: b.id,
      name: b.originalName,
      size: 100,
      mimeType: 'application/pdf',
      url: `/attachments/${b.id}`,
      preview: 'pdf',
    })
    const row = await db('folders').where('id', Number(saved.id)).first()
    assert.deepEqual(row.files, [b.id, a.id])
    for (const file of [a, b]) {
      const bound = await attachmentRow(file.id)
      assert.equal(bound.record_id, Number(saved.id))
      assert.equal(bound.field, 'files')
      assert.equal(bound.org_unit_id, 2)
    }
    const shown = await service.show('folders', Number(saved.id), admin)
    assert.deepEqual(ids(shown.data.files), [b.id, a.id])
    // One attachments query for the whole page, whatever the number of files.
    const queries: string[] = []
    const capture = (query: { sql: string }) => queries.push(query.sql)
    db.on('query', capture)
    try {
      await service.list('folders', admin)
    } finally {
      db.removeListener('query', capture)
    }
    assert.lengthOf(
      queries.filter((sql) => sql.includes('from "attachments"')),
      1
    )
  })

  test('reordering keeps files, removing releases one, adding binds one, all audited', async ({
    assert,
  }) => {
    const [a, b, c, scan] = [
      await upload('files'),
      await upload('files'),
      await upload('files'),
      await upload('scans'),
    ]
    const saved = await service.save('folders', admin, {
      title: 'ترتيب',
      files: [a.id, b.id],
      scans: [scan.id],
      orgUnitId: 2,
    })
    const id = Number(saved.id)
    const reordered = await service.save('folders', admin, { files: [b.id, a.id], version: 1 }, id)
    assert.deepEqual(ids(reordered.files), [b.id, a.id])
    assert.isNull(await stored(a.id, 'deleted_at'))
    const changed = await service.save('folders', admin, { files: [c.id, b.id], version: 2 }, id)
    assert.deepEqual(ids(changed.files), [c.id, b.id])
    assert.isNotNull(await stored(a.id, 'deleted_at'))
    assert.equal(await stored(c.id, 'record_id'), id)
    const audit = await db('field_changes')
      .where({ resource: 'folders', record_id: id, field: 'files' })
      .orderBy('id')
    assert.deepEqual(
      audit.map((change) => [change.before, change.after]),
      [
        [
          [a.id, b.id],
          [b.id, a.id],
        ],
        [
          [b.id, a.id],
          [c.id, b.id],
        ],
      ]
    )
    // A released file cannot come back: its row is gone for every reader and writer.
    await assert.rejects(
      () => service.save('folders', admin, { files: [a.id], version: 3 }, id),
      /لا يخصك/
    )
    const cleared = await service.save('folders', admin, { files: [], version: 3 }, id)
    assert.deepEqual(cleared.files, [])
    assert.isNotNull(await stored(c.id, 'deleted_at'))
    // Moving the record claims its remaining files for the new unit.
    await service.save('folders', admin, { orgUnitId: 3, version: 4 }, id)
    assert.equal(await stored(scan.id, 'org_unit_id'), 3)
  })

  test('a record holding files of several uploaders moves unit; a foreign new file does not', async ({
    assert,
  }) => {
    const [mine, scan] = [await upload('files'), await upload('scans')]
    const saved = await service.save('folders', admin, {
      title: 'ملفات مشتركة',
      files: [mine.id],
      scans: [scan.id],
      orgUnitId: 2,
    })
    const id = Number(saved.id)
    const theirs = await upload('files', { uploadedBy: clerk.id })
    await service.save('folders', clerk, { files: [mine.id, theirs.id], version: 1 }, id)
    assert.equal(await stored(theirs.id, 'record_id'), id)
    // The administrator moves the record: the clerk's file follows without an uploader check.
    const moved = await service.save('folders', admin, { orgUnitId: 3, version: 2 }, id)
    assert.equal(moved.orgUnitId, 3)
    for (const file of [mine, theirs, scan]) assert.equal(await stored(file.id, 'org_unit_id'), 3)
    assert.deepEqual(ids(moved.files), [mine.id, theirs.id])
    // A new file of another uploader is still refused, even within a move, and rolls back.
    const foreign = await upload('files', { uploadedBy: clerk.id })
    await assert.rejects(
      () =>
        service.save(
          'folders',
          admin,
          { orgUnitId: 2, files: [mine.id, theirs.id, foreign.id], version: 3 },
          id
        ),
      /لا يخصك/
    )
    assert.isNull(await stored(foreign.id, 'record_id'))
    assert.equal(await stored(theirs.id, 'org_unit_id'), 3)
    const record = await db('folders').where('id', id).first()
    assert.equal(Number(record.org_unit_id), 3)
  })

  test('a foreign, duplicated or excess file rolls the whole write back', async ({ assert }) => {
    const before = await db('folders').count('* as count').first()
    const own = await upload('files')
    const scan = await upload('scans')
    const foreign = await upload('files', { uploadedBy: 2 })
    const other = await upload('scans')
    await assert.rejects(
      () =>
        service.save('folders', admin, {
          title: 'أجنبي',
          files: [own.id, foreign.id],
          scans: [scan.id],
          orgUnitId: 2,
        }),
      /لا يخصك/
    )
    // A file uploaded for another field is refused too.
    await assert.rejects(
      () =>
        service.save('folders', admin, {
          title: 'حقل آخر',
          files: [other.id],
          scans: [scan.id],
          orgUnitId: 2,
        }),
      /مخصص لحقل آخر/
    )
    await assert.rejects(
      () =>
        service.save('folders', admin, {
          title: 'مكرر',
          files: [own.id, own.id],
          scans: [scan.id],
          orgUnitId: 2,
        }),
      /أكثر من مرة/
    )
    await assert.rejects(
      () =>
        service.save('folders', admin, { title: 'بلا مسح', files: [], scans: [], orgUnitId: 2 }),
      /Required field: scans/
    )
    assert.deepEqual(await db('folders').count('* as count').first(), before)
    assert.isNull(await stored(own.id, 'record_id'))
    assert.isNull(await stored(scan.id, 'record_id'))
  })

  test('export lists the file names in order and filters accept only empty', async ({ assert }) => {
    const [a, b, scan] = [
      await upload('files', { originalName: 'أولًا.pdf' }),
      await upload('files', { originalName: 'ثانيًا.pdf' }),
      await upload('scans'),
    ]
    await service.save('folders', admin, {
      title: 'تصدير',
      files: [b.id, a.id],
      scans: [scan.id],
      orgUnitId: 2,
    })
    const file = await service.export('folders', admin, { search: undefined })
    assert.include(file.content, 'ثانيًا.pdf، أولًا.pdf')
    const empty = await service.list('folders', admin, { filters: { files: { empty: true } } })
    const present = await service.list('folders', admin, { filters: { files: { empty: false } } })
    assert.isTrue(empty.data.every((row) => (row.files as unknown[]).length === 0))
    assert.isTrue(present.data.some((row) => row.title === 'تصدير'))
    await assert.rejects(
      () => service.list('folders', admin, { filters: { files: a.id } }),
      /Invalid filter value|Unsupported filter/
    )
  })
})

test.group('Multiple attachments: editor and OpenAPI', (group) => {
  group.setup(async () => {
    await setup()
    await createResourceTable(db, folder)
    await createResourceTable(db, binder)
    await createResourceTable(db, sheet)
  })

  test('the editor sends the resolved limit and OpenAPI describes ordered id arrays', async ({
    assert,
  }) => {
    const editor = await service.editor('folders', admin)
    const limit = (key: string) =>
      (editor.fields.find((entry) => entry.key === key) as { max?: number }).max
    assert.equal(limit('files'), 3)
    assert.equal(limit('scans'), MULTIPLE_ATTACHMENT_LIMIT)
    const document = openApiDocument(registry, {
      title: 'Test',
      version: '1.0.0',
      serverUrl: 'https://example.test',
      actor: admin,
    })
    const input = document.components.schemas.folders_input as {
      properties: Record<string, Record<string, unknown>>
    }
    // An optional field may also be null.
    assert.deepInclude(input.properties.files, {
      type: ['array', 'null'],
      maxItems: 3,
      uniqueItems: true,
      items: { type: 'integer' },
    })
    assert.notProperty(input.properties.files, 'minItems')
    assert.deepInclude(input.properties.scans, { minItems: 1, maxItems: MULTIPLE_ATTACHMENT_LIMIT })
    const read = document.components.schemas.folders as {
      properties: Record<string, { type?: unknown; items?: { properties?: object } }>
    }
    assert.property(read.properties.files.items?.properties ?? {}, 'preview')
  })
})

test.group('Attachment preview', () => {
  const file = (extname: string, mimeType: string, originalName = `تقرير.${extname}`) => ({
    extname,
    mimeType,
    originalName,
    size: 10,
  })

  test('only allow-listed types whose stored content type matches preview inline', ({ assert }) => {
    assert.equal(attachmentPreview(file('png', 'image/png')), 'image')
    assert.equal(attachmentPreview(file('JPG', 'image/jpeg')), 'image')
    assert.equal(attachmentPreview(file('pdf', 'application/pdf')), 'pdf')
    assert.equal(attachmentPreview(file('txt', 'text/plain; charset=utf-8')), 'text')
    for (const [extname, mimeType] of [
      ['svg', 'image/svg+xml'],
      ['html', 'text/html'],
      ['png', 'text/html'],
      ['txt', 'text/html'],
      ['pdf', 'application/octet-stream'],
      ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      ['constructor', 'image/png'],
    ])
      assert.isNull(attachmentPreview(file(extname, mimeType)), `${extname} ${mimeType}`)
  })

  test('preview headers are inline with the listed type; everything else downloads', ({
    assert,
  }) => {
    const image = attachmentHeaders(file('png', 'image/png'), { preview: true })
    assert.equal(image['Content-Type'], 'image/png')
    assert.match(image['Content-Disposition'], /^inline; filename="/)
    assert.include(image['Content-Disposition'], encodeURIComponent('تقرير.png'))
    assert.equal(image['X-Content-Type-Options'], 'nosniff')
    assert.equal(image['X-Frame-Options'], 'SAMEORIGIN')
    assert.include(image['Content-Security-Policy'], "default-src 'none'")
    assert.include(image['Content-Security-Policy'], 'sandbox')
    assert.notInclude(image['Content-Security-Policy'], 'script-src')
    const text = attachmentHeaders(file('txt', 'text/plain'), { preview: true })
    assert.equal(text['Content-Type'], 'text/plain; charset=utf-8')
    assert.include(text['Content-Security-Policy'], 'sandbox')
    const pdf = attachmentHeaders(file('pdf', 'application/pdf'), { preview: true })
    assert.equal(pdf['Content-Type'], 'application/pdf')
    assert.match(pdf['Content-Disposition'], /^inline;/)
    assert.include(pdf['Content-Security-Policy'], "default-src 'none'")
    assert.include(pdf['Content-Security-Policy'], "frame-ancestors 'self'")
    for (const unsafe of [
      file('svg', 'image/svg+xml'),
      file('html', 'text/html'),
      file('png', 'text/html'),
    ]) {
      const headers = attachmentHeaders(unsafe, { preview: true })
      assert.match(headers['Content-Disposition'], /^attachment;/)
      assert.equal(headers['X-Frame-Options'], 'DENY')
      assert.include(headers['Content-Security-Policy'], 'sandbox')
      assert.equal(headers['X-Content-Type-Options'], 'nosniff')
    }
    // Without ?preview=1 even an image downloads.
    const download = attachmentHeaders(file('png', 'image/png'))
    assert.match(download['Content-Disposition'], /^attachment;/)
    assert.equal(download['Content-Length'], '10')
    assert.equal(download['Cache-Control'], 'private, no-store')
    const quoted = attachmentHeaders(file('pdf', 'application/pdf', 'a"b\\c.pdf'))
    assert.include(quoted['Content-Disposition'], 'filename="a_b_c.pdf"')
  })
})
