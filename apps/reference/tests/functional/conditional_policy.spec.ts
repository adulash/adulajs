import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import User from '#models/user'
import { adula } from '#services/adula'
import { seedActor, type UiActor } from '#tests/helpers/ui_fixtures'

const json = { Accept: 'application/json' }
const knex = () => db.connection().getWriteClient()

/**
 * Plan phase 3 acceptance: "the accountant edits only unapproved orders" is
 * configured through the administration screens' HTTP API, without code.
 */
test.group('Conditional policies configured without code', (group) => {
  let admin: UiActor
  let accountant: User
  group.setup(async () => {
    admin = await seedActor([{ subject: 'all', action: 'manage' }], { fullName: 'مدير الصلاحيات' })
    accountant = await User.create({
      fullName: 'المحاسب',
      email: `accountant-${Date.now()}@example.test`,
      password: 'test-only-password-123',
    })
  })

  test('an accountant updates draft orders only, as configured in the role screen', async ({
    client,
    assert,
  }) => {
    const as = <T extends { loginAs(user: User): T }>(request: T) => request.loginAs(admin.user)
    const role = await as(client.post('/admin/roles'))
      .withCsrfToken()
      .headers(json)
      .json({ name: `المحاسب ${Date.now()}`, permissionLevel: 1 })
    role.assertStatus(200)
    const roleId = role.body().data.id
    for (const rule of [
      { subject: 'orders', action: 'view' },
      { subject: 'orders', action: 'update', conditions: { docStatus: 0 } },
    ]) {
      const response = await as(client.put(`/admin/roles/${roleId}/rules`))
        .withCsrfToken()
        .headers(json)
        .json(rule)
      response.assertStatus(200)
    }
    const unsupported = await as(client.put(`/admin/roles/${roleId}/rules`))
      .withCsrfToken()
      .headers(json)
      .json({ subject: 'orders', action: 'update', conditions: { docStatus: { $regex: '.*' } } })
    unsupported.assertStatus(422)
    {
      const response = await as(client.post(`/admin/users/${accountant.id}/roles`))
        .withCsrfToken()
        .headers(json)
        .json({ roleId })
      response.assertStatus(200)
    }
    {
      const response = await as(client.post(`/admin/users/${accountant.id}/org-units`))
        .withCsrfToken()
        .headers(json)
        .json({ orgUnitId: admin.orgUnitId })
      response.assertStatus(200)
    }

    const creator = await adula().actors.load(admin.user.id)
    const draft = await adula().resources.save('orders', creator, {
      notes: 'مسودة للمحاسب',
      orgUnitId: admin.orgUnitId,
    })
    const approved = await adula().resources.save('orders', creator, {
      notes: 'طلب معتمد',
      orgUnitId: admin.orgUnitId,
    })
    await adula().resources.transition(
      'orders',
      Number(approved.id),
      creator,
      'submit',
      approved.version
    )

    const listed = await client.get('/resources/orders').loginAs(accountant).headers(json)
    listed.assertStatus(200)
    assert.isTrue(listed.body().permissions[String(draft.id)].update)
    assert.isFalse(listed.body().permissions[String(approved.id)].update)

    const edited = await client
      .patch(`/resources/orders/${draft.id}`)
      .loginAs(accountant)
      .withCsrfToken()
      .headers(json)
      .json({ notes: 'عدّلها المحاسب', version: draft.version })
    edited.assertStatus(200)
    const refused = await client
      .patch(`/resources/orders/${approved.id}`)
      .loginAs(accountant)
      .withCsrfToken()
      .headers(json)
      .json({ notes: 'محاولة', version: Number(approved.version) + 1 })
    refused.assertStatus(403)
    const [row] = await knex()('orders').where('id', Number(approved.id))
    assert.equal(row.notes, 'طلب معتمد')
  })

  test('each inspector updates only the inspections assigned to them ($actor.id)', async ({
    client,
    assert,
  }) => {
    const as = <T extends { loginAs(user: User): T }>(request: T) => request.loginAs(admin.user)
    const stamp = Date.now()
    const inspectors: User[] = []
    for (const name of ['مفتش أول', 'مفتش ثان'])
      inspectors.push(
        await User.create({
          fullName: `${name} ${stamp}`,
          email: `inspector-${inspectors.length}-${stamp}@example.test`,
          password: 'test-only-password-123',
        })
      )
    const [mine, colleague] = inspectors
    const role = await as(client.post('/admin/roles'))
      .withCsrfToken()
      .headers(json)
      .json({ name: `المفتشون ${stamp}`, permissionLevel: 0 })
    role.assertStatus(200)
    const roleId = role.body().data.id
    const setRule = async (rule: Record<string, unknown>, status: number) => {
      const response = await as(client.put(`/admin/roles/${roleId}/rules`))
        .withCsrfToken()
        .headers(json)
        .json(rule)
      response.assertStatus(status)
      return response.body().data
    }
    await setRule({ subject: 'order_inspections', action: 'view' }, 200)
    const own = await setRule(
      { subject: 'order_inspections', action: 'update', conditions: { inspector: '$actor.id' } },
      200
    )
    // The stored rule keeps the placeholder; it is resolved for each signed-in user.
    assert.deepEqual(own.conditions, { inspector: '$actor.id' })
    // Only user fields and the creator/updater accept the current user.
    await setRule(
      { subject: 'order_inspections', action: 'delete', conditions: { findings: '$actor.id' } },
      422
    )
    for (const inspector of inspectors) {
      const granted = await as(client.post(`/admin/users/${inspector.id}/roles`))
        .withCsrfToken()
        .headers(json)
        .json({ roleId })
      granted.assertStatus(200)
      const member = await as(client.post(`/admin/users/${inspector.id}/org-units`))
        .withCsrfToken()
        .headers(json)
        .json({ orgUnitId: admin.orgUnitId })
      member.assertStatus(200)
    }

    // The administrator assigns one inspection to each inspector through the API.
    const assign = async (inspector: User) => {
      const response = await as(client.post('/resources/order_inspections'))
        .withCsrfToken()
        .headers(json)
        .json({ inspector: inspector.id, findings: 'قبل الزيارة', orgUnitId: admin.orgUnitId })
      response.assertStatus(201)
      return response.body().data
    }
    const assigned = await assign(mine)
    const other = await assign(colleague)

    const listed = await client.get('/resources/order_inspections').loginAs(mine).headers(json)
    listed.assertStatus(200)
    assert.isTrue(listed.body().permissions[String(assigned.id)].update)
    assert.isFalse(listed.body().permissions[String(other.id)].update)
    // Readers see the inspector's name only, never the account e-mail.
    assert.deepInclude(listed.body().related.inspector, {
      id: mine.id,
      fullName: mine.fullName,
      avatarUrl: null,
    })
    assert.notInclude(JSON.stringify(listed.body()), '@example.test')
    // A conditional rule keeps queries by field closed (canQueryField); administrators filter.
    const filtered = await client
      .get(`/resources/order_inspections?filters[inspector]=${mine.id}`)
      .loginAs(mine)
      .headers(json)
    filtered.assertStatus(422)
    const byAdmin = await as(
      client.get(
        `/resources/order_inspections?filters[inspector]=${mine.id}&sort=inspector&direction=desc`
      )
    ).headers(json)
    byAdmin.assertStatus(200)
    assert.deepEqual(
      byAdmin.body().data.map((row: { id: number }) => row.id),
      [assigned.id]
    )

    const updated = await client
      .patch(`/resources/order_inspections/${assigned.id}`)
      .loginAs(mine)
      .withCsrfToken()
      .headers(json)
      .json({ inspector: mine.id, findings: 'تمت الزيارة' })
    updated.assertStatus(200)
    assert.equal(updated.body().data.findings, 'تمت الزيارة')
    const refused = await client
      .patch(`/resources/order_inspections/${other.id}`)
      .loginAs(mine)
      .withCsrfToken()
      .headers(json)
      .json({ inspector: colleague.id, findings: 'محاولة' })
    refused.assertStatus(403)
    // Handing the inspection to a colleague would leave the rule: the new row must match too.
    const handedOver = await client
      .patch(`/resources/order_inspections/${assigned.id}`)
      .loginAs(mine)
      .withCsrfToken()
      .headers(json)
      .json({ inspector: colleague.id, findings: 'نقل' })
    handedOver.assertStatus(403)
    const [row] = await knex()('order_inspections').where('id', Number(other.id))
    assert.equal(row.findings, 'قبل الزيارة')
  })
})
