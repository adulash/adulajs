import { test } from '@japa/runner'
import { BaseModel } from '@adonisjs/lucid/orm'
import {
  Assignments,
  ResourceRegistry,
  ResourceService,
  createResourceTable,
  defineResource,
} from '../index.js'
import type { Actor, RecordData } from '../index.js'
import { db, setup, admin, customer, order, line } from './helpers.js'
import { ace, addUserProfileColumns } from './helpers/actors.js'

// A ticket declares its title: its code and its status label, never the raw lookup key.
const ticket = defineResource({
  name: 'tickets',
  label: { ar: 'التذاكر', en: 'Tickets' },
  model: BaseModel,
  scoped: true,
  fields: {
    code: { type: 'string', required: true, label: { ar: 'الرمز', en: 'Code' } },
    status: {
      type: 'lookup',
      group: 'order_status',
      label: { ar: 'الحالة', en: 'Status' },
    },
    cost: {
      type: 'money',
      permissionLevel: 1,
      label: { ar: 'التكلفة', en: 'Cost' },
    },
    orderId: { type: 'belongsTo', resource: 'orders', label: { ar: 'الطلب', en: 'Order' } },
  },
  title: ['code', 'status', 'cost'],
  list: ['status', 'code', 'cost', 'orderId'],
  form: ['code', 'status', 'cost', 'orderId'],
  show: ['code', 'status', 'cost', 'orderId'],
  actions: ['view', 'create', 'update', 'delete'],
  validator: { validate: async (data) => data as RecordData },
})
const registry = new ResourceRegistry().register([
  { name: 'customers', label: customer.label, dependsOn: [], resources: [customer] },
  {
    name: 'orders',
    label: order.label,
    dependsOn: ['customers'],
    resources: [order, line, ticket],
  },
])
const service = new ResourceService(db, registry)
const staff = ace()

test.group('Record titles (#47, #32)', (group) => {
  group.setup(async () => {
    await setup()
    await createResourceTable(db, ticket)
    await addUserProfileColumns()
  })

  test('definitions accept only readable, displayable title fields', ({ assert }) => {
    const base = { ...ticket, fields: { ...ticket.fields } }
    assert.throws(() => defineResource({ ...base, title: [] }), /at least one field/)
    assert.throws(() => defineResource({ ...base, title: ['orderId'] }), /cannot be a belongsTo/)
    assert.throws(
      () => defineResource({ ...base, title: ['code'], serialize: ['status'] }),
      /must be serialized/
    )
  })

  test('declared titles show lookup labels and hide fields the viewer may not read', async ({
    assert,
  }) => {
    const created = await service.save('tickets', admin, {
      code: 'T-7',
      status: 'open',
      cost: '1500',
      orgUnitId: 2,
    })
    const full = await service.titles('tickets', [Number(created.id)], admin)
    assert.equal(full.get(Number(created.id)), 'T-7 · مفتوح · 1500')
    // The reader's permission level hides the cost, so the title leaves it out.
    const limited = await service.titles('tickets', [Number(created.id)], staff)
    assert.equal(limited.get(Number(created.id)), 'T-7 · مفتوح')
    const outside: Actor = { ...staff, orgPaths: ['1.3'] }
    const hidden = await service.titles('tickets', [Number(created.id)], outside)
    assert.equal(hidden.size, 0)
  })

  test('default titles use the sequence and the first text field', async ({ assert }) => {
    const document = await service.save('orders', admin, { notes: 'توريد أجهزة', orgUnitId: 2 })
    const titles = await service.titles('orders', [Number(document.id)], admin)
    assert.equal(titles.get(Number(document.id)), `${document.number} · توريد أجهزة`)
    const ticketRow = await service.save('tickets', admin, {
      code: 'T-8',
      orderId: document.id,
      orgUnitId: 2,
    })
    // Related rows carry the title, so relation cells never show a raw lookup key.
    const listed = await service.list('tickets', admin, { search: undefined })
    const related = listed.related.orderId.find((row) => row.id === document.id)
    assert.equal(related?._title, `${document.number} · توريد أجهزة`)
    const options = await service.relationOptions('tickets', 'orderId', admin, {
      id: Number(ticketRow.id),
    })
    assert.include(
      options.data.map((option) => option.label),
      `${document.number} · توريد أجهزة`
    )
  })

  test('my tasks and the record tasks show the record title', async ({ assert }) => {
    const record = await service.save('tickets', admin, {
      code: 'T-9',
      status: 'closed',
      orgUnitId: 2,
    })
    const assignments = new Assignments(db, service, { load: async () => staff })
    await assignments.create(db, {
      resource: 'tickets',
      recordId: Number(record.id),
      assigneeId: 2,
      assignedBy: 1,
      title: 'حل التذكرة',
    })
    const page = await assignments.mine(staff)
    const [task] = page.data
    assert.equal(task.recordTitle, 'T-9 · مغلق')
    const [onRecord] = await assignments.forRecord('tickets', Number(record.id), staff)
    assert.equal(onRecord.recordTitle, 'T-9 · مغلق')
  })
})

test.group('Create form defaults (#48)', (group) => {
  group.setup(async () => {
    await setup()
    await createResourceTable(db, ticket)
    await db('lookups').insert({
      group: 'order_status',
      key: 'retired',
      label_ar: 'متوقف',
      label_en: 'Retired',
      active: false,
    })
  })

  test('only visible form fields, active lookups and viewable relations are used', async ({
    assert,
  }) => {
    const inScope = await service.save('orders', admin, { notes: 'داخل النطاق', orgUnitId: 2 })
    const outOfScope = await service.save('orders', admin, { notes: 'خارج النطاق', orgUnitId: 3 })
    const editor = await service.editor('tickets', staff, undefined, {
      defaults: {
        code: 'T-10',
        status: 'open',
        orderId: String(inScope.id),
        cost: '99',
        createdBy: '1',
        unknown: 'x',
      },
    })
    // cost needs a higher permission level; createdBy and unknown are not form fields.
    assert.deepEqual(editor.defaults, { code: 'T-10', status: 'open', orderId: inScope.id })
    const refused = await service.editor('tickets', staff, undefined, {
      defaults: { status: 'retired', orderId: String(outOfScope.id) },
    })
    assert.deepEqual(refused.defaults, {}, 'inactive lookups and hidden records are dropped')
    assert.notInclude(
      refused.options.orderId.map((option) => option.value),
      String(outOfScope.id)
    )
    const invalid = await service.editor('tickets', staff, undefined, {
      defaults: { orderId: 'abc', status: ['open'] as unknown as string },
    })
    assert.deepEqual(invalid.defaults, {})
    const existing = await service.save('tickets', admin, { code: 'T-11', orgUnitId: 2 })
    const editing = await service.editor('tickets', admin, Number(existing.id), {
      defaults: { code: 'ignored' },
    })
    assert.deepEqual(editing.defaults, {}, 'defaults apply to create forms only')
  })

  test('a default relation beyond the first option page is added with its title', async ({
    assert,
  }) => {
    for (let index = 0; index < 55; index++)
      await service.save('orders', admin, { notes: `طلب ${index}`, orgUnitId: 2 })
    const oldest = await db('orders').where('org_unit_id', 2).orderBy('id').first('id', 'number')
    const editor = await service.editor('tickets', admin, undefined, {
      defaults: { orderId: String(oldest.id) },
    })
    assert.equal(editor.defaults.orderId, oldest.id)
    const option = editor.options.orderId.find((entry) => entry.value === String(oldest.id))
    assert.match(String(option?.label), new RegExp(`^${oldest.number} · `))
  })
})
