import { test } from '@japa/runner'
import { subject } from '@casl/ability'
import {
  buildAbility,
  accessibleBy,
  canRecord,
  ActorStore,
  moveOrgUnit,
  serialize,
} from '../index.js'
import { predicates } from '../src/auth/conditions.js'
import { fromRow } from '../src/admin/contracts.js'
import knex from 'knex'
import { db, setup, order, admin, reader, registry, testConnection } from './helpers.js'
import type { Rule } from '../index.js'

test.group('Authorization semantics against PostgreSQL 17', (group) => {
  group.setup(setup)
  group.each.setup(async () => {
    await db('orders').delete()
    await db('orders').insert([
      {
        id: 1,
        number: 'A',
        org_unit_id: 2,
        created_by: 1,
        updated_by: 1,
        notes: 'alpha',
        status: 'open',
        total: 100,
      },
      {
        id: 2,
        number: 'B',
        org_unit_id: 3,
        created_by: 2,
        updated_by: 2,
        notes: null,
        status: 'closed',
        total: 200,
      },
      {
        id: 3,
        number: 'C',
        org_unit_id: 4,
        created_by: 2,
        updated_by: 2,
        notes: 'a_100%',
        status: 'open',
        total: null,
      },
    ])
  })
  const cases: [string, Rule[]][] = [
    ['no roles', []],
    ['allow all', [{ action: 'view', subject: 'orders' }]],
    [
      'deny last',
      [
        { action: 'view', subject: 'orders' },
        { action: 'view', subject: 'orders', inverted: true, conditions: { status: 'closed' } },
      ],
    ],
    [
      'deny first is still last',
      [
        { action: 'view', subject: 'orders', inverted: true, conditions: { status: 'closed' } },
        { action: 'view', subject: 'orders' },
      ],
    ],
    [
      'unconditional deny',
      [
        { action: 'manage', subject: 'all' },
        { action: 'view', subject: 'orders', inverted: true },
      ],
    ],
    [
      'multiple roles',
      [
        { action: 'view', subject: 'orders', conditions: { createdBy: 1 } },
        { action: 'view', subject: 'orders', conditions: { status: 'closed' } },
      ],
    ],
    ['null equality', [{ action: 'view', subject: 'orders', conditions: { notes: null } }]],
    [
      'null inequality',
      [{ action: 'view', subject: 'orders', conditions: { notes: { $ne: null } } }],
    ],
    [
      'inequality includes null',
      [{ action: 'view', subject: 'orders', conditions: { notes: { $ne: 'alpha' } } }],
    ],
    [
      'in includes null',
      [{ action: 'view', subject: 'orders', conditions: { notes: { $in: [null, 'alpha'] } } }],
    ],
    [
      'in only null',
      [{ action: 'view', subject: 'orders', conditions: { notes: { $in: [null] } } }],
    ],
    ['empty in', [{ action: 'view', subject: 'orders', conditions: { notes: { $in: [] } } }]],
    ['less than', [{ action: 'view', subject: 'orders', conditions: { id: { $lt: 3 } } }]],
    ['greater than', [{ action: 'view', subject: 'orders', conditions: { id: { $gt: 1 } } }]],
    [
      'like percent',
      [{ action: 'view', subject: 'orders', conditions: { notes: { $like: 'a%' } } }],
    ],
    [
      'like underscore',
      [{ action: 'view', subject: 'orders', conditions: { notes: { $like: 'a_pha' } } }],
    ],
    ['relation id', [{ action: 'view', subject: 'orders', conditions: { customerId: null } }]],
    [
      'field allow does not restrict rows',
      [{ action: 'view', subject: 'orders', fields: ['notes'] }],
    ],
    [
      'field deny does not deny row',
      [
        { action: 'view', subject: 'orders' },
        { action: 'view', subject: 'orders', fields: ['notes'], inverted: true },
      ],
    ],
    [
      'conjunction',
      [{ action: 'view', subject: 'orders', conditions: { status: 'open', id: { $gt: 1 } } }],
    ],
  ]
  for (const [name, rules] of cases)
    test(name, async ({ assert }) => {
      const ability = buildAbility(rules)
      const actor = { ...admin, rules }
      const rows = await db('orders as r')
        .join('org_units as ou', 'ou.id', 'r.org_unit_id')
        .select('r.*', 'ou.path as org_path')
        .orderBy('r.id')
      const memory = rows
        .map((row) => fromRow(row, order))
        .filter((record) => canRecord(ability, actor, order, 'view', record))
        .map((record) => record.id)
      const sql = await accessibleBy(db('orders as r'), ability, actor, 'view', order)
        .orderBy('r.id')
        .select('r.id')
      assert.deepEqual(
        sql.map((row: { id: number }) => row.id),
        memory
      )
    })
  test('org scope remains AND even with manage all', async ({ assert }) => {
    const ability = buildAbility(admin.rules)
    const rows = await accessibleBy(
      db('orders as r'),
      ability,
      { ...reader, rules: admin.rules },
      'view',
      order
    )
      .select('r.id')
      .orderBy('r.id')
    assert.deepEqual(
      rows.map((r: { id: number }) => r.id),
      [1, 3]
    )
    assert.isFalse(canRecord(ability, reader, order, 'view', { orgPath: '1.20' }))
  })
  test('unsupported and nested operators fail closed', ({ assert }) => {
    assert.throws(
      () =>
        buildAbility([
          { action: 'view', subject: 'orders', conditions: { id: { $regex: '.*' } } as never },
        ]),
      /Unsupported/
    )
    assert.throws(() => predicates({ 'customer.name': 'anything' }), /Unsafe/)
    assert.throws(() => predicates({ id: { $in: [undefined] } } as never), /Invalid operand/)
    assert.throws(
      () =>
        accessibleBy(
          db('orders as r'),
          buildAbility([{ action: 'view', subject: 'orders', conditions: { id: '1' } }]),
          admin,
          'view',
          order
        ),
      /type mismatch/
    )
  })
  test('serialization honors deny fields and levels per record', ({ assert }) => {
    const ability = buildAbility([
      { action: 'view', subject: 'orders' },
      {
        action: 'view',
        subject: 'orders',
        fields: ['notes'],
        inverted: true,
        conditions: { status: 'closed' },
      },
    ])
    const result = serialize(
      order,
      {
        id: 1,
        total: '500',
        notes: 'secret',
        internalNote: 'private',
        status: 'closed',
        createdBy: 1,
        version: 7,
        docStatus: 0,
      },
      ability,
      reader
    )
    assert.notProperty(result, 'notes')
    assert.notProperty(result, 'total')
    assert.notProperty(result, 'internalNote')
    assert.notProperty(result, 'createdBy')
    assert.equal(result.version, 7)
    assert.isFalse(ability.can('view', subject('orders', { status: 'closed' }), 'notes'))
  })
  test('scoped role cannot extend to sibling or central resources and tree move invalidates cache', async ({
    assert,
  }) => {
    const [role] = await db('roles').insert({ name: 'unit-manager' }).returning('id')
    await db('role_rules').insert({ role_id: role.id, subject: 'all', action: 'manage' })
    await db('user_roles').insert({ user_id: 2, role_id: role.id, org_unit_id: 2 })
    await db('user_org_units').insert({ user_id: 2, org_unit_id: 1 })
    const cache = new Map()
    const store = new ActorStore(db, registry, {
      get: async (key) => cache.get(key),
      set: async (key, value) => {
        cache.set(key, value)
      },
    })
    const actor = await store.load(2)
    assert.isFalse(buildAbility(actor.rules).can('view', 'customers'))
    assert.isFalse(canRecord(buildAbility(actor.rules), actor, order, 'view', { orgPath: '1.3' }))
    assert.isTrue(canRecord(buildAbility(actor.rules), actor, order, 'view', { orgPath: '1.2.4' }))
    await moveOrgUnit(db, 2, 3)
    const moved = await store.load(2)
    assert.isFalse(canRecord(buildAbility(moved.rules), moved, order, 'view', { orgPath: '1.2.4' }))
    assert.isTrue(
      canRecord(buildAbility(moved.rules), moved, order, 'view', { orgPath: '1.3.2.4' })
    )
    const sql = await accessibleBy(
      db('orders as r'),
      buildAbility(moved.rules),
      moved,
      'view',
      order
    )
      .select('r.id')
      .orderBy('r.id')
    assert.deepEqual(
      sql.map((r: { id: number }) => r.id),
      [1, 3]
    )
    await assert.rejects(() => moveOrgUnit(db, 3, 4), /beneath itself/)
  })
  test('the actor store loads on the connection it is given', async ({ assert }) => {
    const [role] = await db('roles').insert({ name: 'connection-reader' }).returning('id')
    await db('role_rules').insert({ role_id: role.id, subject: 'orders', action: 'view' })
    await db('user_roles').insert({ user_id: 2, role_id: role.id })
    // One connection that is never released while the transaction runs: a load that
    // asked the pool for another one would time out.
    const single = knex({
      client: 'pg',
      connection: testConnection,
      pool: { min: 0, max: 1 },
      acquireConnectionTimeout: 2000,
      searchPath: ['adula_test', 'public'],
    })
    try {
      const store = new ActorStore(single, registry)
      const inside = await single.transaction((trx) => store.load(2, trx))
      assert.deepEqual(inside, await store.load(2))
      assert.isTrue(buildAbility(inside.rules).can('view', 'orders'))
    } finally {
      await single.destroy()
      await db('user_roles').where('role_id', role.id).del()
      await db('role_rules').where('role_id', role.id).del()
      await db('roles').where('id', role.id).del()
    }
  })
})
