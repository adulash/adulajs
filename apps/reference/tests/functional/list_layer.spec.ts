import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import User from '#models/user'
import { adula } from '#services/adula'
import { seedActor, type UiActor } from '#tests/helpers/ui_fixtures'
import { insertProbes, installProbes, resetProbes } from '#tests/helpers/list_probes'

/**
 * ADR 046 list layer over real HTTP and PostgreSQL: filter operators, server export,
 * bulk actions, restore and «المحذوفات», dashboards. Authorization is the stored role
 * rules of seeded users, never a mock.
 */
const json = { Accept: 'application/json' }
const html = { Accept: 'text/html' }
const knex = () => db.connection().getWriteClient()
const arabic = /[؀-ۿ]/
const EXPORT_LIMIT_MESSAGE =
  'عدد السجلات المطابقة يتجاوز حد التصدير (5000 سجل). ضيّق التصفية ثم أعد المحاولة.'

type Rule = { subject: string; action: string; conditions?: Record<string, unknown> }

/** A user with one role (rules may carry conditions) and membership of one unit. */
async function actorWith(rules: Rule[], options: { level?: number; orgUnitId?: number } = {}) {
  const actor = await seedActor([{ subject: 'none', action: 'view' }], options)
  await knex()('role_rules').where('role_id', actor.roleId).del()
  await knex()('role_rules').insert(
    rules.map((rule) => ({
      role_id: actor.roleId,
      subject: rule.subject,
      action: rule.action,
      ...(rule.conditions ? { conditions: JSON.stringify(rule.conditions) } : {}),
    }))
  )
  return actor
}

async function bearer(user: User, abilities = ['read']) {
  const token = await User.accessTokens.create(user, abilities, {
    name: 'قائمة',
    expiresIn: '30 days',
  })
  return token.value!.release()
}

const titles = (body: { data: { title: string }[] }) => body.data.map((row) => row.title).sort()

/** The four base probes: three in the actor's unit, Delta in another unit. */
async function seedBase(userId: number, unitA: number, unitB: number) {
  const [alpha, beta, gamma, delta] = await insertProbes(userId, [
    {
      title: 'Alpha',
      note: null,
      status: 'open',
      qty: 5,
      amount: '100000',
      due: '2026-01-10',
      secret: 7,
      internal: 'سر ألفا',
      org_unit_id: unitA,
    },
    {
      title: 'Beta',
      note: '',
      status: 'closed',
      qty: 10,
      amount: '250000',
      due: '2026-02-01',
      org_unit_id: unitA,
    },
    { title: 'Gamma', note: 'ن', status: 'open', qty: 15, due: '2026-03-01', org_unit_id: unitA },
    { title: 'Delta', note: 'د', status: 'open', qty: 12, org_unit_id: unitB },
  ])
  return { alpha, beta, gamma, delta }
}

test.group('List layer: filter operators', (group) => {
  let manager: UiActor
  let clerk: UiActor
  let outsider: UiActor
  let managerToken: string
  let clerkToken: string
  group.setup(async () => {
    const remove = await installProbes()
    manager = await seedActor([{ subject: 'all', action: 'manage' }], { level: 1 })
    clerk = await actorWith(
      [
        { subject: 'list_probes', action: 'view' },
        { subject: 'list_probes', action: 'update' },
      ],
      { level: 0, orgUnitId: manager.orgUnitId }
    )
    outsider = await seedActor([{ subject: 'all', action: 'manage' }], { level: 1 })
    managerToken = await bearer(manager.user)
    clerkToken = await bearer(clerk.user)
    await seedBase(manager.user.id, manager.orgUnitId, outsider.orgUnitId)
    return remove
  })
  group.each.setup(async () => {
    await knex()('saved_views').where('resource', 'list_probes').del()
  })

  const routes = [
    { label: 'session', base: '/resources/list_probes', api: false },
    { label: 'bearer', base: '/api/v1/resources/list_probes', api: true },
  ]
  for (const route of routes) {
    const get = (
      client: any,
      who: () => { user: User; token: string },
      qs: Record<string, unknown> | string
    ) => {
      const request =
        typeof qs === 'string'
          ? client.get(`${route.base}?${qs}`).headers(json)
          : client.get(route.base).qs(qs).headers(json)
      const { user, token } = who()
      return route.api ? request.header('Authorization', `Bearer ${token}`) : request.loginAs(user)
    }
    const asManager = () => ({ user: manager.user, token: managerToken })
    const asClerk = () => ({ user: clerk.user, token: clerkToken })

    test(`${route.label}: in, gte/lte and empty narrow the list`, async ({ client, assert }) => {
      const cases: [Record<string, unknown> | string, string[]][] = [
        [{}, ['Alpha', 'Beta', 'Gamma']],
        ['filters[status][in]=open,closed', ['Alpha', 'Beta', 'Gamma']],
        ['filters[status][in]=closed', ['Beta']],
        ['filters[status][in][]=open&filters[status][in][]=missing', ['Alpha', 'Gamma']],
        [{ filters: { qty: { gte: 10, lte: 15 } } }, ['Beta', 'Gamma']],
        [{ filters: { qty: { lte: 5 } } }, ['Alpha']],
        [{ filters: { amount: { gte: '100000', lte: '200000' } } }, ['Alpha']],
        [{ filters: { amount: { gte: '200000' } } }, ['Beta']],
        [{ filters: { due: { gte: '2026-01-15' } } }, ['Beta', 'Gamma']],
        [{ filters: { due: { gte: '2026-01-10', lte: '2026-02-01' } } }, ['Alpha', 'Beta']],
        [{ filters: { note: { empty: 'true' } } }, ['Alpha', 'Beta']],
        [{ filters: { note: { empty: 'false' } } }, ['Gamma']],
        [{ filters: { amount: { empty: 'true' } } }, ['Gamma']],
        [{ filters: { status: { in: 'open' }, qty: { gte: 10 } } }, ['Gamma']],
      ]
      for (const [qs, expected] of cases) {
        const response = await get(client, asManager, qs)
        response.assertStatus(200)
        assert.deepEqual(titles(response.body()), expected, JSON.stringify(qs))
      }
    })

    test(`${route.label}: an invalid operand or operator is 422 E_FILTER`, async ({
      client,
      assert,
    }) => {
      const many = Array.from({ length: 51 }, (_, index) => `v${index}`).join(',')
      for (const qs of [
        { filters: { qty: { gte: 'abc' } } },
        { filters: { qty: { lte: '1.5' } } },
        { filters: { amount: { gte: '12.50' } } },
        { filters: { due: { gte: '2026-13-45' } } },
        { filters: { due: { lte: 'yesterday' } } },
        { filters: { note: { empty: 'maybe' } } },
        { filters: { qty: { like: '1' } } },
        { filters: { qty: { in: '5', gte: '1' } } },
        { filters: { status: { gte: 'open' } } },
        { filters: { qty: { in: 'x,y' } } },
        `filters[status][in]=${many}`,
      ]) {
        const response = await get(client, asManager, qs)
        response.assertStatus(422)
        assert.equal(response.body().error.code, 'E_FILTER', JSON.stringify(qs))
      }
    })

    test(`${route.label}: an operator on a field the actor cannot query is refused`, async ({
      client,
      assert,
    }) => {
      const allowed = await get(client, asManager, { filters: { secret: { gte: 1 } } })
      allowed.assertStatus(200)
      assert.deepEqual(titles(allowed.body()), ['Alpha'])
      for (const filters of [{ secret: { gte: 1 } }, { secret: { empty: 'true' } }]) {
        const refused = await get(client, asClerk, { filters })
        refused.assertStatus(422)
        assert.equal(refused.body().error.code, 'E_FILTER')
      }
      // The clerk's own rows stay readable without the private field.
      const own = await get(client, asClerk, { filters: { qty: { gte: 1 } } })
      own.assertStatus(200)
      assert.notProperty(own.body().data[0], 'secret')
    })
  }

  test('a saved view stores operator filters and the list re-applies them', async ({
    client,
    assert,
  }) => {
    const query = {
      sort: 'qty',
      direction: 'desc',
      filters: { status: { in: ['open', 'closed'] }, qty: { gte: '10', lte: '15' } },
    }
    const saved = await client
      .post('/resources/list_probes/views')
      .loginAs(clerk.user)
      .withCsrfToken()
      .headers(json)
      .json({ name: 'المتوسطة', query })
    saved.assertStatus(200)
    const page = await client
      .get('/resources/list_probes')
      .loginAs(clerk.user)
      .headers(html)
      .withInertia()
    page.assertStatus(200)
    const views = page.body().props.view.savedViews
    assert.lengthOf(views, 1)
    assert.deepEqual(views[0].query, query)
    const applied = await client
      .get('/resources/list_probes')
      .qs(views[0].query)
      .loginAs(clerk.user)
      .headers(json)
    applied.assertStatus(200)
    assert.deepEqual(
      applied.body().data.map((row: { title: string }) => row.title),
      ['Gamma', 'Beta']
    )

    const invalid = await client
      .post('/resources/list_probes/views')
      .loginAs(clerk.user)
      .withCsrfToken()
      .headers(json)
      .json({ name: 'خاطئ', query: { filters: { qty: { gte: 'abc' } } } })
    invalid.assertStatus(422)
    assert.equal(invalid.body().error.code, 'E_VIEW_QUERY')
    const forbidden = await client
      .post('/resources/list_probes/views')
      .loginAs(clerk.user)
      .withCsrfToken()
      .headers(json)
      .json({ name: 'سري', query: { filters: { secret: { gte: 1 } } } })
    forbidden.assertStatus(403)
    assert.equal(forbidden.body().error.code, 'E_FIELD_FORBIDDEN')
    const rows = await knex()('saved_views').where('resource', 'list_probes').count('* as count')
    assert.equal(rows[0].count, '1')
  })
})

test.group('List layer: server export', (group) => {
  let manager: UiActor
  let clerk: UiActor
  let outsider: UiActor
  let managerToken: string
  group.setup(async () => {
    const remove = await installProbes()
    manager = await seedActor([{ subject: 'all', action: 'manage' }], { level: 1 })
    clerk = await actorWith([{ subject: 'list_probes', action: 'view' }], {
      level: 0,
      orgUnitId: manager.orgUnitId,
    })
    outsider = await seedActor([{ subject: 'all', action: 'manage' }], { level: 1 })
    managerToken = await bearer(manager.user)
    return remove
  })
  group.each.setup(async () => {
    await resetProbes()
    await knex()('activities').where('resource', 'core.exports').del()
    await seedBase(manager.user.id, manager.orgUnitId, outsider.orgUnitId)
    // 150 rows in the actor's unit and 20 elsewhere: more than one list page of 100.
    await knex().raw(
      `INSERT INTO list_probes (title, qty, status, org_unit_id, created_by, updated_by)
       SELECT 'Bulk ' || g, 1000 + g, 'open', ?, ?, ? FROM generate_series(1, 150) g`,
      [manager.orgUnitId, manager.user.id, manager.user.id]
    )
    await knex().raw(
      `INSERT INTO list_probes (title, qty, status, org_unit_id, created_by, updated_by)
       SELECT 'Foreign ' || g, 1000 + g, 'open', ?, ?, ? FROM generate_series(1, 20) g`,
      [outsider.orgUnitId, manager.user.id, manager.user.id]
    )
    // A deleted row is never exported from the live list.
    await insertProbes(manager.user.id, [
      { title: 'Deleted bulk', qty: 1500, org_unit_id: manager.orgUnitId, deleted_at: new Date() },
    ])
  })

  const parse = (text: string) => {
    ensure(text.startsWith('﻿'), 'CSV starts with a byte order mark')
    ensure(text.endsWith('\r\n'), 'CSV ends with CRLF')
    return text
      .slice(1)
      .split('\r\n')
      .filter(Boolean)
      .map((line) => line.split(',').map((cell) => cell.replace(/^"|"$/g, '')))
  }
  function ensure(condition: boolean, message: string) {
    if (!condition) throw new Error(message)
  }

  test('exports the whole filtered set beyond one page as CSV with headers and an audit entry', async ({
    client,
    assert,
  }) => {
    const response = await client
      .get('/resources/list_probes/export')
      .qs({ filters: { qty: { gte: 1000 } }, sort: 'qty', direction: 'asc' })
      .loginAs(manager.user)
      .headers(json)
    response.assertStatus(200)
    assert.match(response.header('content-type') ?? '', /^text\/csv; charset=utf-8/)
    const day = new Date().toISOString().slice(0, 10)
    const disposition = response.header('content-disposition')
    assert.include(disposition, `attachment; filename="list_probes-${day}.csv"`)
    assert.include(
      disposition,
      `filename*=UTF-8''${encodeURIComponent(`عينات القائمة-${day}.csv`)}`
    )
    assert.equal(response.header('cache-control'), 'no-store')
    const lines = parse(response.text())
    assert.deepEqual(lines[0], [
      'العنوان',
      'ملاحظة',
      'الحالة',
      'الكمية',
      'المبلغ',
      'الاستحقاق',
      'سري',
      'داخلي',
    ])
    const rows = lines.slice(1)
    assert.lengthOf(rows, 150)
    assert.deepEqual(rows[0].slice(0, 4), ['Bulk 1', '', 'مفتوحة', '1001'])
    assert.equal(rows[149][0], 'Bulk 150')
    assert.isFalse(rows.some((row) => /Foreign|Deleted/.test(row[0])))

    const [entry] = await knex()('activities')
      .where({ resource: 'core.exports', action: 'exported', actor_id: manager.user.id })
      .orderBy('id', 'desc')
    assert.exists(entry)
    const changes = typeof entry.changes === 'string' ? JSON.parse(entry.changes) : entry.changes
    assert.equal(changes.resource, 'list_probes')
    assert.equal(changes.rows, 150)
    assert.deepEqual(changes.query.filters, { qty: { gte: '1000' } })
  }).timeout(60000)

  test('display values: lookup labels, money as a decimal amount and ISO dates', async ({
    client,
    assert,
  }) => {
    const response = await client
      .get('/api/v1/resources/list_probes/export')
      .qs({ filters: { qty: { lte: 20 } }, sort: 'qty' })
      .header('Authorization', `Bearer ${managerToken}`)
    response.assertStatus(200)
    const lines = parse(response.text())
    assert.deepEqual(lines.slice(1), [
      ['Alpha', '', 'مفتوحة', '5', '1000.00', '2026-01-10', '7', 'سر ألفا'],
      ['Beta', '', 'مغلقة', '10', '2500.00', '2026-02-01', '', ''],
      ['Gamma', 'ن', 'مفتوحة', '15', '', '2026-03-01', '', ''],
    ])
  })

  test('hidden and higher-level fields are omitted for a low-level actor', async ({
    client,
    assert,
  }) => {
    const response = await client
      .get('/resources/list_probes/export')
      .qs({ filters: { qty: { lte: 20 } }, sort: 'qty' })
      .loginAs(clerk.user)
      .headers(json)
    response.assertStatus(200)
    const lines = parse(response.text())
    assert.deepEqual(lines[0], ['العنوان', 'ملاحظة', 'الحالة', 'الكمية', 'المبلغ', 'الاستحقاق'])
    assert.notInclude(response.text(), 'سر ألفا')
    assert.lengthOf(lines, 4)

    // The reference orders: total has permissionLevel 1.
    const creator = await adula().actors.load(manager.user.id)
    await adula().resources.save('orders', creator, {
      notes: 'طلب التصدير',
      total: '150000',
      orgUnitId: manager.orgUnitId,
    })
    const reader = await actorWith([{ subject: 'orders', action: 'view' }], {
      level: 0,
      orgUnitId: manager.orgUnitId,
    })
    const low = await client.get('/resources/orders/export').loginAs(reader.user).headers(json)
    low.assertStatus(200)
    const lowLines = parse(low.text())
    assert.notInclude(lowLines[0], 'الإجمالي')
    assert.lengthOf(lowLines, 2)
    assert.notInclude(low.text(), '1500.00')
    const high = await client.get('/resources/orders/export').loginAs(manager.user).headers(json)
    high.assertStatus(200)
    const highLines = parse(high.text())
    const column = highLines[0].indexOf('الإجمالي')
    assert.isAtLeast(column, 0)
    assert.equal(highLines[1][column], '1500.00')
  })

  test('more than 5000 matching rows is 422 E_EXPORT_LIMIT and nothing is audited', async ({
    client,
    assert,
  }) => {
    await knex().raw(
      `INSERT INTO list_probes (title, qty, org_unit_id, created_by, updated_by)
       SELECT 'Many ' || g, 9, ?, ?, ? FROM generate_series(1, 5001) g`,
      [manager.orgUnitId, manager.user.id, manager.user.id]
    )
    const response = await client
      .get('/resources/list_probes/export')
      .qs({ filters: { qty: { in: '9' } } })
      .loginAs(manager.user)
      .headers(json)
    response.assertStatus(422)
    assert.deepEqual(response.body().error, {
      code: 'E_EXPORT_LIMIT',
      message: EXPORT_LIMIT_MESSAGE,
    })
    const entries = await knex()('activities').where('resource', 'core.exports').count('* as count')
    assert.equal(entries[0].count, '0')
    // Narrowing the filter brings it back under the limit.
    const narrowed = await client
      .get('/resources/list_probes/export')
      .qs({ filters: { qty: { in: '9' }, title: 'Many 42' } })
      .loginAs(manager.user)
      .headers(json)
    narrowed.assertStatus(200)
    assert.include(narrowed.text(), '"Many 42"')
  }).timeout(120000)

  test('an invalid filter is 422 E_FILTER and an actor without view is 403', async ({
    client,
    assert,
  }) => {
    const invalid = await client
      .get('/resources/list_probes/export')
      .qs({ filters: { qty: { gte: 'abc' } } })
      .loginAs(manager.user)
      .headers(json)
    invalid.assertStatus(422)
    assert.equal(invalid.body().error.code, 'E_FILTER')
    const stranger = await actorWith([{ subject: 'tasks', action: 'view' }], {
      orgUnitId: manager.orgUnitId,
    })
    const refused = await client
      .get('/resources/list_probes/export')
      .loginAs(stranger.user)
      .headers(json)
    refused.assertStatus(403)
    assert.equal(refused.body().error.code, 'E_FORBIDDEN')
  })
})

test.group('List layer: bulk actions', (group) => {
  let manager: UiActor
  let clerk: UiActor
  let viewer: UiActor
  let outsider: UiActor
  let ids: Awaited<ReturnType<typeof seedBase>>
  group.setup(async () => {
    const remove = await installProbes()
    manager = await seedActor([{ subject: 'all', action: 'manage' }], { level: 1 })
    // The clerk may delete open probes only.
    clerk = await actorWith(
      [
        { subject: 'list_probes', action: 'view' },
        { subject: 'list_probes', action: 'delete', conditions: { status: 'open' } },
        { subject: 'tasks', action: 'view' },
      ],
      { level: 0, orgUnitId: manager.orgUnitId }
    )
    viewer = await actorWith(
      [
        { subject: 'list_probes', action: 'view' },
        { subject: 'tasks', action: 'view' },
      ],
      { level: 0, orgUnitId: manager.orgUnitId }
    )
    outsider = await seedActor([{ subject: 'all', action: 'manage' }], { level: 1 })
    return remove
  })
  group.each.setup(async () => {
    await resetProbes()
    ids = await seedBase(manager.user.id, manager.orgUnitId, outsider.orgUnitId)
  })

  const options = async (client: any, user: User, resource: string) => {
    const response = await client.get(`/resources/${resource}/bulk`).loginAs(user).headers(json)
    response.assertStatus(200)
    return response.body().data as { key: string; scope: string; builtIn: boolean }[]
  }
  const run = (client: any, user: User, resource: string, body: Record<string, unknown>) =>
    client
      .post(`/resources/${resource}/bulk`)
      .loginAs(user)
      .withCsrfToken()
      .headers(json)
      .json(body)

  test('GET lists the actions each actor may offer', async ({ client, assert }) => {
    const keys = async (user: User, resource: string) => {
      const offered = await options(client, user, resource)
      return offered.map((option) => option.key)
    }
    assert.deepEqual(await keys(manager.user, 'list_probes'), ['delete', 'restore'])
    assert.deepEqual(await keys(clerk.user, 'list_probes'), ['delete', 'restore'])
    assert.deepEqual(await keys(viewer.user, 'list_probes'), [])
    assert.deepEqual(await keys(manager.user, 'orders'), ['delete', 'submit', 'cancel', 'restore'])
    assert.deepEqual(await keys(manager.user, 'tasks'), ['delete', 'restore', 'markDone'])
    assert.deepEqual(await keys(viewer.user, 'tasks'), [])
    const all = await options(client, manager.user, 'tasks')
    const markDone = all.find((option) => option.key === 'markDone')!
    assert.deepInclude(markDone, {
      label: 'تعليم كمنجزة',
      builtIn: false,
      scope: 'records',
      confirm: 'تعليم المهام المحددة كمنجزة؟',
    })
    assert.equal(all.find((option) => option.key === 'restore')!.scope, 'trash')
    const stranger = await actorWith([{ subject: 'tasks', action: 'view' }], {
      orgUnitId: manager.orgUnitId,
    })
    const refused = await client
      .get('/resources/list_probes/bulk')
      .loginAs(stranger.user)
      .headers(json)
    refused.assertStatus(403)
    const anonymous = await client.get('/resources/list_probes/bulk').headers(json)
    anonymous.assertStatus(401)
  })

  test('bulk delete succeeds per row: scope, rule conditions and stale versions fail alone', async ({
    client,
    assert,
  }) => {
    const response = await run(client, clerk.user, 'list_probes', {
      action: 'delete',
      ids: [ids.alpha, ids.beta, ids.gamma, ids.delta],
      versions: { [ids.alpha]: 1, [ids.beta]: 1, [ids.gamma]: 7, [ids.delta]: 1 },
    })
    response.assertStatus(200)
    const { succeeded, failed } = response.body().data
    assert.deepEqual(succeeded, [ids.alpha])
    const byId = Object.fromEntries(
      failed.map((row: { id: number; code: string; message: string }) => [row.id, row])
    )
    assert.equal(byId[ids.beta].code, 'E_FORBIDDEN')
    assert.equal(byId[ids.gamma].code, 'E_VERSION_CONFLICT')
    assert.equal(byId[ids.delta].code, 'E_NOT_FOUND')
    for (const row of failed) assert.match(row.message, arabic, row.code)
    assert.lengthOf(failed, 3)

    const rows = await knex()('list_probes').orderBy('id').select('id', 'deleted_at')
    const deleted = rows.filter((row) => row.deleted_at !== null).map((row) => row.id)
    assert.deepEqual(deleted, [ids.alpha])
    const activity = await knex()('activities')
      .where({ resource: 'list_probes', action: 'delete' })
      .select('record_id', 'actor_id')
    assert.deepEqual(activity, [{ record_id: ids.alpha, actor_id: clerk.user.id }])
  })

  test('whole-request errors: unknown action, too many or duplicate ids, actions not offered', async ({
    client,
    assert,
  }) => {
    const tooMany = Array.from({ length: 101 }, (_, index) => index + 1)
    for (const body of [
      { action: 'delete', ids: tooMany },
      { action: 'delete', ids: [] },
      { action: 'delete', ids: [ids.alpha, ids.alpha] },
      { action: 'delete', ids: [0] },
      { action: 'delete', ids: 'all' },
      { action: 'explode', ids: [ids.alpha] },
      { action: 'delete', ids: [ids.alpha], versions: [1] },
    ]) {
      const response = await run(client, manager.user, 'list_probes', body)
      response.assertStatus(422)
      assert.equal(response.body().error.code, 'E_BULK', JSON.stringify(body).slice(0, 80))
      assert.match(response.body().error.message, arabic)
    }
    const notOffered = await run(client, viewer.user, 'list_probes', {
      action: 'delete',
      ids: [ids.alpha],
    })
    notOffered.assertStatus(403)
    assert.equal(notOffered.body().error.code, 'E_FORBIDDEN')
    const submitless = await run(client, manager.user, 'list_probes', {
      action: 'submit',
      ids: [ids.alpha],
    })
    submitless.assertStatus(403)
    const live = await knex()('list_probes').whereNotNull('deleted_at').count('* as count')
    assert.equal(live[0].count, '0')
  })

  test('bulk restore brings deleted rows back and refuses live ones', async ({
    client,
    assert,
  }) => {
    const removed = await run(client, manager.user, 'list_probes', {
      action: 'delete',
      ids: [ids.alpha, ids.beta],
      versions: { [ids.alpha]: 1, [ids.beta]: 1 },
    })
    removed.assertStatus(200)
    assert.deepEqual(removed.body().data.succeeded, [ids.alpha, ids.beta])
    const restored = await run(client, manager.user, 'list_probes', {
      action: 'restore',
      ids: [ids.alpha, ids.beta, ids.gamma],
    })
    restored.assertStatus(200)
    assert.deepEqual(restored.body().data.succeeded, [ids.alpha, ids.beta])
    assert.deepEqual(
      restored.body().data.failed.map((row: { id: number; code: string }) => [row.id, row.code]),
      [[ids.gamma, 'E_NOT_FOUND']]
    )
    const deleted = await knex()('list_probes').whereNotNull('deleted_at').count('* as count')
    assert.equal(deleted[0].count, '0')
    const activity = await knex()('activities')
      .where({ resource: 'list_probes', action: 'restore' })
      .orderBy('record_id')
      .pluck('record_id')
    assert.deepEqual(activity, [ids.alpha, ids.beta])
  })

  test('custom tasks markDone updates every selected task through the ordinary save', async ({
    client,
    assert,
  }) => {
    const creator = await adula().actors.load(manager.user.id)
    const created = []
    for (const title of ['مهمة أولى', 'مهمة ثانية'])
      created.push(
        await adula().resources.save('tasks', creator, {
          title,
          done: false,
          orgUnitId: manager.orgUnitId,
        })
      )
    const foreign = await adula().resources.save(
      'tasks',
      await adula().actors.load(outsider.user.id),
      {
        title: 'مهمة خارجية',
        done: false,
        orgUnitId: outsider.orgUnitId,
      }
    )
    const taskIds = created.map((task) => Number(task.id))
    const response = await run(client, manager.user, 'tasks', {
      action: 'markDone',
      ids: [...taskIds, Number(foreign.id)],
    })
    response.assertStatus(200)
    assert.deepEqual(response.body().data.succeeded, taskIds)
    assert.deepEqual(
      response.body().data.failed.map((row: { id: number; code: string }) => [row.id, row.code]),
      [[Number(foreign.id), 'E_NOT_FOUND']]
    )
    const rows = await knex()('tasks')
      .whereIn('id', [...taskIds, Number(foreign.id)])
      .orderBy('id')
      .select('id', 'done', 'title')
    assert.deepEqual(
      rows.map((row) => [row.title, row.done]),
      [
        ['مهمة أولى', true],
        ['مهمة ثانية', true],
        ['مهمة خارجية', false],
      ]
    )
    const updates = await knex()('activities')
      .where({ resource: 'tasks', action: 'update', actor_id: manager.user.id })
      .whereIn('record_id', taskIds)
      .count('* as count')
    assert.equal(updates[0].count, '2')
    const refused = await run(client, clerk.user, 'tasks', { action: 'markDone', ids: taskIds })
    refused.assertStatus(403)
  })
})

test.group('List layer: restore and «المحذوفات»', (group) => {
  let manager: UiActor
  let clerk: UiActor
  let viewer: UiActor
  let outsider: UiActor
  let ids: Awaited<ReturnType<typeof seedBase>>
  let clerkToken: string
  group.setup(async () => {
    const remove = await installProbes()
    manager = await seedActor([{ subject: 'all', action: 'manage' }], { level: 1 })
    clerk = await actorWith(
      [
        { subject: 'list_probes', action: 'view' },
        { subject: 'list_probes', action: 'delete', conditions: { status: 'open' } },
      ],
      { level: 0, orgUnitId: manager.orgUnitId }
    )
    viewer = await actorWith([{ subject: 'list_probes', action: 'view' }], {
      level: 0,
      orgUnitId: manager.orgUnitId,
    })
    outsider = await seedActor([{ subject: 'all', action: 'manage' }], { level: 1 })
    clerkToken = await bearer(clerk.user, ['read', 'write'])
    return remove
  })
  group.each.setup(async () => {
    await resetProbes()
    ids = await seedBase(manager.user.id, manager.orgUnitId, outsider.orgUnitId)
    await knex()('list_probes')
      .whereIn('id', [ids.alpha, ids.beta, ids.delta])
      .update({ deleted_at: knex().fn.now() })
  })

  test('the trash is 403 without the delete permission', async ({ client, assert }) => {
    const session = await client
      .get('/resources/list_probes/trash')
      .loginAs(viewer.user)
      .headers(json)
    session.assertStatus(403)
    assert.equal(session.body().error.code, 'E_FORBIDDEN')
    const token = await bearer(viewer.user)
    const api = await client
      .get('/api/v1/resources/list_probes/trash')
      .header('Authorization', `Bearer ${token}`)
    api.assertStatus(403)
    const page = await client
      .get('/resources/list_probes/trash')
      .loginAs(viewer.user)
      .header('Accept', 'text/html')
    page.assertStatus(403)
  })

  test('the trash lists only deleted rows the actor may delete in scope', async ({
    client,
    assert,
  }) => {
    const asClerk = await client
      .get('/resources/list_probes/trash')
      .loginAs(clerk.user)
      .headers(json)
    asClerk.assertStatus(200)
    assert.deepEqual(titles(asClerk.body()), ['Alpha'])
    assert.deepEqual(asClerk.body().permissions[String(ids.alpha)], {
      view: true,
      create: false,
      update: false,
      delete: false,
      restore: true,
    })
    const asManager = await client
      .get('/resources/list_probes/trash')
      .loginAs(manager.user)
      .headers(json)
    asManager.assertStatus(200)
    assert.deepEqual(titles(asManager.body()), ['Alpha', 'Beta'])
    const filtered = await client
      .get('/resources/list_probes/trash')
      .qs({ filters: { qty: { gte: 6 } } })
      .loginAs(manager.user)
      .headers(json)
    assert.deepEqual(titles(filtered.body()), ['Beta'])
    const api = await client
      .get('/api/v1/resources/list_probes/trash')
      .header('Authorization', `Bearer ${clerkToken}`)
    api.assertStatus(200)
    assert.deepEqual(titles(api.body()), ['Alpha'])
    // The live list never shows them.
    const live = await client.get('/resources/list_probes').loginAs(manager.user).headers(json)
    assert.deepEqual(titles(live.body()), ['Gamma'])
  })

  test('restore refuses other units, refusing conditions, live rows and viewers', async ({
    client,
    assert,
  }) => {
    const restore = (user: User, id: number) =>
      client
        .post(`/resources/list_probes/${id}/restore`)
        .loginAs(user)
        .withCsrfToken()
        .headers(json)
    const cases: [User, number, number, string][] = [
      [clerk.user, ids.delta, 404, 'E_NOT_FOUND'],
      [manager.user, ids.delta, 404, 'E_NOT_FOUND'],
      [clerk.user, ids.beta, 403, 'E_FORBIDDEN'],
      [clerk.user, ids.gamma, 404, 'E_NOT_FOUND'],
      [viewer.user, ids.alpha, 403, 'E_FORBIDDEN'],
      [clerk.user, 999999, 404, 'E_NOT_FOUND'],
    ]
    for (const [user, id, status, code] of cases) {
      const response = await restore(user, id)
      response.assertStatus(status)
      assert.equal(response.body().error.code, code, `${id}`)
    }
    const deleted = await knex()('list_probes').whereNotNull('deleted_at').orderBy('id').pluck('id')
    assert.deepEqual(deleted, [ids.alpha, ids.beta, ids.delta])
    const activity = await knex()('activities').where({
      resource: 'list_probes',
      action: 'restore',
    })
    assert.lengthOf(activity, 0)
  })

  test('restore clears deleted_at, records the activity and the record reappears', async ({
    client,
    assert,
  }) => {
    const response = await client
      .post(`/resources/list_probes/${ids.alpha}/restore`)
      .loginAs(clerk.user)
      .withCsrfToken()
      .headers(json)
    response.assertStatus(200)
    assert.equal(response.body().data.id, ids.alpha)
    assert.equal(response.body().data.title, 'Alpha')
    assert.notProperty(response.body().data, 'secret')
    const [row] = await knex()('list_probes').where('id', ids.alpha)
    assert.isNull(row.deleted_at)
    assert.equal(row.version, 2)
    assert.equal(row.updated_by, clerk.user.id)
    const activity = await knex()('activities')
      .where({ resource: 'list_probes', record_id: ids.alpha })
      .pluck('action')
    assert.deepEqual(activity, ['restore'])
    const shown = await client
      .get(`/resources/list_probes/${ids.alpha}`)
      .loginAs(clerk.user)
      .headers(json)
    shown.assertStatus(200)
    const history = await adula().resources.activity(
      'list_probes',
      ids.alpha,
      await adula().actors.load(clerk.user.id)
    )
    assert.include(JSON.stringify(history), 'restore')
    const live = await client.get('/resources/list_probes').loginAs(clerk.user).headers(json)
    assert.deepEqual(titles(live.body()), ['Alpha', 'Gamma'])
    const trash = await client.get('/resources/list_probes/trash').loginAs(clerk.user).headers(json)
    assert.deepEqual(titles(trash.body()), [])
    // Restoring twice is a missing deleted record.
    const again = await client
      .post(`/resources/list_probes/${ids.alpha}/restore`)
      .loginAs(clerk.user)
      .withCsrfToken()
      .headers(json)
    again.assertStatus(404)
  })

  test('restore over the bearer API needs a write token', async ({ client, assert }) => {
    const readOnly = await bearer(clerk.user)
    const refused = await client
      .post(`/api/v1/resources/list_probes/${ids.alpha}/restore`)
      .header('Authorization', `Bearer ${readOnly}`)
    refused.assertStatus(403)
    assert.equal(refused.body().error.code, 'E_TOKEN_SCOPE')
    const restored = await client
      .post(`/api/v1/resources/list_probes/${ids.alpha}/restore`)
      .header('Authorization', `Bearer ${clerkToken}`)
    restored.assertStatus(200)
    assert.equal(restored.body().data.id, ids.alpha)
  })

  test('Inertia: the index page describes trash/bulk and the trash page renders trashed', async ({
    client,
    assert,
  }) => {
    const index = await client
      .get('/resources/list_probes')
      .loginAs(clerk.user)
      .headers(html)
      .withInertia()
    index.assertStatus(200)
    assert.equal(index.body().component, 'resources/page')
    assert.deepInclude(index.body().props.view.resource, {
      trash: true,
      bulk: true,
      exportable: true,
    })
    const plain = await client
      .get('/resources/list_probes')
      .loginAs(viewer.user)
      .headers(html)
      .withInertia()
    assert.deepInclude(plain.body().props.view.resource, {
      trash: false,
      bulk: false,
      exportable: true,
    })
    const trash = await client
      .get('/resources/list_probes/trash')
      .loginAs(manager.user)
      .headers(html)
      .withInertia()
    trash.assertStatus(200)
    assert.equal(trash.body().component, 'resources/page')
    assert.isTrue(trash.body().props.view.trashed)
    assert.equal(trash.body().props.view.mode, 'index')
    assert.deepEqual(trash.body().props.view.savedViews, [])
    assert.deepEqual(titles(trash.body().props.result), ['Alpha', 'Beta'])
    assert.isTrue(trash.body().props.result.permissions[String(ids.alpha)].restore)
  })
})

test.group('List layer: dashboards', (group) => {
  let wide: UiActor
  let narrow: UiActor
  let stranger: UiActor
  group.setup(async () => {
    wide = await seedActor([{ subject: 'all', action: 'manage' }], { level: 1 })
    narrow = await actorWith(
      [
        { subject: 'orders', action: 'view' },
        { subject: 'tasks', action: 'view' },
      ],
      { level: 0 }
    )
    stranger = await actorWith([{ subject: 'customers', action: 'view' }], { level: 0 })
    const creator = await adula().actors.load(wide.user.id)
    for (const total of ['100000', '50050'])
      await adula().resources.save('orders', creator, {
        notes: 'طلب لوحة',
        total,
        orgUnitId: wide.orgUnitId,
      })
    // The creator's units do not include the narrow unit: rows there are inserted directly.
    await knex()('orders').insert({
      number: `DASH-${Date.now()}`,
      notes: 'طلب الوحدة الأخرى',
      total: '7000',
      org_unit_id: narrow.orgUnitId,
      created_by: wide.user.id,
      updated_by: wide.user.id,
    })
    for (const [title, done, orgUnitId] of [
      ['مهمة منجزة', true, wide.orgUnitId],
      ['مهمة قائمة', false, wide.orgUnitId],
      ['مهمة قائمة أخرى', false, wide.orgUnitId],
      ['مهمة الوحدة الأخرى', true, narrow.orgUnitId],
    ] as const)
      await knex()('tasks').insert({
        title,
        done,
        org_unit_id: orgUnitId,
        created_by: wide.user.id,
        updated_by: wide.user.id,
      })
  })

  const show = (client: any, user: User) =>
    client.get('/dashboards/orders_overview').loginAs(user).headers(json)

  test('numbers follow the viewer: scope differs and the sum is omitted without total', async ({
    client,
    assert,
  }) => {
    const first = await show(client, wide.user)
    first.assertStatus(200)
    const dashboard = first.body().data
    assert.equal(dashboard.name, 'orders_overview')
    assert.equal(dashboard.label, 'لوحة الطلبات')
    const widgets = Object.fromEntries(
      dashboard.widgets.map((widget: { key: string }) => [widget.key, widget])
    )
    assert.deepEqual(Object.keys(widgets), [
      'orders',
      'ordersTotal',
      'ordersByStatus',
      'tasksByDone',
    ])
    assert.equal(widgets.orders.value, 2)
    assert.equal(widgets.orders.href, '/resources/orders')
    assert.equal(widgets.ordersTotal.value, '150050')
    assert.equal(widgets.ordersTotal.format, 'money')
    assert.deepEqual(
      widgets.tasksByDone.rows.map((row: { label: string; measure: number }) => [
        row.label,
        row.measure,
      ]),
      [
        ['لا', 2],
        ['نعم', 1],
      ]
    )
    assert.equal(widgets.ordersByStatus.kind, 'grouped')
    assert.deepEqual(
      widgets.ordersByStatus.rows.map((row: { measure: number }) => row.measure),
      [2]
    )

    const second = await show(client, narrow.user)
    second.assertStatus(200)
    const narrowWidgets = Object.fromEntries(
      second.body().data.widgets.map((widget: { key: string }) => [widget.key, widget])
    )
    assert.notProperty(narrowWidgets, 'ordersTotal')
    assert.equal(narrowWidgets.orders.value, 1)
    assert.deepEqual(
      narrowWidgets.tasksByDone.rows.map((row: { label: string; measure: number }) => [
        row.label,
        row.measure,
      ]),
      [['نعم', 1]]
    )
    assert.notInclude(JSON.stringify(second.body()), '150050')
  })

  test('HTML renders the Inertia page with the shared dashboards prop', async ({
    client,
    assert,
  }) => {
    const page = await client
      .get('/dashboards/orders_overview')
      .loginAs(narrow.user)
      .headers(html)
      .withInertia()
    page.assertStatus(200)
    assert.equal(page.body().component, 'dashboards/show')
    assert.equal(page.body().props.dashboard.name, 'orders_overview')
    assert.deepEqual(page.body().props.dashboards, [
      { name: 'orders_overview', label: 'لوحة الطلبات' },
    ])
    const index = await client.get('/dashboards').loginAs(narrow.user).headers(json)
    index.assertStatus(200)
    assert.deepEqual(index.body().data, [{ name: 'orders_overview', label: 'لوحة الطلبات' }])
    const redirect = await client.get('/dashboards').loginAs(narrow.user).headers(html).redirects(0)
    redirect.assertStatus(302)
    assert.equal(redirect.header('location'), '/dashboards/orders_overview')
  })

  test('unknown dashboards and viewers without any widget are 404', async ({ client, assert }) => {
    const unknown = await client.get('/dashboards/nothing_here').loginAs(wide.user).headers(json)
    unknown.assertStatus(404)
    assert.deepEqual(unknown.body().error, {
      code: 'E_NOT_FOUND',
      message: 'لوحة المؤشرات غير موجودة',
    })
    const hidden = await show(client, stranger.user)
    hidden.assertStatus(404)
    assert.equal(hidden.body().error.code, 'E_NOT_FOUND')
    const list = await client.get('/dashboards').loginAs(stranger.user).headers(json)
    list.assertStatus(200)
    assert.deepEqual(list.body().data, [])
    const anonymous = await client.get('/dashboards/orders_overview').headers(json)
    anonymous.assertStatus(401)
  })
})

test.group('List layer: edge cases', (group) => {
  let manager: UiActor
  let clerk: UiActor
  let outsider: UiActor
  let ids: Awaited<ReturnType<typeof seedBase>>
  group.setup(async () => {
    const remove = await installProbes()
    manager = await seedActor([{ subject: 'all', action: 'manage' }], { level: 1 })
    clerk = await actorWith([{ subject: 'list_probes', action: 'view' }], {
      level: 0,
      orgUnitId: manager.orgUnitId,
    })
    outsider = await seedActor([{ subject: 'all', action: 'manage' }], { level: 1 })
    return remove
  })
  group.each.setup(async () => {
    await resetProbes()
    ids = await seedBase(manager.user.id, manager.orgUnitId, outsider.orgUnitId)
  })

  test('a versioned row without a version fails alone in a bulk delete', async ({
    client,
    assert,
  }) => {
    const response = await client
      .post('/resources/list_probes/bulk')
      .loginAs(manager.user)
      .withCsrfToken()
      .headers(json)
      .json({ action: 'delete', ids: [ids.alpha, ids.beta], versions: { [ids.alpha]: 1 } })
    response.assertStatus(200)
    assert.deepEqual(response.body().data.succeeded, [ids.alpha])
    assert.deepEqual(
      response.body().data.failed.map((row: { id: number; code: string }) => [row.id, row.code]),
      [[ids.beta, 'E_VERSION_CONFLICT']]
    )
  })

  test('bulk actions over the bearer API need a write token and run as the token owner', async ({
    client,
    assert,
  }) => {
    const readOnly = await bearer(manager.user)
    const write = await bearer(manager.user, ['read', 'write'])
    const options = await client
      .get('/api/v1/resources/list_probes/bulk')
      .header('Authorization', `Bearer ${readOnly}`)
    options.assertStatus(200)
    assert.deepEqual(
      options.body().data.map((option: { key: string }) => option.key),
      ['delete', 'restore']
    )
    const body = {
      action: 'delete',
      ids: [ids.gamma, ids.delta],
      versions: { [ids.gamma]: 1, [ids.delta]: 1 },
    }
    const refused = await client
      .post('/api/v1/resources/list_probes/bulk')
      .header('Authorization', `Bearer ${readOnly}`)
      .json(body)
    refused.assertStatus(403)
    assert.equal(refused.body().error.code, 'E_TOKEN_SCOPE')
    const response = await client
      .post('/api/v1/resources/list_probes/bulk')
      .header('Authorization', `Bearer ${write}`)
      .json(body)
    response.assertStatus(200)
    assert.deepEqual(response.body().data.succeeded, [ids.gamma])
    assert.deepEqual(
      response.body().data.failed.map((row: { id: number; code: string }) => [row.id, row.code]),
      [[ids.delta, 'E_NOT_FOUND']]
    )
  })

  test('bulk submit on orders: drafts succeed, an already submitted order fails alone', async ({
    client,
    assert,
  }) => {
    const creator = await adula().actors.load(manager.user.id)
    const orders = []
    for (const notes of ['مسودة أولى', 'مسودة ثانية', 'معتمد سابقًا'])
      orders.push(
        await adula().resources.save('orders', creator, { notes, orgUnitId: manager.orgUnitId })
      )
    const submitted = await adula().resources.transition(
      'orders',
      Number(orders[2].id),
      creator,
      'submit',
      orders[2].version
    )
    const response = await client
      .post('/resources/orders/bulk')
      .loginAs(manager.user)
      .withCsrfToken()
      .headers(json)
      .json({
        action: 'submit',
        ids: orders.map((order) => Number(order.id)),
        versions: {
          [Number(orders[0].id)]: orders[0].version,
          [Number(orders[1].id)]: orders[1].version,
          [Number(orders[2].id)]: submitted.version,
        },
      })
    response.assertStatus(200)
    assert.deepEqual(response.body().data.succeeded, [Number(orders[0].id), Number(orders[1].id)])
    assert.lengthOf(response.body().data.failed, 1)
    assert.equal(response.body().data.failed[0].id, Number(orders[2].id))
    assert.equal(response.body().data.failed[0].code, 'E_DOCUMENT_STATE')
    assert.match(response.body().data.failed[0].message, arabic)
    // A submitted document is not deleted; the row fails with an Arabic reason.
    const [locked] = await knex()('orders').where('id', Number(orders[0].id))
    const deleted = await client
      .post('/resources/orders/bulk')
      .loginAs(manager.user)
      .withCsrfToken()
      .headers(json)
      .json({ action: 'delete', ids: [locked.id], versions: { [locked.id]: locked.version } })
    deleted.assertStatus(200)
    assert.deepEqual(deleted.body().data.succeeded, [])
    assert.equal(deleted.body().data.failed[0].code, 'E_DOCUMENT_LOCKED')
    assert.match(deleted.body().data.failed[0].message, arabic)
    const statuses = await knex()('orders')
      .whereIn(
        'id',
        orders.map((order) => Number(order.id))
      )
      .orderBy('id')
      .pluck('doc_status')
    assert.deepEqual(statuses, [1, 1, 1])
  })

  test('exporting the trash needs the delete permission; formulas are neutralised', async ({
    client,
    assert,
  }) => {
    await insertProbes(manager.user.id, [
      { title: '=HYPERLINK("http://x")', qty: 77, org_unit_id: manager.orgUnitId },
      { title: 'Removed', qty: 78, org_unit_id: manager.orgUnitId, deleted_at: new Date() },
    ])
    const csv = await client
      .get('/resources/list_probes/export')
      .qs({ filters: { qty: { in: '77' } } })
      .loginAs(manager.user)
      .headers(json)
    csv.assertStatus(200)
    assert.include(csv.text(), `"'=HYPERLINK(""http://x"")"`)
    const trash = await client
      .get('/resources/list_probes/export')
      .qs({ trashed: 'true' })
      .loginAs(manager.user)
      .headers(json)
    trash.assertStatus(200)
    assert.include(trash.text(), '"Removed"')
    assert.notInclude(trash.text(), 'Alpha')
    const refused = await client
      .get('/resources/list_probes/export')
      .qs({ trashed: 'true' })
      .loginAs(clerk.user)
      .headers(json)
    refused.assertStatus(403)
    assert.equal(refused.body().error.code, 'E_FORBIDDEN')
  })

  test('restoring a record whose unique value is taken again is 409 E_DUPLICATE', async ({
    client,
    assert,
  }) => {
    const name = `عميل مكرر ${Date.now()}`
    const create = () =>
      client
        .post('/resources/customers')
        .loginAs(manager.user)
        .withCsrfToken()
        .headers(json)
        .json({ name })
    const first = await create()
    first.assertStatus(201)
    const id = first.body().data.id
    const removed = await client
      .delete(`/resources/customers/${id}`)
      .loginAs(manager.user)
      .withCsrfToken()
      .headers(json)
    removed.assertStatus(200)
    const second = await create()
    second.assertStatus(201)
    const restored = await client
      .post(`/resources/customers/${id}/restore`)
      .loginAs(manager.user)
      .withCsrfToken()
      .headers(json)
    restored.assertStatus(409)
    assert.equal(restored.body().error.code, 'E_DUPLICATE')
    const bulk = await client
      .post('/resources/customers/bulk')
      .loginAs(manager.user)
      .withCsrfToken()
      .headers(json)
      .json({ action: 'restore', ids: [id] })
    bulk.assertStatus(200)
    assert.deepEqual(
      bulk.body().data.failed.map((row: { code: string }) => row.code),
      ['E_DUPLICATE']
    )
    const [row] = await knex()('customers').where('id', id)
    assert.isNotNull(row.deleted_at)
  })
})
