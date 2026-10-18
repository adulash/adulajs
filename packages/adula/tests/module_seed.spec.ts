import { test } from '@japa/runner'
import { ResourceRegistry, RolesAdmin, seedModules } from '../index.js'
import type { Module } from '../index.js'
import { customer, db, line, order, setup } from './helpers.js'

const customers: Module = {
  name: 'customers',
  label: customer.label,
  dependsOn: [],
  resources: [customer],
}
const orders: Module = {
  name: 'orders',
  label: order.label,
  dependsOn: ['customers'],
  resources: [order, line],
  lookups: {
    order_status: [
      { key: 'open', label: { ar: 'مفتوح', en: 'Open' } },
      { key: 'approved', label: { ar: 'معتمد', en: 'Approved' }, sort: 5 },
    ],
  },
  defaultRoles: [
    {
      key: 'order_manager',
      name: 'مدير الطلبات',
      permissionLevel: 1,
      rules: [
        { subject: 'orders', action: 'view' },
        { subject: 'orders', action: 'update', conditions: { status: 'open' } },
      ],
    },
    { key: 'order_viewer', name: 'مطلع الطلبات', rules: [{ subject: 'orders', action: 'view' }] },
  ],
}

test.group('Module lookups and default roles', (group) => {
  group.setup(async () => {
    await setup()
  })

  test('install adds missing rows once and never overwrites administrator edits', async ({
    assert,
  }) => {
    const registry = new ResourceRegistry().register([customers, orders])
    // An administrator already created a keyless role with the same display name.
    const [viewer] = await db('roles').insert({ name: 'مطلع الطلبات' }).returning('id')
    // The helper fixture already has order_status.open; only "approved" is new.
    const first = await seedModules(db, registry, 1)
    assert.equal(first.lookups, 1)
    assert.deepEqual(first.created, ['order_manager'])
    assert.deepEqual(first.adopted, ['order_viewer'])
    const approved = await db('lookups').where({ group: 'order_status', key: 'approved' }).first()
    assert.equal(approved.label_ar, 'معتمد')
    assert.equal(approved.sort, 5)
    const manager = await db('roles').where('key', 'order_manager').first()
    assert.equal(manager.name, 'مدير الطلبات')
    assert.equal(manager.permission_level, 1)
    const rules = await db('role_rules').where('role_id', manager.id).orderBy('action')
    assert.deepEqual(
      rules.map((rule) => [rule.action, rule.conditions]),
      [
        ['update', { status: 'open' }],
        ['view', null],
      ]
    )
    // The adopted role keeps its (empty) rules; only the key was added.
    const adopted = await db('roles').where('id', viewer.id).first()
    assert.equal(adopted.key, 'order_viewer')
    assert.lengthOf(await db('role_rules').where('role_id', viewer.id), 0)

    // Administrators rename, relabel and change rules; a later install keeps all of it.
    const roles = new RolesAdmin(db, registry)
    await roles.rename(1, manager.id, 'مدير المبيعات')
    await db('lookups')
      .where({ group: 'order_status', key: 'approved' })
      .update({ label_ar: 'موافق عليه' })
    await db('role_rules').where({ role_id: manager.id, action: 'update' }).delete()
    const second = await seedModules(db, registry, 1)
    assert.deepEqual(second, {
      lookups: 0,
      created: [],
      adopted: [],
      kept: ['order_manager', 'order_viewer'],
    })
    const renamed = await db('roles').where('id', manager.id).first()
    assert.equal(renamed.name, 'مدير المبيعات')
    assert.lengthOf(await db('role_rules').where('role_id', manager.id), 1)
    const relabelled = await db('lookups').where({ group: 'order_status', key: 'approved' }).first()
    assert.equal(relabelled.label_ar, 'موافق عليه')
    assert.exists(
      await db('activities')
        .where({ resource: 'core.roles', record_id: manager.id, action: 'create' })
        .first()
    )
  })

  test('default roles are validated like the roles screen, before anything is written', async ({
    assert,
  }) => {
    const invalid = new ResourceRegistry().register([
      customers,
      {
        ...orders,
        lookups: {},
        defaultRoles: [
          { key: 'clerk', name: 'كاتب', rules: [{ subject: 'orders', action: 'view' }] },
          { key: 'ghost', name: 'شبح', rules: [{ subject: 'ghosts', action: 'view' }] },
        ],
      },
    ])
    await assert.rejects(() => seedModules(db, invalid, 1), /Default role ghost/)
    assert.notExists(await db('roles').where('key', 'clerk').first())
    assert.throws(
      () =>
        new ResourceRegistry().register([
          customers,
          { ...orders, defaultRoles: [{ key: 'Bad', name: 'x', rules: [] }] },
        ]),
      /invalid role key/
    )
    assert.throws(
      () =>
        new ResourceRegistry().register([
          customers,
          {
            ...orders,
            lookups: { order_status: [{ key: 'x', label: { ar: 'س', en: '' } }] },
          },
        ]),
      /needs Arabic text; en is optional but cannot be empty/
    )
    assert.throws(
      () =>
        new ResourceRegistry().register([
          { ...customers, defaultRoles: [{ key: 'same', name: 'أ', rules: [] }] },
          { ...orders, defaultRoles: [{ key: 'same', name: 'ب', rules: [] }] },
        ]),
      /Duplicate default role/
    )
  })
})
