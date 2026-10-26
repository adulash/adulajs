import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { consumeEvent, seedModules, type DomainEvent } from 'adula'
import { registry } from '#start/modules'
import User from '#models/user'
import { adula } from '#services/adula'
import { evaluateWorkflowSla } from '#services/workflow_sla'
import { listeners } from '#start/listeners'
import { seedActor, type UiActor } from '#tests/helpers/ui_fixtures'

const json = { Accept: 'application/json' }
const knex = () => db.connection().getWriteClient()
/** A UTC calendar date `days` from today, as delegation ranges use. */
const day = (days = 0) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)

/** Publishes pending outbox events to every registered listener, as the worker does. */
async function drainOutbox() {
  const rows = await knex()('outbox').whereNull('published_at').orderBy('created_at')
  for (const row of rows) {
    const event: DomainEvent = { id: row.id, event: row.event, payload: row.payload }
    for (const listener of listeners) await consumeEvent(knex(), listener, event)
    await knex()('outbox').where('id', row.id).update({ published_at: knex().fn.now() })
  }
}

/**
 * A member of a module default role. `scopedTo` stores the role against that unit
 * (user_roles.org_unit_id), which is how `{ manager: role }` escalation finds a manager.
 */
async function roleMember(key: string, orgUnitId: number, fullName: string, scopedTo?: number) {
  const user = await User.create({
    fullName,
    email: `${key}-${Date.now()}-${Math.random()}@example.test`,
    password: 'delegation-test-password-123',
  })
  const role = await knex()('roles').where('key', key).first()
  await knex()('user_roles').insert({
    user_id: user.id,
    role_id: role.id,
    ...(scopedTo ? { org_unit_id: scopedTo } : {}),
  })
  await knex()('user_org_units').insert({ user_id: user.id, org_unit_id: orgUnitId })
  return user
}

test.group('Workflow delegation and SLA over HTTP (ADR 044)', (group) => {
  let clerk: UiActor
  let deputy: UiActor
  let admin: UiActor
  let manager: User
  let director: User
  group.setup(async () => {
    clerk = await seedActor([{ subject: 'orders', action: 'manage' }], {
      fullName: 'مقدم طلب التفويض',
      level: 1,
    })
    await seedModules(knex(), registry, clerk.user.id)
    manager = await roleMember('department_manager', clerk.orgUnitId, 'مدير القسم المفوِّض')
    director = await roleMember(
      'general_manager',
      clerk.orgUnitId,
      'المدير العام للوحدة',
      clerk.orgUnitId
    )
    // The delegate can view orders in the unit; delegation never grants record access.
    deputy = await seedActor([{ subject: 'orders', action: 'view' }], {
      orgUnitId: clerk.orgUnitId,
      fullName: 'نائب المدير',
      level: 1,
    })
    admin = await seedActor([{ subject: 'all', action: 'manage' }], { fullName: 'مسؤول التفويضات' })
  })

  async function submit(client: any, total: string) {
    const created = await client
      .post('/resources/orders')
      .loginAs(clerk.user)
      .withCsrfToken()
      .headers(json)
      .json({ notes: 'طلب أثناء الغياب', total, orgUnitId: clerk.orgUnitId })
    created.assertStatus(201)
    const order = created.body().data
    const submitted = await client
      .post(`/resources/orders/${order.id}/submit`)
      .loginAs(clerk.user)
      .withCsrfToken()
      .headers(json)
      .json({ version: order.version })
    submitted.assertStatus(200)
    await drainOutbox()
    const [run] = await adula().workflows.runsFor(
      'orders',
      Number(order.id),
      await adula().actors.load(clerk.user.id)
    )
    return { id: Number(order.id), runId: run.id }
  }

  async function delegate(client: any, user: User, body: Record<string, unknown>) {
    return client
      .post('/account/delegations')
      .loginAs(user)
      .withCsrfToken()
      .headers(json)
      .json(body)
  }

  async function decide(client: any, user: User, runId: string, decision = 'approve') {
    return client
      .post(`/workflows/${runId}/decide`)
      .loginAs(user)
      .withCsrfToken()
      .headers(json)
      .json({ decision })
  }

  let delegationId: number

  test('a user delegates their approvals, lists and validates them', async ({ client, assert }) => {
    const candidates = await client
      .get('/account/delegations/candidates')
      .qs({ q: 'نائب المدير' })
      .loginAs(manager)
      .headers(json)
    candidates.assertStatus(200)
    assert.deepInclude(candidates.body().data, { id: deputy.user.id, name: 'نائب المدير' })
    const self = await client
      .get('/account/delegations/candidates')
      .qs({ q: 'مدير القسم المفوِّض' })
      .loginAs(manager)
      .headers(json)
    assert.notInclude(
      self.body().data.map((user: { id: number }) => user.id),
      manager.id,
      'a user cannot pick themselves'
    )
    // The picker is no user directory: one character or an e-mail fragment finds nobody.
    for (const q of ['ن', 'example.test']) {
      const probe = await client
        .get('/account/delegations/candidates')
        .qs({ q })
        .loginAs(manager)
        .headers(json)
      probe.assertStatus(200)
      assert.lengthOf(probe.body().data, 0, `"${q}" lists nobody`)
    }

    const created = await delegate(client, manager, {
      delegateId: deputy.user.id,
      startsOn: day(),
      endsOn: day(3),
      note: 'إجازة سنوية',
    })
    created.assertStatus(200)
    const delegation = created.body().data
    delegationId = delegation.id
    assert.equal(delegation.status, 'active')
    assert.equal(delegation.delegateName, 'نائب المدير')
    assert.equal(delegation.startsOn, day())
    assert.equal(delegation.endsOn, day(3))
    assert.equal(delegation.note, 'إجازة سنوية')
    const told = await knex()('notifications')
      .where({ user_id: deputy.user.id, template_key: 'workflow.delegated' })
      .count('* as total')
      .first()
    assert.equal(Number(told?.total), 1, 'the delegate is notified')

    const mine = await client.get('/account/delegations').loginAs(manager).headers(json)
    mine.assertStatus(200)
    assert.equal(mine.body().data.given[0].id, delegationId)
    assert.lengthOf(mine.body().data.received, 0)
    const theirs = await client.get('/account/delegations').loginAs(deputy.user).headers(json)
    assert.equal(theirs.body().data.received[0].id, delegationId)
    assert.equal(theirs.body().data.received[0].delegatorName, 'مدير القسم المفوِّض')
    const page = await client
      .get('/account/delegations')
      .loginAs(manager)
      .header('Accept', 'text/html')
      .withInertia()
    page.assertStatus(200)
    assert.equal(page.body().component, 'account/delegations')
    assert.equal(page.body().props.delegations.given[0].id, delegationId)

    for (const [body, status, code] of [
      [{ delegateId: manager.id, startsOn: day(), endsOn: day(1) }, 422, 'E_DELEGATE'],
      [{ startsOn: day(), endsOn: day(1) }, 422, 'E_DELEGATE'],
      [{ delegateId: deputy.user.id, startsOn: day(5), endsOn: day(4) }, 422, 'E_DELEGATION_RANGE'],
      [
        { delegateId: deputy.user.id, startsOn: '2026/01/01', endsOn: day(1) },
        422,
        'E_DELEGATION_RANGE',
      ],
      [
        { delegateId: deputy.user.id, startsOn: day(-9), endsOn: day(-8) },
        422,
        'E_DELEGATION_RANGE',
      ],
      [
        { delegateId: deputy.user.id, startsOn: day(), endsOn: day(400) },
        422,
        'E_DELEGATION_RANGE',
      ],
      [
        { delegateId: deputy.user.id, startsOn: day(), endsOn: day(1), note: 'م'.repeat(501) },
        422,
        'E_DELEGATION_NOTE',
      ],
      [{ delegateId: director.id, startsOn: day(2), endsOn: day(6) }, 409, 'E_DELEGATION_OVERLAP'],
    ] as const) {
      const refused = await delegate(client, manager, body)
      refused.assertStatus(status)
      assert.equal(refused.body().error.code, code, JSON.stringify(body))
    }
    // Someone else's delegation reads as not found.
    const foreign = await client
      .delete(`/account/delegations/${delegationId}`)
      .loginAs(deputy.user)
      .withCsrfToken()
      .headers(json)
    foreign.assertStatus(404)
  })

  test('the delegate decides on behalf of the approver; the history records both', async ({
    client,
    assert,
  }) => {
    const { id, runId } = await submit(client, '2500000')
    const routed = await knex()('assignments')
      .where({ workflow_run_id: runId, status: 'open' })
      .first()
    assert.equal(routed.assignee_id, deputy.user.id)
    assert.equal(routed.on_behalf_of, manager.id)

    const tasks = await client
      .get('/my-tasks')
      .qs({ tab: 'approvals' })
      .loginAs(deputy.user)
      .headers(json)
    tasks.assertStatus(200)
    const item = tasks.body().data.find((row: any) => row.workflowRunId === runId)
    assert.isTrue(item.canDecide)
    assert.deepEqual(item.onBehalfOf, { id: manager.id, name: 'مدير القسم المفوِّض' })
    assert.equal(item.sla, 'on_time')
    assert.isString(item.dueAt)
    assert.deepEqual(tasks.body().decisions[runId].myApproval.onBehalfOf, {
      id: manager.id,
      name: 'مدير القسم المفوِّض',
    })
    assert.equal(tasks.body().decisions[runId].sla.state, 'on_time')

    const decided = await decide(client, deputy.user, runId)
    decided.assertStatus(200)
    assert.equal(decided.body().data.step, 'director')
    const runs = await client
      .get(`/resources/orders/${id}/workflows`)
      .loginAs(clerk.user)
      .headers(json)
    runs.assertStatus(200)
    const approved = runs.body().data[0].history.find((entry: any) => entry.event === 'approved')
    assert.equal(approved.actorName, 'نائب المدير')
    assert.equal(approved.onBehalfOfName, 'مدير القسم المفوِّض')
    assert.equal(approved.detail.onBehalfOf, manager.id)
  })

  test('after revocation the delegate can no longer decide the delegator approval', async ({
    client,
    assert,
  }) => {
    const { runId } = await submit(client, '2600000')
    const revoked = await client
      .delete(`/account/delegations/${delegationId}`)
      .loginAs(manager)
      .withCsrfToken()
      .headers(json)
    revoked.assertStatus(200)
    const listed = await client.get('/account/delegations').loginAs(manager).headers(json)
    assert.equal(listed.body().data.given[0].status, 'revoked')
    const theirs = await client.get('/account/delegations').loginAs(deputy.user).headers(json)
    assert.lengthOf(theirs.body().data.received, 0, 'a revoked delegation is not shown as received')

    const late = await decide(client, deputy.user, runId)
    late.assertStatus(409)
    // The approval returns to its approver, who decides it as their own.
    const tasks = await client
      .get('/my-tasks')
      .qs({ tab: 'approvals' })
      .loginAs(manager)
      .headers(json)
    const item = tasks.body().data.find((row: any) => row.workflowRunId === runId)
    assert.isTrue(item.canDecide)
    const own = await decide(client, manager, runId)
    own.assertStatus(200)
    const runRow = await knex()('workflow_runs').where('id', runId).first()
    const runs = await adula().workflows.runsFor(
      'orders',
      Number(runRow.record_id),
      await adula().actors.load(clerk.user.id)
    )
    const approved = runs[0].history.find((entry) => entry.event === 'approved')
    assert.equal(approved?.actorName, 'مدير القسم المفوِّض')
    assert.isNull(approved?.onBehalfOfName ?? null)
  })

  test('administration of delegations is for administrators only', async ({ client, assert }) => {
    for (const request of [
      client.get('/admin/delegations').loginAs(deputy.user).headers(json),
      client.get('/admin/delegations/candidates').loginAs(deputy.user).headers(json),
      client
        .post('/admin/delegations')
        .loginAs(deputy.user)
        .withCsrfToken()
        .headers(json)
        .json({
          delegatorId: director.id,
          delegateId: deputy.user.id,
          startsOn: day(),
          endsOn: day(1),
        }),
    ]) {
      const denied = await request
      denied.assertStatus(403)
    }
    const [none] = await knex()('workflow_delegations')
      .where('delegator_id', director.id)
      .count('* as n')
    assert.equal(Number(none.n), 0)

    const created = await client
      .post('/admin/delegations')
      .loginAs(admin.user)
      .withCsrfToken()
      .headers(json)
      .json({
        delegatorId: director.id,
        delegateId: deputy.user.id,
        startsOn: day(1),
        endsOn: day(2),
      })
    created.assertStatus(200)
    const delegation = created.body().data
    assert.equal(delegation.delegatorId, director.id)
    assert.equal(delegation.status, 'scheduled')
    assert.equal(delegation.createdBy, admin.user.id)
    const overlap = await client
      .post('/admin/delegations')
      .loginAs(admin.user)
      .withCsrfToken()
      .headers(json)
      .json({
        delegatorId: director.id,
        delegateId: deputy.user.id,
        startsOn: day(2),
        endsOn: day(3),
      })
    overlap.assertStatus(409)

    const list = await client.get('/admin/delegations').loginAs(admin.user).headers(json)
    list.assertStatus(200)
    assert.include(
      list.body().data.map((item: { id: number }) => item.id),
      delegation.id
    )
    const page = await client
      .get('/admin/delegations')
      .loginAs(admin.user)
      .header('Accept', 'text/html')
      .withInertia()
    page.assertStatus(200)
    assert.equal(page.body().component, 'admin/delegations/index')
    const candidates = await client
      .get('/admin/delegations/candidates')
      .qs({ q: 'المدير العام للوحدة' })
      .loginAs(admin.user)
      .headers(json)
    assert.deepInclude(candidates.body().data, { id: director.id, name: 'المدير العام للوحدة' })

    const revoked = await client
      .delete(`/admin/delegations/${delegation.id}`)
      .loginAs(admin.user)
      .withCsrfToken()
      .headers(json)
    revoked.assertStatus(200)
    const after = await client.get('/admin/delegations').loginAs(admin.user).headers(json)
    assert.notInclude(
      after.body().data.map((item: { id: number }) => item.id),
      delegation.id
    )
    const activity = await knex()('activities')
      .where({ resource: 'core.workflow_delegations', record_id: delegation.id })
      .orderBy('id')
      .select('action')
    assert.deepEqual(
      activity.map((row) => row.action),
      ['delegation_created', 'delegation_revoked']
    )
  })

  test('an approval past its SLA is reminded once, then escalated once to the manager', async ({
    client,
    assert,
  }) => {
    const { id, runId } = await submit(client, '2700000')
    const open = await knex()('assignments')
      .where({ workflow_run_id: runId, status: 'open' })
      .first()
    assert.equal(open.assignee_id, manager.id, 'the revoked delegation no longer routes')
    const hours = (Date.parse(open.due_at) - Date.now()) / 3600000
    assert.closeTo(hours, 48, 0.1)
    assert.closeTo((Date.parse(open.due_at) - Date.parse(open.due_soon_at)) / 3600000, 8, 0.01)

    const sent = async (userId: number, template: string) => {
      const [row] = await knex()('notifications')
        .where({ user_id: userId, template_key: template, resource: 'orders', record_id: id })
        .count('* as n')
      return Number(row.n)
    }
    const state = async () => {
      const runs = await client
        .get(`/resources/orders/${id}/workflows`)
        .loginAs(clerk.user)
        .headers(json)
      return runs.body().data[0]
    }

    // The clock that drives SLA states lives in the core tests; here the deadline moves.
    await knex()('assignments')
      .where('id', open.id)
      .update({
        due_soon_at: new Date(Date.now() - 60000),
        due_at: new Date(Date.now() + 3600000),
      })
    const first = await evaluateWorkflowSla()
    assert.isAtLeast(first.reminded, 1)
    await evaluateWorkflowSla()
    assert.equal(await sent(manager.id, 'workflow.sla_due_soon'), 1, 'one reminder')
    const soon = await state()
    assert.equal(soon.sla.state, 'due_soon')

    await knex()('assignments')
      .where('id', open.id)
      .update({ due_at: new Date(Date.now() - 60000) })
    const late = await evaluateWorkflowSla()
    assert.isAtLeast(late.escalated, 1)
    await evaluateWorkflowSla()
    assert.equal(await sent(manager.id, 'workflow.sla_overdue'), 1, 'the approver is told once')
    assert.equal(
      await sent(director.id, 'workflow.sla_escalated'),
      1,
      'the general manager of the unit is told once'
    )
    assert.equal(await sent(manager.id, 'workflow.sla_due_soon'), 1)

    const run = await state()
    assert.equal(run.sla.state, 'overdue')
    assert.isTrue(run.sla.escalated)
    const events = run.history.map((entry: { event: string }) => entry.event)
    assert.equal(events.filter((event: string) => event === 'sla_reminded').length, 1)
    assert.equal(events.filter((event: string) => event === 'sla_escalated').length, 1)
    const escalation = run.history.find((entry: any) => entry.event === 'sla_escalated')
    assert.equal(escalation.detail.action, 'notify')
    assert.deepEqual(escalation.detail.targets, [director.id])
    const escalations = await knex()('workflow_escalations').where('run_id', runId).orderBy('id')
    assert.deepEqual(
      escalations.map((row) => row.level),
      ['due_soon', 'overdue']
    )

    // The approval stays with the manager (notify does not reassign) and remains decidable.
    const tasks = await client
      .get('/my-tasks')
      .qs({ tab: 'approvals' })
      .loginAs(manager)
      .headers(json)
    const item = tasks.body().data.find((row: any) => row.workflowRunId === runId)
    assert.equal(item.sla, 'overdue')
    const decided = await decide(client, manager, runId)
    decided.assertStatus(200)
    assert.equal(decided.body().data.step, 'director')
  })
})
