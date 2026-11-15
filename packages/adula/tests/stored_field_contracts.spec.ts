import { test } from '@japa/runner'
import { createResourceTable, defineResource, ResourceRegistry, ResourceService } from '../index.js'
import type { RecordData, Resource } from '../index.js'
import { admin, customer, db, setup } from './helpers.js'

// A concrete consumer exercises the public field names independently of SQL names.
const resource = defineResource({
  name: 'field_records',
  label: { ar: 'سجلات الحقول', en: 'Field records' },
  model: customer.model,
  scoped: false,
  version: true,
  fields: {
    number: {
      type: 'string',
      column: 'record_number',
      sequence: 'FIELD',
      label: { ar: 'الرقم', en: 'Number' },
    },
    title: {
      type: 'string',
      column: 'display_title',
      required: true,
      label: { ar: 'العنوان', en: 'Title' },
    },
    notes: { type: 'text', column: 'body_text', label: { ar: 'ملاحظات', en: 'Notes' } },
    quantity: { type: 'integer', column: 'item_count', label: { ar: 'العدد', en: 'Quantity' } },
    amount: { type: 'money', column: 'minor_units', label: { ar: 'المبلغ', en: 'Amount' } },
    enabled: { type: 'boolean', column: 'is_enabled', label: { ar: 'مفعل', en: 'Enabled' } },
    day: { type: 'date', column: 'calendar_day', label: { ar: 'التاريخ', en: 'Day' } },
    instant: { type: 'datetime', column: 'occurred_at', label: { ar: 'الوقت', en: 'Instant' } },
    details: { type: 'json', column: 'payload', label: { ar: 'البيانات', en: 'Details' } },
    attachment: {
      type: 'attachment',
      column: 'attachment_path',
      label: { ar: 'المرفق', en: 'Attachment' },
    },
    customerId: {
      type: 'belongsTo',
      resource: 'customers',
      column: 'client_ref',
      label: { ar: 'العميل', en: 'Customer' },
    },
    status: {
      type: 'lookup',
      group: 'field_status',
      column: 'state_key',
      label: { ar: 'الحالة', en: 'Status' },
    },
    lines: {
      type: 'hasMany',
      resource: 'field_lines',
      foreignKey: 'recordId',
      inline: true,
      label: { ar: 'البنود', en: 'Lines' },
    },
    internalMemo: {
      type: 'text',
      column: 'private_payload',
      label: { ar: 'ملاحظة داخلية', en: 'Internal memo' },
    },
    reviewCode: {
      type: 'string',
      column: 'review_token',
      label: { ar: 'رمز المراجعة', en: 'Review code' },
    },
    secret: {
      type: 'json',
      column: 'restricted_payload',
      permissionLevel: 1,
      label: { ar: 'بيانات مقيدة', en: 'Restricted details' },
    },
  },
  list: ['number', 'title', 'quantity', 'enabled', 'customerId', 'status'],
  form: [
    'title',
    'notes',
    'quantity',
    'amount',
    'enabled',
    'day',
    'instant',
    'details',
    'attachment',
    'customerId',
    'status',
    'lines',
    'internalMemo',
    'reviewCode',
    'secret',
  ],
  show: [
    'number',
    'title',
    'notes',
    'quantity',
    'amount',
    'enabled',
    'day',
    'instant',
    'details',
    'attachment',
    'customerId',
    'status',
    'lines',
    'secret',
  ],
  actions: ['view', 'create', 'update', 'delete'],
  validator: { validate: async (data) => data as RecordData },
})

const line = defineResource({
  name: 'field_lines',
  label: { ar: 'بنود الحقول', en: 'Field lines' },
  model: customer.model,
  scoped: false,
  version: true,
  fields: {
    recordId: {
      type: 'belongsTo',
      resource: resource.name,
      column: 'parent_ref',
      required: true,
      label: { ar: 'السجل', en: 'Record' },
    },
    title: { type: 'string', required: true, label: { ar: 'العنوان', en: 'Title' } },
  },
  list: ['title'],
  form: ['recordId', 'title'],
  show: ['title'],
  actions: ['view', 'create', 'update', 'delete'],
  validator: { validate: async (data) => data as RecordData },
})

function serviceFor(definition: Resource = resource) {
  const registry = new ResourceRegistry().register([
    { name: 'customers', label: customer.label, dependsOn: [], resources: [customer] },
    {
      name: 'fields',
      label: resource.label,
      dependsOn: ['customers'],
      resources: [definition, line],
    },
  ])
  return new ResourceService(db, registry)
}

async function effects() {
  return {
    records: await db(resource.name).orderBy('id'),
    lines: await db(line.name).orderBy('id'),
    sequence: await db('sequences').where('key', 'FIELD').first(),
    activities: await db('activities').count('* as count').first(),
    outbox: await db('outbox').count('* as count').first(),
  }
}

test.group('Stored field contracts', (group) => {
  const service = serviceFor()
  group.setup(async () => {
    await setup()
    await createResourceTable(db, resource)
    await createResourceTable(db, line)
    await db('lookups').insert([
      { group: 'field_status', key: 'open', label_ar: 'مفتوح', label_en: 'Open' },
      { group: 'field_status', key: 'closed', label_ar: 'مغلق', label_en: 'Closed' },
      {
        group: 'field_status',
        key: 'inactive',
        label_ar: 'معطل',
        label_en: 'Inactive',
        active: false,
      },
    ])
  })

  test('all field kinds use custom columns through save, show, list and editor', async ({
    assert,
  }) => {
    const client = await service.save('customers', admin, { name: 'عميل عقد الحقول' })
    const input = {
      title: 'عقد الحقول',
      notes: 'السطر الأول\nالسطر الثاني',
      quantity: 0,
      amount: '-10',
      enabled: false,
      day: '2024-02-29',
      instant: new Date('2026-09-18T03:15:24.123+03:00'),
      details: { nested: [false, 0, null, 'عربي'], empty: {} },
      attachment: null,
      customerId: client.id,
      status: 'open',
      lines: [{ title: 'بند العقد' }],
      internalMemo: 'قيمة للنموذج فقط',
      reviewCode: 'accepted',
      secret: { private: true },
    }
    const saved = await service.save(resource.name, admin, input)
    const row = await db(resource.name).where('id', Number(saved.id)).first()
    assert.equal(row.display_title, input.title)
    assert.equal(row.body_text, input.notes)
    assert.strictEqual(row.item_count, 0)
    assert.strictEqual(row.is_enabled, false)
    assert.equal(row.minor_units, '-10')
    assert.equal(row.occurred_at.toISOString(), '2026-09-18T00:15:24.123Z')
    assert.deepEqual(row.payload, input.details)
    assert.equal(row.client_ref, client.id)
    assert.equal(row.state_key, 'open')
    assert.equal(row.private_payload, input.internalMemo)
    assert.notProperty(row, 'title')
    assert.notProperty(row, 'lines')
    const shown = await service.show(resource.name, Number(saved.id), admin)
    assert.deepEqual(shown.data, saved)
    assert.equal(shown.data.day, '2024-02-29')
    assert.equal(shown.data.instant, '2026-09-18T00:15:24.123Z')
    // Related rows also carry the title that labels the relation (#47).
    assert.deepEqual(shown.related.customerId, [{ ...client, _title: client.name }])
    for (const key of ['internalMemo', 'reviewCode', 'display_title', 'createdBy', 'lines'])
      assert.notProperty(shown.data, key)
    const listed = await service.list(resource.name, admin)
    // A list row is the saved record plus the title that names it, like related rows (#110):
    // the sequence number and the first text field read through their custom columns.
    const { _title: listedTitle, ...listedRecord } = listed.data.find(
      (entry) => entry.id === saved.id
    )!
    assert.equal(listedTitle, `${saved.number} · ${saved.title}`)
    assert.deepEqual(listedRecord, saved)
    const editor = await service.editor(resource.name, admin, Number(saved.id))
    assert.deepEqual(editor.record, saved)
    assert.equal(editor.inline.lines.rows[0].title, 'بند العقد')
    const persistedLine = await db(line.name).where('parent_ref', Number(saved.id)).first()
    assert.equal(persistedLine.title, 'بند العقد')
    assert.deepEqual(
      editor.options.status.map((option) => option.value),
      ['open', 'closed']
    )
    assert.include(
      editor.options.customerId.map((option) => option.value),
      String(client.id)
    )
    assert.sameMembers(
      editor.fields.map((field) => field.type),
      resource.form.map((key) => resource.fields[key].type)
    )
    assert.notInclude(
      editor.fields.map((field) => field.key),
      'number'
    )
  })

  test('omitted update fields survive while explicit null clears nullable fields', async ({
    assert,
  }) => {
    const saved = await service.save(resource.name, admin, {
      title: 'تحديث جزئي',
      notes: 'يبقى',
      quantity: 0,
      enabled: false,
      instant: '2026-09-18T00:00:00.000Z',
      details: ['يبقى', null],
    })
    const partial = await service.save(
      resource.name,
      admin,
      { title: 'عنوان جديد', version: 1 },
      Number(saved.id)
    )
    assert.equal(partial.notes, 'يبقى')
    assert.strictEqual(partial.quantity, 0)
    assert.strictEqual(partial.enabled, false)
    assert.deepEqual(partial.details, ['يبقى', null])
    const nullable = [
      'notes',
      'quantity',
      'amount',
      'enabled',
      'day',
      'instant',
      'details',
      'attachment',
      'customerId',
      'status',
      'secret',
    ]
    const cleared = await service.save(
      resource.name,
      admin,
      {
        ...Object.fromEntries(nullable.map((key) => [key, null])),
        version: 2,
      },
      Number(saved.id)
    )
    const shown = await service.show(resource.name, Number(saved.id), admin)
    for (const key of nullable) assert.isNull(shown.data[key], key)
    assert.equal(cleared.version, 3)
    assert.equal(cleared.title, 'عنوان جديد')
    const empty = await service.save(resource.name, admin, { title: 'حقول اختيارية' })
    for (const key of nullable) assert.isNull(empty[key], key)
  })

  test('required stored fields reject missing and null values without durable effects', async ({
    assert,
  }) => {
    const before = await effects()
    for (const [key, field] of Object.entries(resource.fields)) {
      if (field.type === 'hasMany' || ('sequence' in field && field.sequence)) continue
      const strict = serviceFor({
        ...resource,
        fields: { ...resource.fields, [key]: { ...field, required: true } },
      })
      for (const input of [
        key === 'title' ? {} : { title: 'حقل مطلوب' },
        { title: 'حقل مطلوب', [key]: null },
      ]) {
        await assert.rejects(() => strict.save(resource.name, admin, input), /Required field/)
      }
    }
    assert.deepEqual(await effects(), before)
    const saved = await service.save(resource.name, admin, { title: 'مطلوب عند التحديث' })
    const persisted = await effects()
    await assert.rejects(
      () => service.save(resource.name, admin, { title: null, version: 1 }, Number(saved.id)),
      /Required field: title/
    )
    assert.deepEqual(await effects(), persisted)
    const requiredScalars = serviceFor({
      ...resource,
      fields: {
        ...resource.fields,
        quantity: { ...resource.fields.quantity, required: true },
        enabled: { ...resource.fields.enabled, required: true },
        details: { ...resource.fields.details, required: true },
      },
    })
    const zero = await requiredScalars.save(resource.name, admin, {
      title: 'القيم الصفرية مطلوبة',
      quantity: 0,
      enabled: false,
      details: false,
    })
    assert.strictEqual(zero.quantity, 0)
    assert.strictEqual(zero.enabled, false)
    assert.strictEqual(zero.details, false)
  })

  test('JSON roots retain their types across PostgreSQL writes and reads', async ({ assert }) => {
    for (const details of [false, 0, '42', '', [], {}, [null, { text: 'عربي' }]]) {
      const saved = await service.save(resource.name, admin, { title: 'جذر JSON', details })
      const row = await db(resource.name).where('id', Number(saved.id)).first('payload')
      assert.deepEqual(row.payload, details)
      const shown = await service.show(resource.name, Number(saved.id), admin)
      assert.deepEqual(shown.data.details, details)
    }
  })

  test('invalid timestamp and JSON updates preserve the original record and event history', async ({
    assert,
  }) => {
    const saved = await service.save(resource.name, admin, {
      title: 'ثبات الحفظ',
      instant: '2026-09-18T00:00:00.000Z',
      details: { unchanged: true },
    })
    const cycle: RecordData = {}
    cycle.self = cycle
    const invalid = [
      { instant: new Date(Number.NaN) },
      { instant: '2026-09-18T00:00:00Z' },
      { instant: '2026-09-18T00:00:00.000+00:00' },
      { details: cycle },
      { details: { value: undefined } },
      { details: [undefined] },
      { details: { value: 1n } },
      { details: Number.NaN },
      { details: new Date() },
      { details: new Map([['key', 'value']]) },
      { details: new Array(2) },
      { details: { nested: Object.assign(new Array(3), { 0: true, 2: false }) } },
    ]
    const before = await effects()
    for (const input of invalid)
      await assert.rejects(
        () => service.save(resource.name, admin, { ...input, version: 1 }, Number(saved.id)),
        /ISO date|JSON value/
      )
    assert.deepEqual(await effects(), before)
  })

  test('read projection selects policy fields without exposing form-only or forbidden data', async ({
    assert,
  }) => {
    const saved = await service.save(resource.name, admin, {
      title: 'عرض محدود',
      reviewCode: 'accepted',
      internalMemo: 'سري',
      secret: { restricted: true },
    })
    const actor = {
      ...admin,
      permissionLevel: 0,
      rules: [{ subject: resource.name, action: 'view', conditions: { reviewCode: 'accepted' } }],
    }
    const queries: string[] = []
    const capture = (query: { sql: string }) => queries.push(query.sql)
    db.on('query', capture)
    try {
      const shown = await service.show(resource.name, Number(saved.id), actor)
      assert.equal(shown.data.title, 'عرض محدود')
      for (const key of ['reviewCode', 'internalMemo', 'secret', 'review_token', 'private_payload'])
        assert.notProperty(shown.data, key)
    } finally {
      db.removeListener('query', capture)
    }
    const read = queries.find((query) => query.includes('from "field_records" as "r"'))!
    assert.include(read, '"r"."review_token"')
    assert.notInclude(read, '"r"."private_payload"')
    assert.notInclude(read, '"r".*')
    const custom = serviceFor({ ...resource, serialize: ['title'] })
    const serialized = await custom.show(resource.name, Number(saved.id), admin)
    assert.deepEqual(serialized.data, {
      id: saved.id,
      title: 'عرض محدود',
      version: 1,
    })
  })

  test('SQL column aliases and generated fields cannot bypass the writable form contract', async ({
    assert,
  }) => {
    const before = await effects()
    for (const key of ['display_title', 'payload', 'client_ref', 'number', 'createdBy'])
      await assert.rejects(
        () => service.save(resource.name, admin, { title: 'حقل مرفوض', [key]: 'injected' }),
        /not writable/
      )
    assert.deepEqual(await effects(), before)
  })

  test('attachment writes without an owned upload fail closed on create, update and beforeSave hooks', async ({
    assert,
  }) => {
    const saved = await service.save(resource.name, admin, { title: 'مرفق مؤجل', attachment: null })
    const before = await effects()
    // Paths, objects and other non-identifiers are rejected before any lookup; unknown ids after it.
    for (const attachment of [
      'uploads/foreign.pdf',
      '',
      { path: 'uploads/foreign.pdf' },
      { id: 1 },
      2147483648,
      false,
      [],
    ]) {
      await assert.rejects(
        () =>
          service.save(resource.name, admin, {
            title: 'إنشاء مرفوض',
            attachment,
            lines: [{ title: 'لن يحفظ' }],
          }),
        /uploaded attachment/
      )
      await assert.rejects(
        () =>
          service.save(
            resource.name,
            admin,
            {
              title: 'تعديل مرفوض',
              attachment,
              version: 1,
            },
            Number(saved.id)
          ),
        /uploaded attachment/
      )
    }
    await assert.rejects(
      () =>
        service.save(resource.name, admin, {
          title: 'مرفق غير موجود',
          attachment: 2147483647,
          lines: [{ title: 'لن يحفظ' }],
        }),
      /المرفق غير موجود/
    )
    await assert.rejects(
      () =>
        service.save(
          resource.name,
          admin,
          { title: 'تعديل بمرفق غير موجود', attachment: 2147483647, version: 1 },
          Number(saved.id)
        ),
      /المرفق غير موجود/
    )
    const hooked = serviceFor({
      ...resource,
      hooks: {
        beforeSave: async (record) => {
          record.attachment = 'uploads/hook.pdf'
        },
      },
    })
    await assert.rejects(
      () => hooked.save(resource.name, admin, { title: 'مرفق من الامتداد' }),
      /uploaded attachment/
    )
    assert.deepEqual(await effects(), before)
  })

  test('invalid mapped relations and inactive lookups roll back parent and inline rows', async ({
    assert,
  }) => {
    const before = await effects()
    for (const input of [{ customerId: 2147483647 }, { status: 'inactive' }, { status: 'unknown' }])
      await assert.rejects(
        () =>
          service.save(resource.name, admin, {
            title: 'علاقة غير صالحة',
            lines: [{ title: 'بند لن يحفظ' }],
            ...input,
          }),
        /السجل غير موجود|Invalid lookup/
      )
    assert.deepEqual(await effects(), before)
  })
})
