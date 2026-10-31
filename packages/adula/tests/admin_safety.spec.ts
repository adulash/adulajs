import { test } from '@japa/runner'
import {
  ActorStore,
  buildAbility,
  AdulaError,
  RolesAdmin,
  SettingsAdmin,
  UsersAdmin,
  uiPreferences,
  DEFAULT_UI_PREFERENCES,
} from '../index.js'
import { db, registry, setup } from './helpers.js'
import { addUserProfileColumns } from './helpers/actors.js'

test.group('Administrator access safety and UI preferences', (group) => {
  const roles = new RolesAdmin(db, registry)
  const users = new UsersAdmin(db)
  let roleId: number
  let ruleId: number
  let assignmentId: number
  group.each.setup(async () => {
    await setup()
    await addUserProfileColumns()
    const [role] = await db('roles').insert({ name: 'administrator' }).returning('id')
    roleId = role.id
    const [rule] = await db('role_rules')
      .insert({ role_id: roleId, subject: 'all', action: 'manage' })
      .returning('id')
    ruleId = rule.id
    const [assignment] = await db('user_roles')
      .insert({ user_id: 1, role_id: roleId })
      .returning('id')
    assignmentId = assignment.id
  })
  async function rejected(action: () => Promise<unknown>, code: string) {
    try {
      await action()
    } catch (error) {
      if (error instanceof AdulaError && error.code === code && error.status === 409) return
      throw error
    }
    throw new Error(`Expected ${code}`)
  }
  test('last administrator rule deletion is rolled back with revision and activity', async ({
    assert,
  }) => {
    const revision = await db('authorization_revision').first('version')
    await rejected(() => roles.removeRule(1, roleId, ruleId), 'E_LAST_ADMIN')
    assert.exists(await db('role_rules').where('id', ruleId).first())
    assert.deepEqual(await db('authorization_revision').first('version'), revision)
    assert.lengthOf(await db('activities'), 0)
    const actor = await new ActorStore(db, registry).load(1)
    assert.isTrue(buildAbility(actor.rules).can('manage', 'all'))
  })
  test('deny rules and deny-role assignments cannot remove administrative access', async ({
    assert,
  }) => {
    await rejected(
      () => roles.setRule(1, roleId, { subject: 'all', action: 'manage', inverted: true }),
      'E_LAST_ADMIN'
    )
    const [deny] = await db('roles').insert({ name: 'deny-admin' }).returning('id')
    await db('role_rules').insert({
      role_id: deny.id,
      subject: 'all',
      action: 'manage',
      inverted: true,
    })
    await rejected(() => users.assignRole(1, 1, deny.id), 'E_LAST_ADMIN')
    assert.lengthOf(await db('user_roles').where('user_id', 1), 1)
    assert.notExists(await db('role_rules').where({ role_id: roleId, inverted: true }).first())
  })
  test('self-removal stays protected even with another active administrator', async ({
    assert,
  }) => {
    await users.assignRole(1, 2, roleId)
    await rejected(() => users.removeRole(1, 1, assignmentId), 'E_SELF_ADMIN_ACCESS')
    await users.removeRole(2, 1, assignmentId)
    assert.lengthOf(await db('user_roles').where('user_id', 1), 0)
    assert.lengthOf(await db('user_roles').where('user_id', 2), 1)
  })
  test('disabled and organization-scoped users are not recovery administrators', async () => {
    await users.assignRole(1, 2, roleId, 1)
    await rejected(() => users.removeRole(1, 1, assignmentId), 'E_LAST_ADMIN')
    await db('user_roles').where('user_id', 2).update({ org_unit_id: null })
    await db('users').where('id', 2).update({ disabled_at: db.fn.now() })
    await rejected(() => users.disable(2, 1), 'E_LAST_ADMIN')
  })
  test('concurrent cross-removals leave one active administrator', async ({ assert }) => {
    await users.assignRole(1, 2, roleId)
    const second = await db('user_roles').where('user_id', 2).first()
    const results = await Promise.allSettled([
      users.removeRole(1, 2, second.id),
      users.removeRole(2, 1, assignmentId),
    ])
    assert.lengthOf(
      results.filter((r) => r.status === 'fulfilled'),
      1
    )
    const rejectedResult = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    assert.equal(rejectedResult.reason.code, 'E_LAST_ADMIN')
    assert.lengthOf(await db('user_roles'), 1)
  })
  test('bootstrap role identity stays stable for install repair', async () => {
    await rejected(() => roles.rename(1, roleId, 'renamed'), 'E_BOOTSTRAP_ROLE')
  })
  test('Gregorian, Hijri and both preferences persist; invalid or scoped values cannot overwrite them', async ({
    assert,
  }) => {
    const settings = new SettingsAdmin(db)
    assert.deepEqual(await uiPreferences(db), DEFAULT_UI_PREFERENCES)
    for (const calendar of ['gregory', 'islamic-umalqura', 'both'] as const) {
      const value = { calendar, confirmDialogClose: true, pageTransitions: false }
      await settings.upsert(1, { key: 'ui.preferences', scope: 'system', value })
      assert.deepEqual(await uiPreferences(db), value)
    }
    for (const value of [
      null,
      {},
      { ...DEFAULT_UI_PREFERENCES, calendar: 'invalid' },
      { ...DEFAULT_UI_PREFERENCES, confirmDialogClose: 'true' },
    ])
      await assert.rejects(
        () => settings.upsert(1, { key: 'ui.preferences', scope: 'system', value }),
        /تقويم/
      )
    await assert.rejects(
      () =>
        settings.upsert(1, {
          key: 'ui.preferences',
          scope: 'user',
          scopeId: '1',
          value: DEFAULT_UI_PREFERENCES,
        }),
      /مستوى النظام/
    )
    const preferences = await uiPreferences(db)
    assert.equal(preferences.calendar, 'both')
  })
})
