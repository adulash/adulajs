import { test } from '@japa/runner'
import {
  AdulaError,
  ResourceRegistry,
  ResourceService,
  alterResourceTable,
  createResourceTable,
  defineResource,
  installCatalogMessages,
  isVisible,
  definitionSchema,
  resourceAddition,
  resourceSchema,
  schemaDrift,
} from '../index.js'
import type { Actor, Field, RecordData } from '../index.js'
import vine from '@vinejs/vine'
import { additionMigrationSource, inSync } from '../src/database/schema_diff.js'
import { diagnoseResourceSchemas, diagnoseResourceSnapshots } from '../src/commands/doctor.js'
import { resourceSnapshot } from '../src/commands/snapshot.js'
import { admin, db, setup } from './helpers.js'

// A believable consumer: contacts tagged with scoped labels, every new field type used.
const tag = defineResource({
  name: 'ft_tags',
  label: { ar: 'الوسوم' },
  scoped: true,
  fields: { name: { type: 'string', required: true, label: { ar: 'الاسم' } } },
  list: ['name'],
  form: ['name'],
  show: ['name'],
  actions: ['view', 'create', 'update', 'delete'],
})
const contact = defineResource({
  name: 'ft_contacts',
  label: { ar: 'جهات الاتصال' },
  scoped: false,
  version: true,
  fields: {
    code: {
      type: 'string',
      required: true,
      pattern: '[A-Z]{2}-\\d{3}',
      label: { ar: 'الرمز' },
    },
    name: { type: 'string', required: true, min: 2, max: 60, label: { ar: 'الاسم' } },
    email: { type: 'email', unique: true, filterable: true, label: { ar: 'البريد' } },
    phone: { type: 'phone', filterable: true, label: { ar: 'الهاتف' } },
    website: { type: 'url', label: { ar: 'الموقع' } },
    rate: {
      type: 'decimal',
      precision: 8,
      scale: 2,
      min: 0,
      sortable: true,
      filterable: true,
      label: { ar: 'السعر' },
    },
    discount: { type: 'percent', max: 100, label: { ar: 'الخصم' } },
    quantity: { type: 'integer', min: 1, max: 1000, default: 1, label: { ar: 'الكمية' } },
    budget: { type: 'money', min: '0', label: { ar: 'الميزانية' } },
    kind: {
      type: 'enum',
      required: true,
      default: 'person',
      filterable: true,
      sortable: true,
      options: [
        { value: 'person', label: { ar: 'فرد', en: 'Person' } },
        { value: 'company', label: { ar: 'شركة', en: 'Company' } },
      ],
      label: { ar: 'النوع' },
    },
    channels: {
      type: 'multiSelect',
      max: 2,
      filterable: true,
      default: ['email'],
      options: [
        { value: 'email', label: { ar: 'بريد' } },
        { value: 'sms', label: { ar: 'رسالة' } },
        { value: 'call', label: { ar: 'اتصال' } },
      ],
      label: { ar: 'قنوات التواصل' },
    },
    companyName: {
      type: 'string',
      required: true,
      visibleWhen: { kind: 'company' },
      label: { ar: 'اسم الشركة' },
    },
    tags: { type: 'manyToMany', resource: 'ft_tags', filterable: true, label: { ar: 'الوسوم' } },
  },
  unique: [['code', 'kind']],
  list: ['code', 'name', 'email', 'rate', 'kind', 'channels', 'tags'],
  form: [
    'code',
    'name',
    'email',
    'phone',
    'website',
    'rate',
    'discount',
    'quantity',
    'budget',
    'kind',
    'channels',
    'companyName',
    'tags',
  ],
  show: [
    'code',
    'name',
    'email',
    'phone',
    'website',
    'rate',
    'discount',
    'quantity',
    'budget',
    'kind',
    'channels',
    'companyName',
    'tags',
  ],
  title: ['name'],
  actions: ['view', 'create', 'update', 'delete'],
})
const registry = new ResourceRegistry().register([
  { name: 'ft', label: { ar: 'اختبار الأنواع' }, dependsOn: [], resources: [tag, contact] },
])
const service = new ResourceService(db, registry)
// Works in unit 1.2 only: it cannot view tags of unit 1.3.
const outsider: Actor = {
  id: 2,
  orgPaths: ['1.2'],
  permissionLevel: 0,
  rules: [
    { subject: 'ft_contacts', action: ['view', 'create', 'update'] },
    { subject: 'ft_tags', action: 'view' },
  ],
}

let sequence = 0
const valid = (extra: RecordData = {}): RecordData => ({
  code: `AB-${String(++sequence).padStart(3, '0')}`,
  name: 'سلمى',
  ...extra,
})

async function failure(run: () => Promise<unknown>) {
  try {
    await run()
  } catch (error) {
    return error as Error & { code?: string; status?: number; messages?: RecordData[] }
  }
  throw new Error('Expected the write to fail')
}

/** The rule and message the derived validator reported for one field. */
async function rejected(input: RecordData, field: string) {
  const error = await failure(() => service.save(contact.name, admin, input))
  assert422(error)
  const entry = error.messages?.find((message) => message.field === field)
  if (!entry) throw new Error(`No validation message for ${field}: ${JSON.stringify(error)}`)
  return entry as { rule: string; message: string }
}
function assert422(error: { status?: number; code?: string }) {
  if (error.status !== 422) throw new Error(`Expected 422, got ${error.status} ${error.code}`)
}

test.group('Field types: definition as the source of truth', (group) => {
  let unitTwo: RecordData
  let unitThree: RecordData
  group.setup(async () => {
    // As applications do in start/validator.ts: VineJS answers through the catalog.
    const previous = vine.messagesProvider
    installCatalogMessages(vine)
    await setup()
    await createResourceTable(db, tag)
    await createResourceTable(db, contact)
    unitTwo = await service.save(tag.name, admin, { name: 'عميل مميز', orgUnitId: 2 })
    unitThree = await service.save(tag.name, admin, { name: 'سري', orgUnitId: 3 })
    return () => {
      vine.messagesProvider = previous
    }
  })

  test('valid values of every new type persist and read back canonically', async ({ assert }) => {
    const saved = await service.save(
      contact.name,
      admin,
      valid({
        email: '  Salma@Example.COM ',
        phone: '+966 (٥٥) 123-4567',
        website: 'https://example.com/a?b=1',
        rate: 12.5,
        discount: '7.1',
        budget: 1500,
        kind: 'person',
        channels: ['sms', 'email', 'sms'],
        tags: [Number(unitTwo.id)],
      })
    )
    const row = await db(contact.name).where('id', Number(saved.id)).first()
    assert.equal(row.email, 'salma@example.com')
    assert.equal(row.phone, '+966551234567')
    assert.equal(row.rate, '12.50')
    assert.equal(row.discount, '7.10')
    assert.equal(row.budget, '1500')
    assert.deepEqual(row.channels, ['email', 'sms'])
    // Declared defaults apply to keys the input leaves out.
    assert.equal(row.quantity, 1)
    const shown = await service.show(contact.name, Number(saved.id), admin)
    assert.include(shown.data, {
      email: 'salma@example.com',
      phone: '+966551234567',
      website: 'https://example.com/a?b=1',
      rate: '12.50',
      discount: '7.10',
      quantity: 1,
      budget: '1500',
      kind: 'person',
      companyName: null,
    })
    assert.deepEqual(shown.data.channels, ['email', 'sms'])
    assert.deepEqual(shown.data.tags, [Number(unitTwo.id)])
    // Linked records are titled like belongsTo relations.
    assert.deepEqual(
      shown.related.tags.map((link) => [link.id, link._title]),
      [[unitTwo.id, 'عميل مميز']]
    )
    const listed = await service.list(contact.name, admin, { filters: { tags: unitTwo.id } })
    assert.deepEqual(
      listed.data.map((record) => record.id),
      [saved.id]
    )
    assert.deepEqual(listed.data[0].tags, [Number(unitTwo.id)])
  })

  test('invalid values are refused with 422 and Arabic catalog messages', async ({ assert }) => {
    const cases: [RecordData, string, 'rule' | 'message', string][] = [
      [{ code: 'ab-1' }, 'code', 'message', 'صيغة القيمة غير صحيحة'],
      [{ name: 'س' }, 'name', 'message', 'عدد الأحرف أقل من الحد المطلوب (2)'],
      [{ email: 'no-at' }, 'email', 'rule', 'email'],
      [{ phone: '12-34' }, 'phone', 'message', 'أدخل رقم هاتف صحيحًا (من 7 إلى 15 رقمًا)'],
      ...['javascript:alert(1)', 'data:text/html,x', '/relative', 'ftp://x.test'].map(
        (url): [RecordData, string, 'rule', string] => [{ website: url }, 'website', 'rule', 'url']
      ),
      [{ rate: '1.005' }, 'rate', 'message', 'يقبل هذا الحقل 2 منازل عشرية على الأكثر'],
      [{ rate: '1234567' }, 'rate', 'rule', 'decimalPrecision'],
      [{ rate: -1 }, 'rate', 'message', 'يجب ألا تقل القيمة عن 0'],
      [{ discount: 100.5 }, 'discount', 'rule', 'max'],
      [{ quantity: 0 }, 'quantity', 'rule', 'min'],
      [{ budget: '-1' }, 'budget', 'rule', 'min'],
      [{ kind: 'robot' }, 'kind', 'rule', 'in'],
      [{ channels: ['fax'] }, 'channels', 'rule', 'in'],
      [{ channels: ['email', 'sms', 'call'] }, 'channels', 'rule', 'array.maxLength'],
      [{ tags: [0] }, 'tags', 'rule', 'relation'],
    ]
    for (const [input, field, part, expected] of cases) {
      const entry = await rejected(valid(input), field)
      assert.equal(entry[part], expected, `${field} ${JSON.stringify(input)}`)
    }
  })

  test('fieldValue is the hard guarantee behind hooks, custom validators and system writes', async ({
    assert,
  }) => {
    // A custom validator that lets anything through cannot store what the fields forbid.
    const lax = defineResource({
      ...contact,
      validator: { validate: async (d) => d as RecordData },
    })
    const laxService = new ResourceService(
      db,
      new ResourceRegistry().register([
        { name: 'ft', label: { ar: 'اختبار' }, dependsOn: [], resources: [tag, lax] },
      ])
    )
    const error = await failure(() => laxService.save(lax.name, admin, valid({ email: 'bad' })))
    assert.instanceOf(error, AdulaError)
    assert.equal(error.code, 'E_FIELD_VALUE')
    assert.equal(error.message, 'email: أدخل بريدًا إلكترونيًا صحيحًا')
    const system = await failure(() =>
      service.systemSave(contact.name, valid({ rate: '9.999' }), undefined, { actorId: 1 })
    )
    // System writes run the derived validator too.
    assert.equal(system.code, 'E_VALIDATION_ERROR')
    assert.equal(system.status, 422)
    const hooked = defineResource({
      ...contact,
      hooks: {
        beforeSave: async (record) => {
          record.phone = 'not a phone'
        },
      },
    })
    const hookedService = new ResourceService(
      db,
      new ResourceRegistry().register([
        { name: 'ft', label: { ar: 'اختبار' }, dependsOn: [], resources: [tag, hooked] },
      ])
    )
    const fromHook = await failure(() => hookedService.save(hooked.name, admin, valid()))
    assert.equal((fromHook as AdulaError).code, 'E_FIELD_VALUE')
  })

  test('visibleWhen hides, clears and conditionally requires a field', async ({ assert }) => {
    // Hidden: the submitted value is ignored and required does not apply.
    const person = await service.save(
      contact.name,
      admin,
      valid({ kind: 'person', companyName: 'لا تحفظ' })
    )
    assert.isNull(person.companyName)
    // Visible and required.
    const missing = await failure(() =>
      service.save(contact.name, admin, valid({ kind: 'company' }))
    )
    assert.equal((missing as AdulaError).code, 'E_REQUIRED')
    const company = await service.save(
      contact.name,
      admin,
      valid({ kind: 'company', companyName: 'شركة النور' })
    )
    assert.equal(company.companyName, 'شركة النور')
    // On update the hidden value is cleared as well: what is stored never contradicts the rule.
    const updated = await service.save(
      contact.name,
      admin,
      { code: company.code, name: company.name, kind: 'person', version: company.version },
      Number(company.id)
    )
    assert.isNull(updated.companyName)
    const row = await db(contact.name).where('id', Number(company.id)).first()
    assert.isNull(row.company_name)
  })

  test('defaults prefill the create form and are column defaults', async ({ assert }) => {
    const form = await service.editor(contact.name, admin)
    assert.deepInclude(form.defaults, { quantity: 1, kind: 'person', channels: ['email'] })
    assert.deepEqual(form.options.kind, [
      { value: 'person', label: 'فرد' },
      { value: 'company', label: 'شركة' },
    ])
    assert.lengthOf(form.options.channels, 3)
    // The editor payload carries every constraint the widgets need.
    const rate = form.fields.find((field) => field.key === 'rate')!
    assert.include(rate, { type: 'decimal', precision: 8, scale: 2, min: 0 })
    const company = form.fields.find((field) => field.key === 'companyName')!
    assert.deepEqual(company.visibleWhen, { kind: 'company' })
    assert.deepEqual(
      form.options.tags.map((option) => option.label).sort(),
      ['سري', 'عميل مميز'].sort()
    )
    const [inserted] = await db(contact.name)
      .insert({ code: 'ZZ-999', name: 'مباشر', created_by: 1, updated_by: 1 })
      .returning('*')
    assert.equal(inserted.quantity, 1)
    assert.equal(inserted.kind, 'person')
    // A request default overrides a declared one.
    const requested = await service.editor(contact.name, admin, undefined, {
      defaults: { kind: 'company' },
    })
    assert.equal(requested.defaults.kind, 'company')
  })

  test('filters and sorting of the new types', async ({ assert }) => {
    const first = await service.save(
      contact.name,
      admin,
      valid({ rate: '100', channels: ['call'], phone: '0555 000 111', email: 'f@x.test' })
    )
    const second = await service.save(
      contact.name,
      admin,
      valid({ rate: '9.5', channels: ['call', 'sms'], email: 's@x.test' })
    )
    const ids = (rows: RecordData[]) => rows.map((row) => row.id)
    const matching = async (filters: Record<string, unknown>) => {
      const page = await service.list(contact.name, admin, { filters })
      return ids(page.data)
    }
    const sorted = await service.list(contact.name, admin, {
      sort: 'rate',
      direction: 'desc',
      filters: { channels: 'call' },
    })
    assert.deepEqual(ids(sorted.data), [first.id, second.id])
    const sms = await matching({ channels: 'sms' })
    assert.isTrue(sms.includes(second.id))
    assert.isFalse(sms.includes(first.id))
    assert.deepEqual(await matching({ rate: '9.50' }), [second.id])
    // Filters are normalized like stored values.
    assert.deepEqual(await matching({ email: 'F@X.TEST' }), [first.id])
    assert.deepEqual(await matching({ phone: '0555-000-111' }), [first.id])
    const invalid = await failure(() =>
      service.list(contact.name, admin, { filters: { channels: 'fax' } })
    )
    assert.equal((invalid as AdulaError).code, 'E_FILTER')
    const unsortable = await failure(() => service.list(contact.name, admin, { sort: 'channels' }))
    assert.equal((unsortable as AdulaError).code, 'E_SORT')
  })

  test('composite and single unique violations name their fields', async ({ assert }) => {
    const first = await service.save(contact.name, admin, valid({ email: 'u@x.test' }))
    const duplicate = await failure(() =>
      service.save(contact.name, admin, { code: first.code, name: 'آخر', kind: 'person' })
    )
    assert.equal((duplicate as AdulaError).status, 409)
    assert.equal((duplicate as AdulaError).code, 'E_DUPLICATE')
    assert.equal(duplicate.message, 'هذه القيمة مستخدمة في سجل آخر: الرمز، النوع')
    // The same code is allowed for another kind.
    await service.save(contact.name, admin, {
      code: first.code,
      name: 'شركة',
      kind: 'company',
      companyName: 'ش',
    })
    const email = await failure(() =>
      service.save(contact.name, admin, valid({ email: 'U@x.test' }))
    )
    assert.equal(email.message, 'هذه القيمة مستخدمة في سجل آخر: البريد')
  })

  test('manyToMany syncs by difference, audits id arrays and authorizes new targets', async ({
    assert,
  }) => {
    const other = await service.save(tag.name, admin, { name: 'ثالث', orgUnitId: 2 })
    const saved = await service.save(contact.name, admin, valid({ tags: [Number(unitTwo.id)] }))
    const updated = await service.save(
      contact.name,
      admin,
      {
        code: saved.code,
        name: saved.name,
        kind: 'person',
        tags: [Number(other.id), Number(unitThree.id)],
        version: saved.version,
      },
      Number(saved.id)
    )
    assert.deepEqual(
      updated.tags,
      [Number(unitThree.id), Number(other.id)].sort((a, b) => a - b)
    )
    const links = await db('ft_contacts_tags')
      .where('ft_contacts_id', Number(saved.id))
      .orderBy('ft_tags_id')
      .pluck('ft_tags_id')
    assert.deepEqual(links, updated.tags)
    const change = await db('field_changes')
      .where({ resource: contact.name, record_id: Number(saved.id), field: 'tags' })
      .first()
    assert.deepEqual(change.before, [Number(unitTwo.id)])
    assert.deepEqual(change.after, updated.tags)
    // An outsider cannot link a record they cannot view (tag of unit 1.3).
    const denied = await failure(() =>
      service.save(contact.name, outsider, valid({ tags: [Number(unitThree.id)] }))
    )
    assert.include([403, 404], (denied as AdulaError).status)
    assert.equal(
      await db(contact.name)
        .where('created_by', 2)
        .count('* as count')
        .first()
        .then((r) => Number(r!.count)),
      0
    )
    // A viewable target is fine; keeping an existing invisible link on edit is too.
    const own = await service.save(contact.name, outsider, valid({ tags: [Number(unitTwo.id)] }))
    assert.deepEqual(own.tags, [Number(unitTwo.id)])
    await db('ft_contacts_tags').insert({
      ft_contacts_id: Number(own.id),
      ft_tags_id: Number(unitThree.id),
    })
    const kept = await service.save(
      contact.name,
      outsider,
      {
        code: own.code,
        name: 'معدل',
        kind: 'person',
        tags: [Number(unitTwo.id), Number(unitThree.id)],
        version: own.version,
      },
      Number(own.id)
    )
    assert.equal(kept.name, 'معدل')
    // Removing every link.
    const cleared = await service.save(
      contact.name,
      admin,
      { code: own.code, name: 'معدل', kind: 'person', tags: [], version: kept.version },
      Number(own.id)
    )
    assert.deepEqual(cleared.tags, [])
    assert.lengthOf(await db('ft_contacts_tags').where('ft_contacts_id', Number(own.id)), 0)
  })

  test('definitionSchema extends the derived validator', async ({ assert }) => {
    const extended = vine.create(
      vine.object({ ...definitionSchema(contact), note: vine.string().maxLength(5) })
    )
    const result = await extended.validate({ code: 'CD-001', name: 'اسم', note: 'abc', rate: 3 })
    assert.equal((result as RecordData).rate, '3.00')
    assert.equal(result.note, 'abc')
    await assert.rejects(() => extended.validate({ code: 'CD-001', name: 'اسم', note: 'too long' }))
  })

  test('schema doctor finds drift and the generated migration applies cleanly', async ({
    assert,
  }) => {
    const db2 = db
    assert.isTrue(inSync(await schemaDrift(db2, contact)))
    const fresh = await diagnoseResourceSchemas(db2, [tag, contact])
    assert.equal(fresh.status, 'pass', 'A freshly created table matches its definition')
    // A definition grows: a new column, a unique field, a composite index and a join table.
    const grown = defineResource({
      ...contact,
      fields: {
        ...contact.fields,
        rating: {
          type: 'decimal',
          precision: 4,
          scale: 1,
          default: '3.0',
          required: true,
          label: { ar: 'التقييم' },
        },
        nationalId: { type: 'string', unique: true, label: { ar: 'الهوية' } },
        partners: { type: 'manyToMany', resource: 'ft_tags', label: { ar: 'الشركاء' } },
      },
      // Existing rows share (name, null email): a composite index treats NULLs as equal,
      // so the added combination is one the stored rows already satisfy.
      unique: [
        ['code', 'kind'],
        ['name', 'code'],
      ],
    })
    const drift = await schemaDrift(db2, grown)
    assert.deepEqual(
      drift.missingColumns.map((column) => column.name),
      ['rating', 'national_id']
    )
    assert.deepEqual(
      drift.missingUnique.map((index) => index.columns),
      [['national_id'], ['name', 'code']]
    )
    assert.deepEqual(
      drift.missingJoinTables.map((join) => join.table),
      ['ft_contacts_partners']
    )
    const finding = await diagnoseResourceSchemas(db2, [grown])
    assert.equal(finding.status, 'warn')
    assert.include(finding.message, 'ft_contacts.rating: column is missing')
    assert.include(finding.message, 'node ace adula:resource:migration ft_contacts')
    const addition = resourceAddition(grown, drift)
    assert.deepEqual(addition.unique, [['name', 'code']])
    const source = additionMigrationSource(grown.name, addition)
    assert.include(source, "alterResourceTable(this.db.getWriteClient(), 'ft_contacts', {")
    const embedded = JSON.parse(/'ft_contacts', (\{[\s\S]*\})\)\n {2}\}/.exec(source)![1])
    assert.deepEqual(embedded, JSON.parse(JSON.stringify(addition)))
    await alterResourceTable(db2, grown.name, embedded)
    assert.isTrue(inSync(await schemaDrift(db2, grown)))
    // Existing rows got the default of the new NOT NULL column.
    const row = await db(contact.name).first('rating')
    assert.equal(row.rating, '3.0')
    // A wrong type is reported, never changed.
    const retyped = defineResource({
      ...grown,
      fields: { ...grown.fields, rating: { type: 'integer', label: { ar: 'التقييم' } } },
    })
    const wrong = await schemaDrift(db2, retyped)
    assert.deepEqual(wrong.wrongTypes, [
      { column: 'rating', expected: 'integer', actual: 'numeric(4,1)' },
    ])
    assert.deepEqual(resourceAddition(retyped, wrong), {})
    assert.lengthOf(resourceSchema(grown).joinTables, 2)
  })

  test('defineResource refuses inconsistent definitions', ({ assert }) => {
    const base = {
      name: 'ft_bad',
      label: { ar: 'خطأ' },
      scoped: false,
      list: [],
      form: [],
      show: [],
      actions: ['view'] as const,
    }
    const fails = (fields: RecordData, extra: RecordData = {}, pattern: RegExp) =>
      assert.throws(() => defineResource({ ...base, fields, ...extra } as never), pattern)
    const label = { ar: 'حقل' }
    fails({ a: { type: 'string', pattern: '(', label } }, {}, /pattern is not a valid/)
    fails({ a: { type: 'enum', options: [], label } }, {}, /at least one choice/)
    fails(
      {
        a: {
          type: 'enum',
          options: [
            { value: 'x', label },
            { value: 'x', label },
          ],
          label,
        },
      },
      {},
      /duplicate option/
    )
    fails(
      { a: { type: 'multiSelect', options: [{ value: 'x', label }], sortable: true, label } },
      {},
      /cannot be sortable/
    )
    fails({ a: { type: 'decimal', scale: 5, precision: 3, label } }, {}, /scale must be/)
    fails({ a: { type: 'integer', default: 'x', label } }, {}, /default is not a valid/)
    fails({ a: { type: 'decimal', default: '1.5', label } }, {}, /default is not a valid/)
    fails(
      { a: { type: 'belongsTo', resource: 'x', default: 1, label } },
      {},
      /cannot declare a default/
    )
    fails({ a: { type: 'string', visibleWhen: { b: 'x' }, label } }, {}, /unknown field b/)
    fails(
      {
        a: { type: 'string', visibleWhen: { b: 'x' }, label },
        b: { type: 'manyToMany', resource: 'ft_tags', label },
      },
      {},
      /cannot depend on manyToMany/
    )
    fails({ a: { type: 'string', label } }, { unique: [['a', 'missing']] }, /unknown or unstored/)
    fails({ a: { type: 'string', label } }, { unique: [['a']] }, /two or more/)
    fails({ a: { type: 'decimal', searchable: true, label } }, {}, /only text fields/)
    // Optional validator and model: a definition with neither is complete.
    assert.doesNotThrow(() =>
      defineResource({ ...base, fields: { a: { type: 'string', label } } } as never)
    )
  })
  test('a snapshot or migration addition keeps a required visibleWhen field nullable', async ({
    assert,
  }) => {
    const label = { ar: 'حقل' }
    const fields: Record<string, Field> = {
      kind: {
        type: 'enum',
        required: true,
        default: 'person',
        options: [
          { value: 'person', label: { ar: 'فرد' } },
          { value: 'company', label: { ar: 'شركة' } },
        ],
        label,
      },
      companyName: { type: 'string', required: true, visibleWhen: { kind: 'company' }, label },
      ratio: { type: 'decimal', precision: 6, scale: 3, label },
    }
    const snapped = defineResource({
      name: 'ft_snapped',
      label,
      scoped: false,
      fields,
      list: ['kind'],
      form: ['kind', 'companyName', 'ratio'],
      show: ['kind'],
      actions: ['view', 'create', 'update'],
    })
    const snapshot = JSON.parse(JSON.stringify(resourceSnapshot(snapped)))
    // The snapshot carries the rule and the resolved numeric shape, not the package defaults.
    assert.deepEqual(snapshot.fields.companyName.visibleWhen, { kind: 'company' })
    assert.include(snapshot.fields.ratio, { precision: 6, scale: 3 })
    await createResourceTable(db, snapshot)
    assert.isTrue(inSync(await schemaDrift(db, snapped)))
    const local = new ResourceService(
      db,
      new ResourceRegistry().register([{ name: 'fts', label, dependsOn: [], resources: [snapped] }])
    )
    // Hidden, so stored as null: the column built from the snapshot must allow it.
    const person = await local.save(snapped.name, admin, { kind: 'person', ratio: '1.5' })
    const stored = await db(snapped.name).where('id', Number(person.id)).first()
    assert.isNull(stored.company_name)
    assert.equal(stored.ratio, '1.500')
    // The doctor applies the same NOT NULL rule to an embedded snapshot.
    const embed = (value: unknown) =>
      `await createResourceTable(this.db, ${JSON.stringify(value)})\n  }`
    const file = 'database/migrations/1_create_ft_snapped.ts'
    assert.equal(
      diagnoseResourceSnapshots([{ file, source: embed(snapshot) }], () => snapped).status,
      'pass'
    )
    const strict = JSON.parse(JSON.stringify(snapshot))
    delete strict.fields.companyName.visibleWhen
    assert.equal(
      diagnoseResourceSnapshots([{ file, source: embed(strict) }], () => snapped).status,
      'warn'
    )

    // adula:resource:migration: the same field added to an existing table stays nullable.
    const before = defineResource({
      ...snapped,
      name: 'ft_grown',
      fields: { kind: fields.kind },
      form: ['kind'],
    } as never)
    await createResourceTable(db, before)
    await db('ft_grown').insert({ kind: 'person', created_by: 1, updated_by: 1 })
    const grown = defineResource({ ...snapped, name: 'ft_grown' })
    const addition = JSON.parse(
      JSON.stringify(resourceAddition(grown, await schemaDrift(db, grown)))
    )
    assert.deepEqual(addition.fields.companyName.visibleWhen, { kind: 'company' })
    await alterResourceTable(db, 'ft_grown', addition)
    const column = await db('information_schema.columns')
      .where({ table_schema: 'adula_test', table_name: 'ft_grown', column_name: 'company_name' })
      .first('is_nullable')
    assert.equal(column.is_nullable, 'YES')
    const grownService = new ResourceService(
      db,
      new ResourceRegistry().register([{ name: 'ftg', label, dependsOn: [], resources: [grown] }])
    )
    const saved = await grownService.save(grown.name, admin, { kind: 'person' })
    const added = await db('ft_grown').where('id', Number(saved.id)).first()
    assert.isNull(added.company_name)
  })

  test('blank text is no value: required fields refuse it, optional fields store null', async ({
    assert,
  }) => {
    for (const blank of ['', '   ', '\t \n']) {
      const entry = await rejected(valid({ name: blank }), 'name')
      assert.equal(entry.rule, 'required', JSON.stringify(blank))
    }
    // Visible and required: blank is missing too.
    const company = await failure(() =>
      service.save(contact.name, admin, valid({ kind: 'company', companyName: '   ' }))
    )
    assert.equal((company as AdulaError).code, 'E_REQUIRED')
    const saved = await service.save(
      contact.name,
      admin,
      valid({ email: '', phone: '  ', website: ' ' })
    )
    const row = await db(contact.name).where('id', Number(saved.id)).first()
    assert.isNull(row.email)
    assert.isNull(row.phone)
    assert.isNull(row.website)
    // A custom validator cannot store a blank required value either.
    const lax = defineResource({
      ...contact,
      validator: { validate: async (d) => d as RecordData },
    })
    const laxService = new ResourceService(
      db,
      new ResourceRegistry().register([
        { name: 'ft', label: { ar: 'اختبار' }, dependsOn: [], resources: [tag, lax] },
      ])
    )
    const blank = await failure(() => laxService.save(lax.name, admin, valid({ name: '  ' })))
    assert.equal((blank as AdulaError).code, 'E_REQUIRED')
  })

  test('visibleWhen values are checked at definition time and compared canonically', ({
    assert,
  }) => {
    const label = { ar: 'حقل' }
    const base = {
      name: 'ft_rules',
      label,
      scoped: false,
      list: [],
      form: [],
      show: [],
      actions: ['view'] as const,
    }
    const kind = {
      type: 'enum',
      options: [
        { value: 'local', label },
        { value: 'international', label },
      ],
      label,
    } as const
    // A typo in an option value fails when the module loads, not silently at runtime.
    assert.throws(
      () =>
        defineResource({
          ...base,
          fields: {
            kind,
            country: { type: 'string', visibleWhen: { kind: 'internationl' }, label },
          },
        } as never),
      /visibleWhen kind = "internationl" is not a valid enum value/
    )
    const channels = { type: 'multiSelect', options: [{ value: 'sms', label }], label } as const
    assert.throws(
      () =>
        defineResource({
          ...base,
          fields: { channels, number: { type: 'phone', visibleWhen: { channels: 'fax' }, label } },
        } as never),
      /not a valid multiSelect value/
    )
    assert.throws(
      () =>
        defineResource({
          ...base,
          fields: {
            rate: { type: 'decimal', label },
            note: { type: 'string', visibleWhen: { rate: '12.5' }, label },
          },
        } as never),
      /canonical value "12.50"/
    )
    const priced = defineResource({
      ...base,
      fields: {
        rate: { type: 'decimal', label },
        note: { type: 'string', visibleWhen: { rate: '12.50' }, label },
      },
    } as never)
    // A raw controller value matches its canonical rule value.
    for (const rate of [12.5, '12.5', ' 12.50 ', '12.500'])
      assert.isTrue(isVisible(priced, 'note', { rate }), JSON.stringify(rate))
    assert.isFalse(isVisible(priced, 'note', { rate: '12.51' }))
    assert.isFalse(isVisible(priced, 'note', { rate: null }))
  })

  test('a hidden field the actor may not write keeps its stored value and links', async ({
    assert,
  }) => {
    const label = { ar: 'حقل' }
    const deal = defineResource({
      name: 'ft_deals',
      label: { ar: 'الصفقات' },
      scoped: false,
      version: true,
      fields: {
        kind: {
          type: 'enum',
          required: true,
          options: [
            { value: 'person', label: { ar: 'فرد' } },
            { value: 'company', label: { ar: 'شركة' } },
          ],
          label,
        },
        partnerName: { type: 'string', required: true, visibleWhen: { kind: 'company' }, label },
        partners: {
          type: 'manyToMany',
          resource: 'ft_tags',
          visibleWhen: { kind: 'company' },
          label,
        },
      },
      list: ['kind'],
      form: ['kind', 'partnerName', 'partners'],
      show: ['kind', 'partnerName', 'partners'],
      actions: ['view', 'create', 'update'],
    })
    await createResourceTable(db, deal)
    const local = new ResourceService(
      db,
      new ResourceRegistry().register([
        { name: 'ftd', label, dependsOn: [], resources: [tag, deal] },
      ])
    )
    // May change the kind only: partner details are someone else's to write.
    const clerk: Actor = {
      id: 2,
      orgPaths: ['1'],
      permissionLevel: 0,
      rules: [
        { subject: 'ft_deals', action: 'view' },
        { subject: 'ft_tags', action: 'view' },
        { subject: 'ft_deals', action: 'update', fields: ['kind'] },
      ],
    }
    const create = () =>
      local.save(deal.name, admin, {
        kind: 'company',
        partnerName: 'شركة الأفق',
        partners: [Number(unitTwo.id)],
      })
    const first = await create()
    const moved = await local.save(
      deal.name,
      clerk,
      { kind: 'person', version: first.version },
      Number(first.id)
    )
    assert.equal(moved.kind, 'person')
    const row = await db(deal.name).where('id', Number(first.id)).first()
    assert.equal(row.kind, 'person')
    assert.equal(row.partner_name, 'شركة الأفق')
    assert.lengthOf(await db('ft_deals_partners').where('ft_deals_id', Number(first.id)), 1)
    // A writer of those fields clears them as before.
    const second = await create()
    const cleared = await local.save(
      deal.name,
      admin,
      { kind: 'person', version: second.version },
      Number(second.id)
    )
    assert.isNull(cleared.partnerName)
    assert.deepEqual(cleared.partners, [])
    assert.lengthOf(await db('ft_deals_partners').where('ft_deals_id', Number(second.id)), 0)
  })

  test('inline rows neither offer nor clear many-to-many links', async ({ assert }) => {
    const label = { ar: 'حقل' }
    const basket = defineResource({
      name: 'ft_baskets',
      label: { ar: 'السلال' },
      scoped: false,
      version: true,
      fields: {
        title: { type: 'string', required: true, label },
        lines: {
          type: 'hasMany',
          resource: 'ft_basket_lines',
          foreignKey: 'basketId',
          inline: true,
          label,
        },
      },
      list: ['title'],
      form: ['title', 'lines'],
      show: ['title', 'lines'],
      actions: ['view', 'create', 'update'],
    })
    const line = defineResource({
      name: 'ft_basket_lines',
      label: { ar: 'البنود' },
      scoped: false,
      version: true,
      fields: {
        basketId: { type: 'belongsTo', resource: 'ft_baskets', required: true, label },
        quantity: { type: 'integer', required: true, label },
        tags: { type: 'manyToMany', resource: 'ft_tags', label },
      },
      list: ['quantity'],
      form: ['basketId', 'quantity', 'tags'],
      show: ['quantity', 'tags'],
      actions: ['view', 'create', 'update', 'delete'],
    })
    await createResourceTable(db, basket)
    await createResourceTable(db, line)
    const local = new ResourceService(
      db,
      new ResourceRegistry().register([
        { name: 'ftb', label, dependsOn: [], resources: [tag, basket, line] },
      ])
    )
    const parent = await local.save(basket.name, admin, { title: 'سلة' })
    const child = await local.save(line.name, admin, {
      basketId: Number(parent.id),
      quantity: 1,
      tags: [Number(unitTwo.id)],
    })
    const editor = await local.editor(basket.name, admin, Number(parent.id))
    assert.notInclude(
      editor.inline.lines.fields.map((field: { key: string }) => field.key),
      'tags'
    )
    // An inline row update without links, or with an empty list, keeps the stored links.
    const stored = (name: string, id: unknown) => db(name).where('id', Number(id)).first()
    for (const tags of [undefined, []]) {
      const [basketRow, lineRow] = await Promise.all([
        stored(basket.name, parent.id),
        stored(line.name, child.id),
      ])
      await local.save(
        basket.name,
        admin,
        {
          title: 'سلة',
          version: basketRow.version,
          lines: [
            {
              id: Number(child.id),
              version: lineRow.version,
              quantity: 2,
              ...(tags ? { tags } : {}),
            },
          ],
        },
        Number(parent.id)
      )
    }
    const saved = await stored(line.name, child.id)
    assert.equal(saved.quantity, 2)
    assert.deepEqual(
      await db('ft_basket_lines_tags')
        .where('ft_basket_lines_id', Number(child.id))
        .pluck('ft_tags_id'),
      [Number(unitTwo.id)]
    )
  })

  test('visibleWhen null on a multiSelect controller means no selection', ({ assert }) => {
    const label = { ar: 'حقل' }
    const fields: Record<string, Field> = {
      channels: {
        type: 'multiSelect',
        options: [{ value: 'mail', label }],
        label,
      },
      reason: { type: 'string', visibleWhen: { channels: null }, label },
    }
    const resource = { fields }
    assert.isTrue(isVisible(resource, 'reason', { channels: [] }))
    assert.isTrue(isVisible(resource, 'reason', { channels: null }))
    assert.isTrue(isVisible(resource, 'reason', {}))
    assert.isFalse(isVisible(resource, 'reason', { channels: ['mail'] }))
  })

  test('delete responses carry manyToMany ids', async ({ assert }) => {
    const saved = await service.save(contact.name, admin, valid({ tags: [Number(unitTwo.id)] }))
    const deleted = await service.transition(
      contact.name,
      Number(saved.id),
      admin,
      'delete',
      saved.version
    )
    assert.deepEqual(deleted.tags, [Number(unitTwo.id)])
  })

  test('a composite unique combination with an empty member is still unique', async ({
    assert,
  }) => {
    const label = { ar: 'حقل' }
    const slot = defineResource({
      name: 'ft_slots',
      label: { ar: 'المواعيد' },
      scoped: false,
      fields: {
        room: { type: 'string', required: true, label: { ar: 'القاعة' } },
        day: { type: 'date', label: { ar: 'اليوم' } },
      },
      unique: [['room', 'day']],
      list: ['room'],
      form: ['room', 'day'],
      show: ['room', 'day'],
      actions: ['view', 'create'],
    })
    await createResourceTable(db, slot)
    const local = new ResourceService(
      db,
      new ResourceRegistry().register([{ name: 'ftsl', label, dependsOn: [], resources: [slot] }])
    )
    await local.save(slot.name, admin, { room: 'A' })
    const duplicate = await failure(() => local.save(slot.name, admin, { room: 'A' }))
    assert.equal((duplicate as AdulaError).status, 409)
    assert.equal(duplicate.message, 'هذه القيمة مستخدمة في سجل آخر: القاعة، اليوم')
    await local.save(slot.name, admin, { room: 'A', day: '2026-10-26' })
    await local.save(slot.name, admin, { room: 'B' })
  })

  test('identifiers longer than the PostgreSQL 63-byte limit are refused at definition time', ({
    assert,
  }) => {
    const label = { ar: 'حقل' }
    const base = {
      label,
      scoped: false,
      list: [],
      form: [],
      show: [],
      actions: ['view'] as const,
    }
    const long = `ft_${'a'.repeat(40)}`
    const key = `linked${'x'.repeat(20)}`
    // The default join table `<owner>_<key>` is longer than 63 bytes.
    assert.throws(
      () =>
        defineResource({
          ...base,
          name: long,
          fields: { [key]: { type: 'manyToMany', resource: 'ft_tags', label } },
        } as never),
      /longer than 63 bytes/
    )
    // A short explicit table is accepted; a long one is refused.
    assert.doesNotThrow(() =>
      defineResource({
        ...base,
        name: long,
        fields: {
          [key]: { type: 'manyToMany', resource: 'ft_tags', table: 'ft_short_links', label },
        },
      } as never)
    )
    assert.throws(
      () =>
        defineResource({
          ...base,
          name: 'ft_links',
          fields: {
            tags: { type: 'manyToMany', resource: 'ft_tags', table: 't'.repeat(64), label },
          },
        } as never),
      /longer than 63 bytes/
    )
    // A composite unique index name PostgreSQL would silently truncate.
    assert.throws(
      () =>
        defineResource({
          ...base,
          name: long,
          fields: {
            firstName: { type: 'string', label },
            familyName: { type: 'string', label },
          },
          unique: [['firstName', 'familyName']],
        } as never),
      /unique index name .* longer than 63 bytes/
    )
  })
})
