import { test } from '@japa/runner'
import { randomUUID } from 'node:crypto'
import { ResourceService, consumeEvent, publishOutbox, AdulaError } from '../index.js'
import type { RecordData } from '../index.js'
import {
  db,
  setup,
  registry,
  admin,
  reader,
  order,
  line,
  customer as customerResource,
} from './helpers.js'
import { failure } from './helpers/failure.js'
import { powerless } from './helpers/actors.js'

test.group('Transactional resource service', (group) => {
  group.setup(setup)
  const service = new ResourceService(db, registry)
  test('create commits entity, activity, sequence and outbox together', async ({ assert }) => {
    const record = await service.save('orders', admin, {
      notes: 'طلب عربي',
      orgUnitId: 2,
      status: 'open',
      total: '9007199254740993',
    })
    assert.equal(record.number, 'ORD-000001')
    assert.equal(record.version, 1)
    assert.equal(record.total, '9007199254740993')
    assert.exists(
      await db('activities').where({ record_id: record.id, resource: 'orders' }).first()
    )
    assert.exists(await db('outbox').where({ event: 'orders.orders.created' }).first())
  })
  test('editor hides forbidden fields, inactive lookups and out-of-scope organizations', async ({
    assert,
  }) => {
    const editor = await service.editor('orders', reader)
    assert.notInclude(
      editor.fields.map((field) => field.key),
      'total'
    )
    assert.notInclude(
      editor.fields.map((field) => field.key),
      'internalNote'
    )
    assert.notInclude(
      editor.fields.map((field) => field.key),
      'number'
    )
    assert.deepEqual(
      editor.orgUnits.map((unit) => unit.value),
      ['2', '4']
    )
    assert.deepEqual(editor.options.status.map((option) => option.value).sort(), ['closed', 'open'])
    await assert.rejects(() => service.editor('orders', powerless()), /صلاحية/)
  })
  test('editor enforces record policy and preserves a selected relation beyond the first page', async ({
    assert,
  }) => {
    for (let index = 0; index < 51; index++)
      await service.save('customers', admin, { name: `خيار ${index}` })
    const customer = await service.save('customers', admin, { name: 'العميل المحدد' })
    const record = await service.save('orders', admin, { orgUnitId: 2, customerId: customer.id })
    const editor = await service.editor('orders', reader, Number(record.id))
    assert.include(
      editor.options.customerId.map((option) => option.value),
      String(customer.id)
    )
    assert.notProperty(editor.record!, 'total')
    const outside = await service.save('orders', admin, { orgUnitId: 3 })
    await assert.rejects(
      () => service.editor('orders', reader, Number(outside.id)),
      /السجل غير موجود/
    )
    await service.transition('orders', Number(record.id), admin, 'submit', 1)
    await assert.rejects(() => service.editor('orders', admin, Number(record.id)), /Only draft/)
  })
  test('unknown form fields and internal columns are rejected', async ({ assert }) => {
    for (const key of ['createdBy', 'deletedAt', 'docStatus', 'password', '__proto__']) {
      await assert.rejects(
        () => service.save('orders', admin, { orgUnitId: 2, notes: 'x', [key]: 1 }),
        /not writable/
      )
    }
  })
  test('no ability returns 403, out-of-scope record returns 404', async ({ assert }) => {
    const record = await service.save('orders', admin, { orgUnitId: 3, notes: 'hidden' })
    const forbidden = await failure(() => service.show('orders', Number(record.id), powerless()))
    assert.instanceOf(forbidden, AdulaError)
    assert.equal(forbidden.status, 403)
    const missing = await failure(() => service.show('orders', Number(record.id), reader))
    assert.equal(missing.status, 404)
  })
  test('forbidden fields and writes to another org fail closed', async ({ assert }) => {
    await assert.rejects(
      () => service.save('orders', reader, { orgUnitId: 2, total: 100 }),
      /Field is forbidden/
    )
    await assert.rejects(
      () => service.save('orders', reader, { orgUnitId: 3, notes: 'x' }),
      /السجل غير موجود/
    )
  })
  test('fields added by a validator are authorized like submitted fields', async ({ assert }) => {
    const defaulting = {
      ...order,
      validator: { validate: async (data: RecordData) => ({ total: 999, ...data }) },
    }
    const { ResourceRegistry } = await import('../index.js')
    const variant = new ResourceRegistry().register([
      {
        name: 'customers',
        label: customerResource.label,
        dependsOn: [],
        resources: [customerResource],
      },
      {
        name: 'orders',
        label: order.label,
        dependsOn: ['customers'],
        resources: [defaulting, line],
      },
    ])
    await assert.rejects(
      () => new ResourceService(db, variant).save('orders', reader, { orgUnitId: 2, notes: 'x' }),
      /Field is forbidden: total/
    )
  })
  test('optimistic lock allows exactly one concurrent writer', async ({ assert }) => {
    const record = await service.save('orders', admin, { orgUnitId: 2, notes: 'original' })
    const results = await Promise.allSettled(
      ['first', 'second'].map((notes) =>
        service.save('orders', admin, { notes, version: 1 }, Number(record.id))
      )
    )
    assert.lengthOf(
      results.filter((r) => r.status === 'fulfilled'),
      1
    )
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    assert.equal(rejected.reason.status, 409)
  })
  test('submission envelope rolls back with the record and shares the durable event ID', async ({
    assert,
  }) => {
    const record = await service.save('orders', admin, { orgUnitId: 2 })
    await assert.rejects(
      () =>
        db.transaction(async (trx) => {
          await service.transition('orders', Number(record.id), admin, 'submit', 1, trx)
          assert.exists(await trx('workflow_runs').where('record_id', Number(record.id)).first())
          throw new Error('rollback submission')
        }),
      /rollback submission/
    )
    const unchanged = await db('orders').where('id', Number(record.id)).first()
    assert.equal(unchanged.doc_status, 0)
    assert.equal(unchanged.version, 1)
    assert.notExists(await db('workflow_runs').where('record_id', Number(record.id)).first())
    await service.transition('orders', Number(record.id), admin, 'submit', 1)
    const envelope = await db('workflow_runs').where('record_id', Number(record.id)).first()
    assert.equal(envelope.status, 'pending_definition')
    assert.equal(envelope.snapshot.eventId, envelope.id)
    assert.exists(
      await db('outbox').where({ id: envelope.id, event: 'orders.orders.submitted' }).first()
    )
    await assert.rejects(
      () => service.transition('orders', Number(record.id), admin, 'submit', 2),
      /Invalid document/
    )
    assert.lengthOf(await db('workflow_runs').where('record_id', Number(record.id)), 1)
  })
  test('failed afterSave hook rolls back entity, activity, outbox and sequence', async ({
    assert,
  }) => {
    const broken = {
      ...order,
      hooks: {
        afterSave: async () => {
          throw new Error('hook failed')
        },
      },
    }
    const modules = registry
      .modules()
      .map((m) => ({ ...m, resources: m.resources.map((r) => (r.name === 'orders' ? broken : r)) }))
    const { ResourceRegistry } = await import('../index.js')
    const failedService = new ResourceService(db, new ResourceRegistry().register(modules))
    const before = await db('outbox').count('* as n').first()
    const seq = await db('sequences').where('key', 'ORD').first()
    await assert.rejects(
      () => failedService.save('orders', admin, { orgUnitId: 2, notes: 'rollback' }),
      /hook failed/
    )
    assert.notExists(await db('orders').where('notes', 'rollback').first())
    assert.deepEqual(await db('outbox').count('* as n').first(), before)
    assert.deepEqual(await db('sequences').where('key', 'ORD').first(), seq)
  })
  test('conditional policy checks original and prospective record', async ({ assert }) => {
    const actor = {
      ...admin,
      rules: [
        { action: ['view', 'create'], subject: 'orders' },
        { action: 'update', subject: 'orders', conditions: { status: 'open' } },
      ],
    }
    const record = await service.save('orders', admin, { orgUnitId: 2, status: 'open' })
    await assert.rejects(
      () => service.save('orders', actor, { status: 'closed', version: 1 }, Number(record.id)),
      /صلاحية/
    )
    const shown = await service.show('orders', Number(record.id), admin)
    assert.equal(shown.data.version, 1)
  })
  test('conditional field denial cannot be bypassed by changing its condition', async ({
    assert,
  }) => {
    const record = await service.save('orders', admin, {
      orgUnitId: 2,
      status: 'closed',
      notes: 'protected',
    })
    const actor = {
      ...admin,
      rules: [
        ...admin.rules,
        {
          action: 'update',
          subject: 'orders',
          fields: ['notes'],
          inverted: true,
          conditions: { status: 'closed' },
        },
      ],
    }
    await assert.rejects(
      () =>
        service.save(
          'orders',
          actor,
          { status: 'open', notes: 'bypass', version: 1 },
          Number(record.id)
        ),
      /Field is forbidden/
    )
  })
  test('soft delete releases partial unique constraint', async ({ assert }) => {
    const record = await service.save('customers', admin, { name: 'شركة الاختبار' })
    await assert.rejects(
      () => service.save('customers', admin, { name: 'شركة الاختبار' }),
      /unique/
    )
    await service.transition('customers', Number(record.id), admin, 'delete')
    const replacement = await service.save('customers', admin, { name: 'شركة الاختبار' })
    assert.notEqual(replacement.id, record.id)
    await assert.rejects(
      () => service.show('customers', Number(record.id), admin),
      /السجل غير موجود/
    )
  })
  test('inline children are atomic, cannot cross org scope, and relation preload is authorized', async ({
    assert,
  }) => {
    const customer = await service.save('customers', admin, { name: 'شركة البنود' })
    const record = await service.save('orders', admin, {
      orgUnitId: 2,
      customerId: customer.id,
      notes: 'with-lines',
      lines: [{ name: 'بند أول' }, { name: 'بند ثان' }],
    })
    assert.lengthOf(await db('order_lines').where('order_id', Number(record.id)), 2)
    const shown = await service.show('orders', Number(record.id), reader)
    assert.equal(shown.related.customerId[0].name, 'شركة البنود')
    await assert.rejects(
      () =>
        service.save('orders', reader, {
          orgUnitId: 2,
          notes: 'failed-lines',
          lines: [{ name: 'not allowed' }],
        }),
      /صلاحية/
    )
    assert.notExists(await db('orders').where('notes', 'failed-lines').first())
  })
  test('keyset pages have no duplicates, accept null values and cap at 100', async ({ assert }) => {
    let cursor: string | undefined
    const ids: unknown[] = []
    const estimates: (number | undefined)[] = []
    do {
      const page = await service.list('orders', admin, { limit: 2, cursor, sort: 'notes' })
      ids.push(...page.data.map((r) => r.id))
      estimates.push(page.meta.estimatedTotal)
      cursor = page.meta.nextCursor ?? undefined
    } while (cursor)
    // Only the first page runs the planner estimate.
    assert.isNumber(estimates[0])
    assert.isTrue(estimates.slice(1).every((estimate) => estimate === undefined))
    assert.equal(new Set(ids).size, ids.length)
    assert.equal(
      ids.length,
      Number((await db('orders').whereNull('deleted_at').count('* as n').first())!.n)
    )
    const capped = await service.list('orders', admin, { limit: 1000 })
    assert.equal(capped.meta.limit, 100)
    assert.isAtLeast(capped.meta.estimatedTotal!, 0)
    const emptyScope = await service.list('orders', { ...reader, orgPaths: [] })
    assert.deepEqual(emptyScope.data, [])
    assert.equal(emptyScope.meta.estimatedTotal, 0)
    await assert.rejects(() => service.list('orders', reader, { sort: 'total' }), /Forbidden sort/)
    await assert.rejects(
      () => service.list('orders', admin, { cursor: 'invalid' }),
      /Invalid cursor/
    )
  })
  test('inline reconciliation updates, inserts and explicitly soft deletes atomically', async ({
    assert,
  }) => {
    const parent = await service.save('orders', admin, {
      orgUnitId: 2,
      notes: 'inline-edit',
      lines: [{ name: 'first' }, { name: 'second' }],
    })
    const [first, second] = await db('order_lines')
      .where('order_id', Number(parent.id))
      .orderBy('id')
    const edited = await service.save(
      'orders',
      admin,
      {
        version: 1,
        lines: [
          { id: first.id, version: first.version, name: 'updated' },
          { id: second.id, version: second.version, _delete: true },
          { name: 'third' },
        ],
      },
      Number(parent.id)
    )
    assert.equal(edited.version, 2)
    const rows = await db('order_lines')
      .where('order_id', Number(parent.id))
      .whereNull('deleted_at')
      .orderBy('id')
    assert.deepEqual(
      rows.map((row) => row.name),
      ['updated', 'third']
    )
    const deleted = await db('order_lines').where('id', second.id).first()
    assert.exists(deleted.deleted_at)
    const before = await db('outbox').count('* as n').first()
    await assert.rejects(
      () =>
        service.save(
          'orders',
          admin,
          {
            version: 2,
            notes: 'rollback-inline',
            lines: [
              { id: first.id, version: rows[0].version, name: 'would-change' },
              { id: rows[1].id, version: 999, name: 'stale' },
            ],
          },
          Number(parent.id)
        ),
      /تم تعديل/
    )
    const unchangedParent = await service.show('orders', Number(parent.id), admin)
    const unchangedLine = await db('order_lines').where('id', first.id).first()
    assert.equal(unchangedParent.data.notes, 'inline-edit')
    assert.equal(unchangedLine.name, 'updated')
    assert.deepEqual(await db('outbox').count('* as n').first(), before)
  })
  test('inline records cannot be stolen, repeated, reparented or changed after submission', async ({
    assert,
  }) => {
    const left = await service.save('orders', admin, { orgUnitId: 2, lines: [{ name: 'owned' }] })
    const right = await service.save('orders', admin, { orgUnitId: 2 })
    const child = await db('order_lines').where('order_id', Number(left.id)).first()
    await assert.rejects(
      () =>
        service.save(
          'orders',
          admin,
          { version: 1, lines: [{ id: child.id, version: 1, name: 'stolen' }] },
          Number(right.id)
        ),
      /السجل غير موجود/
    )
    await assert.rejects(
      () =>
        service.save(
          'orders',
          admin,
          {
            version: 1,
            lines: [
              { id: child.id, version: 1, name: 'a' },
              { id: child.id, version: 2, name: 'b' },
            ],
          },
          Number(left.id)
        ),
      /repeated/
    )
    await assert.rejects(
      () =>
        service.save(
          'order_lines',
          admin,
          { orderId: right.id, name: 'move', version: 1 },
          child.id
        ),
      /cannot be moved/
    )
    await assert.rejects(
      () => service.save('orders', admin, { orgUnitId: 3, version: 1 }, Number(left.id)),
      /organization/
    )
    await service.transition('orders', Number(left.id), admin, 'submit', 1)
    await assert.rejects(
      () => service.save('order_lines', admin, { name: 'bypass', version: 1 }, child.id),
      /Only draft/
    )
    await assert.rejects(
      () => service.transition('order_lines', child.id, admin, 'delete', 1),
      /Only draft/
    )
  })
  test('a create-only parent grant can create inline children but cannot edit them later', async ({
    assert,
  }) => {
    const creator = {
      ...reader,
      rules: [
        { action: ['create', 'view'], subject: 'orders' },
        { action: ['create', 'view', 'update'], subject: 'order_lines' },
      ],
    }
    const parent = await service.save('orders', creator, {
      orgUnitId: 2,
      lines: [{ name: 'created inline' }],
    })
    const child = await db('order_lines').where('order_id', Number(parent.id)).first()
    await assert.rejects(
      () =>
        service.save(
          'order_lines',
          creator,
          { name: 'unauthorized parent edit', version: 1 },
          child.id
        ),
      /صلاحية/
    )
  })
  test('submit locks document, stale cancel conflicts, valid cancel transitions', async ({
    assert,
  }) => {
    const record = await service.save('orders', admin, { orgUnitId: 2, notes: 'approve' })
    const submitted = await service.transition('orders', Number(record.id), admin, 'submit', 1)
    assert.equal(submitted.docStatus, 1)
    await assert.rejects(
      () => service.save('orders', admin, { notes: 'x', version: 2 }, Number(record.id)),
      /Only draft/
    )
    await assert.rejects(
      () => service.transition('orders', Number(record.id), admin, 'cancel', 1),
      /تم تعديل/
    )
    const cancelled = await service.transition('orders', Number(record.id), admin, 'cancel', 2)
    assert.equal(cancelled.docStatus, 2)
  })
  test('outbox crash redelivery and concurrent listeners apply database effects once', async ({
    assert,
  }) => {
    const event = { id: randomUUID(), event: 'orders.orders.created', payload: { id: 1 } }
    let attempts = 0
    const listener = {
      name: 'test.counter',
      event: event.event,
      handle: async (_event: unknown, trx: typeof db) => {
        attempts++
        await trx('settings').insert({ key: 'listener', value: JSON.stringify(true) })
      },
    }
    const consumed = await Promise.all([
      consumeEvent(db, listener, event),
      consumeEvent(db, listener, event),
    ])
    assert.equal(consumed.filter(Boolean).length, 1)
    assert.equal(attempts, 1)
    const published: string[] = []
    const jobs = {
      dispatch: async (_name: string, _data: unknown, options: { id: string }) => {
        published.push(options.id)
      },
    }
    await Promise.all([publishOutbox(db, jobs, 2), publishOutbox(db, jobs, 2)])
    assert.equal(new Set(published).size, published.length)
  })
  test('failed listener rolls back dedup marker so retry remains possible', async ({ assert }) => {
    const event = { id: randomUUID(), event: 'orders.orders.created', payload: {} }
    await assert.rejects(
      () =>
        consumeEvent(
          db,
          {
            name: 'failing',
            event: event.event,
            handle: async () => {
              throw new Error('failed')
            },
          },
          event
        ),
      /failed/
    )
    assert.notExists(await db('processed_events').where('event_id', event.id).first())
  })
})
