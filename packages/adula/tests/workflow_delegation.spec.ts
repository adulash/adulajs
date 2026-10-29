import { test } from '@japa/runner'
import {
  Assignments,
  ResourceService,
  WorkflowDelegations,
  WorkflowEngine,
  consumeEvent,
  defineWorkflow,
  publishOutbox,
} from '../index.js'
import type { Actor, DomainEvent, WorkflowDefinition } from '../index.js'
import { admin, db, reader, registry, setup } from './helpers.js'
import { failure } from './helpers/failure.js'
import { addUserProfileColumns, seedActor } from './helpers/actors.js'

/** The usual approver of unit 1.2. */
const manager: Actor = {
  id: 3,
  orgPaths: ['1.2'],
  permissionLevel: 1,
  rules: [{ subject: 'orders', action: 'view' }],
}
/** The manager's deputy in the same unit: may read the same orders. */
const deputy: Actor = {
  id: 4,
  orgPaths: ['1.2'],
  permissionLevel: 1,
  rules: [{ subject: 'orders', action: 'view' }],
}
/** A user of the sibling unit 1.3: never reads unit 1.2 orders. */
const stranger: Actor = {
  id: 5,
  orgPaths: ['1.3'],
  permissionLevel: 1,
  rules: [{ subject: 'orders', action: 'view' }],
}
/** Another approver of unit 1.2 who never delegated to the deputy. */
const peer: Actor = {
  id: 6,
  orgPaths: ['1.2'],
  permissionLevel: 1,
  rules: [{ subject: 'orders', action: 'view' }],
}
/** A disabled account. */
const retired: Actor = { id: 7, orgPaths: ['1.2'], permissionLevel: 0, rules: [] }
const actors = new Map(
  [admin, reader, manager, deputy, stranger, peer, retired].map((actor) => [actor.id, actor])
)

/** One approval step; orders whose notes say "peer" go to the peer instead of the manager. */
function approval(): WorkflowDefinition {
  return defineWorkflow({
    name: 'delegated_approval',
    version: 1,
    resource: 'orders',
    label: 'اعتماد الطلب',
    start: 'review',
    steps: {
      review: {
        type: 'approval',
        label: 'موافقة المدير',
        assignees: ({ record }) => (record.notes === 'peer' ? [peer.id] : [manager.id]),
        approve: 'approved',
        reject: 'rejected',
      },
      approved: { type: 'end', outcome: 'approved' },
      rejected: { type: 'end', outcome: 'rejected' },
    },
  })
}

const START = new Date('2026-10-10T08:00:00Z')

test.group('Workflow approval delegation', (group) => {
  let now = START
  const clock = () => now
  const service = () => new ResourceService(db, registry)
  const loader = { load: async (id: number) => actors.get(id)! }
  const assignments = () => new Assignments(db, service(), loader, { now: clock })
  const engine = () =>
    new WorkflowEngine(db, registry, service(), loader, assignments(), [approval()], {
      now: clock,
    })
  const delegations = () => new WorkflowDelegations(db, { now: clock })

  group.setup(async () => {
    await setup()
    await addUserProfileColumns()
    await seedActor(manager, { email: 'manager@example.test', fullName: 'مدير القسم' })
    await seedActor(deputy, { email: 'deputy@example.test', fullName: 'نائب المدير' })
    await seedActor(stranger, { email: 'stranger@example.test', fullName: 'موظف فرع آخر' })
    await seedActor(peer, { email: 'peer@example.test', fullName: 'زميل' })
    await seedActor(retired, { email: 'retired@example.test', fullName: 'متقاعد', disabled: true })
  })
  group.each.setup(async () => {
    now = START
    await db('workflow_escalations').del()
    await db('workflow_events').del()
    await db('assignments').del()
    await db('workflow_delegations').del()
    await db('workflow_runs').del()
    await db('processed_events').del()
    await db('outbox').del()
    await db('notifications').del()
    await db('activities').del()
  })

  async function deliver(workflows: WorkflowEngine) {
    const events: DomainEvent[] = []
    await publishOutbox(db, {
      dispatch: async (_, payload) => {
        events.push(payload as unknown as DomainEvent)
      },
    })
    for (const event of events)
      for (const listener of workflows.listeners()) await consumeEvent(db, listener, event)
  }

  /** Submits a unit 1.2 order and returns the id of its waiting run. */
  async function submitted(workflows: WorkflowEngine, notes = 'طلب للاعتماد') {
    const saved = await service().save('orders', reader, { notes, orgUnitId: 2 })
    const shown = await service().show('orders', Number(saved.id), admin)
    await service().transition('orders', Number(saved.id), reader, 'submit', shown.data.version)
    await deliver(workflows)
    const [run] = await workflows.runsFor('orders', Number(saved.id), admin)
    if (run.status !== 'waiting') throw new Error(`Run not waiting: ${run.status} ${run.lastError}`)
    return run.id
  }

  /** One column of the first matching row. */
  async function column(table: string, where: Record<string, unknown>, name: string) {
    const row = await db(table).where(where).first()
    return row?.[name]
  }
  const ids = (list: { id: unknown }[]) => list.map((item) => item.id)
  async function given(userId: number) {
    const { given: list } = await delegations().forUser(userId)
    return list
  }
  async function newest(userId: number, key: 'id' | 'status') {
    const [first] = await given(userId)
    return first[key]
  }
  async function received(userId: number) {
    const { received: list } = await delegations().forUser(userId)
    return list
  }
  async function openTasks(actor: Actor) {
    const { data } = await assignments().mine(actor)
    return data
  }
  async function myApproval(runId: string, actor: Actor) {
    const run = await engine().run(runId, actor)
    return run.myApproval
  }
  async function outcomeOf(runId: string, actor: Actor) {
    const { outcome } = await engine().decide(runId, actor, 'approve')
    return outcome
  }

  const delegate = (delegatorId: number, delegateId: number, startsOn: string, endsOn: string) =>
    delegations().create({ delegatorId, delegateId, startsOn, endsOn }, delegatorId)

  test('refuses self, invalid, past, over-long and overlapping delegations', async ({ assert }) => {
    const refused = async (input: Record<string, unknown>) =>
      failure(() =>
        delegations().create(
          { delegatorId: manager.id, delegateId: deputy.id, ...input } as never,
          manager.id
        )
      )
    const self = await refused({
      delegateId: manager.id,
      startsOn: '2026-10-10',
      endsOn: '2026-10-12',
    })
    assert.deepEqual([self.status, self.code], [422, 'E_DELEGATE'])
    const nobody = await refused({ delegateId: '', startsOn: '2026-10-10', endsOn: '2026-10-12' })
    assert.equal(nobody.code, 'E_DELEGATE')
    const missing = await refused({ delegateId: 999, startsOn: '2026-10-10', endsOn: '2026-10-12' })
    assert.deepEqual([missing.status, missing.code], [422, 'E_DELEGATE'])
    const disabled = await refused({
      delegateId: retired.id,
      startsOn: '2026-10-10',
      endsOn: '2026-10-12',
    })
    assert.deepEqual([disabled.status, disabled.code], [422, 'E_DELEGATE'])
    const format = await refused({ startsOn: '10/10/2026', endsOn: '2026-10-12' })
    assert.equal(format.code, 'E_DELEGATION_RANGE')
    const reversed = await refused({ startsOn: '2026-10-12', endsOn: '2026-10-11' })
    assert.equal(reversed.code, 'E_DELEGATION_RANGE')
    // A range that already ended (UTC calendar date) cannot be created.
    const past = await refused({ startsOn: '2026-10-01', endsOn: '2026-10-09' })
    assert.deepEqual([past.status, past.code], [422, 'E_DELEGATION_RANGE'])
    // At most a year: 366 days apart is refused, 365 is accepted.
    const long = await refused({ startsOn: '2026-10-10', endsOn: '2027-10-11' })
    assert.equal(long.code, 'E_DELEGATION_RANGE')
    const note = await refused({
      startsOn: '2026-10-10',
      endsOn: '2026-10-12',
      note: 'x'.repeat(501),
    })
    assert.equal(note.code, 'E_DELEGATION_NOTE')
    assert.lengthOf(await db('workflow_delegations'), 0)
    assert.lengthOf(await db('notifications'), 0)

    const year = await delegate(manager.id, deputy.id, '2026-10-10', '2027-10-10')
    assert.equal(year.status, 'active')
    await delegations().revoke(year.id, manager.id)

    // Ranges are inclusive: touching another delegation's last day overlaps it.
    const first = await delegate(manager.id, deputy.id, '2026-10-12', '2026-10-15')
    assert.equal(first.status, 'scheduled')
    assert.deepEqual([first.startsOn, first.endsOn], ['2026-10-12', '2026-10-15'])
    const touching = await failure(() =>
      delegate(manager.id, deputy.id, '2026-10-15', '2026-10-20')
    )
    assert.deepEqual([touching.status, touching.code], [409, 'E_DELEGATION_OVERLAP'])
    // One delegate per date range, whoever the second delegate is.
    const second = await failure(() => delegate(manager.id, peer.id, '2026-10-13', '2026-10-14'))
    assert.equal(second.code, 'E_DELEGATION_OVERLAP')
    const adjacent = await delegate(manager.id, deputy.id, '2026-10-16', '2026-10-20')
    assert.equal(adjacent.status, 'scheduled')
    // Another delegator's ranges are independent.
    await delegate(peer.id, deputy.id, '2026-10-12', '2026-10-15')
    // A revoked delegation no longer blocks its range.
    await delegations().revoke(first.id, manager.id)
    const again = await delegate(manager.id, peer.id, '2026-10-12', '2026-10-15')
    assert.equal(again.delegateName, 'زميل')
    const listed = await delegations().forUser(manager.id)
    assert.deepEqual(
      listed.given.map((item) => item.status),
      ['scheduled', 'scheduled', 'revoked', 'revoked']
    )
    assert.sameMembers(ids(await delegations().current()), [
      adjacent.id,
      again.id,
      await newest(peer.id, 'id'),
    ])
  })

  test('refuses an impossible calendar date with a validation error', async ({ assert }) => {
    // 2027-02-30 matches the YYYY-MM-DD shape but is not a date; PostgreSQL would refuse it.
    const impossible = await failure(() =>
      delegate(manager.id, deputy.id, '2027-02-01', '2027-02-30')
    )
    assert.deepEqual([impossible.status, impossible.code], [422, 'E_DELEGATION_RANGE'])
  })

  test('routes a new approval to the delegate, who decides for the approver', async ({
    assert,
  }) => {
    const workflows = engine()
    const created = await delegations().create(
      {
        delegatorId: manager.id,
        delegateId: deputy.id,
        startsOn: '2026-10-10',
        endsOn: '2026-10-12',
        note: ' إجازة سنوية ',
      },
      manager.id
    )
    assert.include(created, {
      delegatorId: manager.id,
      delegatorName: 'مدير القسم',
      delegateId: deputy.id,
      delegateName: 'نائب المدير',
      note: 'إجازة سنوية',
      status: 'active',
      createdBy: manager.id,
      revokedAt: null,
    })
    const [notice] = await db('notifications').where({
      user_id: deputy.id,
      template_key: 'workflow.delegated',
    })
    assert.include(notice.title, 'مدير القسم')
    assert.include(notice.body, '2026-10-10')
    assert.include(notice.body, '2026-10-12')
    const [activity] = await db('activities').where({
      resource: 'core.workflow_delegations',
      record_id: created.id,
    })
    assert.equal(activity.action, 'delegation_created')
    assert.equal(activity.actor_id, manager.id)
    assert.deepInclude(activity.changes, {
      delegatorId: manager.id,
      delegateId: deputy.id,
      startsOn: '2026-10-10',
      endsOn: '2026-10-12',
    })
    assert.deepEqual(ids(await received(deputy.id)), [created.id])

    const runId = await submitted(workflows)
    const rows = await db('assignments').where({ workflow_run_id: runId })
    assert.lengthOf(rows, 1)
    assert.include(rows[0], {
      assignee_id: deputy.id,
      on_behalf_of: manager.id,
      delegation_id: created.id,
      status: 'open',
    })
    const requested = await db('workflow_events')
      .where({ run_id: runId, event: 'approval_requested' })
      .first()
    assert.deepEqual(requested.detail, {
      approvers: [manager.id],
      delegated: [{ from: manager.id, to: deputy.id }],
    })
    // The approval notice goes to the person who holds it now.
    assert.lengthOf(
      await db('notifications').where({ user_id: deputy.id, template_key: 'assignment.approval' }),
      1
    )
    assert.lengthOf(
      await db('notifications').where({ user_id: manager.id, template_key: 'assignment.approval' }),
      0
    )

    const [held] = await workflows.inbox(deputy)
    assert.equal(held.id, runId)
    assert.deepEqual(held.myApproval?.onBehalfOf, { id: manager.id, name: 'مدير القسم' })
    // The approver of record still sees and may decide the routed approval.
    const [own] = await workflows.inbox(manager)
    assert.equal(own.id, runId)
    assert.isNull(own.myApproval?.onBehalfOf)

    const deputyTasks = await assignments().mine(deputy, { kind: 'approval' })
    assert.equal(deputyTasks.approvals, 1)
    assert.lengthOf(deputyTasks.data, 1)
    assert.include(deputyTasks.data[0], { assigneeId: deputy.id, canDecide: true })
    assert.deepEqual(deputyTasks.data[0].onBehalfOf, { id: manager.id, name: 'مدير القسم' })
    const managerTasks = await assignments().mine(manager, { kind: 'approval' })
    assert.lengthOf(managerTasks.data, 1)
    assert.isTrue(managerTasks.data[0].canDecide)
    assert.isNull(managerTasks.data[0].onBehalfOf)

    const decided = await workflows.decide(runId, deputy, 'approve', 'موافق نيابة عن المدير')
    assert.equal(decided.status, 'completed')
    assert.equal(decided.outcome, 'approved')
    const event = await db('workflow_events').where({ run_id: runId, event: 'approved' }).first()
    assert.equal(event.actor_id, deputy.id)
    assert.deepInclude(event.detail, {
      onBehalfOf: manager.id,
      onBehalfOfName: 'مدير القسم',
      comment: 'موافق نيابة عن المدير',
    })
    const entry = decided.history.find((item) => item.event === 'approved')
    assert.equal(entry?.actorName, 'نائب المدير')
    assert.equal(entry?.onBehalfOfName, 'مدير القسم')
    const done = await db('assignments').where({ workflow_run_id: runId }).first()
    assert.include(done, { status: 'done', outcome: 'approve', completed_by: deputy.id })
    // Both see the decided approval among their closed items.
    for (const actor of [manager, deputy]) {
      const closed = await assignments().mine(actor, { status: 'done', kind: 'approval' })
      assert.deepEqual(
        closed.data.map((item) => item.workflowRunId),
        [runId]
      )
      assert.isFalse(closed.data[0].canDecide)
    }
  })

  test("the delegator's pending approval becomes visible and decidable by the delegate", async ({
    assert,
  }) => {
    const workflows = engine()
    const runId = await submitted(workflows)
    const [pending] = await db('assignments').where({ workflow_run_id: runId })
    assert.include(pending, { assignee_id: manager.id, on_behalf_of: null, delegation_id: null })
    assert.lengthOf(await workflows.inbox(deputy), 0)
    const early = await failure(() => workflows.decide(runId, deputy, 'approve'))
    assert.equal(early.code, 'E_WORKFLOW_STATE')

    await delegate(manager.id, deputy.id, '2026-10-10', '2026-10-11')
    const [held] = await workflows.inbox(deputy)
    assert.equal(held.id, runId)
    assert.deepEqual(held.myApproval?.onBehalfOf, { id: manager.id, name: 'مدير القسم' })
    const shown = await workflows.run(runId, deputy)
    assert.equal(shown.myApproval?.assignmentId, Number(pending.id))
    const page = await assignments().mine(deputy)
    assert.equal(page.open, 1)
    assert.equal(page.approvals, 1)
    assert.lengthOf(page.data, 1)
    assert.include(page.data[0], {
      id: Number(pending.id),
      assigneeId: manager.id,
      canDecide: true,
    })
    assert.deepEqual(page.data[0].onBehalfOf, { id: manager.id, name: 'مدير القسم' })
    // The approver keeps the approval as their own.
    const managerPage = await assignments().mine(manager)
    assert.isTrue(managerPage.data[0].canDecide)
    assert.isNull(managerPage.data[0].onBehalfOf)

    const rejected = await workflows.decide(runId, deputy, 'reject', 'السعر مرتفع')
    assert.equal(rejected.outcome, 'rejected')
    const event = await db('workflow_events').where({ run_id: runId, event: 'rejected' }).first()
    assert.equal(event.actor_id, deputy.id)
    assert.deepInclude(event.detail, { onBehalfOf: manager.id, onBehalfOfName: 'مدير القسم' })
    const closed = await db('assignments').where('id', pending.id).first()
    assert.include(closed, { status: 'done', completed_by: deputy.id })
  })

  test('a delegate cannot decide for others or take manual tasks', async ({ assert }) => {
    const workflows = engine()
    await delegate(manager.id, deputy.id, '2026-10-10', '2026-10-12')
    // The peer never delegated: their approval stays theirs alone.
    const peerRun = await submitted(workflows, 'peer')
    const [peerRow] = await db('assignments').where({ workflow_run_id: peerRun })
    assert.include(peerRow, { assignee_id: peer.id, on_behalf_of: null })
    assert.notInclude(ids(await workflows.inbox(deputy)), peerRun)
    const foreign = await failure(() => workflows.decide(peerRun, deputy, 'approve'))
    assert.deepEqual([foreign.status, foreign.code], [409, 'E_WORKFLOW_STATE'])
    assert.equal(await column('assignments', { id: peerRow.id }, 'status'), 'open')

    // Manual tasks are never delegated, only workflow approvals.
    const saved = await service().save('orders', reader, { notes: 'مهمة يدوية', orgUnitId: 2 })
    const task = await assignments().assign('orders', Number(saved.id), reader, {
      assigneeId: manager.id,
      title: 'تدقيق المرفقات',
    })
    const deputyTasks = await assignments().mine(deputy, { kind: 'task' })
    assert.lengthOf(deputyTasks.data, 0)
    const all = await assignments().mine(deputy)
    assert.notInclude(
      all.data.map((item) => item.id),
      task.id
    )
    const taken = await failure(() => assignments().complete(task.id, deputy))
    assert.deepEqual([taken.status, taken.code], [404, 'E_ASSIGNMENT_NOT_FOUND'])
    assert.equal(await column('assignments', { id: task.id }, 'status'), 'open')
    const managerTasks = await assignments().mine(manager, { kind: 'task' })
    assert.isTrue(managerTasks.data[0].canComplete)
  })

  test('a delegation never widens what the delegate may read', async ({ assert }) => {
    const workflows = engine()
    const before = await submitted(workflows)
    await delegate(manager.id, stranger.id, '2026-10-10', '2026-10-12')
    // The stranger cannot read unit 1.2 orders, so a new approval stays with the manager.
    const after = await submitted(workflows)
    const [routed] = await db('assignments').where({ workflow_run_id: after })
    assert.include(routed, { assignee_id: manager.id, on_behalf_of: null, delegation_id: null })
    const requested = await db('workflow_events')
      .where({ run_id: after, event: 'approval_requested' })
      .first()
    assert.deepEqual(requested.detail, { approvers: [manager.id] })

    assert.lengthOf(await workflows.inbox(stranger), 0)
    const page = await assignments().mine(stranger)
    assert.lengthOf(page.data, 0)
    // The My tasks badge must not reveal approvals on records the delegate cannot open.
    assert.deepEqual([page.open, page.approvals], [0, 0])
    for (const runId of [before, after]) {
      const decided = await failure(() => workflows.decide(runId, stranger, 'approve'))
      assert.deepEqual([decided.status, decided.code], [404, 'E_WORKFLOW_NOT_FOUND'])
      const shown = await failure(() => workflows.run(runId, stranger))
      assert.equal(shown.status, 404)
    }
    assert.lengthOf(await db('assignments').where({ status: 'open' }), 2)
    for (const runId of [before, after]) assert.equal(await outcomeOf(runId, manager), 'approved')
  })

  test('the delegation ends after its last UTC day; the approver keeps the approval', async ({
    assert,
  }) => {
    const workflows = engine()
    const created = await delegate(manager.id, deputy.id, '2026-10-10', '2026-10-12')
    const runId = await submitted(workflows)
    assert.equal(await column('assignments', { workflow_run_id: runId }, 'assignee_id'), deputy.id)
    // The last day is inclusive up to midnight UTC.
    now = new Date('2026-10-12T23:59:59Z')
    assert.deepEqual(ids(await workflows.inbox(deputy)), [runId])
    now = new Date('2026-10-13T00:00:00Z')
    assert.lengthOf(await workflows.inbox(deputy), 0)
    assert.lengthOf(await openTasks(deputy), 0)
    const { open } = await assignments().mine(deputy)
    assert.equal(open, 0)
    assert.isNull(await myApproval(runId, deputy))
    const late = await failure(() => workflows.decide(runId, deputy, 'approve'))
    assert.deepEqual([late.status, late.code], [409, 'E_WORKFLOW_STATE'])
    assert.equal(await newest(manager.id, 'status'), 'ended')
    assert.notInclude(ids(await delegations().current()), created.id)

    const [own] = await workflows.inbox(manager)
    assert.equal(own.id, runId)
    const managerPage = await assignments().mine(manager)
    assert.isTrue(managerPage.data[0].canDecide)
    const decided = await workflows.decide(runId, manager, 'approve')
    assert.equal(decided.outcome, 'approved')
    const event = await db('workflow_events').where({ run_id: runId, event: 'approved' }).first()
    assert.equal(event.actor_id, manager.id)
    assert.notProperty(event.detail, 'onBehalfOf')
    // New approvals after the end go straight to the approver.
    const next = await submitted(workflows)
    assert.include(await db('assignments').where({ workflow_run_id: next }).first(), {
      assignee_id: manager.id,
      delegation_id: null,
    })
  })

  test('revocation ends the delegate access; only the delegator or an admin revokes', async ({
    assert,
  }) => {
    const workflows = engine()
    const created = await delegate(manager.id, deputy.id, '2026-10-10', '2026-10-12')
    const runId = await submitted(workflows)
    for (const [id, actorId] of [
      [created.id, deputy.id],
      [created.id, admin.id],
      ['abc', manager.id],
      [999999, manager.id],
    ] as const) {
      const refused = await failure(() => delegations().revoke(id, actorId))
      assert.deepEqual([refused.status, refused.code], [404, 'E_DELEGATION_NOT_FOUND'])
    }
    assert.isNull(await column('workflow_delegations', { id: created.id }, 'revoked_at'))

    await delegations().revoke(created.id, manager.id)
    const stored = await db('workflow_delegations').where('id', created.id).first()
    assert.equal(stored.revoked_by, manager.id)
    assert.equal(new Date(stored.revoked_at).toISOString(), START.toISOString())
    const revokedLog = await db('activities').where({
      resource: 'core.workflow_delegations',
      record_id: created.id,
      action: 'delegation_revoked',
    })
    assert.lengthOf(revokedLog, 1)
    assert.equal(revokedLog[0].actor_id, manager.id)
    assert.deepInclude(revokedLog[0].changes, { delegatorId: manager.id, delegateId: deputy.id })

    assert.lengthOf(await workflows.inbox(deputy), 0)
    assert.lengthOf(await openTasks(deputy), 0)
    const late = await failure(() => workflows.decide(runId, deputy, 'approve'))
    assert.equal(late.code, 'E_WORKFLOW_STATE')
    assert.lengthOf(await received(deputy.id), 0)
    assert.equal(await newest(manager.id, 'status'), 'revoked')
    assert.equal(await outcomeOf(runId, manager), 'approved')

    // Administrators revoke anyone's delegation; a repeated revocation changes nothing.
    const other = await delegate(manager.id, peer.id, '2026-10-10', '2026-10-12')
    await delegations().revoke(other.id, admin.id, { any: true })
    await delegations().revoke(other.id, admin.id, { any: true })
    const adminLog = await db('activities').where({
      resource: 'core.workflow_delegations',
      record_id: other.id,
      action: 'delegation_revoked',
    })
    assert.lengthOf(adminLog, 1)
    assert.equal(adminLog[0].actor_id, admin.id)
    assert.equal(await column('workflow_delegations', { id: other.id }, 'revoked_by'), admin.id)
  })

  test('a delegate never approves a request they submitted', async ({ assert }) => {
    const workflows = engine()
    // A pending approval from before the delegation, and one opened during it.
    const before = await submitted(workflows)
    await delegate(manager.id, reader.id, '2026-10-10', '2026-10-12')
    const during = await submitted(workflows)
    assert.equal(
      await column('assignments', { workflow_run_id: during, status: 'open' }, 'assignee_id'),
      manager.id,
      'the approval stays with the approver instead of going to its submitter'
    )
    assert.lengthOf(await workflows.inbox(reader), 0)
    const tasks = await openTasks(reader)
    assert.notInclude(
      tasks.map((item) => item.workflowRunId),
      before,
      'the pending approval is not offered to its submitter'
    )
    for (const runId of [before, during]) {
      const refused = await failure(() => workflows.decide(runId, reader, 'approve'))
      assert.deepEqual([refused.status, refused.code], [409, 'E_WORKFLOW_STATE'])
      assert.equal(await outcomeOf(runId, manager), 'approved')
    }
  })

  test('approvals routed through an ended delegation follow the approver to the next delegate', async ({
    assert,
  }) => {
    const workflows = engine()
    await delegate(manager.id, deputy.id, '2026-10-10', '2026-10-11')
    const runId = await submitted(workflows)
    assert.equal(
      await column('assignments', { workflow_run_id: runId, status: 'open' }, 'assignee_id'),
      deputy.id
    )
    now = new Date('2026-10-13T08:00:00Z')
    await delegate(manager.id, peer.id, '2026-10-13', '2026-10-14')
    assert.lengthOf(await workflows.inbox(deputy), 0, 'the ended delegate lost it')
    assert.deepEqual(ids(await workflows.inbox(peer)), [runId])
    const held = await myApproval(runId, peer)
    assert.equal(held?.onBehalfOf?.id, manager.id)
    const peerTasks = await openTasks(peer)
    const task = peerTasks.find((item) => item.workflowRunId === runId)!
    assert.deepEqual([task.canDecide, task.onBehalfOf?.id], [true, manager.id])
    assert.equal(await outcomeOf(runId, peer), 'approved')
    const decided = await db('workflow_events').where({ run_id: runId, event: 'approved' }).first()
    assert.deepEqual([decided.actor_id, decided.detail.onBehalfOf], [peer.id, manager.id])
  })

  test('revoking a delegation returns its routed approvals to the approver', async ({ assert }) => {
    const workflows = engine()
    const created = await delegate(manager.id, deputy.id, '2026-10-10', '2026-10-12')
    const runId = await submitted(workflows)
    await delegations().revoke(created.id, manager.id)
    const row = await db('assignments').where({ workflow_run_id: runId, status: 'open' }).first()
    assert.deepEqual(
      [row.assignee_id, row.on_behalf_of, row.delegation_id],
      [manager.id, null, null]
    )
    const log = await db('activities').where({ action: 'delegation_revoked' }).first()
    assert.equal(log.changes.returned, 1)
    assert.lengthOf(await workflows.inbox(deputy), 0)
    assert.deepEqual(ids(await workflows.inbox(manager)), [runId])
  })

  test('an approval stays with its approver when the delegate is away too', async ({ assert }) => {
    const workflows = engine()
    await delegate(manager.id, deputy.id, '2026-10-10', '2026-10-12')
    await delegate(deputy.id, peer.id, '2026-10-10', '2026-10-12')
    const runId = await submitted(workflows)
    const row = await db('assignments').where({ workflow_run_id: runId, status: 'open' }).first()
    assert.deepEqual([row.assignee_id, row.on_behalf_of], [manager.id, null])
    assert.lengthOf(await workflows.inbox(peer), 0, 'routing never chains to a second delegate')
  })

  test('delegation days follow the system time zone', async ({ assert }) => {
    // 01:00 on 10 October in Riyadh is still 9 October in UTC.
    now = new Date('2026-10-09T22:00:00Z')
    const zone = { now: clock, timeZone: 'Asia/Riyadh' }
    const riyadh = new WorkflowDelegations(db, zone)
    const created = await riyadh.create(
      {
        delegatorId: manager.id,
        delegateId: deputy.id,
        startsOn: '2026-10-10',
        endsOn: '2026-10-10',
      },
      manager.id
    )
    assert.equal(created.status, 'active')
    const [inUtc] = await given(manager.id)
    assert.equal(inUtc.status, 'scheduled', 'the same range has not started in UTC')
    const workflows = new WorkflowEngine(
      db,
      registry,
      service(),
      loader,
      new Assignments(db, service(), loader, zone),
      [approval()],
      zone
    )
    const runId = await submitted(workflows)
    assert.equal(
      await column('assignments', { workflow_run_id: runId, status: 'open' }, 'assignee_id'),
      deputy.id
    )
    // 03:00 on 11 October in Riyadh: the one-day delegation has ended there.
    now = new Date('2026-10-11T00:00:00Z')
    assert.lengthOf(await workflows.inbox(deputy), 0)
    assert.throws(
      () => new WorkflowDelegations(db, { timeZone: 'Nowhere/City' }),
      /Unknown time zone/
    )
  })
})
