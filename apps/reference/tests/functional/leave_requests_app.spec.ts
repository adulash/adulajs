import { test } from '@japa/runner'
import { randomUUID } from 'node:crypto'
import type { ApiRequest } from '@japa/api-client'
import db from '@adonisjs/lucid/services/db'
import { seedModules } from 'adula'
import User from '#models/user'
import { registry } from '#start/modules'
import { seedActor, type UiActor } from '#tests/helpers/ui_fixtures'

/**
 * The leave_requests fixture is what `node ace adula:app leave_requests` scaffolds, with its
 * example resource filled in. Installing it (seedModules, as adula:install does) must give an
 * administrator its roles and its menu group, and its user role must work as declared.
 */
test.group('An application created by adula:app', (group) => {
  const knex = () => db.connection().getWriteClient()
  const asJson = (request: ApiRequest) =>
    request.withCsrfToken().header('Accept', 'application/json')
  const asPage = (request: ApiRequest) => request.header('Accept', 'text/html').withInertia()
  let admin: UiActor

  /** A user holding one module default role, addressed by its key, in the given unit. */
  async function holder(key: string, orgUnitId: number) {
    const user = await User.create({
      fullName: 'موظف الإجازات',
      email: `${key}-${randomUUID()}@example.test`,
      password: 'leave-requests-test-password-123',
    })
    const role = await knex()('roles').where('key', key).first()
    await knex()('user_roles').insert({ user_id: user.id, role_id: role.id })
    await knex()('user_org_units').insert({ user_id: user.id, org_unit_id: orgUnitId })
    return user
  }

  group.setup(async () => {
    admin = await seedActor([{ subject: 'all', action: 'manage' }], { fullName: 'مدير النظام' })
    await seedModules(knex(), registry, admin.user.id)
  })

  test('installation creates the default roles with their rules and the status lookups', async ({
    client,
    assert,
  }) => {
    const listed = await asJson(client.get('/admin/roles').loginAs(admin.user))
    listed.assertStatus(200)
    const roles = listed
      .body()
      .data.filter((role: { key: string | null }) => role.key?.startsWith('leave_requests_'))
    assert.sameDeepMembers(
      roles.map((role: { key: string; name: string; permissionLevel: number }) => ({
        key: role.key,
        name: role.name,
        permissionLevel: role.permissionLevel,
      })),
      [
        { key: 'leave_requests_manager', name: 'مدير طلبات الإجازة', permissionLevel: 1 },
        { key: 'leave_requests_user', name: 'مستخدم طلبات الإجازة', permissionLevel: 0 },
      ]
    )
    const rules = async (key: string) => {
      const id = roles.find((role: { key: string }) => role.key === key).id
      const shown = await asJson(client.get(`/admin/roles/${id}`).loginAs(admin.user))
      shown.assertStatus(200)
      return shown
        .body()
        .data.rules.map(
          (rule: { subject: string; action: string; conditions: unknown; inverted: boolean }) => ({
            subject: rule.subject,
            action: rule.action,
            conditions: rule.conditions,
            inverted: rule.inverted,
          })
        )
    }
    const plain = (action: string) => ({
      subject: 'leave_requests',
      action,
      conditions: null,
      inverted: false,
    })
    assert.sameDeepMembers(
      await rules('leave_requests_manager'),
      ['view', 'create', 'update', 'delete'].map(plain)
    )
    assert.sameDeepMembers(await rules('leave_requests_user'), [
      plain('view'),
      plain('create'),
      { ...plain('update'), conditions: { createdBy: '$actor.id' } },
    ])
    const statuses = await knex()('lookups')
      .where('group', 'leave_request_status')
      .orderBy('sort')
      .pluck('key')
    assert.includeMembers(statuses, ['pending', 'approved', 'rejected'])
    // Installing again changes nothing.
    const again = await seedModules(knex(), registry, admin.user.id)
    assert.includeMembers(again.kept, ['leave_requests_manager', 'leave_requests_user'])
  })

  test('the administrator sees the application as its own menu group', async ({
    client,
    assert,
  }) => {
    const page = await asPage(client.get('/resources/leave_requests').loginAs(admin.user))
    page.assertStatus(200)
    const entries = page
      .body()
      .props.navigation.filter((entry: { module: string }) => entry.module === 'leave_requests')
    assert.deepEqual(
      entries.map((entry: { name: string; moduleLabel: string }) => [
        entry.name,
        entry.moduleLabel,
      ]),
      [['leave_requests', 'طلبات الإجازة']]
    )
  })

  test('a holder of leave_requests_user lists and creates, edits only their own, never deletes', async ({
    client,
    assert,
  }) => {
    const employee = await holder('leave_requests_user', admin.orgUnitId)
    const manager = await holder('leave_requests_manager', admin.orgUnitId)
    const request = (user: User, days: [string, string]) =>
      asJson(client.post('/resources/leave_requests').loginAs(user)).json({
        employee: user.id,
        startDate: days[0],
        endDate: days[1],
        reason: 'إجازة سنوية',
        status: 'pending',
        orgUnitId: admin.orgUnitId,
      })
    const own = await request(employee, ['2026-12-01', '2026-12-03'])
    own.assertStatus(201)
    const theirs = await request(manager, ['2026-12-10', '2026-12-12'])
    theirs.assertStatus(201)

    const listed = await asJson(client.get('/resources/leave_requests').loginAs(employee))
    listed.assertStatus(200)
    assert.includeMembers(
      listed.body().data.map((row: { id: number }) => row.id),
      [own.body().data.id, theirs.body().data.id]
    )
    const page = await asPage(client.get('/resources/leave_requests').loginAs(employee))
    assert.deepEqual(
      page.body().props.navigation.map((entry: { moduleLabel: string }) => entry.moduleLabel),
      ['طلبات الإجازة']
    )

    const edit = (id: number, user: User) =>
      asJson(client.patch(`/resources/leave_requests/${id}`).loginAs(user)).json({
        employee: user.id,
        startDate: '2026-12-01',
        endDate: '2026-12-04',
        reason: 'تمديد',
        status: 'pending',
      })
    const ownId: number = own.body().data.id
    const edited = await edit(ownId, employee)
    edited.assertStatus(200)
    const foreign = await edit(theirs.body().data.id, employee)
    foreign.assertStatus(403)

    const remove = (id: number, user: User) =>
      asJson(client.delete(`/resources/leave_requests/${id}`).loginAs(user))
    const refused = await remove(ownId, employee)
    refused.assertStatus(403)
    const removed = await remove(ownId, manager)
    removed.assertStatus(200)
  })
})
