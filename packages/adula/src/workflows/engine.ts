import type { Knex } from 'knex'
import type { Actor } from '../auth/ability.js'
import type { ResourceService } from '../admin/resource_service.js'
import type { ResourceRegistry } from '../resource/registry.js'
import type { JsonValue, RecordData } from '../resource/types.js'
import type { DomainEvent, Listener } from '../events/outbox.js'
import type { HttpPoster } from '../integrations/webhooks.js'
import type { Assignments } from '../collaboration/assignments.js'
import { canView, resourceLabel, type ActorLoader } from '../collaboration/shared.js'
import { AdulaError } from '../admin/errors.js'
import { fromRow } from '../admin/contracts.js'
import { recordMutation } from '../events/record_mutation.js'
import { notifyWithTemplate } from '../core/message_templates.js'
import { WorkflowDelegations, actionableBy, utcDate } from './delegations.js'
import {
  nextStep,
  type EscalationTarget,
  type Recipients,
  type StepContext,
  type WorkflowDefinition,
  type WorkflowEvent,
  type WorkflowStep,
} from './define_workflow.js'

import { slaState, type SlaEvaluation, type WorkflowSlaStatus } from './sla.js'

export { slaState } from './sla.js'
export type { SlaEvaluation, SlaState, WorkflowSlaStatus } from './sla.js'

export type WorkflowRunStatus =
  'pending_definition' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled'
export type WorkflowRun = {
  id: string
  resource: string
  resourceLabel: string
  recordId: number
  /** The record title for the approver (#32); null in admin views or when not readable. */
  recordTitle: string | null
  definition: string
  label: string
  version: number
  status: WorkflowRunStatus
  step: string | null
  stepLabel: string | null
  outcome: string | null
  attempts: number
  lastError: string | null
  wakeAt: string | null
  createdAt: string
  completedAt: string | null
  history: {
    step: string | null
    event: string
    actorName: string | null
    /** Set when the actor decided as a delegate (ADR 044). */
    onBehalfOfName?: string | null
    detail: { [key: string]: JsonValue }
    at: string
  }[]
  /** Open approval assigned to the viewer for this run, if any. */
  myApproval: {
    assignmentId: number
    title: string
    /** Set at a decision step: its outcomes in declaration order (#42). */
    decision?: WorkflowDecisionForm
    /** The approver the viewer decides for as their delegate; null for their own approval. */
    onBehalfOf?: { id: number; name: string | null } | null
  } | null
  /** The current step's SLA deadline while the run waits on approvers; null without one. */
  sla?: WorkflowSlaStatus | null
}
/** What an approver needs to take a decision at a decision step. */
export type WorkflowDecisionForm = {
  outcomes: { key: string; label: string; comment: 'optional' | 'required' }[]
}
export type WorkflowOptions = {
  post?: HttpPoster
  /** Test hook simulating a crash after a step's effect and before its commit. */
  beforeCommit?: (run: { id: string; step: string }) => void | Promise<void>
  now?: () => Date
}

const MAX_STEPS_PER_TICK = 25
const HOUR = 3600000
type ApprovalStep = Extract<WorkflowStep, { type: 'approval' | 'decision' }>
type Deadline = { dueAt: Date; dueSoonAt: Date | null; escalatedAt?: Date }
const BACKOFF_SECONDS = [30, 120, 600, 1800, 7200]
/** Orders an actor's actionable rows: their own, then those routed for them, then delegated. */
const MINE_FIRST =
  '(a.assignee_id = ? AND a.delegation_id IS NULL) DESC, coalesce(a.on_behalf_of = ?, false) DESC, a.id'

/**
 * Whose approval an actor decides as a delegate: the delegator of an approval routed to
 * them, the delegator's own approval, or one routed earlier through a delegation that has
 * ended (its approver is on_behalf_of). Null when it is the actor's own.
 */
function onBehalfOf(row: Record<string, any>, actorId: number): number | null {
  const routedFor =
    row.on_behalf_of === null || row.on_behalf_of === undefined ? null : Number(row.on_behalf_of)
  if (Number(row.assignee_id) === actorId) return routedFor
  if (routedFor === actorId) return null
  return row.delegation_id ? routedFor : Number(row.assignee_id)
}

class StepFailure extends Error {
  /** A permanent failure stops the run now instead of retrying a configuration error. */
  constructor(
    message: string,
    readonly permanent = false
  ) {
    super(message)
  }
}

/**
 * Durable workflow engine over workflow_runs. Every step runs inside the run's
 * row lock (FOR UPDATE); its database effects and the transition commit together,
 * so a crash repeats at most the step's external calls (HTTP carries a stable
 * Idempotency-Key). Failed steps retry with growing delays up to maxAttempts.
 */
export class WorkflowEngine {
  #definitions = new Map<string, Map<number, WorkflowDefinition>>()
  #delegations: WorkflowDelegations

  constructor(
    private db: Knex,
    private registry: ResourceRegistry,
    private resources: ResourceService,
    private actors: ActorLoader,
    private assignments: Assignments,
    definitions: readonly WorkflowDefinition[],
    private options: WorkflowOptions = {}
  ) {
    this.#delegations = new WorkflowDelegations(db, { now: () => this.now() })
    for (const definition of definitions) this.register(definition)
  }

  register(definition: WorkflowDefinition) {
    const resource = this.registry.get(definition.resource)
    if (!resource.submittable)
      throw new Error(`Workflow ${definition.name} needs a submittable resource`)
    const versions = this.#definitions.get(definition.name) ?? new Map()
    if (versions.has(definition.version))
      throw new Error(`Duplicate workflow version ${definition.name}@${definition.version}`)
    versions.set(definition.version, definition)
    this.#definitions.set(definition.name, versions)
    return this
  }

  /** The newest version of each workflow attached to a resource. */
  private latestFor(resource: string) {
    const found: WorkflowDefinition[] = []
    for (const versions of this.#definitions.values()) {
      const latest = [...versions.values()].sort((a, b) => b.version - a.version)[0]
      if (latest.resource === resource) found.push(latest)
    }
    if (found.length > 1)
      throw new Error(`Resource ${resource} has more than one workflow; use one per resource`)
    return found[0]
  }

  private definition(name: string, version: number) {
    const definition = this.#definitions.get(name)?.get(version)
    if (!definition) throw new StepFailure(`Workflow ${name}@${version} is not registered`)
    return definition
  }

  /** Listeners: submitted documents start their workflow; cancelled ones stop it. */
  listeners(): Listener[] {
    return this.registry.all().flatMap((resource) => {
      if (!resource.submittable) return []
      return [
        {
          ...workflowKey(this.registry, resource.name, 'start'),
          handle: (event: DomainEvent, trx: Knex.Transaction) => this.start(trx, event),
        },
        {
          ...workflowKey(this.registry, resource.name, 'cancel'),
          handle: (event: DomainEvent, trx: Knex.Transaction) =>
            this.cancelRuns(
              trx,
              resource.name,
              Number(event.payload.id),
              Number(event.payload.actorId)
            ),
        },
      ]
    })
  }

  /** Claims the submission envelope written in the submit transaction. */
  async start(trx: Knex.Transaction, event: DomainEvent) {
    const run = await trx('workflow_runs').where('id', event.id).forUpdate().first()
    if (!run || run.status !== 'pending_definition') return
    const definition = this.latestFor(run.resource)
    if (!definition) {
      await trx('workflow_runs').where('id', run.id).update({
        status: 'completed',
        outcome: 'no_workflow',
        updated_at: trx.fn.now(),
        completed_at: trx.fn.now(),
      })
      return
    }
    await trx('workflow_runs')
      .where('id', run.id)
      .update({
        definition: definition.name,
        definition_version: definition.version,
        snapshot: JSON.stringify({ value: definition.start }),
        status: 'running',
        current_step: definition.start,
        wake_at: this.now(),
        started_by: Number(event.payload.actorId) || null,
        updated_at: trx.fn.now(),
      })
    await this.log(
      trx,
      run.id,
      definition.start,
      'started',
      Number(event.payload.actorId) || null,
      {
        workflow: definition.name,
        version: definition.version,
      }
    )
    await this.advance(trx, run.id)
  }

  /** Worker step: advances due runs, each under its own row lock. */
  async tick(limit = 20) {
    let processed = 0
    for (let index = 0; index < limit; index++) {
      const advanced = await this.db.transaction(async (trx) => {
        const run = await trx('workflow_runs')
          .where('status', 'running')
          .where('wake_at', '<=', this.now())
          .orderBy('wake_at')
          .forUpdate()
          .skipLocked()
          .first('id')
        if (!run) return false
        await this.advance(trx, run.id)
        return true
      })
      if (!advanced) break
      processed++
    }
    return processed
  }

  /**
   * Runs steps until the run waits, ends, fails or is scheduled later. The caller
   * holds the row lock. Each step executes in a savepoint so a failing step leaves
   * no partial effects behind.
   */
  private async advance(trx: Knex.Transaction, runId: string) {
    for (let count = 0; count < MAX_STEPS_PER_TICK; count++) {
      const run = await trx('workflow_runs').where('id', runId).forUpdate().first()
      if (!run || run.status !== 'running') return
      if (run.wake_at && new Date(run.wake_at) > this.now()) return
      let definition: WorkflowDefinition
      try {
        definition = this.definition(run.definition, run.definition_version)
      } catch (error) {
        await this.fail(trx, run, error, true)
        return
      }
      const stepName = String(run.current_step)
      const step = definition.steps[stepName]
      if (!step) {
        await this.fail(trx, run, new StepFailure(`Unknown step ${stepName}`), true)
        return
      }
      try {
        const outcome = await trx.transaction(async (savepoint) => {
          const context = await this.context(savepoint, run)
          const result = await this.execute(savepoint, run, definition, stepName, context)
          await this.options.beforeCommit?.({ id: run.id, step: stepName })
          return result
        })
        if (outcome === 'stop') return
      } catch (error) {
        await this.fail(trx, run, error, error instanceof StepFailure && error.permanent)
        return
      }
    }
  }

  private async execute(
    trx: Knex.Transaction,
    run: Record<string, any>,
    definition: WorkflowDefinition,
    stepName: string,
    context: StepContext
  ): Promise<'continue' | 'stop'> {
    const step = definition.steps[stepName]
    const move = async (event: WorkflowEvent, detail: Record<string, unknown> = {}) => {
      const target = nextStep(definition, stepName, event)
      // A definition built without defineWorkflow could still loop; stop it here.
      if (target === stepName)
        throw new StepFailure(`Step ${stepName} cannot name itself as its next step`, true)
      await trx('workflow_runs')
        .where('id', run.id)
        .update({
          current_step: target,
          snapshot: JSON.stringify({ value: target }),
          attempts: 0,
          last_error: null,
          wake_at: this.now(),
          updated_at: trx.fn.now(),
        })
      await this.log(trx, run.id, stepName, event.type.toLowerCase(), null, {
        ...detail,
        next: target,
      })
      return 'continue' as const
    }
    switch (step.type) {
      case 'condition':
        return move({ type: 'EVALUATE', record: context.record })
      case 'update': {
        const values = typeof step.values === 'function' ? step.values(context) : step.values
        await this.updateRecord(trx, run, context.record, values)
        return move({ type: 'DONE' }, { fields: Object.keys(values) })
      }
      case 'notify': {
        const users = await this.recipients(trx, run, context, step.to)
        for (const userId of users)
          await notifyWithTemplate(
            trx,
            userId,
            step.template ?? 'workflow.decided',
            step.variables?.(context) ?? {
              outcome: definition.label,
              resource: this.resources.label(run.resource),
              id: run.record_id,
              workflow: definition.label,
              step: step.label ?? stepName,
            },
            undefined,
            { resource: String(run.resource), recordId: Number(run.record_id) }
          )
        return move({ type: 'DONE' }, { recipients: users.length })
      }
      case 'approval':
      case 'decision': {
        const open = await trx('assignments')
          .where({ workflow_run_id: run.id, workflow_step: stepName, status: 'open' })
          .first('id')
        if (!open) {
          const assignees = step.assignees
          if (typeof assignees === 'object' && 'role' in assignees)
            if ((await this.roleId(trx, assignees.role)) === null)
              throw new StepFailure(
                `Approval step ${stepName} is addressed to role "${assignees.role}", which matches no role key or name. Give the role that key (or update the workflow), then retry the run.`,
                true
              )
          const users = await this.recipients(trx, run, context, assignees)
          const eligible: number[] = []
          for (const userId of users)
            if (await this.canView(run.resource, run.record_id, userId)) eligible.push(userId)
          // Waiting on nobody would hide the run for hours of retries; fail it where admins look.
          if (!eligible.length)
            throw new StepFailure(
              `No eligible approver for ${stepName}: ${users.length ? `${users.length} recipients cannot view the record` : 'the recipients resolve to no active user'}. Fix the recipients, then retry the run.`,
              true
            )
          const delegated = await this.openApprovals(trx, run, stepName, step, eligible)
          await this.log(trx, run.id, stepName, 'approval_requested', null, {
            approvers: eligible,
            ...(delegated.length ? { delegated } : {}),
          })
        }
        await trx('workflow_runs').where('id', run.id).update({
          status: 'waiting',
          wake_at: null,
          attempts: 0,
          last_error: null,
          updated_at: trx.fn.now(),
        })
        return 'stop'
      }
      case 'delay': {
        // The deadline lives in the snapshot, so a crash or a later loop back to
        // this step never skips or doubles the wait.
        const snapshot = (run.snapshot ?? {}) as { value?: string; until?: string }
        if (!snapshot.until) {
          const wake = new Date(this.now().getTime() + step.ms)
          await trx('workflow_runs')
            .where('id', run.id)
            .update({
              wake_at: wake,
              snapshot: JSON.stringify({ value: stepName, until: wake.toISOString() }),
              updated_at: trx.fn.now(),
            })
          await this.log(trx, run.id, stepName, 'delay_started', null, {
            until: wake.toISOString(),
          })
          return 'stop'
        }
        if (new Date(snapshot.until) > this.now()) return 'stop'
        return move({ type: 'DONE' })
      }
      case 'http': {
        if (!this.options.post)
          throw new StepFailure('No HTTP client configured for workflow steps')
        const url = typeof step.url === 'function' ? step.url(context) : step.url
        const body = JSON.stringify(
          step.body?.(context) ?? { run: run.id, resource: run.resource, recordId: run.record_id }
        )
        const response = await this.options.post(url, {
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': `${run.id}:${stepName}`,
            'User-Agent': 'adula-workflows',
          },
          body,
          signal: AbortSignal.timeout(10000),
        })
        if (response.status < 200 || response.status >= 300)
          throw new StepFailure(`HTTP ${response.status} from ${new URL(url).host}`)
        return move({ type: 'DONE' }, { status: response.status })
      }
      case 'end': {
        if (step.cancelDocument && context.record.docStatus === 1)
          await this.cancelDocument(trx, run, context.record)
        await trx('workflow_runs').where('id', run.id).update({
          status: 'completed',
          outcome: step.outcome,
          wake_at: null,
          completed_at: trx.fn.now(),
          updated_at: trx.fn.now(),
        })
        await this.log(trx, run.id, stepName, 'completed', null, { outcome: step.outcome })
        return 'stop'
      }
    }
  }

  /**
   * Records an approver's decision. Only an open approval assigned to the actor
   * counts, and the run is locked so concurrent decisions cannot both apply.
   */
  async decide(runId: string, actor: Actor, decision: string, comment?: unknown) {
    if (typeof decision !== 'string' || !decision)
      throw new AdulaError(422, 'E_WORKFLOW_DECISION', 'القرار غير صالح')
    const note = typeof comment === 'string' ? comment.trim().slice(0, 1000) : ''
    await this.db.transaction(async (trx) => {
      const run = await trx('workflow_runs').where('id', runId).forUpdate().first()
      if (!run) throw new AdulaError(404, 'E_WORKFLOW_NOT_FOUND', 'التدفق غير موجود')
      if (!(await this.resources.permits(run.resource, Number(run.record_id), actor)))
        throw new AdulaError(404, 'E_WORKFLOW_NOT_FOUND', 'التدفق غير موجود')
      // The actor's own approval first, then one they hold for a delegator (ADR 044).
      const assignment = await trx('assignments as a')
        .where({
          'a.workflow_run_id': run.id,
          'a.workflow_step': run.current_step,
          'a.status': 'open',
        })
        .modify(actionableBy(trx, actor.id, this.today()))
        .orderByRaw(MINE_FIRST, [actor.id, actor.id])
        .forUpdate()
        .first('a.*')
      if (run.status !== 'waiting' || !assignment)
        throw new AdulaError(409, 'E_WORKFLOW_STATE', 'لا توجد موافقة مطلوبة منك في هذه الخطوة')
      const definition = this.definition(run.definition, run.definition_version)
      const step = definition.steps[run.current_step]
      let event: WorkflowEvent
      let logged: string
      if (step?.type === 'decision') {
        const outcome = Object.hasOwn(step.outcomes, decision) ? step.outcomes[decision] : undefined
        if (!outcome) throw new AdulaError(422, 'E_WORKFLOW_DECISION', 'القرار غير صالح')
        if (outcome.comment === 'required' && !note)
          throw new AdulaError(422, 'E_WORKFLOW_COMMENT', 'اكتب ملاحظة القرار')
        event = { type: 'DECIDE', outcome: decision }
        logged = 'decided'
      } else {
        if (decision !== 'approve' && decision !== 'reject')
          throw new AdulaError(422, 'E_WORKFLOW_DECISION', 'القرار غير صالح')
        event = { type: decision === 'approve' ? 'APPROVE' : 'REJECT' }
        logged = decision === 'approve' ? 'approved' : 'rejected'
      }
      const target = nextStep(definition, run.current_step, event)
      await trx('assignments').where('id', assignment.id).update({
        status: 'done',
        outcome: decision,
        completed_at: trx.fn.now(),
        completed_by: actor.id,
      })
      // Other approvers of the same step are no longer needed.
      await trx('assignments')
        .where({ workflow_run_id: run.id, workflow_step: run.current_step, status: 'open' })
        .update({ status: 'cancelled', completed_at: trx.fn.now() })
      await trx('workflow_runs')
        .where('id', run.id)
        .update({
          status: 'running',
          current_step: target,
          snapshot: JSON.stringify({ value: target }),
          wake_at: this.now(),
          attempts: 0,
          last_error: null,
          updated_at: trx.fn.now(),
        })
      const behalf = onBehalfOf(assignment, actor.id)
      await this.log(trx, run.id, run.current_step, logged, actor.id, {
        ...(logged === 'decided' ? { outcome: decision } : {}),
        ...(note ? { comment: note } : {}),
        ...(behalf ? { onBehalfOf: behalf, onBehalfOfName: await this.userName(trx, behalf) } : {}),
        next: target,
      })
      await this.advance(trx, run.id)
    })
    return this.run(runId, actor)
  }

  /** Administrators put a failed run back to its failed step. */
  async retry(runId: string, actorId: number) {
    const updated = await this.db('workflow_runs').where({ id: runId, status: 'failed' }).update({
      status: 'running',
      attempts: 0,
      wake_at: this.now(),
      updated_at: this.db.fn.now(),
    })
    if (!updated)
      throw new AdulaError(404, 'E_WORKFLOW_NOT_FOUND', 'لا يوجد تدفق فاشل بهذا المعرّف')
    await this.log(this.db, runId, null, 'retried', actorId, {})
  }

  /**
   * One pass of the `sla:` job family (ADR 044). Approvers whose deadline is near get one
   * reminder; overdue approvals run their step's escalation policy once: mark overdue
   * (tell the approvers), notify a target, or reassign to it. Every action happens under
   * the run's row lock and is recorded in workflow_escalations, whose unique key per
   * assignment and level makes a repeated or concurrent pass a no-op.
   */
  async evaluateSla(options: { limit?: number } = {}): Promise<SlaEvaluation> {
    const limit = Math.max(1, Math.min(500, Math.floor(Number(options.limit) || 100)))
    const now = this.now()
    const pending = () =>
      this.db('assignments as a')
        .join('workflow_runs as r', 'r.id', 'a.workflow_run_id')
        .where({ 'a.status': 'open', 'r.status': 'waiting' })
        .whereRaw('a.workflow_step = r.current_step')
    const reminders = await pending()
      .whereNull('a.reminded_at')
      .whereNull('a.escalated_at')
      .where('a.due_soon_at', '<=', now)
      .where('a.due_at', '>', now)
      .orderBy('a.due_at')
      .limit(limit)
      .select('a.id', 'a.workflow_run_id')
    let reminded = 0
    for (const due of reminders)
      if (await this.db.transaction((trx) => this.remind(trx, due.workflow_run_id, due.id, now)))
        reminded++
    const late = await pending()
      .whereNull('a.escalated_at')
      .where('a.due_at', '<=', now)
      .groupBy('a.workflow_run_id')
      .orderByRaw('min(a.due_at)')
      .limit(limit)
      .select('a.workflow_run_id')
    let escalated = 0
    for (const due of late)
      if (await this.db.transaction((trx) => this.escalate(trx, due.workflow_run_id, now)))
        escalated++
    return { reminded, escalated }
  }

  private async remind(trx: Knex.Transaction, runId: string, assignmentId: number, now: Date) {
    const run = await trx('workflow_runs').where('id', runId).forUpdate().skipLocked().first()
    if (!run || run.status !== 'waiting') return false
    const row = await trx('assignments')
      .where({ id: assignmentId, status: 'open', workflow_step: run.current_step })
      .whereNull('reminded_at')
      .whereNull('escalated_at')
      .forUpdate()
      .first()
    if (!row) return false
    await trx('assignments').where('id', row.id).update({ reminded_at: now })
    const holder = await this.holder(trx, run, row)
    const recorded = await this.record(trx, run, row, 'due_soon', 'remind', [holder])
    if (!recorded) return false
    await this.notifyDeadline(trx, run, row, holder, 'workflow.sla_due_soon')
    await this.log(trx, run.id, run.current_step, 'sla_reminded', null, {
      assignee: holder,
      dueAt: new Date(row.due_at).toISOString(),
    })
    return true
  }

  private async escalate(trx: Knex.Transaction, runId: string, now: Date) {
    const run = await trx('workflow_runs').where('id', runId).forUpdate().skipLocked().first()
    if (!run || run.status !== 'waiting') return false
    const rows = await trx('assignments')
      .where({ workflow_run_id: run.id, workflow_step: run.current_step, status: 'open' })
      .whereNull('escalated_at')
      .where('due_at', '<=', now)
      .orderBy('id')
      .forUpdate()
    if (!rows.length) return false
    await trx('assignments')
      .whereIn(
        'id',
        rows.map((row) => row.id)
      )
      .update({ escalated_at: now, reminded_at: trx.raw('coalesce(reminded_at, ?)', [now]) })
    let step: WorkflowStep | undefined
    try {
      step = this.definition(run.definition, run.definition_version).steps[run.current_step]
    } catch {}
    const policy =
      step && (step.type === 'approval' || step.type === 'decision')
        ? step.sla?.escalate
        : undefined
    let action: 'overdue' | 'notify' | 'reassign' = policy?.action ?? 'overdue'
    let targets: number[] = []
    let reason: string | undefined
    if (policy && policy.action !== 'overdue') {
      try {
        const context = await this.context(trx, run)
        const late = new Set<number>()
        for (const row of rows) {
          late.add(Number(row.assignee_id))
          if (row.on_behalf_of) late.add(Number(row.on_behalf_of))
        }
        for (const userId of await this.escalationTargets(trx, run, context, policy.to, rows))
          // The requester never receives their own request (ADR 044, no self-approval).
          if (
            !late.has(userId) &&
            userId !== Number(run.started_by) &&
            (await this.canView(run.resource, run.record_id, userId))
          )
            targets.push(userId)
      } catch (error) {
        reason = String((error as Error)?.message ?? error).slice(0, 300)
      }
      // A policy that finds nobody still marks the approval overdue, never silently waits.
      if (!targets.length) {
        reason ??= 'no eligible escalation target'
        action = 'overdue'
      }
    }
    let recorded = 0
    for (const row of rows)
      if (await this.record(trx, run, row, 'overdue', action, targets)) recorded++
    if (!recorded) return false
    // Late approvers are told at their current holder: the approver again once the
    // delegation that routed the approval has ended.
    const holders: number[] = []
    for (const row of rows) holders.push(await this.holder(trx, run, row))
    for (const [index, row] of rows.entries())
      await this.notifyDeadline(trx, run, row, holders[index], 'workflow.sla_overdue')
    if (action === 'notify') {
      const names: string[] = []
      for (const row of rows) {
        const name = await this.userName(trx, Number(row.on_behalf_of ?? row.assignee_id))
        if (name && !names.includes(name)) names.push(name)
      }
      for (const userId of targets)
        await this.notifyDeadline(trx, run, rows[0], userId, 'workflow.sla_escalated', {
          assignee: names.join('، '),
        })
    }
    if (action === 'reassign' && step && (step.type === 'approval' || step.type === 'decision')) {
      await trx('assignments')
        .whereIn(
          'id',
          rows.map((row) => row.id)
        )
        .update({
          status: 'cancelled',
          completed_at: trx.fn.now(),
          close_reason: 'أُعيد الإسناد بعد تجاوز المهلة',
        })
      const dueAt = new Date(Math.min(...rows.map((row) => new Date(row.due_at).getTime())))
      await this.openApprovals(trx, run, run.current_step, step, targets, {
        dueAt,
        dueSoonAt: null,
        escalatedAt: now,
      })
    }
    await this.log(trx, run.id, run.current_step, 'sla_escalated', null, {
      action,
      late: holders,
      targets,
      ...(reason ? { reason } : {}),
    })
    return true
  }

  /** Records one SLA action per assignment and level; false when it was already recorded. */
  private async record(
    trx: Knex.Transaction,
    run: Record<string, any>,
    row: Record<string, any>,
    level: 'due_soon' | 'overdue',
    action: string,
    targets: number[]
  ) {
    const inserted = await trx('workflow_escalations')
      .insert({
        run_id: run.id,
        step: run.current_step,
        assignment_id: row.id,
        level,
        action,
        targets: JSON.stringify(targets),
      })
      .onConflict(['assignment_id', 'level'])
      .ignore()
      .returning('id')
    return inserted.length > 0
  }

  private async notifyDeadline(
    trx: Knex.Transaction,
    run: Record<string, any>,
    row: Record<string, any>,
    userId: number,
    template: string,
    extra: Record<string, unknown> = {}
  ) {
    await notifyWithTemplate(
      trx,
      userId,
      template,
      {
        title: String(row.title),
        resource: this.resources.label(run.resource),
        id: run.record_id,
        due: new Date(row.due_at).toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
        ...extra,
      },
      undefined,
      { resource: String(run.resource), recordId: Number(run.record_id) }
    )
  }

  /**
   * Explicit version migration for runs that have not finished: `mapStep` returns
   * the equivalent step name in the new version.
   */
  async migrateRuns(name: string, from: number, to: number, mapStep: (step: string) => string) {
    const target = this.definition(name, to)
    return this.db.transaction(async (trx) => {
      const runs = await trx('workflow_runs')
        .where({ definition: name, definition_version: from })
        .whereIn('status', ['running', 'waiting', 'failed'])
        .forUpdate()
      for (const run of runs) {
        const step = mapStep(run.current_step)
        if (!(step in target.steps)) throw new Error(`Step ${step} is not in ${name}@${to}`)
        await trx('workflow_runs')
          .where('id', run.id)
          .update({
            definition_version: to,
            current_step: step,
            snapshot: JSON.stringify({ value: step }),
            updated_at: trx.fn.now(),
          })
        await this.log(trx, run.id, step, 'migrated', null, { from, to })
      }
      return runs.length
    })
  }

  async runsFor(name: string, id: number, actor: Actor) {
    await this.resources.access(name, id, actor)
    const rows = await this.db('workflow_runs')
      .where({ resource: name, record_id: id })
      .whereNot('status', 'pending_definition')
      .orderBy('created_at', 'desc')
      .limit(20)
    return Promise.all(rows.map((row) => this.present(row, actor)))
  }

  async run(runId: string, actor: Actor) {
    const row = await this.db('workflow_runs').where('id', runId).first()
    if (!row || !(await this.resources.permits(row.resource, Number(row.record_id), actor)))
      throw new AdulaError(404, 'E_WORKFLOW_NOT_FOUND', 'التدفق غير موجود')
    return this.present(row, actor)
  }

  /** Runs waiting for the actor's decision, newest first, on records they can still read. */
  /**
   * Runs waiting for this user's decision, newest first (at most 100). `runIds` narrows the
   * inbox to those runs, for pages that list their own rows (My tasks).
   */
  async inbox(actor: Actor, options: { runIds?: readonly string[] } = {}) {
    if (options.runIds && !options.runIds.length) return []
    // Delegated approvals count too, so one run may match twice (ADR 044).
    const query = this.db('workflow_runs as r')
      .join('assignments as a', 'a.workflow_run_id', 'r.id')
      .where({ 'a.status': 'open', 'r.status': 'waiting' })
      .whereRaw('a.workflow_step = r.current_step')
      .modify(actionableBy(this.db, actor.id, this.today()))
    if (options.runIds) query.whereIn('r.id', [...new Set(options.runIds)].slice(0, 100))
    const rows = await query.orderBy('a.id', 'desc').limit(200).select('r.*')
    const runs: WorkflowRun[] = []
    const seen = new Set<string>()
    for (const row of rows) {
      if (seen.has(String(row.id)) || runs.length >= 100) continue
      seen.add(String(row.id))
      if (await this.resources.permits(row.resource, Number(row.record_id), actor))
        runs.push(await this.present(row, actor))
    }
    return runs
  }

  async failed(limit = 100) {
    const rows = await this.db('workflow_runs')
      .where('status', 'failed')
      .orderBy('updated_at', 'desc')
      .limit(limit)
    return Promise.all(rows.map((row) => this.present(row)))
  }

  private async present(row: Record<string, any>, actor?: Actor): Promise<WorkflowRun> {
    let definition: WorkflowDefinition | undefined
    try {
      definition = this.definition(row.definition, row.definition_version)
    } catch {}
    const history = await this.db('workflow_events as e')
      .leftJoin('users as u', 'u.id', 'e.actor_id')
      .where('e.run_id', row.id)
      .orderBy('e.id')
      .limit(200)
      .select('e.*', 'u.full_name as actor_name')
    const mine = actor
      ? await this.db('assignments as a')
          .where({
            'a.workflow_run_id': row.id,
            'a.workflow_step': row.current_step,
            'a.status': 'open',
          })
          .modify(actionableBy(this.db, actor.id, this.today()))
          .orderByRaw(MINE_FIRST, [actor.id, actor.id])
          .first('a.*')
      : undefined
    const behalf = mine && actor ? onBehalfOf(mine, actor.id) : null
    const deadline =
      row.status === 'waiting'
        ? await this.db('assignments')
            .where({ workflow_run_id: row.id, workflow_step: row.current_step, status: 'open' })
            .whereNotNull('due_at')
            .first(
              this.db.raw('min(due_at) as due_at'),
              this.db.raw('min(due_soon_at) as due_soon_at'),
              this.db.raw('bool_or(escalated_at IS NOT NULL) as escalated')
            )
        : undefined
    const step = row.current_step ? definition?.steps[row.current_step] : undefined
    const titles = actor
      ? await this.resources.titles(row.resource, [Number(row.record_id)], actor)
      : undefined
    return {
      id: String(row.id),
      resource: String(row.resource),
      resourceLabel: resourceLabel(this.resources, String(row.resource)),
      recordId: Number(row.record_id),
      recordTitle: titles?.get(Number(row.record_id)) ?? null,
      definition: String(row.definition),
      label: definition?.label ?? String(row.definition),
      version: Number(row.definition_version),
      status: row.status,
      step: row.current_step ?? null,
      stepLabel: step?.label ?? row.current_step ?? null,
      outcome: row.outcome ?? null,
      attempts: Number(row.attempts ?? 0),
      lastError: row.last_error ?? null,
      wakeAt: row.wake_at ? new Date(row.wake_at).toISOString() : null,
      createdAt: new Date(row.created_at).toISOString(),
      completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
      history: history.map((event) => ({
        step: event.step ?? null,
        event: String(event.event),
        actorName: event.actor_name ? String(event.actor_name) : null,
        onBehalfOfName:
          typeof event.detail?.onBehalfOfName === 'string' ? event.detail.onBehalfOfName : null,
        detail: (event.detail ?? {}) as { [key: string]: JsonValue },
        at: new Date(event.created_at).toISOString(),
      })),
      myApproval: mine
        ? {
            assignmentId: Number(mine.id),
            title: String(mine.title),
            ...(step?.type === 'decision' ? { decision: this.decisionForm(step) } : {}),
            onBehalfOf: behalf ? { id: behalf, name: await this.userName(this.db, behalf) } : null,
          }
        : null,
      sla: deadline?.due_at
        ? {
            dueAt: new Date(deadline.due_at).toISOString(),
            state: slaState(
              new Date(deadline.due_at),
              deadline.due_soon_at ? new Date(deadline.due_soon_at) : null,
              this.now()
            ),
            escalated: Boolean(deadline.escalated),
          }
        : null,
    }
  }

  /** The outcomes an approver can choose at a decision step. */
  private decisionForm(step: Extract<WorkflowStep, { type: 'decision' }>): WorkflowDecisionForm {
    return {
      outcomes: Object.entries(step.outcomes).map(([key, outcome]) => ({
        key,
        label: outcome.label,
        comment: outcome.comment ?? 'optional',
      })),
    }
  }

  private async fail(
    trx: Knex.Transaction,
    run: Record<string, any>,
    error: unknown,
    permanent: boolean
  ) {
    const attempts = Number(run.attempts ?? 0) + 1
    let maxAttempts = 5
    try {
      maxAttempts = this.definition(run.definition, run.definition_version).maxAttempts ?? 5
    } catch {}
    const message = String((error as Error)?.message ?? error).slice(0, 1000)
    const final = permanent || attempts >= maxAttempts
    await trx('workflow_runs')
      .where('id', run.id)
      .update({
        status: final ? 'failed' : 'running',
        attempts,
        last_error: message,
        wake_at: final
          ? null
          : new Date(
              this.now().getTime() +
                BACKOFF_SECONDS[Math.min(attempts - 1, BACKOFF_SECONDS.length - 1)] * 1000
            ),
        updated_at: trx.fn.now(),
      })
    await this.log(trx, run.id, run.current_step, final ? 'failed' : 'retry_scheduled', null, {
      error: message,
      attempts,
    })
    if (final && run.started_by)
      await notifyWithTemplate(
        trx,
        Number(run.started_by),
        'workflow.failed',
        {
          workflow: run.definition,
          resource: this.resources.label(run.resource),
          id: run.record_id,
          error: message,
        },
        undefined,
        { resource: String(run.resource), recordId: Number(run.record_id) }
      )
  }

  private async cancelRuns(trx: Knex.Transaction, resource: string, id: number, actorId: number) {
    const runs = await trx('workflow_runs')
      .where({ resource, record_id: id })
      .whereIn('status', ['running', 'waiting', 'failed', 'pending_definition'])
      .forUpdate()
    for (const run of runs) {
      await trx('workflow_runs').where('id', run.id).update({
        status: 'cancelled',
        wake_at: null,
        completed_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      })
      await trx('assignments')
        .where({ workflow_run_id: run.id, status: 'open' })
        .update({ status: 'cancelled', completed_at: trx.fn.now() })
      await this.log(trx, run.id, run.current_step, 'cancelled', actorId || null, {})
    }
  }

  private async context(trx: Knex.Transaction, run: Record<string, any>): Promise<StepContext> {
    const resource = this.registry.get(run.resource)
    const row = await trx(resource.name).where('id', run.record_id).first()
    if (!row) throw new StepFailure('The workflow record no longer exists')
    return {
      record: fromRow(row, resource),
      run: {
        id: String(run.id),
        resource: String(run.resource),
        recordId: Number(run.record_id),
        startedBy: run.started_by === null ? null : Number(run.started_by),
      },
      db: trx,
    }
  }

  /**
   * Workflow writes are system writes attributed to the submitter, with history. They go
   * through systemSave, so the resource validator, hooks, relation checks and the
   * optimistic lock apply; a rejected write fails the step like any other step error.
   */
  private async updateRecord(
    trx: Knex.Transaction,
    run: Record<string, any>,
    record: RecordData,
    values: RecordData
  ) {
    const resource = this.registry.get(run.resource)
    for (const [key, value] of Object.entries(values)) {
      const field = resource.fields[key]
      if (!field || ['hasMany', 'attachment'].includes(field.type) || field.sequence)
        throw new StepFailure(`Workflow cannot write field ${key}`)
      if (field.type === 'lookup' && value !== null && value !== undefined) {
        const valid = await trx('lookups')
          .where({ group: field.group, key: value, active: true })
          .first()
        if (!valid) throw new StepFailure(`Invalid lookup value for ${key}`)
      }
    }
    // A run started by an event without a user is an unattributed system update.
    await this.resources.systemSave(resource.name, values, Number(run.record_id), {
      actorId: run.started_by ? Number(run.started_by) : null,
      trx,
      reason: `workflow:${run.definition}`,
      version: resource.version ? Number(record.version) : undefined,
      submitted: true,
    })
  }

  private async cancelDocument(
    trx: Knex.Transaction,
    run: Record<string, any>,
    record: RecordData
  ) {
    const resource = this.registry.get(run.resource)
    await trx(resource.name)
      .where('id', run.record_id)
      .update({
        doc_status: 2,
        updated_at: trx.fn.now(),
        ...(resource.version ? { version: Number(record.version) + 1 } : {}),
      })
    if (run.started_by)
      await recordMutation(trx, {
        module: this.registry.owner(resource.name),
        resource: resource.name,
        id: run.record_id,
        actorId: Number(run.started_by),
        action: 'cancel',
        fields: [],
      })
  }

  private async recipients(
    trx: Knex.Transaction,
    run: Record<string, any>,
    context: StepContext,
    to: Recipients
  ): Promise<number[]> {
    let ids: number[]
    if (to === 'creator') ids = [Number(context.record.createdBy)]
    else if (to === 'submitter') ids = run.started_by ? [Number(run.started_by)] : []
    else if (typeof to === 'function') ids = await to(context)
    else if ('users' in to) ids = to.users
    else {
      const roleId = await this.roleId(trx, to.role)
      const members =
        roleId === null
          ? []
          : await trx('user_roles as ur')
              .join('users as u', 'u.id', 'ur.user_id')
              .where('ur.role_id', roleId)
              .whereNull('u.disabled_at')
              .distinct('ur.user_id')
      ids = members.map((row) => Number(row.user_id))
    }
    return [...new Set(ids.filter((id) => Number.isSafeInteger(id) && id > 0))]
  }

  /** A role reference is its stable key; for compatibility a display name also matches. */
  private async roleId(db: Knex, reference: string): Promise<number | null> {
    const byKey = await db('roles').where('key', reference).first('id')
    if (byKey) return Number(byKey.id)
    const byName = await db('roles').where('name', reference).first('id')
    return byName ? Number(byName.id) : null
  }

  private canView(resource: string, id: number, userId: number) {
    return canView(this.db, this.resources, this.actors, resource, id, userId)
  }

  private async log(
    db: Knex,
    runId: string,
    step: string | null,
    event: string,
    actorId: number | null,
    detail: Record<string, unknown>
  ) {
    await db('workflow_events').insert({
      run_id: runId,
      step,
      event,
      actor_id: actorId,
      detail: JSON.stringify(detail),
    })
  }

  /**
   * Opens one approval per approver. An approver with a delegation in force today is
   * replaced by the delegate when the delegate may view the record (ADR 044); the row
   * keeps the approver in on_behalf_of, so both see it while the delegation lasts.
   * Returns the routed pairs for the run log.
   */
  private async openApprovals(
    trx: Knex.Transaction,
    run: Record<string, any>,
    stepName: string,
    step: ApprovalStep,
    approvers: number[],
    deadline: Deadline | null = this.deadline(step)
  ) {
    const dueOn = deadline
      ? utcDate(deadline.dueAt)
      : step.dueInDays
        ? utcDate(new Date(this.now().getTime() + step.dueInDays * 86400000))
        : null
    const routed: { from: number; to: number }[] = []
    const opened = new Set<string>()
    for (const approver of approvers) {
      let assigneeId = approver
      const active = await this.delegateFor(trx, run, approver)
      let delegation: { id: number; delegateId: number } | null = null
      if (active) {
        delegation = active
        assigneeId = active.delegateId
        routed.push({ from: approver, to: assigneeId })
      }
      const key = `${assigneeId}:${delegation ? approver : ''}`
      if (opened.has(key)) continue
      opened.add(key)
      await this.assignments.create(trx, {
        resource: run.resource,
        recordId: Number(run.record_id),
        assigneeId,
        assignedBy: run.started_by,
        title: step.label,
        kind: 'approval',
        dueOn,
        workflowRunId: run.id,
        workflowStep: stepName,
        onBehalfOf: delegation ? approver : null,
        delegationId: delegation?.id ?? null,
        dueAt: deadline?.dueAt ?? null,
        dueSoonAt: deadline?.dueSoonAt ?? null,
        escalatedAt: deadline?.escalatedAt ?? null,
      })
    }
    return routed
  }

  /** The SLA deadline of a step opening now, or null when the step declares none. */
  private deadline(step: ApprovalStep): Deadline | null {
    if (!step.sla) return null
    const now = this.now().getTime()
    const dueAt = new Date(now + step.sla.hours * HOUR)
    const soon = step.sla.dueSoonHours ?? step.sla.hours / 4
    return { dueAt, dueSoonAt: soon > 0 ? new Date(dueAt.getTime() - soon * HOUR) : null }
  }

  private async escalationTargets(
    trx: Knex.Transaction,
    run: Record<string, any>,
    context: StepContext,
    to: EscalationTarget,
    late: Record<string, any>[]
  ): Promise<number[]> {
    if (typeof to === 'object' && to !== null && 'manager' in to) {
      // The approver of record: the delegator when the late approval was delegated.
      const approvers = [...new Set(late.map((row) => Number(row.on_behalf_of ?? row.assignee_id)))]
      const found: number[] = []
      for (const approver of approvers)
        found.push(...(await this.managers(trx, to.manager, approver)))
      return [...new Set(found)]
    }
    return this.recipients(trx, run, context, to)
  }

  /**
   * The approver's managers in the org tree: active holders of the role whose role is
   * scoped to the approver's unit or, failing that, to the nearest ancestor unit.
   */
  private async managers(trx: Knex.Transaction, role: string, approver: number) {
    const roleId = await this.roleId(trx, role)
    if (roleId === null) return []
    const rows = await trx('user_roles as ur')
      .join('org_units as o', 'o.id', 'ur.org_unit_id')
      .join('users as u', 'u.id', 'ur.user_id')
      .where('ur.role_id', roleId)
      .whereNot('ur.user_id', approver)
      .whereNull('u.disabled_at')
      .whereRaw(
        'o.path @> ANY (SELECT ou.path FROM user_org_units m JOIN org_units ou ON ou.id = m.org_unit_id WHERE m.user_id = ?)',
        [approver]
      )
      .select('ur.user_id', trx.raw('nlevel(o.path) AS depth'))
    const nearest = Math.max(...rows.map((row) => Number(row.depth)))
    return rows.filter((row) => Number(row.depth) === nearest).map((row) => Number(row.user_id))
  }

  /**
   * The delegate an approver's approvals go to today, or null to keep them with the
   * approver (ADR 044). Routing is one hop and only to someone who can act: never the
   * person who started the run (no self-approval), never a delegate who is away and
   * delegating in turn, and never a delegate who cannot view the record.
   */
  private async delegateFor(db: Knex, run: Record<string, any>, approver: number) {
    const active = await this.#delegations.active(approver, db)
    if (!active || active.delegateId === Number(run.started_by)) return null
    if (await this.#delegations.active(active.delegateId, db)) return null
    if (!(await this.canView(run.resource, run.record_id, active.delegateId))) return null
    return active
  }

  /**
   * Who is told about an open approval now: the delegate it was routed to while that
   * delegation lasts; otherwise its approver, or the approver's current delegate when
   * the approver is away today.
   */
  private async holder(db: Knex, run: Record<string, any>, row: Record<string, any>) {
    let approver = Number(row.assignee_id)
    if (row.delegation_id && row.on_behalf_of) {
      const today = this.today()
      const routed = await db('workflow_delegations')
        .where('id', row.delegation_id)
        .whereNull('revoked_at')
        .where('starts_on', '<=', today)
        .where('ends_on', '>=', today)
        .first('id')
      if (routed) return approver
      approver = Number(row.on_behalf_of)
    }
    const away = await this.delegateFor(db, run, approver)
    return away ? away.delegateId : approver
  }

  private async userName(db: Knex, id: number) {
    const row = await db('users').where('id', id).first('full_name', 'email')
    return row ? String(row.full_name ?? row.email ?? `#${id}`) : null
  }

  private today() {
    return utcDate(this.now())
  }

  private now() {
    return this.options.now?.() ?? new Date()
  }
}

/** The listener name and domain event that start or cancel a resource's workflow. */
function workflowKey(registry: ResourceRegistry, resource: string, kind: 'start' | 'cancel') {
  return {
    name: `adula.workflows.${kind}.${resource}`,
    event: `${registry.owner(resource)}.${resource}.${kind === 'start' ? 'submitted' : 'cancelled'}`,
  }
}

/**
 * Listeners resolved per call, so hosts can build the engine lazily (for example
 * per request) while the listener list is fixed at boot from the registry.
 */
export function workflowListeners(
  registry: ResourceRegistry,
  engine: () => WorkflowEngine
): Listener[] {
  return registry.all().flatMap((resource) => {
    if (!resource.submittable) return []
    return (['start', 'cancel'] as const).map((kind) => {
      const key = workflowKey(registry, resource.name, kind)
      return {
        ...key,
        handle: (event: DomainEvent, trx: Knex.Transaction) => {
          const listener = engine()
            .listeners()
            .find((entry) => entry.name === key.name)
          return listener ? listener.handle(event, trx) : Promise.resolve()
        },
      }
    })
  })
}
