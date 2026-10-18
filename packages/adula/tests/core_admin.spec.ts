import { test } from '@japa/runner'
import {
  ActivityAdmin,
  NotificationsAdmin,
  OrgUnitsAdmin,
  RolesAdmin,
  Settings,
  SettingsAdmin,
  UsersAdmin,
  backupStale,
  heartbeat,
  notify,
  notifyWithTemplate,
  parseSettingValue,
  runtimeHealth,
} from '../index.js'
import { db, setup, registry } from './helpers.js'
import { failure } from './helpers/failure.js'
import { addUserProfileColumns } from './helpers/actors.js'

async function code(run: () => Promise<unknown>) {
  const error = await failure(run)
  return error.code
}
async function status(run: () => Promise<unknown>) {
  const error = await failure(run)
  return error.status
}

test.group('Core administration services', (group) => {
  const roles = new RolesAdmin(db, registry)
  const users = new UsersAdmin(db)
  const units = new OrgUnitsAdmin(db, registry)
  const activity = new ActivityAdmin(db)
  const inbox = new NotificationsAdmin(db)
  const settings = new SettingsAdmin(db)
  let roleId = 0
  group.setup(async () => {
    await setup()
    // Host applications own users; the reference migration adds these two columns.
    await addUserProfileColumns()
    await db('users').where('id', 1).update({ full_name: 'مدير النظام' })
    // The fixture inserts explicit org unit ids; new units must continue after them.
    await db.raw(
      "SELECT setval(pg_get_serial_sequence('org_units','id'), (SELECT max(id) FROM org_units))"
    )
  })

  test('matrix content matches the registry', ({ assert }) => {
    const matrix = roles.matrix()
    assert.deepEqual(
      matrix.subjects.map((subject) => subject.name),
      ['all', 'core.users', ...registry.all().map((resource) => resource.name)]
    )
    assert.deepEqual(matrix.actions, [
      'view',
      'create',
      'update',
      'delete',
      'submit',
      'cancel',
      'amend',
      'invite',
      'manage',
    ])
    const orders = matrix.subjects.find((subject) => subject.name === 'orders')!
    assert.deepEqual(orders.actions, [...registry.get('orders').actions, 'manage'])
    assert.deepEqual(matrix.subjects.find((subject) => subject.name === 'customers')!.actions, [
      'view',
      'create',
      'update',
      'delete',
      'manage',
    ])
    assert.isFalse(orders.fields.find((field) => field.key === 'lines')!.conditionable)
    assert.isTrue(orders.fields.find((field) => field.key === 'total')!.conditionable)
    assert.equal(orders.label.ar, 'الطلبات')
    const orderKeys = orders.conditionFields.map((field) => field.key)
    assert.includeMembers(orderKeys, ['id', 'createdBy', 'orgUnitId', 'docStatus', 'total'])
    assert.notInclude(orderKeys, 'lines')
    const customers = matrix.subjects.find((subject) => subject.name === 'customers')!
    assert.notInclude(
      customers.conditionFields.map((field) => field.key),
      'orgUnitId'
    )
    assert.isEmpty(matrix.subjects[0].conditionFields)
  })

  test('rules are validated against the registry and the condition compiler', async ({
    assert,
  }) => {
    const role = await roles.create(1, { name: 'editors', permissionLevel: 1 })
    roleId = role.id
    const rejected = (input: Parameters<RolesAdmin['setRule']>[2]) =>
      code(() => roles.setRule(1, roleId, input))
    assert.equal(await rejected({ subject: 'ghosts', action: 'view' }), 'E_RULE_SUBJECT')
    assert.equal(await rejected({ subject: 'customers', action: 'submit' }), 'E_RULE_ACTION')
    assert.equal(await rejected({ subject: 'all', action: 'fly' }), 'E_RULE_ACTION')
    assert.equal(
      await rejected({
        subject: 'orders',
        action: 'view',
        conditions: { status: { $regex: 'a' } } as never,
      }),
      'E_RULE_CONDITIONS'
    )
    assert.equal(
      await rejected({ subject: 'orders', action: 'view', conditions: { ghost: 'x' } }),
      'E_RULE_CONDITIONS'
    )
    assert.equal(
      await rejected({ subject: 'orders', action: 'view', conditions: { lines: 1 } }),
      'E_RULE_CONDITIONS'
    )
    assert.equal(
      await rejected({ subject: 'orders', action: 'view', conditions: { total: 5 } }),
      'E_RULE_CONDITIONS'
    )
    assert.equal(
      await rejected({ subject: 'orders', action: 'view', conditions: { orgPath: '1' } }),
      'E_RULE_CONDITIONS'
    )
    assert.equal(
      await rejected({ subject: 'customers', action: 'view', conditions: { orgUnitId: 1 } }),
      'E_RULE_CONDITIONS'
    )
    assert.equal(
      await rejected({ subject: 'all', action: 'view', conditions: { status: 'open' } }),
      'E_RULE_CONDITIONS'
    )
    assert.equal(
      await rejected({ subject: 'orders', action: 'view', fields: ['ghost'] }),
      'E_RULE_FIELDS'
    )
    assert.equal(
      await rejected({ subject: 'all', action: 'view', fields: ['name'] }),
      'E_RULE_FIELDS'
    )
    assert.equal(
      await status(() => roles.setRule(1, 9999, { subject: 'all', action: 'manage' })),
      404
    )
    const saved = await roles.setRule(1, roleId, {
      subject: 'orders',
      action: 'view',
      conditions: { status: 'open', total: { $gt: '100' } },
      fields: ['number', 'notes', 'notes'],
    })
    assert.deepEqual(saved.conditions, { status: 'open', total: { $gt: '100' } })
    assert.deepEqual(saved.fields, ['number', 'notes'])
    const stored = await db('role_rules').where('id', saved.id).first()
    assert.deepEqual(stored.conditions, { status: 'open', total: { $gt: '100' } })
    const updated = await roles.setRule(1, roleId, {
      subject: 'orders',
      action: 'view',
      conditions: { createdBy: { $in: [1, 2] } },
    })
    assert.equal(updated.id, saved.id)
    assert.isNull(updated.fields)
    const denied = await roles.setRule(1, roleId, {
      subject: 'orders',
      action: 'view',
      inverted: true,
    })
    assert.notEqual(denied.id, saved.id)
    const detail = await roles.get(roleId)
    assert.lengthOf(detail.rules, 2)
    await roles.removeRule(1, roleId, denied.id)
    assert.equal(await code(() => roles.removeRule(1, roleId, denied.id)), 'E_RULE_NOT_FOUND')
    const log = await db('activities')
      .where({ resource: 'core.roles', record_id: roleId })
      .orderBy('id')
    assert.deepEqual(
      log.map((row) => row.action),
      ['create', 'set_rule', 'set_rule', 'set_rule', 'remove_rule']
    )
    assert.equal(log[4].changes.rule.inverted, true)
  })

  test('roles list, rename, permission level and the deletion guard', async ({ assert }) => {
    assert.equal(await code(() => roles.create(1, { name: 'editors' })), 'E_ROLE_EXISTS')
    assert.equal(await code(() => roles.create(1, { name: ' ' })), 'E_ROLE_NAME')
    assert.equal(
      await code(() => roles.create(1, { name: 'x', permissionLevel: 10 })),
      'E_ROLE_LEVEL'
    )
    await roles.rename(1, roleId, 'المحررون')
    await roles.setPermissionLevel(1, roleId, 2)
    // A role created without a key receives one once; it is then fixed.
    await roles.setKey(1, roleId, 'editors')
    await roles.setKey(1, roleId, 'editors')
    assert.equal(await code(() => roles.setKey(1, roleId, 'writers')), 'E_ROLE_KEY_FIXED')
    assert.equal(await code(() => roles.setKey(1, roleId, '1bad')), 'E_ROLE_KEY')
    const all = await roles.list()
    const listed = all.find((role) => role.id === roleId)!
    assert.equal(listed.key, 'editors')
    assert.equal(listed.name, 'المحررون')
    assert.equal(listed.permissionLevel, 2)
    assert.equal(listed.rules, 1)
    assert.equal(listed.users, 0)
    const assignment = await users.assignRole(1, 2, roleId)
    assert.equal(await code(() => roles.delete(1, roleId)), 'E_ROLE_IN_USE')
    await users.removeRole(1, 2, assignment)
    const temporary = await roles.create(1, { name: 'temporary' })
    await roles.delete(1, temporary.id)
    assert.notExists(await db('roles').where('id', temporary.id).first())
    assert.exists(
      await db('activities')
        .where({ resource: 'core.roles', record_id: temporary.id, action: 'delete' })
        .first()
    )
  })

  test('users are listed with roles and memberships, searched, paged, disabled and enabled', async ({
    assert,
  }) => {
    const assignment = await users.assignRole(1, 2, roleId, 2)
    assert.equal(await code(() => users.assignRole(1, 2, roleId, 2)), 'E_ROLE_ASSIGNED')
    assert.equal(await status(() => users.assignRole(1, 2, roleId, 999)), 404)
    assert.equal(await code(() => users.assignRole(1, 999, roleId)), 'E_USER_NOT_FOUND')
    await users.assignOrgUnit(1, 2, 2)
    assert.equal(await code(() => users.assignOrgUnit(1, 2, 2)), 'E_MEMBERSHIP_EXISTS')
    const found = await users.list({ search: 'READER' })
    assert.lengthOf(found.data, 1)
    assert.equal(found.data[0].id, 2)
    assert.deepEqual(found.data[0].roles, [
      { id: assignment, roleId, role: 'المحررون', orgUnitId: 2, orgUnit: 'A' },
    ])
    assert.deepEqual(found.data[0].orgUnits, [{ id: 2, name: 'A', path: '1.2' }])
    assert.isNull(found.data[0].disabledAt)
    const first = await users.list({ limit: 1 })
    assert.equal(first.nextCursor, 1)
    const second = await users.list({ limit: 1, cursor: first.nextCursor! })
    assert.equal(second.data[0].id, 2)
    assert.isNull(second.nextCursor)
    assert.equal(await code(() => users.disable(2, 2)), 'E_SELF_DISABLE')
    await users.disable(1, 2)
    const disabled = await users.get(2)
    assert.isNotNull(disabled.disabledAt)
    await users.enable(1, 2)
    const enabled = await users.get(2)
    assert.isNull(enabled.disabledAt)
    await users.removeRole(1, 2, assignment)
    await users.removeOrgUnit(1, 2, 2)
    assert.equal(await code(() => users.removeOrgUnit(1, 2, 2)), 'E_MEMBERSHIP_NOT_FOUND')
    assert.equal(await code(() => users.removeRole(1, 2, assignment)), 'E_ROLE_NOT_ASSIGNED')
    const log = await db('activities').where({ resource: 'core.users', record_id: 2 }).orderBy('id')
    assert.includeMembers(
      log.map((row) => row.action),
      ['assign_role', 'assign_org_unit', 'disable', 'enable', 'remove_role', 'remove_org_unit']
    )
  })

  test('org units: ordered tree, creation, rename, move and guarded deletion', async ({
    assert,
  }) => {
    const tree = await units.tree()
    assert.deepEqual(
      tree.map((node) => [node.path, node.depth]),
      [
        ['1', 1],
        ['1.2', 2],
        ['1.2.4', 3],
        ['1.3', 2],
      ]
    )
    assert.equal(await code(() => units.delete(1, 2)), 'E_ORG_HAS_CHILDREN')
    await users.assignOrgUnit(1, 2, 3)
    assert.equal(await code(() => units.delete(1, 3)), 'E_ORG_HAS_MEMBERS')
    await users.removeOrgUnit(1, 2, 3)
    await db('orders').insert({ number: 'ORG', org_unit_id: 3, created_by: 1, updated_by: 1 })
    const blocked = await failure(() => units.delete(1, 3))
    assert.equal(blocked.code, 'E_ORG_HAS_RECORDS')
    assert.include(blocked.message, 'الطلبات')
    await db('orders').delete()
    const created = await units.create(1, { parentId: 3, name: 'C', type: 'unit' })
    assert.equal(created.path, `1.3.${created.id}`)
    assert.equal(
      await status(() => units.create(1, { parentId: 999, name: 'x', type: 'unit' })),
      404
    )
    assert.equal(
      await code(() => units.create(1, { parentId: 3, name: '', type: 'unit' })),
      'E_ORG_INPUT'
    )
    await units.rename(1, created.id, 'C2')
    await units.move(1, created.id, 2)
    const after = await units.tree()
    const moved = after.find((node) => node.id === created.id)!
    assert.equal(moved.path, `1.2.${created.id}`)
    assert.equal(moved.name, 'C2')
    assert.equal(moved.parentId, 2)
    assert.equal(await code(() => units.move(1, 2, created.id)), 'E_ORG_CYCLE')
    await units.delete(1, created.id)
    assert.notExists(await db('org_units').where('id', created.id).first())
    const log = await db('activities')
      .where({ resource: 'core.org_units', record_id: created.id })
      .orderBy('id')
    assert.deepEqual(
      log.map((row) => row.action),
      ['create', 'rename', 'move', 'delete']
    )
    assert.equal(log[2].changes.path, `1.2.${created.id}`)
  })

  test('activity listing pages by keyset with filters', async ({ assert }) => {
    const all = await activity.list()
    assert.isAbove(all.data.length, 5)
    assert.isTrue(
      all.data.every((row, index) => index === 0 || Number(row.id) < Number(all.data[index - 1].id))
    )
    assert.equal(all.data[0].actor, 'admin@example.test')
    const page = await activity.list({ limit: 2 })
    assert.lengthOf(page.data, 2)
    assert.equal(page.nextCursor, page.data[1].id)
    const next = await activity.list({ limit: 2, cursor: page.nextCursor! })
    assert.isBelow(Number(next.data[0].id), Number(page.data[1].id))
    const scoped = await activity.list({ resource: 'core.org_units', action: 'move', actorId: 1 })
    assert.lengthOf(scoped.data, 1)
    const future = await activity.list({ from: '2100-01-01' })
    assert.isEmpty(future.data)
    const past = await activity.list({ to: '2000-01-01' })
    assert.isEmpty(past.data)
    const today = await activity.list({
      from: '2000-01-01',
      to: new Date().toISOString().slice(0, 10),
    })
    assert.isNotEmpty(today.data)
    assert.equal(await code(() => activity.list({ cursor: 'abc' })), 'E_ACTIVITY_CURSOR')
    assert.equal(await code(() => activity.list({ from: 'never' })), 'E_ACTIVITY_DATE')
    const facets = await activity.facets()
    assert.includeMembers(facets.resources, ['core.roles', 'core.users', 'core.org_units'])
    assert.include(facets.actions, 'set_rule')
  })

  test('notifications: unread first, cursor across segments, mark one and all read', async ({
    assert,
  }) => {
    const rows = await db('notifications')
      .insert([
        { user_id: 2, title: 'قديم', body: 'مقروء', read_at: db.fn.now() },
        { user_id: 2, title: 'ب', body: 'غير مقروء' },
        { user_id: 2, title: 'ج', body: 'غير مقروء' },
        { user_id: 2, title: 'د', body: 'غير مقروء' },
        { user_id: 1, title: 'لغيره', body: 'مستخدم آخر' },
      ])
      .returning('id')
    const [read, b, c, d, other] = rows.map((row) => row.id as number)
    const first = await inbox.list(2, { limit: 2 })
    assert.deepEqual(
      first.data.map((row) => row.id),
      [d, c]
    )
    assert.equal(first.unread, 3)
    assert.equal(first.nextCursor, `u:${c}`)
    const second = await inbox.list(2, { limit: 2, cursor: first.nextCursor! })
    assert.deepEqual(
      second.data.map((row) => row.id),
      [b, read]
    )
    assert.isNull(second.nextCursor)
    assert.equal(await code(() => inbox.markRead(2, other)), 'E_NOTIFICATION_NOT_FOUND')
    await inbox.markRead(2, b)
    assert.equal(await inbox.unreadCount(2), 2)
    assert.equal(await inbox.markAllRead(2), 2)
    assert.equal(await inbox.unreadCount(2), 0)
    assert.equal(await inbox.unreadCount(1), 1)
    const paged = await inbox.list(2, { limit: 3 })
    assert.equal(paged.nextCursor, `r:${paged.data[2].id}`)
    const rest = await inbox.list(2, { limit: 3, cursor: paged.nextCursor! })
    assert.lengthOf(rest.data, 1)
  })

  test('notifications: a record target links while its resource is registered', async ({
    assert,
  }) => {
    await db('notifications').where('user_id', 2).del()
    await notify(db, 2, 'بلا سجل', 'نص')
    await notify(db, 2, 'عن طلب', 'نص', { resource: 'orders', recordId: 7 })
    await notify(db, 2, 'عن كيان محذوف', 'نص', { resource: 'archived_things', recordId: 3 })
    await notifyWithTemplate(
      db,
      2,
      'record.changed',
      { change: 'تم تعديل', resource: 'العملاء', id: 4 },
      undefined,
      { resource: 'customers', recordId: 4 }
    )
    const linked = new NotificationsAdmin(db, registry)
    const page = await linked.list(2)
    const byTitle = new Map(page.data.map((row) => [row.title, row.target]))
    assert.isNull(byTitle.get('بلا سجل'))
    assert.deepEqual(byTitle.get('عن طلب'), {
      resource: 'orders',
      recordId: 7,
      href: '/resources/orders/7',
    })
    // An unregistered (removed) resource keeps its row but loses the link.
    assert.isNull(byTitle.get('عن كيان محذوف'))
    assert.equal(byTitle.get('تم تعديل العملاء #4')?.href, '/resources/customers/4')
    // Without a registry the stored target is returned unchanged.
    const raw = await inbox.list(2)
    assert.equal(raw.data.find((row) => row.title === 'عن كيان محذوف')?.target?.recordId, 3)
    const target = page.data.find((row) => row.title === 'عن طلب')!
    assert.equal(await linked.open(2, target.id), '/resources/orders/7')
    const opened = await db('notifications').where('id', target.id).first('read_at')
    assert.isNotNull(opened.read_at)
    const plain = page.data.find((row) => row.title === 'بلا سجل')!
    assert.isNull(await linked.open(2, plain.id))
    assert.equal(await code(() => linked.open(1, plain.id)), 'E_NOTIFICATION_NOT_FOUND')
    await assert.rejects(() => notify(db, 2, 'x', 'y', { resource: 'orders; drop', recordId: 1 }))
    await db('notifications').where('user_id', 2).del()
  })

  test('settings: scoped upsert, JSON validation and protected keys', async ({ assert }) => {
    const row = await settings.upsert(1, {
      key: 'ui.theme',
      scope: 'system',
      value: { dark: true },
    })
    assert.isFalse(row.readOnly)
    assert.deepEqual(row.value, { dark: true })
    const merged = await settings.upsert(1, { key: 'ui.theme', scope: 'system', value: 'compact' })
    assert.equal(merged.id, row.id)
    assert.equal(merged.value, 'compact')
    const system = await settings.list('system')
    assert.deepEqual(
      system.map((item) => [item.key, item.value]),
      [['ui.theme', 'compact']]
    )
    for (const key of [
      'backup.lastOffsite',
      'scheduler.heartbeat',
      'worker.heartbeat',
      'adula.version',
    ])
      assert.equal(
        await code(() => settings.upsert(1, { key, scope: 'system', value: 'x' })),
        'E_SETTING_READ_ONLY'
      )
    assert.equal(
      await code(() => settings.upsert(1, { key: 'bad key', scope: 'system', value: 1 })),
      'E_SETTING_KEY'
    )
    assert.equal(
      await code(() => settings.upsert(1, { key: 'a', scope: 'tenant' as never, value: 1 })),
      'E_SETTING_SCOPE'
    )
    assert.equal(
      await code(() => settings.upsert(1, { key: 'a', scope: 'org_unit', value: 1 })),
      'E_SETTING_SCOPE'
    )
    assert.equal(
      await status(() =>
        settings.upsert(1, { key: 'a', scope: 'org_unit', scopeId: '999', value: 1 })
      ),
      404
    )
    assert.equal(
      await code(() => settings.upsert(1, { key: 'a', scope: 'system', value: undefined })),
      'E_SETTING_JSON'
    )
    assert.equal(await code(async () => parseSettingValue('{bad')), 'E_SETTING_JSON')
    assert.deepEqual(parseSettingValue('{"a":[1,null]}'), { a: [1, null] })
    const unit = await settings.upsert(1, {
      key: 'limit',
      scope: 'org_unit',
      scopeId: '2',
      value: 5,
    })
    assert.equal(unit.scopeId, '2')
    const scopedUnit = await settings.list('org_unit', '2')
    assert.deepEqual(
      scopedUnit.map((item) => item.key),
      ['limit']
    )
    assert.isEmpty(await settings.list('org_unit', '3'))
    await settings.upsert(1, { key: 'locale', scope: 'user', scopeId: '2', value: 'ar' })
    await settings.delete(1, unit.id)
    assert.equal(await code(() => settings.delete(1, unit.id)), 'E_SETTING_NOT_FOUND')
    await new Settings(db).set('backup.lastOffsite', new Date().toISOString())
    const protectedRow = await db('settings').where('key', 'backup.lastOffsite').first()
    const withProtected = await settings.list('system')
    assert.isTrue(withProtected.find((item) => item.key === 'backup.lastOffsite')!.readOnly)
    assert.equal(await code(() => settings.delete(1, protectedRow.id)), 'E_SETTING_READ_ONLY')
    const log = await db('activities').where({ resource: 'core.settings' }).orderBy('id')
    assert.deepEqual(
      log.map((item) => item.action),
      ['upsert', 'upsert', 'upsert', 'upsert', 'delete']
    )
  })

  test('runtime health reads outbox backlog, heartbeats and backup freshness', async ({
    assert,
  }) => {
    const now = Date.parse('2026-09-18T12:00:00Z')
    const store = new Settings(db)
    await store.set('scheduler.heartbeat', new Date(now - 10_000).toISOString())
    await store.set('worker.heartbeat', new Date(now - 120_000).toISOString())
    await db('settings').where('key', 'backup.lastOffsite').delete()
    await db('outbox').insert({
      id: '11111111-1111-4111-8111-111111111111',
      event: 'orders.orders.created',
      payload: JSON.stringify({}),
      created_at: new Date(now - 5_000).toISOString(),
    })
    await db('processed_events').insert({
      event_id: '11111111-1111-4111-8111-111111111111',
      listener: 'x',
    })
    const health = await runtimeHealth(db, now)
    assert.equal(health.outbox.backlog, 1)
    assert.equal(health.outbox.oldestAgeMs, 5_000)
    assert.equal(health.processedEvents, 1)
    assert.isTrue(health.heartbeats.scheduler.healthy)
    assert.equal(health.heartbeats.scheduler.ageMs, 10_000)
    assert.isFalse(health.heartbeats.worker.healthy)
    assert.isTrue(health.backup.stale)
    assert.isNull(health.backup.lastOffsite)
    await store.set('backup.lastOffsite', new Date(now - 3_600_000).toISOString())
    const fresh = await runtimeHealth(db, now)
    assert.isFalse(fresh.backup.stale)
    assert.isTrue(backupStale(new Date(now - 49 * 3_600_000).toISOString(), now))
    assert.isTrue(backupStale('garbage', now))
    assert.isFalse(heartbeat(undefined, now).healthy)
    assert.isFalse(heartbeat(new Date(now + 5_000).toISOString(), now).healthy)
  })
})
