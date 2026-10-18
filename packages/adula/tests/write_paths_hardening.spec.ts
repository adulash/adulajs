import { test } from '@japa/runner'
import { BaseModel } from '@adonisjs/lucid/orm'
import {
  AdulaError,
  Assignments,
  ResourceRegistry,
  ResourceService,
  WorkflowEngine,
  consumeEvent,
  createResourceTable,
  defineResource,
  defineWorkflow,
  logActivity,
  publishOutbox,
} from '../index.js'
import type { Actor, DomainEvent, RecordData } from '../index.js'
import { admin, db, registry, setup } from './helpers.js'

async function failure(run: () => Promise<unknown>): Promise<AdulaError> {
  try {
    await run()
  } catch (error) {
    if (error instanceof AdulaError) return error
    throw error
  }
  throw new Error('Expected an AdulaError')
}

/** Typed filter and sort columns for list/aggregate input validation (F9). */
const item = defineResource({
  name: 'stock_items',
  label: { ar: 'الأصناف', en: 'Items' },
  model: BaseModel,
  scoped: false,
  fields: {
    name: { type: 'string', sortable: true, label: { ar: 'الاسم', en: 'Name' } },
    quantity: {
      type: 'integer',
      filterable: true,
      sortable: true,
      label: { ar: 'الكمية', en: 'Quantity' },
    },
    active: { type: 'boolean', filterable: true, label: { ar: 'نشط', en: 'Active' } },
  },
  list: ['name', 'quantity', 'active'],
  form: ['name', 'quantity', 'active'],
  show: ['name', 'quantity', 'active'],
  actions: ['view', 'create', 'update', 'delete'],
  validator: { validate: async (data) => data as RecordData },
})

/** A submittable document whose validator rejects one priority value (F7 workflow writes). */
const ticket = defineResource({
  name: 'tickets',
  label: { ar: 'التذاكر', en: 'Tickets' },
  model: BaseModel,
  scoped: false,
  submittable: true,
  fields: {
    priority: { type: 'string', label: { ar: 'الأولوية', en: 'Priority' } },
  },
  list: ['priority'],
  form: ['priority'],
  show: ['priority'],
  actions: ['view', 'create', 'update', 'delete', 'submit', 'cancel', 'amend'],
  validator: {
    validate: async (data) => {
      if ((data as RecordData).priority === 'invalid')
        throw new AdulaError(422, 'E_VALIDATION', 'priority: unsupported value')
      return data as RecordData
    },
  },
})

const local = new ResourceRegistry().register([
  { name: 'stock', label: item.label, dependsOn: [], resources: [item, ticket] },
])

const cursorOf = (value: unknown) =>
  Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url')

test.group('Write path and query hardening', (group) => {
  const service = () => new ResourceService(db, registry)
  const stock = () => new ResourceService(db, local)

  group.setup(async () => {
    await setup()
    for (const resource of local.all()) await createResourceTable(db, resource)
    for (const [index, quantity] of [3, 5, 5, 8, 13].entries())
      await stock().save('stock_items', admin, {
        name: `صنف ${index}`,
        quantity,
        active: index % 2 === 0,
      })
  })

  test('filters are coerced to the field type and mismatches are 422 E_FILTER', async ({
    assert,
  }) => {
    const five = await stock().list('stock_items', admin, { filters: { quantity: '5' } })
    assert.deepEqual(
      five.data.map((row) => row.quantity),
      [5, 5]
    )
    const numeric = await stock().list('stock_items', admin, { filters: { quantity: 8 } })
    assert.lengthOf(numeric.data, 1)
    const active = await stock().list('stock_items', admin, { filters: { active: 'true' } })
    assert.lengthOf(active.data, 3)
    for (const filters of [
      { quantity: 'abc' },
      { quantity: '1.5' },
      { quantity: '99999999999' },
      { quantity: true },
      { active: 'maybe' },
    ]) {
      const error = await failure(() => stock().list('stock_items', admin, { filters }))
      assert.equal(error.status, 422, JSON.stringify(filters))
      assert.equal(error.code, 'E_FILTER')
    }
    const aggregate = await failure(() =>
      stock().aggregate('stock_items', admin, { filters: { quantity: 'abc' } })
    )
    assert.equal(aggregate.status, 422)
    assert.equal(aggregate.code, 'E_FILTER')
    const totals = await stock().aggregate('stock_items', admin, { filters: { quantity: '5' } })
    assert.equal(Number(totals.rows[0].count), 2)
  })

  test('forged or mistyped cursors are 422 E_CURSOR; valid cursors still page', async ({
    assert,
  }) => {
    const forged = [
      'not base64 at all!',
      cursorOf('null'),
      cursorOf('[]'),
      cursorOf('42'),
      cursorOf('{"broken"'),
      cursorOf({ id: 1, value: 'abc', sort: 'quantity', direction: 'asc' }),
      cursorOf({ id: 1, value: 1.5, sort: 'quantity', direction: 'asc' }),
      cursorOf({ id: 'x', value: 1, sort: 'quantity', direction: 'asc' }),
      cursorOf({ id: 1, sort: 'quantity', direction: 'asc' }),
    ]
    for (const cursor of forged) {
      const error = await failure(() =>
        stock().list('stock_items', admin, { sort: 'quantity', cursor })
      )
      assert.equal(error.status, 422, cursor)
      assert.equal(error.code, 'E_CURSOR')
    }
    const byId = await failure(() =>
      stock().list('stock_items', admin, {
        cursor: cursorOf({ id: 1, value: 'abc', sort: 'id', direction: 'asc' }),
      })
    )
    assert.equal(byId.code, 'E_CURSOR')

    const seen: unknown[] = []
    let cursor: string | undefined
    do {
      const page = await stock().list('stock_items', admin, { sort: 'quantity', limit: 2, cursor })
      seen.push(...page.data.map((row) => row.quantity))
      cursor = page.meta.nextCursor ?? undefined
    } while (cursor)
    assert.deepEqual(seen, [3, 5, 5, 8, 13])
  })

  test('amend copies inline lines only for actors who may create them', async ({ assert }) => {
    const draft = await service().save('orders', admin, {
      orgUnitId: 2,
      notes: 'أصل للتعديل بالنسخ',
      lines: [{ name: 'بند أ' }, { name: 'بند ب' }],
    })
    const id = Number(draft.id)
    const submitted = await service().transition('orders', id, admin, 'submit', draft.version)
    await service().transition('orders', id, admin, 'cancel', submitted.version)

    const amender: Actor = {
      id: 2,
      orgPaths: ['1'],
      permissionLevel: 1,
      rules: [
        { subject: 'orders', action: ['view', 'create', 'update', 'amend'] },
        { subject: 'order_lines', action: ['view', 'update'] },
      ],
    }
    const denied = await failure(() => service().amend('orders', id, amender))
    assert.equal(denied.status, 403)
    assert.equal(denied.code, 'E_FORBIDDEN')
    // The transaction rolled back: neither the copied document nor any line exists.
    assert.notExists(await db('orders').where('amended_from_id', id).first())
    assert.lengthOf(await db('order_lines').where('created_by', amender.id), 0)

    const permitted: Actor = {
      ...amender,
      rules: [...amender.rules, { subject: 'order_lines', action: 'create' }],
    }
    const amended = await service().amend('orders', id, permitted)
    const copies = await db('order_lines')
      .where('order_id', Number(amended.id))
      .whereNull('deleted_at')
      .orderBy('id')
    assert.deepEqual(
      copies.map((row) => row.name),
      ['بند أ', 'بند ب']
    )
    for (const row of copies) {
      assert.equal(row.created_by, permitted.id)
      assert.equal(row.org_unit_id, 2)
      assert.equal(row.version, 1)
    }
    // Copies are audited as ordinary creates through the service.
    const audits = await db('activities')
      .where({ resource: 'order_lines', action: 'create', actor_id: permitted.id })
      .whereIn(
        'record_id',
        copies.map((row) => row.id)
      )
    assert.lengthOf(audits, 2)
  })

  /** Submits a ticket and delivers its events to a one-step workflow writing `priority`. */
  async function triage(priority: string, options: { anonymous?: boolean } = {}) {
    const definition = defineWorkflow({
      name: 'ticket_triage',
      version: 1,
      resource: 'tickets',
      label: 'فرز التذاكر',
      start: 'mark',
      maxAttempts: 1,
      steps: {
        mark: { type: 'update', values: { priority }, next: 'done' },
        done: { type: 'end', outcome: 'completed' },
      },
    })
    const actors = new Map<number, Actor>([[admin.id, admin]])
    const engine = new WorkflowEngine(
      db,
      local,
      stock(),
      { load: async (userId) => actors.get(userId)! },
      new Assignments(db, stock(), { load: async (userId) => actors.get(userId)! }),
      [definition]
    )
    const saved = await stock().save('tickets', admin, { priority: 'normal' })
    const id = Number(saved.id)
    await db('outbox').del()
    await stock().transition('tickets', id, admin, 'submit', saved.version)
    // An event that names no user, as a producer without an author would publish it.
    if (options.anonymous) await db('outbox').update({ payload: db.raw(`payload - 'actorId'`) })
    const events: DomainEvent[] = []
    await publishOutbox(db, {
      dispatch: async (_, payload) => {
        events.push(payload as unknown as DomainEvent)
      },
    })
    for (const event of events)
      for (const listener of engine.listeners()) await consumeEvent(db, listener, event)
    const run = await db('workflow_runs').where({ resource: 'tickets', record_id: id }).first()
    const stored = await db('tickets').where('id', id).first()
    const updates = await db('activities').where({
      resource: 'tickets',
      record_id: id,
      action: 'update',
    })
    return { run, stored, updates }
  }

  test('workflow update steps run the resource validator and fail without writing', async ({
    assert,
  }) => {
    const { run, stored, updates } = await triage('invalid')
    assert.equal(stored.priority, 'normal')
    assert.equal(run.status, 'failed')
    assert.equal(run.current_step, 'mark')
    assert.include(run.last_error, 'priority: unsupported value')
    assert.lengthOf(updates, 0)

    const valid = await triage('high')
    assert.equal(valid.stored.priority, 'high')
    assert.equal(valid.run.status, 'completed')
    assert.lengthOf(valid.updates, 1)
    assert.equal(valid.updates[0].actor_id, admin.id)
    assert.isTrue(valid.updates[0].changes.system)
  })

  test('a workflow started by an event without a user still writes as the system', async ({
    assert,
  }) => {
    const { run, stored, updates } = await triage('high', { anonymous: true })
    assert.isNull(run.started_by)
    assert.equal(run.status, 'completed')
    assert.equal(stored.priority, 'high')
    // The last human author is kept; there is no author to record an activity for.
    assert.equal(stored.updated_by, admin.id)
    assert.lengthOf(updates, 0)
    // The validator still applies to unattributed writes.
    const rejected = await triage('invalid', { anonymous: true })
    assert.equal(rejected.stored.priority, 'normal')
    assert.equal(rejected.run.status, 'failed')
    assert.include(rejected.run.last_error, 'priority: unsupported value')
    // Creates always need an author.
    const create = await failure(() =>
      stock().systemSave('tickets', { priority: 'x' }, undefined, { actorId: null })
    )
    assert.equal(create.code, 'E_ACTOR')
  })

  test('a docStatus-conditioned amend role with child create amends documents with lines', async ({
    assert,
  }) => {
    const cancelledOrder = async (notes: string) => {
      const draft = await service().save('orders', admin, {
        orgUnitId: 2,
        notes,
        lines: [{ name: `بند ${notes}` }],
      })
      const id = Number(draft.id)
      const submitted = await service().transition('orders', id, admin, 'submit', draft.version)
      await service().transition('orders', id, admin, 'cancel', submitted.version)
      return id
    }
    const amender: Actor = {
      id: 2,
      orgPaths: ['1'],
      permissionLevel: 1,
      rules: [
        { subject: 'orders', action: ['view', 'create', 'update'] },
        { subject: 'orders', action: 'amend', conditions: { docStatus: 2 } },
        { subject: 'order_lines', action: ['view', 'create'] },
      ],
    }
    const id = await cancelledOrder('مشروط')
    const amended = await service().amend('orders', id, amender)
    const copies = await db('order_lines').where('order_id', Number(amended.id))
    assert.deepEqual(
      copies.map((row) => row.name),
      ['بند مشروط']
    )
    // A rule denying the lines field on amend still blocks copying them.
    const secondId = await cancelledOrder('ممنوع')
    const denied = await failure(() =>
      service().amend('orders', secondId, {
        ...amender,
        rules: [
          ...amender.rules,
          { subject: 'orders', action: 'amend', fields: ['lines'], inverted: true },
        ],
      })
    )
    assert.equal(denied.code, 'E_FIELD_FORBIDDEN')
    assert.notExists(await db('orders').where('amended_from_id', secondId).first())
  })

  test('activity entries take the impersonator only from the trusted argument', async ({
    assert,
  }) => {
    await logActivity(db, {
      resource: 'stock_items',
      recordId: 1,
      actorId: admin.id,
      action: 'forged_note',
      changes: { note: 'x', impersonatedBy: 99 },
    })
    await logActivity(db, {
      resource: 'stock_items',
      recordId: 1,
      actorId: admin.id,
      impersonatorId: 2,
      action: 'trusted_note',
      changes: { impersonatedBy: 99 },
    })
    const forged = await db('activities').where('action', 'forged_note').first()
    assert.deepEqual(forged.changes, { note: 'x' })
    const trusted = await db('activities').where('action', 'trusted_note').first()
    assert.deepEqual(trusted.changes, { impersonatedBy: 2 })
  })
})
