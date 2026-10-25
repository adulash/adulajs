import { test } from '@japa/runner'
import { BaseModel } from '@adonisjs/lucid/orm'
import {
  ImportBatches,
  ResourceRegistry,
  ResourceService,
  createResourceTable,
  defineResource,
  importCell,
} from '../index.js'
import type { Actor, ImportAdapter, RecordData } from '../index.js'
import { admin, db, reader, registry, setup } from './helpers.js'
import { failure } from './helpers/failure.js'
import { addUserProfileColumns, viewer as aViewer } from './helpers/actors.js'

const viewer = aViewer({ id: 2 })

test.group('CSV import batches', (group) => {
  const service = () => new ResourceService(db, registry)
  const imports = () =>
    new ImportBatches(db, registry, service(), {
      load: async (id) => (id === admin.id ? admin : reader),
    })
  group.setup(async () => {
    await setup()
    await addUserProfileColumns()
  })
  group.each.setup(async () => {
    await db('import_batches').del()
  })

  test('converts cells by field type, including Arabic digits and lookup labels', ({ assert }) => {
    const lookups = new Map([
      ['open', 'open'],
      ['مفتوح', 'open'],
    ])
    assert.equal(
      importCell({ type: 'money', label: { ar: '', en: '' } }, '١٬٢٣٤.٥', lookups),
      '123450'
    )
    assert.equal(importCell({ type: 'integer', label: { ar: '', en: '' } }, '٤٢', lookups), 42)
    assert.equal(
      importCell({ type: 'date', label: { ar: '', en: '' } }, '05/10/2026', lookups),
      '2026-10-05'
    )
    assert.isTrue(importCell({ type: 'boolean', label: { ar: '', en: '' } }, 'نعم', lookups))
    assert.equal(
      importCell({ type: 'lookup', group: 'x', label: { ar: '', en: '' } }, ' مفتوح ', lookups),
      'open'
    )
    assert.isNull(importCell({ type: 'string', label: { ar: '', en: '' } }, '  ', lookups))
    assert.throws(() =>
      importCell({ type: 'date', label: { ar: '', en: '' } }, '31/02/2026', lookups)
    )
  })

  test('maps columns, imports valid rows and reports the failed ones by line', async ({
    assert,
  }) => {
    const csv =
      '﻿ملاحظات,الحالة,الوحدة التنظيمية (رقم),Total\nأول,مفتوح,2,10.50\nثاني,غير موجود,2,1\nثالث,closed,3,7\n'
    const batch = await imports().create('orders', reader, { fileName: 'orders.csv', content: csv })
    assert.equal(batch.status, 'mapping')
    assert.equal(batch.total, 3)
    // Header labels matched; total needs permission level 1, so the reader cannot map it.
    assert.deepEqual(batch.mapping, { 0: 'notes', 1: 'status', 2: 'orgUnitId' })
    assert.notInclude(
      batch.targets.map((target) => target.key),
      'total'
    )
    const refused = await failure(() =>
      imports().start(batch.id, reader, { ...batch.mapping, 3: 'total' })
    )
    assert.equal(refused.code, 'E_IMPORT_MAPPING')
    const started = await imports().start(batch.id, reader, batch.mapping)
    assert.equal(started.status, 'queued')
    const result = await imports().process()
    assert.deepEqual(result, { id: batch.id, processed: 3, created: 1, updated: 0, failed: 2 })
    const done = await imports().show(batch.id, reader)
    assert.equal(done.status, 'done')
    assert.deepEqual(
      done.errors.map((error) => error.row),
      [3, 4]
    )
    assert.include(done.errors[0].message, 'الحالة')
    // Row 4 targets unit 1.3, outside the reader's scope: refused by authorization.
    const saved = await db('orders').where('notes', 'أول').first()
    assert.equal(saved.status, 'open')
    assert.equal(saved.created_by, reader.id)
    const notice = await db('notifications')
      .where('user_id', reader.id)
      .orderBy('id', 'desc')
      .first()
    assert.include(notice.title, 'اكتمل استيراد')
  })

  test('requires create permission, owner access and the required columns', async ({ assert }) => {
    const denied = await failure(() =>
      imports().create('orders', viewer, { fileName: 'x.csv', content: 'notes\nx\n' })
    )
    assert.equal(denied.status, 403)
    const batch = await imports().create('orders', reader, {
      fileName: 'x.csv',
      content: 'notes\nx\n',
    })
    const missing = await failure(() => imports().start(batch.id, reader, { 0: 'notes' }))
    assert.include(missing.message, 'الوحدة التنظيمية')
    const foreign = await failure(() => imports().show(batch.id, admin))
    assert.equal(foreign.status, 404)
    const empty = await failure(() =>
      imports().create('orders', reader, { fileName: 'x.csv', content: 'notes\n' })
    )
    assert.equal(empty.code, 'E_IMPORT_ROWS')
  })

  test('processing resumes in chunks without importing a row twice', async ({ assert }) => {
    const lines = Array.from({ length: 5 }, (_, index) => `دفعة ${index},2`).join('\n')
    const batch = await imports().create('orders', reader, {
      fileName: 'chunks.csv',
      content: `notes,orgUnitId\n${lines}\n`,
    })
    await imports().start(batch.id, reader, { 0: 'notes', 1: 'orgUnitId' })
    const first = await imports().process(2)
    assert.equal(first?.processed, 2)
    const second = await imports().process(2)
    assert.equal(second?.processed, 4)
    await imports().process(2)
    assert.isNull(await imports().process(2))
    const [{ count }] = await db('orders').whereLike('notes', 'دفعة %').count('* as count')
    assert.equal(Number(count), 5)
  })
})

/** A JSON-lines format: one object per line, keys of the first line are the headers. */
const jsonLines: ImportAdapter = {
  name: 'jsonl',
  extensions: ['jsonl'],
  detect: (file) => file.fileName.endsWith('.jsonl'),
  async parse(file) {
    const objects = file.text
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    const headers = Object.keys(objects[0] ?? {})
    return { headers, rows: objects.map((entry) => headers.map((key) => String(entry[key] ?? ''))) }
  },
}
/** A binary-flagged pipe-separated format detected by its content, not its name. */
const pipes: ImportAdapter = {
  name: 'pipes',
  extensions: ['psv'],
  binary: true,
  detect: (file) => file.bytes[0] === 0x23 && file.text.startsWith('#PSV'),
  async parse(file) {
    const [, header, ...lines] = file.text.split(/\r?\n/).filter(Boolean)
    return { headers: header.split('|'), rows: lines.map((line) => line.split('|')) }
  },
}
const count = async (table: string) => {
  const [row] = await db(table).count('* as c')
  return Number(row.c)
}

test.group('Import formats and templates', (group) => {
  const imports = () =>
    new ImportBatches(
      db,
      registry,
      new ResourceService(db, registry),
      { load: async (id) => (id === admin.id ? admin : reader) },
      { adapters: [jsonLines] }
    ).registerAdapter(pipes)
  group.setup(async () => {
    await setup()
    await addUserProfileColumns()
  })

  test('registered adapters are detected and import end to end', async ({ assert }) => {
    const batches = imports()
    assert.deepEqual(batches.extensions(), ['csv', 'txt', 'jsonl', 'psv'])
    const lines = '{"الاسم":"عميل سطري"}\n{"الاسم":"عميل ثان"}\n'
    const batch = await batches.create('customers', admin, {
      fileName: 'customers.jsonl',
      content: Buffer.from(lines),
    })
    assert.deepEqual(batch.headers, ['الاسم'])
    assert.deepEqual(batch.mapping, { 0: 'name' })
    await batches.start(batch.id, admin, batch.mapping)
    assert.deepEqual(await batches.process(), {
      id: batch.id,
      processed: 2,
      created: 2,
      updated: 0,
      failed: 0,
    })
    assert.exists(await db('customers').where('name', 'عميل سطري').first())
    // Detection by signature; a binary format arrives as base64 in a JSON body.
    const piped = await batches.create('customers', admin, {
      fileName: 'export.dat',
      content: Buffer.from('#PSV\nname|x\nبالأنابيب|1\n').toString('base64'),
      encoding: 'base64',
    })
    assert.deepEqual(piped.mapping, { 0: 'name' })
    assert.equal(piped.total, 1)
    const named = await batches.create('customers', admin, {
      fileName: 'anything',
      content: '{"name":"بالاسم"}',
      format: 'jsonl',
    })
    assert.deepEqual(named.sample, [['بالاسم']])
    const unknown = await failure(() =>
      batches.create('customers', admin, { fileName: 'book.xlsx', content: Buffer.from('PK') })
    )
    assert.equal(unknown.code, 'E_IMPORT_FORMAT')
    const broken = await failure(() =>
      batches.create('customers', admin, { fileName: 'bad.csv', content: 'name\n"x\n' })
    )
    assert.include(broken.message, 'تعذر قراءة CSV')
  })

  test('the CSV template lists the actor fields in Arabic and maps back on upload', async ({
    assert,
  }) => {
    const template = imports().template('orders', reader)
    assert.equal(template.fileName, 'orders-template.csv')
    assert.isTrue(template.content.startsWith('\uFEFF'))
    const headers = template.content.slice(1).trim().split(',')
    assert.include(headers, 'ملاحظات')
    assert.include(headers, 'الوحدة التنظيمية (رقم) *')
    // Level-1 and hidden fields stay out for the reader.
    assert.notInclude(headers, 'الإجمالي')
    assert.notInclude(headers, 'ملاحظة داخلية')
    const values = headers.map((header) => (header.includes('الوحدة') ? '2' : ''))
    const batch = await imports().create('orders', reader, {
      fileName: 't.csv',
      content: `${template.content}${values.join(',')}\n`,
    })
    assert.equal(Object.keys(batch.mapping).length, headers.length)
    assert.include(Object.values(batch.mapping), 'orgUnitId')
    const denied = await failure(async () => imports().template('orders', viewer))
    assert.equal(denied.status, 403)
    const noUpdate = await failure(async () => imports().template('customers', reader, 'upsert'))
    assert.equal(noUpdate.status, 403)
  })

  test('a dry run validates every row without leaving any trace, then imports for real', async ({
    assert,
  }) => {
    const counts = async () => {
      const sequence = await db('sequences').where('key', 'ORD').first()
      return {
        orders: await count('orders'),
        activities: await count('activities'),
        outbox: await count('outbox'),
        notifications: await count('notifications'),
        sequence: sequence?.value ?? null,
      }
    }
    const before = await counts()
    const csv =
      'notes,status,orgUnitId\nتجربة جافة,open,2\nحالة خاطئة,غير موجود,2\nخارج النطاق,open,3\n'
    const batch = await imports().create('orders', reader, {
      fileName: 'dry.csv',
      content: csv,
      dryRun: true,
    })
    assert.isTrue(batch.dryRun)
    await imports().start(batch.id, reader, batch.mapping)
    // Dry-run progress and report are stored once per chunk.
    await imports().process(2)
    const halfway = await imports().show(batch.id, reader)
    assert.equal(halfway.status, 'running')
    assert.equal(halfway.processed, 2)
    assert.lengthOf(halfway.report, 2)
    await imports().process(2)
    const validated = await imports().show(batch.id, reader)
    assert.equal(validated.status, 'validated')
    assert.deepEqual(
      validated.report.map(({ row, ok, action }) => ({ row, ok, action })),
      [
        { row: 2, ok: true, action: 'create' },
        { row: 3, ok: false, action: undefined },
        { row: 4, ok: false, action: undefined },
      ]
    )
    assert.include(validated.report[1].message, 'الحالة')
    assert.equal(validated.created, 1)
    assert.equal(validated.failed, 2)
    assert.deepEqual(await counts(), before)
    assert.isNull(await imports().process())

    // The same batch then runs for real.
    const started = await imports().start(batch.id, reader, validated.mapping)
    assert.isFalse(started.dryRun)
    await imports().process()
    const done = await imports().show(batch.id, reader)
    assert.equal(done.status, 'done')
    assert.equal(done.created, 1)
    assert.deepEqual(done.report, [])
    const after = await counts()
    assert.equal(after.orders, before.orders + 1)
    assert.isAbove(after.outbox, before.outbox)
    assert.equal(after.notifications, before.notifications + 1)
    const saved = await db('orders').where('notes', 'تجربة جافة').first()
    assert.match(saved.number, /^ORD/)
  })
})

const item = defineResource({
  name: 'import_items',
  label: { ar: 'الأصناف', en: 'Items' },
  model: BaseModel,
  scoped: false,
  version: true,
  fields: {
    code: { type: 'string', required: true, unique: true, label: { ar: 'الرمز', en: 'Code' } },
    title: { type: 'string', label: { ar: 'العنوان', en: 'Title' } },
    qty: { type: 'integer', label: { ar: 'الكمية', en: 'Quantity' } },
  },
  list: ['code', 'title', 'qty'],
  form: ['code', 'title', 'qty'],
  show: ['code', 'title', 'qty'],
  actions: ['view', 'create', 'update', 'delete'],
  validator: { validate: async (data) => data as RecordData },
})

test.group('Upsert imports by a unique field', (group) => {
  const items = new ResourceRegistry().register([
    { name: 'inventory', label: item.label, dependsOn: [], resources: [item] },
  ])
  const service = new ResourceService(db, items)
  const creator: Actor = {
    id: 2,
    orgPaths: ['1'],
    permissionLevel: 0,
    rules: [{ subject: 'import_items', action: ['view', 'create'] }],
  }
  const imports = () =>
    new ImportBatches(db, items, service, {
      load: async (id) => (id === admin.id ? admin : creator),
    })
  group.setup(async () => {
    await setup()
    await createResourceTable(db, item)
  })

  test('updates matched live records with their version and creates the rest', async ({
    assert,
  }) => {
    const first = await service.save('import_items', admin, { code: 'A1', title: 'قديم', qty: 7 })
    await service.save('import_items', admin, { title: 'قديم', version: 1 }, Number(first.id))
    const removed = await service.save('import_items', admin, { code: 'C3', title: 'محذوف' })
    await service.transition('import_items', Number(removed.id), admin, 'delete', 1)

    // Upsert needs update permission as well as create.
    const refused = await failure(() =>
      imports().create('import_items', creator, {
        fileName: 'x.csv',
        content: 'code\nA1\n',
        mode: 'upsert',
      })
    )
    assert.equal(refused.status, 403)

    const csv = 'الرمز *,العنوان,الكمية\nA1,محدث,\nB2,جديد,3\nC3,بديل,1\nB2,مكرر,4\n'
    const batch = await imports().create('import_items', admin, {
      fileName: 'items.csv',
      content: csv,
      mode: 'upsert',
      matchField: 'code',
      dryRun: true,
    })
    assert.deepEqual(batch.mapping, { 0: 'code', 1: 'title', 2: 'qty' })
    assert.equal(batch.matchField, 'code')
    const notUnique = await failure(() =>
      imports().start(batch.id, admin, batch.mapping, { matchField: 'title' })
    )
    assert.equal(notUnique.code, 'E_IMPORT_MATCH')
    const unmapped = await failure(() =>
      imports().start(batch.id, admin, { 1: 'title', 2: 'qty' }, { matchField: 'code' })
    )
    assert.equal(unmapped.code, 'E_IMPORT_MAPPING')

    await imports().start(batch.id, admin, batch.mapping)
    await imports().process()
    const validated = await imports().show(batch.id, admin)
    assert.equal(validated.status, 'validated')
    assert.deepEqual(
      validated.report.map(({ action }) => action),
      ['update', 'create', 'create', 'update']
    )
    const unchanged = await db('import_items').where('code', 'A1').first()
    assert.equal(unchanged.title, 'قديم')
    assert.notExists(await db('import_items').where('code', 'B2').first())

    await imports().start(batch.id, admin, batch.mapping)
    const result = await imports().process()
    assert.deepEqual(result, { id: batch.id, processed: 4, created: 2, updated: 2, failed: 0 })
    const a1 = await db('import_items').where('code', 'A1').first()
    assert.equal(a1.title, 'محدث')
    assert.equal(a1.version, 3)
    // The empty quantity cell kept the stored value of the matched record.
    assert.equal(a1.qty, 7)
    const b2 = await db('import_items').where('code', 'B2').first()
    assert.equal(b2.qty, 4)
    const c3 = await db('import_items').where('code', 'C3').orderBy('id')
    assert.lengthOf(c3, 2)
    assert.isNotNull(c3[0].deleted_at)
    assert.equal(c3[1].title, 'بديل')
  })

  test('create mode reports duplicates in the file and against stored records', async ({
    assert,
  }) => {
    const batch = await imports().create('import_items', creator, {
      fileName: 'dupes.csv',
      content: 'code,title\nZ9,أول\nZ9,ثان\nA1,موجود\n',
      dryRun: true,
    })
    await imports().start(batch.id, creator, batch.mapping)
    await imports().process()
    const validated = await imports().show(batch.id, creator)
    assert.deepEqual(
      validated.report.map(({ ok }) => ok),
      [true, false, false]
    )
    assert.include(validated.report[1].message, 'مكررة في الملف (الصف 2)')
    assert.equal(validated.report[2].message, 'هذه القيمة مستخدمة في سجل آخر')
    await imports().start(batch.id, creator, batch.mapping)
    const result = await imports().process()
    assert.deepEqual(result, { id: batch.id, processed: 3, created: 1, updated: 0, failed: 2 })
  })
})
