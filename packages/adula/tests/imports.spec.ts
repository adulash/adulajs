import { test } from '@japa/runner'
import { ImportBatches, ResourceService, importCell } from '../index.js'
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
    assert.deepEqual(result, { id: batch.id, processed: 3, created: 1, failed: 2 })
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
