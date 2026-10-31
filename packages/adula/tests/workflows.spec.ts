import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test } from '@japa/runner'
import {
  Assignments,
  ResourceService,
  RolesAdmin,
  WorkflowEngine,
  consumeEvent,
  defineWorkflow,
  publishOutbox,
} from '../index.js'
import type {
  Actor,
  DomainEvent,
  HttpPoster,
  WorkflowDefinition,
  WorkflowOptions,
} from '../index.js'
import { admin, db, reader, registry, setup } from './helpers.js'
import { failure } from './helpers/failure.js'
import { addUserProfileColumns, seedActor } from './helpers/actors.js'

const manager: Actor = {
  id: 3,
  orgPaths: ['1.2'],
  permissionLevel: 1,
  rules: [{ subject: 'orders', action: 'view' }],
}
const director: Actor = {
  id: 4,
  orgPaths: ['1'],
  permissionLevel: 1,
  rules: [{ subject: 'orders', action: 'view' }],
}
const actors = new Map([admin, reader, manager, director].map((actor) => [actor.id, actor]))

/** Two-level approval: large orders need the manager and then the director. */
function approval(version = 1): WorkflowDefinition {
  return defineWorkflow({
    name: 'order_approval',
    version,
    resource: 'orders',
    label: 'اعتماد الطلب',
    start: 'size',
    steps: {
      size: {
        type: 'condition',
        when: (order) => Number(order.total ?? 0) >= 100000,
        then: 'manager',
        else: 'approved',
      },
      manager: {
        type: 'approval',
        label: 'موافقة مدير القسم',
        assignees: { users: [3] },
        approve: 'director',
        reject: 'rejected',
      },
      director: {
        type: 'approval',
        label: 'موافقة المدير العام',
        assignees: { users: [4] },
        approve: 'mark',
        reject: 'rejected',
      },
      mark: { type: 'update', values: { status: 'closed' }, next: 'tell' },
      tell: { type: 'notify', to: 'submitter', next: 'approved' },
      approved: { type: 'end', outcome: 'approved' },
      rejected: { type: 'end', outcome: 'rejected', cancelDocument: true },
    },
  })
}

/**
 * The manager prepares, the director approves, rejects with a reason, or returns the order
 * to the manager (#42). Decisions route the run; the submitted order itself stays locked.
 */
function decision(): WorkflowDefinition {
  return defineWorkflow({
    name: 'order_decision',
    version: 1,
    resource: 'orders',
    label: 'قرار الطلب',
    start: 'prepare',
    steps: {
      prepare: {
        type: 'decision',
        label: 'إعداد مدير القسم',
        assignees: { users: [3] },
        outcomes: {
          forward: { label: 'إحالة', next: 'decide' },
          withdraw: { label: 'سحب', next: 'rejected' },
        },
      },
      decide: {
        type: 'decision',
        label: 'قرار المدير العام',
        assignees: { users: [4] },
        outcomes: {
          approve: { label: 'اعتماد', next: 'approved' },
          reject: { label: 'رفض', next: 'rejected', comment: 'required' },
          back: { label: 'إعادة للإعداد', next: 'prepare', comment: 'required' },
        },
      },
      approved: { type: 'end', outcome: 'approved' },
      rejected: { type: 'end', outcome: 'rejected', cancelDocument: true },
    },
  })
}

test.group('Workflow engine', (group) => {
  const service = () => new ResourceService(db, registry)
  const assignments = () => new Assignments(db, service(), { load: async (id) => actors.get(id)! })
  const engine = (
    definitions: WorkflowDefinition[] = [approval()],
    options: WorkflowOptions = {}
  ) =>
    new WorkflowEngine(
      db,
      registry,
      service(),
      { load: async (id) => actors.get(id)! },
      assignments(),
      definitions,
      options
    )

  group.setup(async () => {
    await setup()
    await addUserProfileColumns()
    await seedActor({ id: 3 }, { email: 'manager@example.test', fullName: 'مدير القسم' })
    await seedActor({ id: 4 }, { email: 'director@example.test', fullName: 'المدير العام' })
  })
  group.each.setup(async () => {
    await db('workflow_events').del()
    await db('assignments').del()
    await db('workflow_runs').del()
    await db('processed_events').del()
    await db('outbox').del()
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

  async function submittedOrder(total: string) {
    const saved = await service().save('orders', reader, { notes: 'طلب تدفق', orgUnitId: 2 })
    await db('orders').where('id', Number(saved.id)).update({ total })
    const shown = await service().show('orders', Number(saved.id), admin)
    await service().transition('orders', Number(saved.id), reader, 'submit', shown.data.version)
    return Number(saved.id)
  }

  test('rejects invalid definitions before they run', ({ assert }) => {
    assert.throws(
      () =>
        defineWorkflow({
          name: 'broken',
          version: 1,
          resource: 'orders',
          label: 'x',
          start: 'a',
          steps: {
            a: { type: 'delay', ms: 10, next: 'missing' },
            b: { type: 'end', outcome: 'completed' },
          },
        }),
      /unknown step missing/
    )
    // Naming errors state the rule and a valid spelling (issue #24).
    const named = (name: string, step: string) => () =>
      defineWorkflow({
        name,
        version: 1,
        resource: 'orders',
        label: 'x',
        start: step,
        steps: { [step]: { type: 'end', outcome: 'completed' } },
      })
    assert.throws(
      named('projects.release.approval', 'done'),
      'Invalid workflow name "projects.release.approval": use lower-case letters, digits and underscores, starting with a letter (for example projects_release_approval).'
    )
    assert.throws(
      named('release_approval', 'notifyApproved'),
      'Invalid step name "notifyApproved": use lower-case letters, digits and underscores, starting with a letter (for example notify_approved).'
    )
    assert.throws(named('2fast', 'done'), /\(for example fast\)/)
    assert.throws(() => engine([approval(), approval()]), /Duplicate workflow version/)
    assert.throws(
      () =>
        engine([
          defineWorkflow({
            name: 'on_customers',
            version: 1,
            resource: 'customers',
            label: 'x',
            start: 'done',
            steps: { done: { type: 'end', outcome: 'completed' } },
          }),
        ]),
      /submittable/
    )
  })

  test('two-level approval from submission to approval without UI code', async ({ assert }) => {
    const workflows = engine()
    const id = await submittedOrder('250000')
    await deliver(workflows)
    let [run] = await workflows.runsFor('orders', id, admin)
    assert.equal(run.status, 'waiting')
    assert.equal(run.step, 'manager')
    // Only the assigned approver may decide, and only at the current step.
    const early = await failure(() => workflows.decide(run.id, director, 'approve'))
    assert.equal(early.code, 'E_WORKFLOW_STATE')
    const inbox = await workflows.inbox(manager)
    assert.deepEqual(
      inbox.map((entry) => entry.id),
      [run.id]
    )
    // A page of My tasks asks only for its own rows' runs.
    const page = await workflows.inbox(manager, { runIds: [run.id] })
    assert.deepEqual(
      page.map((entry) => entry.id),
      [run.id]
    )
    assert.lengthOf(await workflows.inbox(manager, { runIds: [] }), 0)
    assert.lengthOf(await workflows.inbox(director, { runIds: [run.id] }), 0)
    // My tasks lists the same approval, decidable in place (#35).
    const decisions = await assignments().mine(manager, { kind: 'approval' })
    assert.equal(decisions.approvals, 1)
    assert.lengthOf(decisions.data, 1)
    assert.isTrue(decisions.data[0].canDecide)
    assert.isFalse(decisions.data[0].canComplete)
    assert.equal(decisions.data[0].workflowRunId, run.id)
    const manual = await assignments().mine(manager, { kind: 'task' })
    assert.lengthOf(manual.data, 0)
    // The director's approval is not due yet, so it is not decidable anywhere.
    const early2 = await assignments().mine(director, { kind: 'approval' })
    assert.isFalse(early2.data.some((item) => item.canDecide))
    run = await workflows.decide(run.id, manager, 'approve', 'الأسعار مطابقة')
    assert.equal(run.step, 'director')
    const decided = await assignments().mine(manager, { status: 'done', kind: 'approval' })
    assert.isFalse(decided.data[0].canDecide)
    assert.equal(decided.data[0].outcome, 'approve')
    run = await workflows.decide(run.id, director, 'approve')
    assert.equal(run.status, 'completed')
    assert.equal(run.outcome, 'approved')
    const order = await db('orders').where('id', id).first()
    assert.equal(order.status, 'closed')
    assert.equal(order.doc_status, 1)
    const history = run.history.map((entry) => entry.event)
    assert.deepEqual(history, [
      'started',
      'evaluate',
      'approval_requested',
      'approved',
      'approval_requested',
      'approved',
      'done',
      'done',
      'completed',
    ])
    assert.equal(run.history[3].detail.comment, 'الأسعار مطابقة')
    const notice = await db('notifications')
      .where('user_id', reader.id)
      .orderBy('id', 'desc')
      .first()
    assert.include(notice.body, 'اعتماد الطلب')
    const changes = await db('field_changes').where({
      resource: 'orders',
      record_id: id,
      field: 'status',
    })
    assert.lengthOf(changes, 1)
  })

  test('small orders skip approval; rejection cancels the document', async ({ assert }) => {
    const workflows = engine()
    const small = await submittedOrder('100')
    const large = await submittedOrder('900000')
    await deliver(workflows)
    const [done] = await workflows.runsFor('orders', small, admin)
    assert.equal(done.outcome, 'approved')
    const [waiting] = await workflows.runsFor('orders', large, admin)
    const rejected = await workflows.decide(waiting.id, manager, 'reject', 'تجاوز الميزانية')
    assert.equal(rejected.outcome, 'rejected')
    const order = await db('orders').where('id', large).first()
    assert.equal(order.doc_status, 2)
    const open = await db('assignments').where({ workflow_run_id: waiting.id, status: 'open' })
    assert.lengthOf(open, 0)
  })

  test('a crash between effect and commit loses no state and repeats no effect', async ({
    assert,
  }) => {
    let crash = true
    const workflows = engine([approval()], {
      beforeCommit: ({ step }) => {
        if (step === 'mark' && crash) {
          crash = false
          throw new Error('worker stopped')
        }
      },
    })
    const id = await submittedOrder('300000')
    await deliver(workflows)
    let [run] = await workflows.runsFor('orders', id, admin)
    await workflows.decide(run.id, manager, 'approve')
    run = await workflows.decide(run.id, director, 'approve')
    // The update step's write was rolled back with the failed step; the run waits to retry.
    assert.equal(run.status, 'running')
    assert.equal(run.step, 'mark')
    assert.equal(run.attempts, 1)
    const unchanged = await db('orders').where('id', id).first()
    assert.notEqual(unchanged.status, 'closed')
    await db('workflow_runs')
      .where('id', run.id)
      .update({ wake_at: new Date(Date.now() - 1000) })
    await workflows.tick()
    run = await workflows.run(run.id, admin)
    assert.equal(run.status, 'completed')
    const changes = await db('field_changes').where({
      resource: 'orders',
      record_id: id,
      field: 'status',
    })
    assert.lengthOf(changes, 1)
  })

  test('a new definition version does not change a running workflow', async ({ assert }) => {
    const id = await submittedOrder('500000')
    await deliver(engine())
    const [started] = await engine().runsFor('orders', id, admin)
    assert.equal(started.version, 1)
    // Version 2 removes the director level; the running v1 still requires it.
    const v2 = defineWorkflow({
      name: 'order_approval',
      version: 2,
      resource: 'orders',
      label: 'اعتماد الطلب ٢',
      start: 'manager',
      steps: {
        manager: {
          type: 'approval',
          label: 'موافقة',
          assignees: { users: [3] },
          approve: 'ok',
          reject: 'no',
        },
        ok: { type: 'end', outcome: 'approved' },
        no: { type: 'end', outcome: 'rejected' },
      },
    })
    const both = engine([approval(), v2])
    const after = await both.decide(started.id, manager, 'approve')
    assert.equal(after.version, 1)
    assert.equal(after.step, 'director')
    // New submissions start on the newest version.
    const next = await submittedOrder('10')
    await deliver(both)
    const [fresh] = await both.runsFor('orders', next, admin)
    assert.equal(fresh.version, 2)
    // Explicit migration moves unfinished v1 runs.
    const moved = await both.migrateRuns('order_approval', 1, 2, () => 'manager')
    assert.equal(moved, 1)
  })

  test('a run whose version is no longer registered stops instead of guessing', async ({
    assert,
  }) => {
    const id = await submittedOrder('400000')
    await deliver(engine())
    const [run] = await engine().runsFor('orders', id, admin)
    await db('workflow_runs')
      .where('id', run.id)
      .update({ status: 'running', wake_at: new Date(Date.now() - 1000) })
    const withoutV1 = engine([
      defineWorkflow({
        name: 'order_approval',
        version: 3,
        resource: 'orders',
        label: 'x',
        start: 'end',
        steps: { end: { type: 'end', outcome: 'completed' } },
      }),
    ])
    await withoutV1.tick()
    const stopped = await withoutV1.run(run.id, admin)
    assert.equal(stopped.status, 'failed')
    assert.include(stopped.lastError, 'order_approval@1 is not registered')
  })

  test('concurrent decisions under the row lock apply once', async ({ assert }) => {
    const workflows = engine()
    const id = await submittedOrder('700000')
    await deliver(workflows)
    const [run] = await workflows.runsFor('orders', id, admin)
    const results = await Promise.allSettled([
      workflows.decide(run.id, manager, 'approve'),
      workflows.decide(run.id, manager, 'reject'),
    ])
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
    const decisions = await db('workflow_events')
      .where({ run_id: run.id })
      .whereIn('event', ['approved', 'rejected'])
    assert.lengthOf(decisions, 1)
  })

  test('delay, HTTP with a stable idempotency key, bounded retries and admin retry', async ({
    assert,
  }) => {
    const keys: string[] = []
    let failures = 2
    const server = createServer((request, response) => {
      keys.push(String(request.headers['idempotency-key']))
      if (failures-- > 0) response.writeHead(503).end()
      else response.writeHead(200).end('{}')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    let clock = new Date()
    const post: HttpPoster = async (url, init) => {
      const response = await fetch(url, { method: 'POST', ...init })
      return { status: response.status }
    }
    try {
      const port = (server.address() as AddressInfo).port
      const flow = defineWorkflow({
        name: 'order_sync',
        version: 1,
        resource: 'orders',
        label: 'مزامنة الطلب',
        start: 'wait',
        maxAttempts: 3,
        steps: {
          wait: { type: 'delay', ms: 3600000, next: 'push' },
          push: { type: 'http', url: `http://127.0.0.1:${port}/sync`, next: 'done' },
          done: { type: 'end', outcome: 'completed' },
        },
      })
      const workflows = engine([flow], { post, now: () => clock })
      const id = await submittedOrder('1')
      await deliver(workflows)
      let [run] = await workflows.runsFor('orders', id, admin)
      assert.equal(run.step, 'wait')
      assert.equal(await workflows.tick(), 0)
      clock = new Date(clock.getTime() + 3600000 + 1000)
      await workflows.tick()
      run = await workflows.run(run.id, admin)
      assert.equal(run.step, 'push')
      assert.equal(run.attempts, 1)
      clock = new Date(clock.getTime() + 60_000)
      await workflows.tick()
      run = await workflows.run(run.id, admin)
      assert.equal(run.attempts, 2)
      // Retries use the same key, so the receiver can apply the call once.
      assert.deepEqual([...new Set(keys)], [`${run.id}:push`])
      clock = new Date(clock.getTime() + 600_000)
      failures = 5
      await workflows.tick()
      run = await workflows.run(run.id, admin)
      assert.equal(run.status, 'failed')
      const failed = await workflows.failed()
      assert.include(
        failed.map((entry) => entry.id),
        run.id
      )
      failures = 0
      await workflows.retry(run.id, admin.id)
      await workflows.tick()
      run = await workflows.run(run.id, admin)
      assert.equal(run.status, 'completed')
    } finally {
      server.close()
    }
  })

  test('an approval addressed to a missing or empty role fails at once and can be retried', async ({
    assert,
  }) => {
    const flow = defineWorkflow({
      name: 'role_approval',
      version: 1,
      resource: 'orders',
      label: 'اعتماد بالدور',
      start: 'review',
      steps: {
        review: {
          type: 'approval',
          label: 'مراجعة',
          assignees: { role: 'مدير مشروع' },
          approve: 'done',
          reject: 'done',
        },
        done: { type: 'end', outcome: 'completed' },
      },
    })
    const workflows = engine([flow])
    const id = await submittedOrder('1')
    await deliver(workflows)
    // The role was renamed away (issue #25): no retries hide the run for hours.
    let [run] = await workflows.runsFor('orders', id, admin)
    assert.equal(run.status, 'failed')
    assert.equal(run.attempts, 1)
    assert.include(run.lastError, 'role "مدير مشروع", which matches no role key or name')
    const failed = await workflows.failed()
    assert.include(
      failed.map((entry) => entry.id),
      run.id
    )
    const [role] = await db('roles').insert({ name: 'مدير مشروع' }).returning('id')
    try {
      await workflows.retry(run.id, admin.id)
      await workflows.tick()
      run = await workflows.run(run.id, admin)
      assert.equal(run.status, 'failed')
      assert.include(run.lastError, 'the recipients resolve to no active user')
      await db('user_roles').insert({ user_id: manager.id, role_id: role.id })
      await workflows.retry(run.id, admin.id)
      await workflows.tick()
      run = await workflows.run(run.id, admin)
      assert.equal(run.status, 'waiting')
      assert.lengthOf(await db('assignments').where({ workflow_run_id: run.id }), 1)
    } finally {
      await db('user_roles').del()
      await db('roles').where('id', role.id).del()
    }
  })

  test('a role key keeps approvals addressed after the display name is renamed', async ({
    assert,
  }) => {
    const flow = defineWorkflow({
      name: 'keyed_approval',
      version: 1,
      resource: 'orders',
      label: 'اعتماد بمفتاح الدور',
      start: 'review',
      steps: {
        review: {
          type: 'approval',
          label: 'مراجعة المدير',
          assignees: { role: 'project_manager' },
          approve: 'done',
          reject: 'done',
        },
        done: { type: 'end', outcome: 'completed' },
      },
    })
    const roles = new RolesAdmin(db, registry)
    const role = await roles.create(admin.id, {
      name: 'مدير مشروع',
      key: 'project_manager',
      permissionLevel: 0,
    })
    try {
      await db('user_roles').insert({ user_id: manager.id, role_id: role.id })
      // Administrators rename the Arabic display name; the workflow keeps its approvers.
      await roles.rename(admin.id, role.id, 'مدير المشروع')
      const workflows = engine([flow])
      const id = await submittedOrder('2')
      await deliver(workflows)
      const [run] = await workflows.runsFor('orders', id, admin)
      assert.equal(run.status, 'waiting')
      const [assigned] = await db('assignments').where({ workflow_run_id: run.id })
      assert.equal(assigned.assignee_id, manager.id)
      const fixed = await failure(() => roles.setKey(admin.id, role.id, 'other_key'))
      assert.equal(fixed.code, 'E_ROLE_KEY_FIXED')
      const taken = await failure(() =>
        roles.create(admin.id, { name: 'آخر', key: 'project_manager' })
      )
      assert.equal(taken.code, 'E_ROLE_KEY_EXISTS')
      const invalid = await failure(() => roles.create(admin.id, { name: 'سيئ', key: 'Bad Key' }))
      assert.equal(invalid.code, 'E_ROLE_KEY')
      const stored = await roles.get(role.id)
      assert.equal(stored.key, 'project_manager')
    } finally {
      await db('assignments').del()
      await db('user_roles').del()
      await db('roles').where('id', role.id).del()
    }
  })

  test('cancelling the document stops the run and its open approvals', async ({ assert }) => {
    const workflows = engine()
    const id = await submittedOrder('800000')
    await deliver(workflows)
    const shown = await service().show('orders', id, admin)
    await service().transition('orders', id, admin, 'cancel', shown.data.version)
    await deliver(workflows)
    const [run] = await workflows.runsFor('orders', id, admin)
    assert.equal(run.status, 'cancelled')
    assert.lengthOf(await db('assignments').where({ workflow_run_id: run.id, status: 'open' }), 0)
    const amended = await service().amend('orders', id, admin)
    assert.equal(amended.docStatus, 0)
    const copy = await db('orders').where('id', Number(amended.id)).first()
    assert.equal(copy.amended_from_id, id)
    assert.notEqual(copy.number, shown.data.number)
    const again = await failure(() => service().amend('orders', id, admin))
    assert.equal(again.code, 'E_ALREADY_AMENDED')
    const draft = await failure(() => service().amend('orders', Number(amended.id), admin))
    assert.equal(draft.code, 'E_DOCUMENT_STATE')
  })

  test('decision steps route by named outcomes and may return to an earlier step (#42)', async ({
    assert,
  }) => {
    assert.throws(
      () =>
        defineWorkflow({
          ...decision(),
          steps: {
            ...decision().steps,
            decide: {
              type: 'decision',
              label: 'x',
              assignees: { users: [4] },
              outcomes: { only: { label: 'x', next: 'approved' } },
            },
          },
        }),
      /at least two outcomes/
    )
    const workflows = engine([decision()])
    const first = await submittedOrder('10')
    await deliver(workflows)
    let [run] = await workflows.inbox(manager)
    assert.deepEqual(run.myApproval?.decision?.outcomes, [
      { key: 'forward', label: 'إحالة', comment: 'optional' },
      { key: 'withdraw', label: 'سحب', comment: 'optional' },
    ])
    run = await workflows.decide(run.id, manager, 'forward')
    ;[run] = await workflows.inbox(director)
    const unknown = await failure(() => workflows.decide(run.id, director, 'approve_all'))
    assert.equal(unknown.code, 'E_WORKFLOW_DECISION')
    const noReason = await failure(() => workflows.decide(run.id, director, 'back'))
    assert.equal(noReason.code, 'E_WORKFLOW_COMMENT')
    // Returning opens a new task at the earlier step; the order stays submitted and unchanged.
    run = await workflows.decide(run.id, director, 'back', 'أرفق عرض السعر')
    assert.equal(run.step, 'prepare')
    const [again] = await workflows.inbox(manager)
    assert.equal(again.id, run.id)
    run = await workflows.decide(run.id, manager, 'forward')
    ;[run] = await workflows.inbox(director)
    run = await workflows.decide(run.id, director, 'approve')
    assert.equal(run.outcome, 'approved')
    const stored = await db('orders').where('id', first).first()
    assert.equal(stored.doc_status, 1)
    const returned = run.history.find(
      (entry) => entry.event === 'decided' && entry.detail.outcome === 'back'
    )
    assert.deepInclude(returned?.detail, { comment: 'أرفق عرض السعر', next: 'prepare' })

    // Reject with a reason cancels the document, as the end step declares.
    const second = await submittedOrder('10')
    await deliver(workflows)
    ;[run] = await workflows.inbox(manager)
    run = await workflows.decide(run.id, manager, 'forward')
    ;[run] = await workflows.inbox(director)
    run = await workflows.decide(run.id, director, 'reject', 'خارج الميزانية')
    assert.equal(run.outcome, 'rejected')
    const cancelled = await db('orders').where('id', second).first()
    assert.equal(cancelled.doc_status, 2)
    // Plain approval steps keep their two decisions and show no outcome list.
    const plain = engine([approval()])
    await submittedOrder('200000')
    await deliver(plain)
    const [waiting] = await plain.inbox(manager)
    assert.isUndefined(waiting.myApproval?.decision)
    const invalid = await failure(() => plain.decide(waiting.id, manager, 'back'))
    assert.equal(invalid.code, 'E_WORKFLOW_DECISION')
  })
})
