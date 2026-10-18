import { test } from '@japa/runner'
import {
  ACTOR_ID,
  ActorStore,
  ResourceRegistry,
  ResourceService,
  RolesAdmin,
  accessibleBy,
  buildAbility,
  resolveActorConditions,
} from '../index.js'
import { db, order, registry, setup } from './helpers.js'
import { failure } from './helpers/failure.js'
import { addUserProfileColumns, seedActor } from './helpers/actors.js'

test.group('Current-actor conditions ($actor.id)', (group) => {
  const roles = new RolesAdmin(db, registry)
  const service = () => new ResourceService(db, registry)
  let roleId = 0
  group.setup(async () => {
    await setup()
    // Host applications own users; the reference migration adds these two columns.
    await addUserProfileColumns()
    const role = await roles.create(1, { name: 'محرر طلباته' })
    roleId = role.id
    // Everyone in the unit reads orders; each user edits only the orders they created.
    await roles.setRule(1, roleId, { subject: 'orders', action: 'view' })
    await roles.setRule(1, roleId, { subject: 'orders', action: 'create' })
    await roles.setRule(1, roleId, {
      subject: 'orders',
      action: 'update',
      conditions: { createdBy: ACTOR_ID },
    })
    await seedActor({ id: 3 }, { email: 'colleague@example.test' })
    await db('user_roles').insert([
      { user_id: 2, role_id: roleId },
      { user_id: 3, role_id: roleId },
    ])
    await db('user_org_units').insert([
      { user_id: 2, org_unit_id: 2 },
      { user_id: 3, org_unit_id: 2 },
    ])
  })

  test('each user may update only the records they created, in CASL and SQL alike', async ({
    assert,
  }) => {
    const store = new ActorStore(db, registry)
    const mine = await store.load(2)
    const colleague = await store.load(3)
    const update = mine.rules.find((rule) => rule.action === 'update')
    assert.deepEqual(update?.conditions, { createdBy: 2 })
    const own = await service().save('orders', mine, { notes: 'طلبي', orgUnitId: 2 })
    const theirs = await service().save('orders', colleague, { notes: 'طلب الزميل', orgUnitId: 2 })
    const page = await service().list('orders', mine)
    assert.isTrue(page.permissions[String(own.id)].update)
    assert.isFalse(page.permissions[String(theirs.id)].update)
    // Both records remain visible; only the update right follows the creator.
    assert.includeMembers(
      page.data.map((row) => row.id),
      [own.id, theirs.id]
    )
    const editable = await accessibleBy(
      db('orders as r').whereNull('r.deleted_at'),
      buildAbility(mine.rules, registry.all()),
      mine,
      'update',
      order
    ).pluck('r.id')
    assert.include(editable, Number(own.id))
    assert.notInclude(editable, Number(theirs.id))
    const denied = await failure(() =>
      service().save(
        'orders',
        mine,
        { notes: 'تعديل غير مسموح', version: theirs.version },
        Number(theirs.id)
      )
    )
    assert.equal(denied.status, 403)
    const saved = await service().save(
      'orders',
      mine,
      { notes: 'طلبي المعدل', version: own.version },
      Number(own.id)
    )
    assert.equal(saved.notes, 'طلبي المعدل')
    // The stored rule keeps the placeholder; only the loaded actor carries an id.
    const stored = await db('role_rules').where({ role_id: roleId, action: 'update' }).first()
    assert.deepEqual(stored.conditions, { createdBy: ACTOR_ID })
  })

  test('the placeholder is limited to user fields and equality operators', async ({ assert }) => {
    const reject = async (conditions: Record<string, unknown>) => {
      const error = await failure(() =>
        roles.setRule(1, roleId, { subject: 'orders', action: 'delete', conditions } as never)
      )
      return error.code
    }
    assert.equal(await reject({ notes: ACTOR_ID }), 'E_RULE_CONDITIONS')
    assert.equal(await reject({ createdBy: { $lt: ACTOR_ID } }), 'E_RULE_CONDITIONS')
    const listed = await roles.setRule(1, roleId, {
      subject: 'orders',
      action: 'delete',
      conditions: { updatedBy: { $in: [ACTOR_ID, 1] } },
    })
    assert.deepEqual(listed.conditions, { updatedBy: { $in: [ACTOR_ID, 1] } })
    assert.deepEqual(resolveActorConditions({ updatedBy: { $in: [ACTOR_ID, 1] } }, 7), {
      updatedBy: { $in: [7, 1] },
    })
    const matrix = roles.matrix().subjects.find((entry) => entry.name === 'orders')!
    const actorFields = matrix.conditionFields.filter((field) => field.actor).map((f) => f.key)
    assert.deepEqual(actorFields, ['createdBy', 'updatedBy'])
  })

  test('a placeholder stored outside setRule on another field fails closed', async ({ assert }) => {
    // Written by SQL, bypassing RolesAdmin: resolving it would compare an id with text,
    // so `$ne` would allow every record. The rule stays unresolved and is refused.
    const [rule] = await db('role_rules')
      .insert({
        role_id: roleId,
        subject: 'orders',
        action: 'delete',
        conditions: { notes: { $ne: ACTOR_ID } },
      })
      .returning('id')
    try {
      const actor = await new ActorStore(db, registry).load(2)
      const stored = actor.rules.find((entry) => entry.action === 'delete')
      assert.deepEqual(stored?.conditions, { notes: { $ne: ACTOR_ID } })
      assert.throws(() => buildAbility(actor.rules, registry.all()), /resolveActorConditions/)
      await assert.rejects(() => service().list('orders', actor), /resolveActorConditions/)
      // Stores built without the resource (core checks such as invitations) still load.
      const core = await new ActorStore(db, new ResourceRegistry()).load(2)
      assert.doesNotThrow(() => buildAbility(core.rules))
    } finally {
      await db('role_rules').where('id', rule.id).del()
    }
  })
})
