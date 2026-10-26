import { test } from '@japa/runner'
import { getNextSnapshot } from 'xstate'
import {
  Assignments,
  ResourceService,
  WorkflowDelegations,
  WorkflowEngine,
  consumeEvent,
  defineWorkflow,
  nextStep,
  publishOutbox,
} from '../index.js'
import type {
  Actor,
  DomainEvent,
  Recipients,
  StepSla,
  WorkflowDefinition,
  WorkflowEvent,
  WorkflowInput,
} from '../index.js'
import { admin, db, reader, registry, setup } from './helpers.js'
import { failure } from './helpers/failure.js'
import { addUserProfileColumns, seedActor } from './helpers/actors.js'

const viewOrders = [{ subject: 'orders', action: 'view' }]
/** The approver; in the org tree they sit in unit 4 (1.2.4), below unit 2. */
const manager: Actor = { id: 3, orgPaths: ['1.2'], permissionLevel: 1, rules: viewOrders }
/** Head of unit 2 (1.2), the approver's nearest ancestor with the role. */
const head2: Actor = { id: 5, orgPaths: ['1.2'], permissionLevel: 1, rules: viewOrders }
/** Head of the root unit: an ancestor, but farther than unit 2. */
const head1: Actor = { id: 6, orgPaths: ['1'], permissionLevel: 1, rules: viewOrders }
/** Head of unit 4 itself, added for one case. */
const head4: Actor = { id: 7, orgPaths: ['1.2'], permissionLevel: 1, rules: viewOrders }
/** Head of the sibling unit 3: may read the order, but is not in the approver's line. */
const head3: Actor = { id: 8, orgPaths: ['1'], permissionLevel: 1, rules: viewOrders }
/** Holder of the backup approver role. */
const backup: Actor = { id: 9, orgPaths: ['1.2'], permissionLevel: 1, rules: viewOrders }
/** Cannot read unit 1.2 orders. */
const stranger: Actor = { id: 10, orgPaths: ['1.3'], permissionLevel: 1, rules: viewOrders }
const actors = new Map(
  [admin, reader, manager, head2, head1, head4, head3, backup, stranger].map((actor) => [
    actor.id,
    actor,
  ])
)

const START = new Date('2026-10-10T08:00:00Z')
const HOUR = 3600000

/** One approval (or decision) step with the given SLA, then an end step. */
function slaFlow(
  sla: StepSla,
  options: { type?: 'approval' | 'decision'; assignees?: Recipients } = {}
): WorkflowDefinition {
  const assignees = options.assignees ?? { users: [manager.id] }
  return defineWorkflow({
    name: 'sla_approval',
    version: 1,
    resource: 'orders',
    label: 'اعتماد بمهلة',
    start: 'review',
    steps: {
      review:
        options.type === 'decision'
          ? {
              type: 'decision',
              label: 'قرار المراجعة',
              assignees,
              sla,
              outcomes: {
                approve: { label: 'اعتماد', next: 'approved' },
                reject: { label: 'رفض', next: 'rejected', comment: 'required' },
              },
            }
          : {
              type: 'approval',
              label: 'موافقة المدير',
              assignees,
              sla,
              approve: 'approved',
              reject: 'rejected',
            },
      approved: { type: 'end', outcome: 'approved' },
      rejected: { type: 'end', outcome: 'rejected' },
    },
  })
}

test.group('Workflow SLA deadlines and escalation', (group) => {
  let now = START
  const clock = () => now
  const service = () => new ResourceService(db, registry)
  const loader = { load: async (id: number) => actors.get(id)! }
  const assignments = () => new Assignments(db, service(), loader, { now: clock })
  const engine = (definition: WorkflowDefinition) =>
    new WorkflowEngine(db, registry, service(), loader, assignments(), [definition], {
      now: clock,
    })

  group.setup(async () => {
    await setup()
    await addUserProfileColumns()
    await seedActor(manager, { email: 'manager@example.test', fullName: 'مدير القسم' })
    await seedActor(head2, { email: 'head2@example.test', fullName: 'رئيس الإدارة' })
    await seedActor(head1, { email: 'head1@example.test', fullName: 'المدير العام' })
    await seedActor(head4, { email: 'head4@example.test', fullName: 'رئيس الوحدة' })
    await seedActor(head3, { email: 'head3@example.test', fullName: 'رئيس إدارة أخرى' })
    await seedActor(backup, { email: 'backup@example.test', fullName: 'المعتمد البديل' })
    await seedActor(stranger, { email: 'stranger@example.test', fullName: 'موظف فرع آخر' })
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
    await db('user_roles').del()
    await db('user_org_units').del()
    await db('roles').del()
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
  async function submitted(workflows: WorkflowEngine) {
    const saved = await service().save('orders', reader, { notes: 'طلب بمهلة', orgUnitId: 2 })
    const shown = await service().show('orders', Number(saved.id), admin)
    await service().transition('orders', Number(saved.id), reader, 'submit', shown.data.version)
    await deliver(workflows)
    const [run] = await workflows.runsFor('orders', Number(saved.id), admin)
    if (run.status !== 'waiting') throw new Error(`Run not waiting: ${run.status} ${run.lastError}`)
    return run.id
  }

  const templated = (key: string, userId?: number) =>
    db('notifications')
      .where('template_key', key)
      .modify((q) => {
        if (userId !== undefined) q.where('user_id', userId)
      })
      .orderBy('id')
  const events = (runId: string, event: string) =>
    db('workflow_events').where({ run_id: runId, event }).orderBy('id')

  async function tasks(actor: Actor, status?: string) {
    const { data } = await assignments().mine(actor, status ? { status } : {})
    return data
  }
  async function slaOf(workflows: WorkflowEngine, runId: string) {
    const run = await workflows.run(runId, admin)
    return run.sla
  }
  async function recipients(key: string) {
    const rows: { user_id: number }[] = await templated(key)
    return rows.map((notice) => notice.user_id)
  }
  async function remindedAt(id: number) {
    const row = await db('assignments').where('id', id).first()
    return new Date(row.reminded_at).toISOString()
  }

  async function role(key: string, holders: { userId: number; unit?: number }[]) {
    const [created] = await db('roles')
      .insert({ name: `دور ${key}`, key })
      .returning('id')
    for (const holder of holders)
      await db('user_roles').insert({
        user_id: holder.userId,
        role_id: created.id,
        org_unit_id: holder.unit ?? null,
      })
  }

  test('the deadline comes from sla.hours; state moves on time, due soon, overdue', async ({
    assert,
  }) => {
    const workflows = engine(slaFlow({ hours: 8 }))
    const runId = await submitted(workflows)
    const [row] = await db('assignments').where({ workflow_run_id: runId })
    assert.equal(new Date(row.due_at).toISOString(), '2026-10-10T16:00:00.000Z')
    // The default reminder window is a quarter of the duration.
    assert.equal(new Date(row.due_soon_at).toISOString(), '2026-10-10T14:00:00.000Z')
    assert.isNull(row.reminded_at)
    assert.isNull(row.escalated_at)
    let run = await workflows.run(runId, admin)
    assert.deepEqual(run.sla, {
      dueAt: '2026-10-10T16:00:00.000Z',
      state: 'on_time',
      escalated: false,
    })
    let [task] = await tasks(manager)
    assert.include(task, {
      dueAt: '2026-10-10T16:00:00.000Z',
      dueOn: '2026-10-10',
      sla: 'on_time',
    })
    assert.deepEqual(await workflows.evaluateSla(), { reminded: 0, escalated: 0 })

    now = new Date('2026-10-10T13:59:59Z')
    const before = await slaOf(workflows, runId)
    assert.equal(before?.state, 'on_time')
    assert.deepEqual(await workflows.evaluateSla(), { reminded: 0, escalated: 0 })

    now = new Date('2026-10-10T14:00:00Z')
    run = await workflows.run(runId, manager)
    assert.equal(run.sla?.state, 'due_soon')
    ;[task] = await tasks(manager)
    assert.equal(task.sla, 'due_soon')
    assert.deepEqual(await workflows.evaluateSla(), { reminded: 1, escalated: 0 })
    assert.deepEqual(await workflows.evaluateSla(), { reminded: 0, escalated: 0 })
    const reminders = await templated('workflow.sla_due_soon')
    assert.lengthOf(reminders, 1)
    assert.equal(reminders[0].user_id, manager.id)
    assert.include(reminders[0].body, '2026-10-10 16:00 UTC')
    assert.include(reminders[0].body, 'موافقة المدير')
    assert.equal(await remindedAt(row.id), '2026-10-10T14:00:00.000Z')
    const dueSoon = await db('workflow_escalations').where({ run_id: runId })
    assert.lengthOf(dueSoon, 1)
    assert.include(dueSoon[0], { level: 'due_soon', action: 'remind', step: 'review' })
    assert.deepEqual(dueSoon[0].targets, [manager.id])
    assert.lengthOf(await events(runId, 'sla_reminded'), 1)

    now = new Date('2026-10-10T16:00:00Z')
    run = await workflows.run(runId, admin)
    assert.deepEqual(run.sla, {
      dueAt: '2026-10-10T16:00:00.000Z',
      state: 'overdue',
      escalated: false,
    })
    assert.deepEqual(await workflows.evaluateSla(), { reminded: 0, escalated: 1 })
    assert.deepEqual(await workflows.evaluateSla(), { reminded: 0, escalated: 0 })
    const overdue = await templated('workflow.sla_overdue')
    assert.deepEqual(
      overdue.map((notice: { user_id: number }) => notice.user_id),
      [manager.id]
    )
    // The reminder is not repeated by the overdue pass.
    assert.lengthOf(await templated('workflow.sla_due_soon'), 1)
    const [escalation] = await db('workflow_escalations').where({ run_id: runId, level: 'overdue' })
    assert.equal(escalation.action, 'overdue')
    assert.deepEqual(escalation.targets, [])
    const [escalated] = await events(runId, 'sla_escalated')
    assert.deepEqual(escalated.detail, { action: 'overdue', late: [manager.id], targets: [] })
    run = await workflows.run(runId, admin)
    assert.deepEqual(run.sla, {
      dueAt: '2026-10-10T16:00:00.000Z',
      state: 'overdue',
      escalated: true,
    })
    ;[task] = await tasks(manager)
    assert.include(task, { sla: 'overdue', canDecide: true })

    // The default policy only marks the approval late; the approver still decides.
    run = await workflows.decide(runId, manager, 'approve')
    assert.equal(run.outcome, 'approved')
    assert.isNull(run.sla)
    const [closed] = await tasks(manager, 'done')
    assert.isNull(closed.sla)
  })

  test('a step without an SLA has no deadline and is never evaluated', async ({ assert }) => {
    const plain = defineWorkflow({
      name: 'plain_approval',
      version: 1,
      resource: 'orders',
      label: 'اعتماد بلا مهلة',
      start: 'review',
      steps: {
        review: {
          type: 'approval',
          label: 'موافقة',
          assignees: { users: [manager.id] },
          dueInDays: 2,
          approve: 'done',
          reject: 'done',
        },
        done: { type: 'end', outcome: 'completed' },
      },
    })
    const workflows = engine(plain)
    const runId = await submitted(workflows)
    const [row] = await db('assignments').where({ workflow_run_id: runId })
    assert.isNull(row.due_at)
    assert.isNull(row.due_soon_at)
    const [task] = await tasks(manager)
    assert.include(task, { dueOn: '2026-10-12', dueAt: null, sla: null })
    assert.isNull(await slaOf(workflows, runId))
    now = new Date('2026-12-01T00:00:00Z')
    assert.deepEqual(await workflows.evaluateSla(), { reminded: 0, escalated: 0 })
    assert.lengthOf(await db('workflow_escalations'), 0)
  })

  test('repeated and concurrent passes escalate each overdue approval once', async ({ assert }) => {
    const definition = slaFlow({ hours: 1, dueSoonHours: 0 })
    const workflows = engine(definition)
    const first = await submitted(workflows)
    const second = await submitted(workflows)
    const rows = await db('assignments').whereIn('workflow_run_id', [first, second])
    assert.lengthOf(rows, 2)
    assert.isTrue(rows.every((row) => row.due_soon_at === null))
    now = new Date(START.getTime() + 2 * HOUR)
    // Two workers (separate engines) and a repeated pass race over the same runs.
    const results = await Promise.all([
      workflows.evaluateSla(),
      engine(definition).evaluateSla(),
      engine(definition).evaluateSla({ limit: 1 }),
    ])
    assert.equal(
      results.reduce((sum, result) => sum + result.escalated, 0),
      2
    )
    assert.equal(
      results.reduce((sum, result) => sum + result.reminded, 0),
      0
    )
    assert.deepEqual(await workflows.evaluateSla(), { reminded: 0, escalated: 0 })
    const escalations = await db('workflow_escalations').orderBy('id')
    assert.lengthOf(escalations, 2)
    assert.sameMembers(
      escalations.map((row) => row.run_id),
      [first, second]
    )
    assert.isTrue(escalations.every((row) => row.level === 'overdue'))
    assert.lengthOf(await templated('workflow.sla_overdue', manager.id), 2)
    for (const runId of [first, second]) assert.lengthOf(await events(runId, 'sla_escalated'), 1)
  })

  test('notify escalates to the approver’s nearest manager in the org tree', async ({ assert }) => {
    // The approver belongs to unit 4 (1.2.4), which has no head of its own.
    await db('user_org_units').insert({ user_id: manager.id, org_unit_id: 4 })
    await role('dept_head', [
      { userId: head2.id, unit: 2 },
      { userId: head1.id, unit: 1 },
      { userId: head3.id, unit: 3 },
    ])
    const definition = slaFlow({
      hours: 4,
      dueSoonHours: 0,
      escalate: { action: 'notify', to: { manager: 'dept_head' } },
    })
    const workflows = engine(definition)
    const runId = await submitted(workflows)
    now = new Date(START.getTime() + 4 * HOUR)
    assert.deepEqual(await workflows.evaluateSla(), { reminded: 0, escalated: 1 })
    // Unit 4 has no head, so the parent unit's head is told, not the root's or a sibling's.
    const told = await templated('workflow.sla_escalated')
    assert.deepEqual(
      told.map((notice: { user_id: number }) => notice.user_id),
      [head2.id]
    )
    assert.include(told[0].body, 'مدير القسم')
    assert.include(told[0].body, '2026-10-10 12:00 UTC')
    assert.deepEqual(await recipients('workflow.sla_overdue'), [manager.id])
    const [escalation] = await db('workflow_escalations').where({ run_id: runId })
    assert.include(escalation, { level: 'overdue', action: 'notify' })
    assert.deepEqual(escalation.targets, [head2.id])
    const [logged] = await events(runId, 'sla_escalated')
    assert.deepEqual(logged.detail, { action: 'notify', late: [manager.id], targets: [head2.id] })
    // Notifying leaves the approval with the approver.
    const [row] = await db('assignments').where({ workflow_run_id: runId })
    assert.include(row, { status: 'open', assignee_id: manager.id })
    const marked = await slaOf(workflows, runId)
    assert.isTrue(marked?.escalated)
    assert.deepEqual(await workflows.evaluateSla(), { reminded: 0, escalated: 0 })
    assert.lengthOf(await templated('workflow.sla_escalated'), 1)

    // Once unit 4 has its own head, that nearest manager wins over the parent's.
    const [headRole] = await db('roles').where('key', 'dept_head')
    await db('user_roles').insert({ user_id: head4.id, role_id: headRole.id, org_unit_id: 4 })
    now = START
    const nearer = await submitted(workflows)
    now = new Date(START.getTime() + 5 * HOUR)
    assert.deepEqual(await workflows.evaluateSla(), { reminded: 0, escalated: 1 })
    const [second] = await db('workflow_escalations').where({ run_id: nearer })
    assert.deepEqual(second.targets, [head4.id])
    assert.deepEqual(await recipients('workflow.sla_escalated'), [head2.id, head4.id])
  })

  test('reassign cancels the late decision and the role holder decides instead', async ({
    assert,
  }) => {
    await role('backup_approver', [{ userId: backup.id }])
    const workflows = engine(
      slaFlow(
        { hours: 2, escalate: { action: 'reassign', to: { role: 'backup_approver' } } },
        { type: 'decision' }
      )
    )
    const runId = await submitted(workflows)
    const [late] = await db('assignments').where({ workflow_run_id: runId })
    now = new Date(START.getTime() + 3 * HOUR)
    assert.deepEqual(await workflows.evaluateSla(), { reminded: 0, escalated: 1 })
    const cancelled = await db('assignments').where('id', late.id).first()
    assert.equal(cancelled.status, 'cancelled')
    assert.equal(cancelled.close_reason, 'أُعيد الإسناد بعد تجاوز المهلة')
    const [moved] = await db('assignments').where({ workflow_run_id: runId, status: 'open' })
    assert.equal(moved.assignee_id, backup.id)
    assert.equal(moved.workflow_step, 'review')
    // The deadline is the original one; the new task is already marked escalated.
    assert.equal(new Date(moved.due_at).toISOString(), '2026-10-10T10:00:00.000Z')
    assert.equal(new Date(moved.escalated_at).toISOString(), now.toISOString())
    assert.isNotNull(moved.reminded_at)
    assert.isNull(moved.due_soon_at)
    assert.lengthOf(await templated('assignment.approval', backup.id), 1)
    assert.lengthOf(await templated('workflow.sla_overdue', manager.id), 1)
    const [escalation] = await db('workflow_escalations').where({ run_id: runId })
    assert.include(escalation, { action: 'reassign', assignment_id: late.id })
    assert.deepEqual(escalation.targets, [backup.id])
    const run = await workflows.run(runId, admin)
    assert.deepEqual(run.sla, {
      dueAt: '2026-10-10T10:00:00.000Z',
      state: 'overdue',
      escalated: true,
    })
    // A later pass does not escalate the reassigned task again.
    assert.deepEqual(await workflows.evaluateSla(), { reminded: 0, escalated: 0 })
    assert.lengthOf(await db('assignments').where({ workflow_run_id: runId }), 2)

    assert.lengthOf(await workflows.inbox(manager), 0)
    const refused = await failure(() => workflows.decide(runId, manager, 'approve'))
    assert.equal(refused.code, 'E_WORKFLOW_STATE')
    const [held] = await workflows.inbox(backup)
    assert.equal(held.id, runId)
    assert.deepEqual(
      held.myApproval?.decision?.outcomes.map((outcome) => outcome.key),
      ['approve', 'reject']
    )
    const decided = await workflows.decide(runId, backup, 'approve')
    assert.equal(decided.outcome, 'approved')
    const [event] = await events(runId, 'decided')
    assert.equal(event.actor_id, backup.id)
  })

  test('a policy that finds no eligible target falls back to overdue with the reason', async ({
    assert,
  }) => {
    const cases: { escalate: StepSla['escalate']; reason: string }[] = [
      // No such role.
      { escalate: { action: 'notify', to: { manager: 'no_such_role' } }, reason: 'no eligible' },
      // The only target cannot read the record.
      { escalate: { action: 'reassign', to: { users: [stranger.id] } }, reason: 'no eligible' },
      // The late approver is never their own escalation target.
      { escalate: { action: 'reassign', to: { users: [manager.id] } }, reason: 'no eligible' },
      // A failing recipient function is recorded, not swallowed.
      {
        escalate: {
          action: 'notify',
          to: () => {
            throw new Error('directory offline')
          },
        },
        reason: 'directory offline',
      },
    ]
    for (const { escalate, reason } of cases) {
      await db('notifications').del()
      now = START
      const workflows = engine(slaFlow({ hours: 1, dueSoonHours: 0, escalate }))
      const runId = await submitted(workflows)
      now = new Date(START.getTime() + 2 * HOUR)
      assert.deepEqual(await workflows.evaluateSla(), { reminded: 0, escalated: 1 })
      const [escalation] = await db('workflow_escalations').where({ run_id: runId })
      assert.include(escalation, { level: 'overdue', action: 'overdue' })
      assert.deepEqual(escalation.targets, [])
      const [logged] = await events(runId, 'sla_escalated')
      assert.equal(logged.detail.action, 'overdue')
      assert.include(String(logged.detail.reason), reason)
      assert.deepEqual(await recipients('workflow.sla_overdue'), [manager.id])
      assert.lengthOf(await templated('workflow.sla_escalated'), 0)
      // The approval stays with the approver.
      const rows = await db('assignments').where({ workflow_run_id: runId })
      assert.lengthOf(rows, 1)
      assert.include(rows[0], { status: 'open', assignee_id: manager.id })
      const marked = await slaOf(workflows, runId)
      assert.isTrue(marked?.escalated)
    }
  })

  test('defineWorkflow refuses invalid SLA configurations', ({ assert }) => {
    const build =
      (sla: unknown, type: 'approval' | 'decision' = 'approval') =>
      () =>
        slaFlow(sla as StepSla, { type })
    for (const hours of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, '8'])
      assert.throws(build({ hours }), /positive SLA duration in hours/)
    for (const dueSoonHours of [-1, 8, 9, '2'])
      assert.throws(build({ hours: 8, dueSoonHours }), /dueSoonHours between 0/)
    assert.throws(build({ hours: 8, escalate: { action: 'archive' } }), /unknown SLA escalation/)
    assert.throws(build({ hours: 8, escalate: { action: 'notify' } }), /needs an escalation target/)
    assert.throws(
      build({ hours: 8, escalate: { action: 'reassign' } }, 'decision'),
      /needs an escalation target for reassign/
    )
    // Valid configurations, including a reminder window of zero.
    assert.doesNotThrow(build({ hours: 8, dueSoonHours: 0 }))
    assert.doesNotThrow(build({ hours: 0.5, escalate: { action: 'overdue' } }, 'decision'))
    assert.doesNotThrow(
      build({ hours: 24, dueSoonHours: 4, escalate: { action: 'notify', to: { manager: 'x' } } })
    )
  })

  test('nextStep resolves every step type as the XState machine did', ({ assert }) => {
    const input: WorkflowInput = {
      name: 'all_steps',
      version: 1,
      resource: 'orders',
      label: 'كل الخطوات',
      start: 'check',
      steps: {
        check: {
          type: 'condition',
          when: (record) => Number(record.total ?? 0) >= 100,
          then: 'write',
          else: 'tell',
        },
        write: { type: 'update', values: { status: 'closed' }, next: 'tell' },
        tell: { type: 'notify', to: 'submitter', next: 'wait' },
        wait: { type: 'delay', ms: 1000, next: 'call' },
        call: { type: 'http', url: 'http://127.0.0.1/hook', next: 'approve' },
        approve: {
          type: 'approval',
          label: 'موافقة',
          assignees: { users: [3] },
          approve: 'decide',
          reject: 'rejected',
        },
        decide: {
          type: 'decision',
          label: 'قرار',
          assignees: { users: [3] },
          outcomes: {
            accept: { label: 'قبول', next: 'approved' },
            back: { label: 'إعادة', next: 'approve' },
          },
        },
        approved: { type: 'end', outcome: 'approved' },
        rejected: { type: 'end', outcome: 'rejected' },
      },
    }
    const definition = defineWorkflow(input)
    const machine = definition.machine
    /** The former XState lookup (before ADR 044). */
    const previous = (current: string, event: WorkflowEvent) => {
      const snapshot = machine.resolveState({ value: current, context: {} })
      const value = String(getNextSnapshot(machine, snapshot, event).value)
      if (value === current) throw new Error(`Step ${current} does not accept ${event.type}`)
      return value
    }
    const accepted: WorkflowEvent[] = [
      { type: 'EVALUATE', record: { total: 150 } },
      { type: 'EVALUATE', record: { total: 5 } },
      { type: 'DONE' },
      { type: 'APPROVE' },
      { type: 'REJECT' },
      { type: 'DECIDE', outcome: 'accept' },
      { type: 'DECIDE', outcome: 'back' },
      { type: 'DECIDE', outcome: 'missing' },
      { type: 'DECIDE', outcome: 'toString' },
    ]
    const outcome = (resolve: () => string) => {
      try {
        return resolve()
      } catch (error) {
        return `error: ${(error as Error).message}`
      }
    }
    for (const step of Object.keys(input.steps))
      for (const event of accepted)
        assert.equal(
          outcome(() => nextStep(definition, step, event)),
          outcome(() => previous(step, event)),
          `${step} on ${event.type}${event.type === 'DECIDE' ? `:${event.outcome}` : ''}`
        )
    assert.equal(nextStep(definition, 'check', accepted[0]), 'write')
    assert.equal(nextStep(definition, 'check', accepted[1]), 'tell')
    for (const [step, next] of [
      ['write', 'tell'],
      ['tell', 'wait'],
      ['wait', 'call'],
      ['call', 'approve'],
    ])
      assert.equal(nextStep(definition, step, { type: 'DONE' }), next)
    assert.equal(nextStep(definition, 'approve', { type: 'APPROVE' }), 'decide')
    assert.equal(nextStep(definition, 'approve', { type: 'REJECT' }), 'rejected')
    assert.equal(nextStep(definition, 'decide', { type: 'DECIDE', outcome: 'back' }), 'approve')
    assert.throws(
      () => nextStep(definition, 'approve', { type: 'DONE' }),
      'Step approve does not accept DONE'
    )
    assert.throws(
      () => nextStep(definition, 'decide', { type: 'DECIDE', outcome: 'toString' }),
      /does not accept DECIDE/
    )
    assert.throws(() => nextStep(definition, 'approved', { type: 'DONE' }), /does not accept/)
    for (const unknown of ['missing', 'constructor', '__proto__'])
      assert.throws(
        () => nextStep(definition, unknown, { type: 'DONE' }),
        `Step ${unknown} is not part of all_steps@1`
      )
    // Unlike the former lookup, a step may name itself to reopen ("ask again").
    const again = defineWorkflow({
      ...input,
      name: 'ask_again',
      steps: {
        ...input.steps,
        decide: {
          type: 'decision',
          label: 'قرار',
          assignees: { users: [3] },
          outcomes: {
            accept: { label: 'قبول', next: 'approved' },
            again: { label: 'اسأل مجددًا', next: 'decide' },
          },
        },
      },
    })
    assert.equal(nextStep(again, 'decide', { type: 'DECIDE', outcome: 'again' }), 'decide')
  })

  test('only approval and decision steps may name themselves as their next step', async ({
    assert,
  }) => {
    const flow = (step: WorkflowInput['steps'][string]) => () =>
      defineWorkflow({
        name: 'self_target',
        version: 1,
        resource: 'orders',
        label: 'خطوة تعود لنفسها',
        start: 'first',
        steps: { first: step, done: { type: 'end', outcome: 'completed' } },
      })
    assert.throws(
      flow({ type: 'notify', to: { users: [manager.id] }, next: 'first' }),
      'Step first cannot name itself as its next step'
    )
    assert.throws(flow({ type: 'delay', ms: 10, next: 'first' }), /cannot name itself/)
    assert.throws(
      flow({ type: 'condition', when: () => true, then: 'first', else: 'done' }),
      /cannot name itself/
    )
    assert.doesNotThrow(
      flow({
        type: 'approval',
        label: 'اسأل مجددًا',
        assignees: { users: [manager.id] },
        approve: 'done',
        reject: 'first',
      })
    )
    // A definition assembled by hand still cannot loop: the run fails before notifying.
    const valid = defineWorkflow({
      name: 'self_target',
      version: 1,
      resource: 'orders',
      label: 'خطوة تعود لنفسها',
      start: 'tell',
      steps: {
        tell: { type: 'notify', to: { users: [manager.id] }, next: 'done' },
        done: { type: 'end', outcome: 'completed' },
      },
    })
    const looping = {
      ...valid,
      steps: { ...valid.steps, tell: { ...valid.steps.tell, next: 'tell' } },
    } as WorkflowDefinition
    const workflows = engine(looping)
    const saved = await service().save('orders', reader, { notes: 'حلقة', orgUnitId: 2 })
    const shown = await service().show('orders', Number(saved.id), admin)
    await service().transition('orders', Number(saved.id), reader, 'submit', shown.data.version)
    await deliver(workflows)
    const [run] = await workflows.runsFor('orders', Number(saved.id), admin)
    assert.equal(run.status, 'failed')
    assert.match(run.lastError ?? '', /cannot name itself/)
    assert.lengthOf(await templated('workflow.decided', manager.id), 0)
  })

  test('an escalation never hands a request to the person who submitted it', async ({ assert }) => {
    const workflows = engine(
      slaFlow({ hours: 4, escalate: { action: 'reassign', to: { users: [reader.id] } } })
    )
    const runId = await submitted(workflows)
    now = new Date(START.getTime() + 5 * HOUR)
    const result = await workflows.evaluateSla()
    assert.equal(result.escalated, 1)
    const [escalation] = await events(runId, 'sla_escalated')
    assert.equal(escalation.detail.action, 'overdue', 'falls back to marking it overdue')
    assert.deepEqual(escalation.detail.targets, [])
    const open = await db('assignments').where({ workflow_run_id: runId, status: 'open' })
    assert.deepEqual(
      open.map((row) => row.assignee_id),
      [manager.id]
    )
    assert.lengthOf(await workflows.inbox(reader), 0)
  })

  test("reminders reach the approver's current delegate after an earlier delegation ends", async ({
    assert,
  }) => {
    const delegations = () => new WorkflowDelegations(db, { now: clock })
    await delegations().create(
      {
        delegatorId: manager.id,
        delegateId: head2.id,
        startsOn: '2026-10-10',
        endsOn: '2026-10-10',
      },
      manager.id
    )
    const workflows = engine(slaFlow({ hours: 48, dueSoonHours: 12 }))
    const runId = await submitted(workflows)
    const routed = await db('assignments').where({ workflow_run_id: runId, status: 'open' }).first()
    assert.deepEqual([routed.assignee_id, routed.on_behalf_of], [head2.id, manager.id])
    now = new Date('2026-10-11T21:00:00Z')
    await delegations().create(
      {
        delegatorId: manager.id,
        delegateId: backup.id,
        startsOn: '2026-10-11',
        endsOn: '2026-10-12',
      },
      manager.id
    )
    const pass = await workflows.evaluateSla()
    assert.equal(pass.reminded, 1)
    assert.deepEqual(await recipients('workflow.sla_due_soon'), [backup.id])
  })
})
