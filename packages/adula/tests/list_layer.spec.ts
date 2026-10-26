import { test } from '@japa/runner'
import {
  BulkActions,
  Dashboards,
  EXPORT_ROW_LIMIT,
  ResourceService,
  defineBulkActions,
  defineDashboard,
} from '../index.js'
import type { Actor, RecordData } from '../index.js'
import { ResourceRegistry } from '../index.js'
import { admin, customer, db } from './helpers.js'
import { failure } from './helpers/failure.js'
import { clerk, item, listRegistry, setupListItems } from './helpers/list_items.js'

const service = () => new ResourceService(db, listRegistry)
const viewOnly = (): Actor => clerk({ rules: [{ subject: 'list_items', action: 'view' }] })
const nobody = (): Actor => clerk({ rules: [] })
async function id(title: string) {
  const row = await db('list_items').where({ title }).first('id')
  return Number(row.id)
}
const trashed = [
  { title: 'Trashed A', org_unit_id: 2, deleted_at: db.fn.now() },
  { title: 'Trashed B', org_unit_id: 3, deleted_at: db.fn.now() },
  { title: 'Locked', qty: 99, org_unit_id: 2, deleted_at: db.fn.now() },
]

test.group('Trash and restore (ADR 046)', (group) => {
  group.setup(() => setupListItems(trashed))

  test('the trashed list shows deleted records to actors who may delete them', async ({
    assert,
  }) => {
    const all = await service().list('list_items', admin, { trashed: true, sort: 'title' })
    assert.deepEqual(
      all.data.map((row) => row.title),
      ['Locked', 'Trashed A', 'Trashed B']
    )
    const live = await service().list('list_items', admin, { sort: 'title' })
    assert.notInclude(
      live.data.map((row) => row.title),
      'Trashed A'
    )
    const scoped = await service().list('list_items', clerk(), { trashed: true, sort: 'title' })
    assert.deepEqual(
      scoped.data.map((row) => row.title),
      ['Locked', 'Trashed A']
    )
    const permissions = scoped.permissions[String(scoped.data[1].id)]
    assert.isTrue(permissions.restore)
    assert.isTrue(permissions.view)
    assert.isFalse(permissions.update)
    assert.isFalse(permissions.delete)
    // Only rows the delete rule reaches: this clerk may delete (and restore) qty 99 only.
    const narrow = clerk({
      rules: [
        { subject: 'list_items', action: 'view' },
        { subject: 'list_items', action: 'delete', conditions: { qty: 99 } },
      ],
    })
    const conditioned = await service().list('list_items', narrow, { trashed: true })
    assert.deepEqual(
      conditioned.data.map((row) => row.title),
      ['Locked']
    )
    // Filters and search still apply inside the trash.
    const filtered = await service().list('list_items', admin, {
      trashed: true,
      filters: { qty: { gte: '50' } },
    })
    assert.deepEqual(
      filtered.data.map((row) => row.title),
      ['Locked']
    )
    const refused = await failure(() => service().list('list_items', viewOnly(), { trashed: true }))
    assert.equal(refused.status, 403)
    assert.equal(refused.code, 'E_FORBIDDEN')
    assert.isTrue(service().describe('list_items', clerk()).trash)
    assert.isFalse(service().describe('list_items', viewOnly()).trash)
    assert.isTrue(service().describe('list_items', viewOnly()).exportable)
  })

  test('restore is authorized by the delete rule, its scope and its conditions', async ({
    assert,
  }) => {
    const outside = await failure(async () =>
      service().restore('list_items', await id('Trashed B'), clerk())
    )
    assert.equal(outside.status, 404)
    const live = await failure(async () =>
      service().restore('list_items', await id('Alpha'), admin)
    )
    assert.equal(live.status, 404)
    const missing = await failure(() => service().restore('list_items', 999999, admin))
    assert.equal(missing.status, 404)
    const noDelete = await failure(async () =>
      service().restore('list_items', await id('Trashed A'), viewOnly())
    )
    assert.equal(noDelete.status, 403)
    assert.equal(noDelete.code, 'E_FORBIDDEN')
    const narrow = clerk({
      rules: [
        { subject: 'list_items', action: 'view' },
        { subject: 'list_items', action: 'delete', conditions: { qty: 99 } },
      ],
    })
    const condition = await failure(async () =>
      service().restore('list_items', await id('Trashed A'), narrow)
    )
    assert.equal(condition.status, 403)

    const target = await id('Trashed A')
    const restored = await service().restore('list_items', target, clerk())
    assert.equal(restored.title, 'Trashed A')
    assert.equal(restored.version, 2)
    const row = await db('list_items').where('id', target).first()
    assert.isNull(row.deleted_at)
    assert.equal(Number(row.updated_by), 2)
    const activity = await db('activities')
      .where({ resource: 'list_items', record_id: target })
      .first()
    assert.equal(activity.action, 'restore')
    const event = await db('outbox').where('event', 'lists.list_items.restored').first()
    assert.equal(event.payload.id, target)
    assert.equal(event.payload.actorId, 2)
    const again = await failure(() => service().restore('list_items', target, clerk()))
    assert.equal(again.status, 404)
    assert.equal(
      await service()
        .restore('list_items', await id('Locked'), narrow)
        .then((r) => r.title),
      'Locked'
    )
  })
})

test.group('CSV export (ADR 046)', (group) => {
  group.setup(() => setupListItems(trashed))

  const parse = (content: string) =>
    content
      .replace(/^\uFEFF/, '')
      .split('\r\n')
      .filter(Boolean)
      .map((line) => line.slice(1, -1).split('","'))

  test('exports display values of readable list fields with formula injection guarded', async ({
    assert,
  }) => {
    const file = await service().export('list_items', admin, { sort: 'title' })
    assert.isTrue(file.content.startsWith('\uFEFF'))
    assert.isTrue(file.content.endsWith('\r\n'))
    assert.equal(file.rows, 4)
    assert.equal(file.asciiFilename.slice(0, 11), 'list_items-')
    assert.match(file.filename, /^عناصر القائمة-\d{4}-\d{2}-\d{2}\.csv$/)
    const [header, alpha, beta] = parse(file.content)
    assert.deepEqual(header, [
      'العنوان',
      'ملاحظة',
      'الحالة',
      'الكمية',
      'المبلغ',
      'الاستحقاق',
      'شوهد',
      'نشط',
      'المالك',
      'العميل',
      'سري',
    ])
    assert.deepEqual(alpha, [
      'Alpha',
      '',
      'مفتوح',
      '5',
      '10.00',
      '2026-01-10',
      '2026-01-10T08:00:00.000Z',
      'نعم',
      'مدير النظام',
      `'=HYPERLINK(""x"")`,
      '7',
    ])
    assert.equal(beta[7], 'لا')
    assert.equal(beta[8], 'سارة')
    const audit = await db('activities').where({ resource: 'core.exports' }).first()
    assert.equal(audit.action, 'exported')
    assert.equal(audit.changes.resource, 'list_items')
    assert.equal(audit.changes.rows, 4)
    assert.deepEqual(audit.changes.query, { sort: 'title' })
  })

  test('the export is the actor list: scope, filters and hidden fields', async ({ assert }) => {
    const file = await service().export('list_items', clerk(), {
      filters: { qty: { gte: '1' } },
      sort: 'title',
    })
    const [header, ...rows] = parse(file.content)
    // secret needs permission level 1: the column is left out, not blanked.
    assert.notInclude(header, 'سري')
    assert.lengthOf(header, 10)
    assert.deepEqual(
      rows.map((row) => row[0]),
      ['Alpha', 'Beta', 'Gamma']
    )
    const deleted = await service().export('list_items', admin, { trashed: true })
    assert.equal(deleted.rows, 3)
    const refused = await failure(() => service().export('list_items', nobody()))
    assert.equal(refused.status, 403)
  })

  test('more than EXPORT_ROW_LIMIT rows is 422 E_EXPORT_LIMIT and nothing is audited', async ({
    assert,
  }) => {
    assert.equal(EXPORT_ROW_LIMIT, 5000)
    await db.raw(
      `INSERT INTO list_items (title, org_unit_id, created_by, updated_by, version, qty)
       SELECT 'Mass ' || n, 2, 1, 1, 1, 1000 FROM generate_series(1, ?) AS n`,
      [EXPORT_ROW_LIMIT]
    )
    try {
      const before = await db('activities').where({ resource: 'core.exports' }).count('* as c')
      // An oversized export is refused after one bounded count, not after paging.
      const reads: string[] = []
      const record = (query: { sql: string }) => {
        if (query.sql.includes('list_items')) reads.push(query.sql)
      }
      db.on('query', record)
      const error = await failure(() => service().export('list_items', admin)).finally(() =>
        db.off('query', record)
      )
      assert.lengthOf(reads, 1)
      assert.match(reads[0], /count/i)
      assert.equal(error.status, 422)
      assert.equal(error.code, 'E_EXPORT_LIMIT')
      assert.equal(
        error.message,
        'عدد السجلات المطابقة يتجاوز حد التصدير (5000 سجل). ضيّق التصفية ثم أعد المحاولة.'
      )
      const after = await db('activities').where({ resource: 'core.exports' }).count('* as c')
      assert.deepEqual(after, before)
      // Exactly the limit is allowed.
      const exact = await service().export('list_items', admin, { filters: { qty: '1000' } })
      assert.equal(exact.rows, EXPORT_ROW_LIMIT)
    } finally {
      await db('list_items').where('title', 'like', 'Mass %').del()
    }
  })
})

test.group('Bulk actions (ADR 046)', (group) => {
  group.setup(() => setupListItems(trashed))
  const bulk = () =>
    new BulkActions(listRegistry, service(), [
      defineBulkActions('list_items', [
        {
          key: 'activate',
          label: { ar: 'تفعيل', en: 'Activate' },
          values: { active: true },
          confirm: { ar: 'تفعيل العناصر المحددة؟' },
        },
        { key: 'reveal', label: { ar: 'كشف' }, values: { secret: 1 } },
      ]),
    ])

  test('definitions are validated when declared and when registered', ({ assert }) => {
    assert.throws(
      () =>
        defineBulkActions('list_items', [{ key: 'delete', label: { ar: 'x' }, values: { a: 1 } }]),
      /built-in/
    )
    assert.throws(
      () =>
        defineBulkActions('list_items', [{ key: 'Bad-key', label: { ar: 'x' }, values: { a: 1 } }]),
      /invalid bulk action key/
    )
    assert.throws(
      () => defineBulkActions('list_items', [{ key: 'empty', label: { ar: 'x' }, values: {} }]),
      /at least one field/
    )
    assert.throws(
      () =>
        new BulkActions(listRegistry, service(), [
          defineBulkActions('list_items', [{ key: 'x', label: { ar: 'x' }, values: { nope: 1 } }]),
        ]),
      /not a writable form field/
    )
    assert.throws(
      () =>
        new BulkActions(listRegistry, service(), [
          defineBulkActions('list_items', [{ key: 'x', label: { ar: 'x' }, values: { qty: 'a' } }]),
        ]),
      /list_items\.x\.qty/
    )
  })

  test('available actions follow resource-level permissions', async ({ assert }) => {
    assert.deepEqual(
      bulk()
        .available('list_items', clerk())
        .map((option) => [option.key, option.scope]),
      [
        ['delete', 'records'],
        ['restore', 'trash'],
        ['activate', 'records'],
      ]
    )
    const activate = bulk()
      .available('list_items', admin)
      .find((option) => option.key === 'activate')!
    assert.deepEqual(activate, {
      key: 'activate',
      label: 'تفعيل',
      builtIn: false,
      scope: 'records',
      confirm: 'تفعيل العناصر المحددة؟',
      destructive: false,
    })
    // reveal writes a level-1 field: offered to the administrator only.
    assert.include(
      bulk()
        .available('list_items', admin)
        .map((option) => option.key),
      'reveal'
    )
    assert.deepEqual(bulk().available('list_items', viewOnly()), [])
    const refused = await failure(async () => bulk().available('list_items', nobody()))
    assert.equal(refused.status, 403)
    assert.deepEqual(
      bulk()
        .available('orders', admin)
        .map((option) => option.key),
      ['delete', 'submit', 'cancel', 'restore']
    )
  })

  test('malformed requests are 422 E_BULK and unoffered actions 403', async ({ assert }) => {
    const ids = Array.from({ length: 101 }, (_, index) => index + 1)
    for (const request of [
      { action: 'delete', ids: [] },
      { action: 'delete', ids },
      { action: 'delete', ids: [1, 1] },
      { action: 'delete', ids: ['x'] },
      { action: 'delete', ids: [0] },
      { action: 'delete', ids: '1' },
      { action: 'delete', ids: [1], versions: [1] },
      { action: 'delete', ids: [1], versions: { 1: 'x' } },
      { action: 'explode', ids: [1] },
      { action: 42, ids: [1] },
    ]) {
      const error = await failure(() => bulk().run('list_items', clerk(), request))
      assert.equal(error.status, 422, JSON.stringify(request))
      assert.equal(error.code, 'E_BULK')
    }
    const submit = await failure(() =>
      bulk().run('list_items', clerk(), { action: 'submit', ids: [1] })
    )
    assert.equal(submit.status, 403)
    const viewer = await failure(() =>
      bulk().run('list_items', viewOnly(), { action: 'delete', ids: [1] })
    )
    assert.equal(viewer.status, 403)
  })

  test('each row runs on its own: refused rows fail, others commit', async ({ assert }) => {
    const [alpha, beta, delta] = [await id('Alpha'), await id('Beta'), await id('Delta')]
    const deleted = await bulk().run('list_items', clerk(), {
      action: 'delete',
      ids: [alpha, beta, delta],
      versions: { [alpha]: 1, [beta]: 1, [delta]: 1 },
    })
    assert.deepEqual(deleted.succeeded, [alpha, beta])
    assert.deepEqual(deleted.failed, [
      { id: delta, code: 'E_NOT_FOUND', message: 'السجل غير موجود' },
    ])
    const deletions = await db('activities').where({ resource: 'list_items', action: 'delete' })
    assert.lengthOf(deletions, 2)
    const restored = await bulk().run('list_items', clerk(), {
      action: 'restore',
      ids: [alpha, beta, await id('Trashed B')],
    })
    assert.deepEqual(restored.succeeded, [alpha, beta])
    assert.equal(restored.failed[0].code, 'E_NOT_FOUND')
    // A versioned resource needs each row's version; a stale or missing one fails that row.
    const activated = await bulk().run('list_items', clerk(), {
      action: 'activate',
      ids: [alpha, beta],
      versions: { [beta]: '3' },
    })
    assert.deepEqual(activated.succeeded, [beta])
    assert.deepEqual(activated.failed, [
      {
        id: alpha,
        code: 'E_VERSION_CONFLICT',
        message: 'تم تعديل السجل بواسطة مستخدم آخر. حدّث الصفحة وحاول مجدداً.',
      },
    ])
    const row = await db('list_items').where('id', beta).first()
    assert.isTrue(row.active)
    assert.equal(row.version, 4)
    // The update kept the other stored values (the form is resubmitted as stored).
    assert.equal(row.title, 'Beta')
    assert.equal(row.qty, 10)
    assert.equal(Number(row.owner_id), 2)
    const update = await db('activities')
      .where({ resource: 'list_items', record_id: beta, action: 'update' })
      .first()
    assert.include(update.changes.fields, 'active')
  })
})

test.group('Bulk action row failures and locking (ADR 046)', (group) => {
  group.setup(() => setupListItems())
  // The same table behind a validator that refuses some values like VineJS, or crashes.
  const strict = {
    ...item,
    validator: {
      validate: async (data: RecordData) => {
        if (data.qty === -1)
          throw Object.assign(new Error('Validation failure'), {
            code: 'E_VALIDATION_ERROR',
            messages: [{ field: 'qty', message: 'يجب أن تكون القيمة موجبة' }],
          })
        if (data.qty === -2) throw new Error('validator crashed')
        return data
      },
    },
  }
  const registry = new ResourceRegistry().register([
    { name: 'customers', label: customer.label, dependsOn: [], resources: [customer] },
    { name: 'lists', label: item.label, dependsOn: ['customers'], resources: [strict] },
  ])
  const reported: { error: unknown; context: unknown }[] = []
  const bulk = () =>
    new BulkActions(
      registry,
      new ResourceService(db, registry),
      [
        defineBulkActions('list_items', [
          { key: 'negative', label: { ar: 'سالب' }, values: { qty: -1 } },
          { key: 'crash', label: { ar: 'تعطل' }, values: { qty: -2 } },
          { key: 'activate', label: { ar: 'تفعيل' }, values: { active: true } },
        ]),
      ],
      { report: (error, context) => reported.push({ error, context }) }
    )

  test('validation errors are E_VALIDATION, unexpected errors are reported and generic', async ({
    assert,
  }) => {
    const alpha = await id('Alpha')
    const negative = await bulk().run('list_items', clerk(), {
      action: 'negative',
      ids: [alpha],
      versions: { [alpha]: 1 },
    })
    assert.deepEqual(negative.failed, [
      { id: alpha, code: 'E_VALIDATION', message: 'يجب أن تكون القيمة موجبة' },
    ])
    assert.lengthOf(reported, 0)
    const crash = await bulk().run('list_items', clerk(), {
      action: 'crash',
      ids: [alpha],
      versions: { [alpha]: 1 },
    })
    assert.deepEqual(crash.failed, [
      { id: alpha, code: 'E_BULK_ROW', message: 'تعذر تنفيذ الإجراء على هذا السجل' },
    ])
    assert.lengthOf(reported, 1)
    assert.deepEqual(reported[0].context, { resource: 'list_items', action: 'crash', id: alpha })
  })

  test('a custom action reads and saves under one row lock, keeping concurrent edits', async ({
    assert,
  }) => {
    const beta = await id('Beta')
    const holder = await db.transaction()
    await holder('list_items').where('id', beta).forUpdate()
    const running = bulk().run('list_items', clerk(), {
      action: 'activate',
      ids: [beta],
      versions: { [beta]: 1 },
    })
    await new Promise((resolve) => setTimeout(resolve, 300))
    // Edited while the action waits for the lock; the action must not write it back.
    await holder('list_items').where('id', beta).update({ title: 'Beta edited' })
    await holder.commit()
    const result = await running
    assert.deepEqual(result.succeeded, [beta])
    const row = await db('list_items').where('id', beta).first()
    assert.equal(row.title, 'Beta edited')
    assert.isTrue(row.active)
  })
})

test.group('Dashboards (ADR 046)', (group) => {
  group.setup(() => setupListItems(trashed))
  const overview = defineDashboard({
    name: 'items_overview',
    label: { ar: 'لوحة العناصر', en: 'Items overview' },
    description: { ar: 'وصف' },
    widgets: [
      { key: 'count', label: { ar: 'العدد' }, resource: 'list_items', measure: 'count' },
      {
        key: 'amount',
        label: { ar: 'المبالغ' },
        resource: 'list_items',
        measure: { sum: 'amount' },
      },
      { key: 'secret', label: { ar: 'السري' }, resource: 'list_items', measure: { sum: 'secret' } },
      {
        key: 'byStatus',
        label: { ar: 'حسب الحالة' },
        resource: 'list_items',
        measure: 'count',
        groupBy: 'status',
      },
      {
        key: 'byActive',
        label: { ar: 'حسب النشاط' },
        resource: 'list_items',
        measure: 'count',
        groupBy: 'active',
      },
      {
        key: 'byOwner',
        label: { ar: 'حسب المالك' },
        resource: 'list_items',
        measure: { sum: 'qty' },
        groupBy: 'ownerId',
      },
      {
        key: 'byCustomer',
        label: { ar: 'حسب العميل' },
        resource: 'list_items',
        measure: 'count',
        groupBy: 'customerId',
        filters: { qty: { lte: '10' } },
      },
      {
        key: 'orders',
        label: { ar: 'الطلبات' },
        resource: 'orders',
        measure: 'count',
        groupBy: 'docStatus',
      },
    ],
  })
  const secretFilter = defineDashboard({
    name: 'secret_filter',
    label: { ar: 'تصفية سرية' },
    widgets: [
      { key: 'count', label: { ar: 'العدد' }, resource: 'list_items', measure: 'count' },
      {
        key: 'filtered',
        label: { ar: 'المصفى' },
        resource: 'list_items',
        measure: 'count',
        filters: { secret: { gte: '1' } },
      },
      {
        key: 'conditioned',
        label: { ar: 'المشروط' },
        resource: 'list_items',
        measure: 'count',
        where: { secret: { $gt: 0 } },
      },
    ],
  })
  const secretOnly = defineDashboard({
    name: 'secrets',
    label: { ar: 'الأسرار' },
    widgets: [
      { key: 'secret', label: { ar: 'السري' }, resource: 'list_items', measure: { sum: 'secret' } },
    ],
  })
  const dashboards = () =>
    new Dashboards(db, listRegistry, service(), [overview, secretOnly, secretFilter])

  test('definitions are validated', ({ assert }) => {
    const widget = {
      key: 'a',
      label: { ar: 'أ' },
      resource: 'list_items',
      measure: 'count' as const,
    }
    assert.throws(
      () => defineDashboard({ name: 'Bad', label: { ar: 'x' }, widgets: [widget] }),
      /name/
    )
    assert.throws(() => defineDashboard({ name: 'ok', label: { ar: 'x' }, widgets: [] }), /widget/)
    assert.throws(
      () => defineDashboard({ name: 'ok', label: { ar: 'x' }, widgets: [widget, widget] }),
      /duplicate/
    )
    assert.throws(
      () =>
        defineDashboard({
          name: 'ok',
          label: { ar: 'x' },
          widgets: [{ ...widget, measure: { avg: 'qty' } as never }],
        }),
      /measure/
    )
    const sumTitle = defineDashboard({
      name: 'ok',
      label: { ar: 'x' },
      widgets: [{ ...widget, measure: { sum: 'title' } }],
    })
    assert.throws(() => new Dashboards(db, listRegistry, service(), [sumTitle]), /integer or money/)
    const unknown = defineDashboard({
      name: 'ok',
      label: { ar: 'x' },
      widgets: [{ ...widget, resource: 'nothing' }],
    })
    assert.throws(() => new Dashboards(db, listRegistry, service(), [unknown]))
    const badFilter = defineDashboard({
      name: 'ok',
      label: { ar: 'x' },
      widgets: [{ ...widget, filters: { nothing: 1 } }],
    })
    assert.throws(() => Dashboards.validate(listRegistry, [badFilter]), /not a filterable field/)
    const badWhere = defineDashboard({
      name: 'ok',
      label: { ar: 'x' },
      widgets: [{ ...widget, where: { nothing: 1 } }],
    })
    assert.throws(() => Dashboards.validate(listRegistry, [badWhere]), /cannot be a condition/)
    assert.throws(
      () => new Dashboards(db, listRegistry, service(), [overview, overview]),
      /Duplicate/
    )
  })

  test('widgets are computed as the viewer with display labels', async ({ assert }) => {
    const result = await dashboards().render('items_overview', admin)
    assert.equal(result.label, 'لوحة العناصر')
    assert.equal(result.description, 'وصف')
    const widget = (key: string) => result.widgets.find((entry) => entry.key === key)!
    assert.deepInclude(widget('count'), { kind: 'total', value: 4, format: 'count' })
    assert.deepInclude(widget('amount'), { kind: 'total', value: '3500', format: 'money' })
    assert.deepInclude(widget('secret'), { value: '7', format: 'integer' })
    assert.deepEqual(widget('byStatus').rows, [
      { value: 'closed', label: 'مغلق', measure: 1 },
      { value: 'open', label: 'مفتوح', measure: 2 },
      { value: null, label: 'غير محدد', measure: 1 },
    ])
    assert.deepEqual(widget('byActive').rows, [
      { value: false, label: 'لا', measure: 1 },
      { value: true, label: 'نعم', measure: 1 },
      { value: null, label: 'غير محدد', measure: 2 },
    ])
    assert.deepEqual(widget('byOwner').rows, [
      { value: 1, label: 'مدير النظام', measure: '5' },
      { value: 2, label: 'سارة', measure: '10' },
      { value: null, label: 'غير محدد', measure: '15' },
    ])
    assert.deepEqual(widget('byCustomer').rows, [
      { value: 1, label: '=HYPERLINK("x")', measure: 1 },
      { value: null, label: 'غير محدد', measure: 1 },
    ])
    assert.equal(widget('byCustomer').href, '/resources/list_items')
    assert.deepEqual(widget('orders').rows, [])
  })

  test('hidden widgets are omitted and fully hidden dashboards do not exist', async ({
    assert,
  }) => {
    const result = await dashboards().render('items_overview', clerk())
    const keys = result.widgets.map((widget) => widget.key)
    // secret needs level 1 and orders are not viewable by the clerk.
    assert.notInclude(keys, 'secret')
    assert.notInclude(keys, 'orders')
    assert.deepInclude(result.widgets[0], { key: 'count', value: 3 })
    assert.deepEqual(
      dashboards()
        .list(clerk())
        .map((entry) => entry.name),
      ['items_overview', 'secret_filter']
    )
    assert.deepEqual(
      dashboards()
        .list(admin)
        .map((entry) => entry.name),
      ['items_overview', 'secrets', 'secret_filter']
    )
    assert.deepEqual(dashboards().list(nobody()), [])
    const secrets = await failure(() => dashboards().render('secrets', clerk()))
    assert.equal(secrets.status, 404)
    const none = await failure(() => dashboards().render('items_overview', nobody()))
    assert.equal(none.status, 404)
    // Filters or conditions on a field the viewer may not query omit the widget only.
    const filtered = await dashboards().render('secret_filter', clerk())
    assert.deepEqual(
      filtered.widgets.map((widget) => widget.key),
      ['count']
    )
    const full = await dashboards().render('secret_filter', admin)
    assert.deepEqual(
      full.widgets.map((widget) => [widget.key, widget.value]),
      [
        ['count', 4],
        ['filtered', 1],
        ['conditioned', 1],
      ]
    )
    const unknown = await failure(() => dashboards().render('constructor', admin))
    assert.equal(unknown.status, 404)
    assert.equal(unknown.message, 'لوحة المؤشرات غير موجودة')
  })
})
