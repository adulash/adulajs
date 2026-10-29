import { test } from '@japa/runner'
import vine from '@vinejs/vine'
import {
  ResourceRegistry,
  ResourceService,
  alterResourceTable,
  createResourceTable,
  defineResource,
  installCatalogMessages,
  resourceAddition,
  schemaDrift,
} from '../index.js'
import type { Actor, Field, RecordData } from '../index.js'
import { additionMigrationSource, inSync } from '../src/database/schema_diff.js'
import { diagnoseResourceSchemas } from '../src/commands/doctor.js'
import { canonicalDecimal } from '../src/resource/values.js'
import { admin, db, setup } from './helpers.js'

// Review fixes of the definition-as-source-of-truth phase (ADR 045), on real PostgreSQL.
const label = { ar: 'حقل' }
const tag = defineResource({
  name: 'fh_tags',
  label: { ar: 'الوسوم' },
  scoped: true,
  fields: { name: { type: 'string', required: true, label: { ar: 'الاسم' } } },
  list: ['name'],
  form: ['name'],
  show: ['name'],
  actions: ['view', 'create', 'update', 'delete'],
})
// A submittable document with a sequence, a unique code, a composite unique pair and
// inline lines that link tags.
const doc = defineResource({
  name: 'fh_docs',
  label: { ar: 'المستندات' },
  scoped: false,
  submittable: true,
  fields: {
    number: { type: 'string', sequence: 'FHD', unique: true, label: { ar: 'الرقم' } },
    code: { type: 'string', unique: true, label: { ar: 'الرمز' } },
    series: { type: 'string', label: { ar: 'السلسلة' } },
    ref: { type: 'string', label: { ar: 'المرجع' } },
    amount: { type: 'decimal', precision: 20, scale: 2, label: { ar: 'المبلغ' } },
    lines: {
      type: 'hasMany',
      resource: 'fh_doc_lines',
      foreignKey: 'docId',
      inline: true,
      label: { ar: 'البنود' },
    },
  },
  unique: [['series', 'ref']],
  list: ['number', 'code'],
  form: ['code', 'series', 'ref', 'amount', 'lines'],
  show: ['number', 'code', 'series', 'ref', 'amount'],
  actions: ['view', 'create', 'update', 'delete', 'submit', 'cancel', 'amend'],
})
const docLine = defineResource({
  name: 'fh_doc_lines',
  label: { ar: 'البنود' },
  scoped: false,
  fields: {
    docId: { type: 'belongsTo', resource: 'fh_docs', required: true, label: { ar: 'المستند' } },
    name: { type: 'string', required: true, label: { ar: 'الاسم' } },
    tags: { type: 'manyToMany', resource: 'fh_tags', label: { ar: 'الوسوم' } },
  },
  list: ['name'],
  form: ['docId', 'name', 'tags'],
  show: ['name', 'tags'],
  actions: ['view', 'create', 'update', 'delete'],
})
const registry = new ResourceRegistry().register([
  { name: 'fh', label: { ar: 'تقوية' }, dependsOn: [], resources: [tag, doc, docLine] },
])
const service = new ResourceService(db, registry)
// Distinct (series, ref) pairs: the composite index treats an empty pair as one value.
let pairs = 0
const pair = () => ({ series: 'P', ref: String(++pairs) })

async function failure(run: () => Promise<unknown>) {
  try {
    await run()
  } catch (error) {
    return error as Error & { code?: string; status?: number; messages?: RecordData[] }
  }
  throw new Error('Expected the write to fail')
}

/** Cancels a new draft with these values, ready to be amended. */
async function cancelled(values: RecordData) {
  const draft = await service.save(doc.name, admin, values)
  const id = Number(draft.id)
  const submitted = await service.transition(doc.name, id, admin, 'submit', draft.version)
  await service.transition(doc.name, id, admin, 'cancel', submitted.version)
  return draft
}

test.group('Field types hardening: review fixes on PostgreSQL', (group) => {
  let unitTwo: RecordData
  let unitTwoB: RecordData
  let unitThree: RecordData
  group.setup(async () => {
    const previous = vine.messagesProvider
    installCatalogMessages(vine)
    await setup()
    for (const resource of [tag, doc, docLine]) await createResourceTable(db, resource)
    unitTwo = await service.save(tag.name, admin, { name: 'أ', orgUnitId: 2 })
    unitTwoB = await service.save(tag.name, admin, { name: 'ب', orgUnitId: 2 })
    unitThree = await service.save(tag.name, admin, { name: 'سري', orgUnitId: 3 })
    return () => {
      vine.messagesProvider = previous
    }
  })

  test('visibleWhen added to a NOT NULL column: 422, doctor drift and a relaxing migration', async ({
    assert,
  }) => {
    const kind: Field = {
      type: 'enum',
      required: true,
      default: 'person',
      options: [
        { value: 'person', label: { ar: 'فرد' } },
        { value: 'company', label: { ar: 'شركة' } },
      ],
      label: { ar: 'النوع' },
    }
    const strict = defineResource({
      name: 'fh_people',
      label,
      scoped: false,
      fields: {
        kind,
        companyName: { type: 'string', required: true, label: { ar: 'اسم الشركة' } },
      },
      list: ['kind'],
      form: ['kind', 'companyName'],
      show: ['kind'],
      actions: ['view', 'create', 'update'],
    })
    await createResourceTable(db, strict)
    // The definition later hides the field for people: a hidden field is stored as null.
    const relaxed = defineResource({
      ...strict,
      fields: {
        kind,
        companyName: {
          type: 'string',
          required: true,
          visibleWhen: { kind: 'company' },
          label: { ar: 'اسم الشركة' },
        },
      },
    })
    const people = new ResourceService(
      db,
      new ResourceRegistry().register([{ name: 'fhp', label, dependsOn: [], resources: [relaxed] }])
    )
    const refused = await failure(() => people.save(relaxed.name, admin, { kind: 'person' }))
    assert.equal(refused.status, 422)
    assert.equal(refused.code, 'E_NOT_NULL')
    assert.equal(
      refused.message,
      'لا يمكن حفظ السجل لأن الحقل «اسم الشركة» لا يقبل قيمة فارغة في قاعدة البيانات'
    )

    const drift = await schemaDrift(db, relaxed)
    assert.deepEqual(drift.notNullColumns, ['company_name'])
    assert.isFalse(inSync(drift))
    const finding = await diagnoseResourceSchemas(db, [relaxed])
    assert.equal(finding.status, 'warn')
    assert.include(finding.message, 'fh_people.company_name: column is NOT NULL')
    assert.include(finding.message, 'node ace adula:resource:migration fh_people')
    const addition = resourceAddition(relaxed, drift)
    assert.deepEqual(addition, { dropNotNull: ['company_name'] })
    const source = additionMigrationSource(relaxed.name, addition)
    const embedded = JSON.parse(/'fh_people', (\{[\s\S]*\})\)\n {2}\}/.exec(source)![1])
    await alterResourceTable(db, relaxed.name, embedded)
    assert.isTrue(inSync(await schemaDrift(db, relaxed)))
    const saved = await people.save(relaxed.name, admin, { kind: 'person' })
    const person = await db('fh_people').where('id', Number(saved.id)).first()
    assert.isNull(person.company_name)
    // Only relaxing: NOT NULL is never reported for a nullable column the definition requires.
    const strictDrift = await schemaDrift(db, strict)
    assert.deepEqual(strictDrift.notNullColumns, [])
  })

  test('amend copies the manyToMany links of inline lines', async ({ assert }) => {
    const draft = await service.save(doc.name, admin, { code: 'L-1', series: 'L', ref: '1' })
    await service.save(docLine.name, admin, {
      docId: Number(draft.id),
      name: 'بند موسوم',
      tags: [Number(unitTwo.id), Number(unitThree.id)],
    })
    await service.save(docLine.name, admin, { docId: Number(draft.id), name: 'بند بلا وسوم' })
    const id = Number(draft.id)
    const reread = await db('fh_docs').where('id', id).first('version')
    const submitted = await service.transition(doc.name, id, admin, 'submit', reread.version)
    await service.transition(doc.name, id, admin, 'cancel', submitted.version)
    const amended = await service.amend(doc.name, id, admin)
    const copies = await db('fh_doc_lines')
      .where('doc_id', Number(amended.id))
      .whereNull('deleted_at')
      .orderBy('id')
    assert.deepEqual(
      copies.map((row) => row.name),
      ['بند موسوم', 'بند بلا وسوم']
    )
    const links = async (lineId: number) =>
      db('fh_doc_lines_tags')
        .where('fh_doc_lines_id', lineId)
        .orderBy('fh_tags_id')
        .pluck('fh_tags_id')
    assert.deepEqual(
      await links(Number(copies[0].id)),
      [Number(unitTwo.id), Number(unitThree.id)].sort((a, b) => a - b)
    )
    assert.deepEqual(await links(Number(copies[1].id)), [])
    // The original lines keep their links.
    const originals = await db('fh_doc_lines').where('doc_id', id).orderBy('id').pluck('id')
    assert.lengthOf(await links(Number(originals[0])), 2)

    // An actor whose field rules exclude tags gets copies without links, like other fields.
    const restricted: Actor = {
      id: 2,
      orgPaths: ['1'],
      permissionLevel: 1,
      rules: [
        { subject: 'fh_docs', action: ['view', 'create', 'update', 'submit', 'cancel', 'amend'] },
        { subject: 'fh_doc_lines', action: ['view', 'update'] },
        { subject: 'fh_doc_lines', action: 'create', fields: ['docId', 'name'] },
        { subject: 'fh_tags', action: 'view' },
      ],
    }
    const second = await service.save(doc.name, admin, { code: 'L-2', series: 'L', ref: '2' })
    await service.save(docLine.name, admin, {
      docId: Number(second.id),
      name: 'بند',
      tags: [Number(unitTwo.id)],
    })
    const secondId = Number(second.id)
    const secondDraft = await db('fh_docs').where('id', secondId).first('version')
    const secondSubmitted = await service.transition(
      doc.name,
      secondId,
      admin,
      'submit',
      secondDraft.version
    )
    await service.transition(doc.name, secondId, admin, 'cancel', secondSubmitted.version)
    const copy = await service.amend(doc.name, secondId, restricted)
    const [line] = await db('fh_doc_lines').where('doc_id', Number(copy.id)).pluck('id')
    assert.deepEqual(await links(Number(line)), [])
  })

  test('an amended copy keeps unique and composite unique values of its cancelled original', async ({
    assert,
  }) => {
    const original = await cancelled({ code: 'U-1', series: 'S', ref: '7' })
    const amended = await service.amend(doc.name, Number(original.id), admin)
    assert.equal(amended.code, 'U-1')
    assert.equal(amended.series, 'S')
    assert.equal(amended.ref, '7')
    // The sequence gets a fresh number, so it never collides with the original's.
    assert.notEqual(amended.number, original.number)
    // Two live documents that are not cancelled still conflict, single and composite.
    const single = await failure(() => service.save(doc.name, admin, { code: 'U-1', ...pair() }))
    assert.equal(single.status, 409)
    assert.equal(single.message, 'هذه القيمة مستخدمة في سجل آخر: الرمز')
    const composite = await failure(() =>
      service.save(doc.name, admin, { code: 'U-2', series: 'S', ref: '7' })
    )
    assert.equal(composite.status, 409)
    assert.equal(composite.message, 'هذه القيمة مستخدمة في سجل آخر: السلسلة، المرجع')
    const predicates = await db('pg_indexes')
      .where({ schemaname: 'adula_test', tablename: 'fh_docs' })
      .whereLike('indexname', '%_active_unique')
      .pluck('indexdef')
    assert.lengthOf(predicates, 3)
    for (const definition of predicates) assert.include(definition, 'doc_status <> 2')
  })

  test('the doctor finds unique indexes that still count cancelled documents and the migration recreates them', async ({
    assert,
  }) => {
    const { lines, ...stored } = doc.fields
    assert.equal(lines.type, 'hasMany')
    const legacy = defineResource({
      ...doc,
      name: 'fh_legacy',
      fields: stored,
      form: ['code', 'series', 'ref', 'amount'],
    })
    await createResourceTable(db, legacy)
    assert.isTrue(inSync(await schemaDrift(db, legacy)))
    // As tables created before cancelled documents were excluded.
    for (const [name, columns] of [
      ['fh_legacy_code_active_unique', '(code)'],
      ['fh_legacy_series_ref_active_unique', '(series, ref) NULLS NOT DISTINCT'],
    ]) {
      await db.raw(`DROP INDEX ${name}`)
      await db.raw(`CREATE UNIQUE INDEX ${name} ON fh_legacy ${columns} WHERE deleted_at IS NULL`)
    }
    const drift = await schemaDrift(db, legacy)
    assert.deepEqual(drift.staleUnique.map((entry) => entry.index).sort(), [
      'fh_legacy_code_active_unique',
      'fh_legacy_series_ref_active_unique',
    ])
    assert.deepEqual(drift.missingUnique, [])
    const finding = await diagnoseResourceSchemas(db, [legacy])
    assert.equal(finding.status, 'warn')
    assert.include(finding.message, 'still counts cancelled documents')
    assert.include(finding.message, 'node ace adula:resource:migration fh_legacy')
    const addition = resourceAddition(legacy, drift)
    assert.sameDeepMembers(
      [...addition.recreateUnique!],
      [
        { index: 'fh_legacy_code_active_unique', columns: ['code'] },
        { index: 'fh_legacy_series_ref_active_unique', columns: ['series', 'ref'] },
      ]
    )
    const local = new ResourceService(
      db,
      new ResourceRegistry().register([{ name: 'fhl', label, dependsOn: [], resources: [legacy] }])
    )
    const draft = await local.save(legacy.name, admin, { code: 'G-1', series: 'G', ref: '1' })
    const submitted = await local.transition(
      legacy.name,
      Number(draft.id),
      admin,
      'submit',
      draft.version
    )
    await local.transition(legacy.name, Number(draft.id), admin, 'cancel', submitted.version)
    // Before the migration the cancelled original blocks its copy.
    const blocked = await failure(() => local.amend(legacy.name, Number(draft.id), admin))
    assert.equal(blocked.status, 409)
    const source = additionMigrationSource(legacy.name, addition)
    const embedded = JSON.parse(/'fh_legacy', (\{[\s\S]*\})\)\n {2}\}/.exec(source)![1])
    await db.transaction((trx) => alterResourceTable(trx, legacy.name, embedded))
    assert.isTrue(inSync(await schemaDrift(db, legacy)))
    const amended = await local.amend(legacy.name, Number(draft.id), admin)
    assert.equal(amended.code, 'G-1')
    // A column added later to a submittable table gets the same predicate.
    const grown = defineResource({
      ...legacy,
      fields: {
        ...legacy.fields,
        serial: { type: 'string', unique: true, label: { ar: 'تسلسلي' } },
      },
    } as never)
    await alterResourceTable(db, grown.name, resourceAddition(grown, await schemaDrift(db, grown)))
    const serial = await db('pg_indexes')
      .where({ schemaname: 'adula_test', indexname: 'fh_legacy_serial_active_unique' })
      .first('indexdef')
    assert.include(serial.indexdef, 'doc_status <> 2')
    assert.isTrue(inSync(await schemaDrift(db, grown)))
  })

  test('decimal JSON numbers beyond exact precision are refused; strings keep every digit', async ({
    assert,
  }) => {
    for (const amount of [12345678901234567, 1234567890123456.7, -9007199254740991, 0.1 + 0.2]) {
      const error = await failure(() => service.save(doc.name, admin, { amount, ...pair() }))
      assert.equal(error.status, 422, String(amount))
      const entry = error.messages?.find((message) => message.field === 'amount') as
        { rule: string; message: string } | undefined
      assert.equal(entry?.rule, 'unsafeNumber', String(amount))
      assert.include(entry!.message, 'أرسل القيمة نصًا')
    }
    assert.throws(() => canonicalDecimal(123456789012345678, 30, 2), /أرسل القيمة نصًا/)
    // The same digits as a string are exact.
    const exact = await service.save(doc.name, admin, { amount: '12345678901234567.89', ...pair() })
    assert.equal(exact.amount, '12345678901234567.89')
    // Ordinary numbers stay accepted.
    const ordinary = await service.save(doc.name, admin, { amount: 12.5, ...pair() })
    assert.equal(ordinary.amount, '12.50')
    assert.equal(canonicalDecimal(123456789012345, 18, 2), '123456789012345.00')
    assert.equal(canonicalDecimal(0.000001, 18, 6), '0.000001')
  })

  test('manyToMany targets are checked in one query; one unviewable target is 404', async ({
    assert,
  }) => {
    const draft = await service.save(doc.name, admin, { code: 'M-1', ...pair() })
    const outsider: Actor = {
      id: 2,
      orgPaths: ['1.2'],
      permissionLevel: 0,
      rules: [
        { subject: 'fh_docs', action: ['view', 'update'] },
        { subject: 'fh_doc_lines', action: ['view', 'create', 'update'] },
        { subject: 'fh_tags', action: 'view' },
      ],
    }
    const queries: string[] = []
    const listen = (query: { sql: string }) => queries.push(query.sql)
    db.on('query', listen)
    try {
      const denied = await failure(() =>
        service.save(docLine.name, outsider, {
          docId: Number(draft.id),
          name: 'بند',
          tags: [Number(unitTwo.id), Number(unitThree.id), Number(unitTwoB.id)],
        })
      )
      assert.equal(denied.status, 404)
      assert.lengthOf(await db('fh_doc_lines').where('doc_id', Number(draft.id)), 0)
      queries.length = 0
      const saved = await service.save(docLine.name, outsider, {
        docId: Number(draft.id),
        name: 'بند',
        tags: [Number(unitTwoB.id), Number(unitTwo.id)],
      })
      assert.deepEqual(
        saved.tags,
        [Number(unitTwo.id), Number(unitTwoB.id)].sort((a, b) => a - b)
      )
      // One read of the target table for both new links, not one per target.
      assert.lengthOf(
        queries.filter((sql) => /from "fh_tags"/.test(sql)),
        1
      )
    } finally {
      db.off('query', listen)
    }
    // A deleted target is not linkable either.
    await db('fh_tags').where('id', Number(unitTwoB.id)).update({ deleted_at: db.fn.now() })
    const gone = await failure(() =>
      service.save(docLine.name, admin, {
        docId: Number(draft.id),
        name: 'بند',
        tags: [Number(unitTwo.id), Number(unitTwoB.id)],
      })
    )
    assert.equal(gone.status, 404)
    await db('fh_tags').where('id', Number(unitTwoB.id)).update({ deleted_at: null })
  })
})
