import type { Knex } from 'knex'
import type { Actor } from '../auth/ability.js'
import type { ResourceService } from '../admin/resource_service.js'
import { AdulaError } from '../admin/errors.js'
import { notifyWithTemplate } from '../core/message_templates.js'
import { canView, resourceLabel, type ActorLoader } from './shared.js'

export type AssignmentStatus = 'open' | 'done' | 'cancelled'
export type Assignment = {
  id: number
  resource: string
  resourceLabel: string
  recordId: number
  /** The record's title under the viewer's field access; null shows the id instead (#32). */
  recordTitle: string | null
  assigneeId: number
  assigneeName: string | null
  assignedBy: number | null
  assignedByName: string | null
  kind: string
  title: string
  note: string | null
  dueOn: string | null
  status: AssignmentStatus
  outcome: string | null
  createdAt: string
  completedAt: string | null
  /** Set for approval steps; completion goes through the workflow engine instead. */
  workflowRunId: string | null
  /** Opened and closed by module code with the record's state; a manual close needs a note. */
  managed: boolean
  /** Whether closing this task by hand needs a note. */
  closeNote: CloseNotePolicy
  /** The note written when the task was closed, by hand or by module code. */
  closeReason: string | null
  canComplete: boolean
  canCancel: boolean
  /** An open approval step waiting for this user's decision (WorkflowEngine.decide). 1.2; optional for compatibility. */
  canDecide?: boolean
}
export type AssignmentPage = {
  data: Assignment[]
  nextCursor: string | null
  /** Open items of every kind. */
  open: number
  /** Open approval steps among them. 1.2; optional for compatibility. */
  approvals?: number
}
/**
 * Whether closing a task by hand needs a note. Each application chooses: `optional`
 * (the default) shows the note field but accepts it empty; `required` refuses an empty
 * note. Managed tasks always need a note when closed by hand.
 */
export type CloseNotePolicy = 'optional' | 'required'
export type AssignmentOptions = { closeNote?: CloseNotePolicy }

const TITLE_LIMIT = 200
const NOTE_LIMIT = 2000
const REASON_LIMIT = 500
const DATE = /^\d{4}-\d{2}-\d{2}$/

function dateOnly(value: unknown) {
  if (value === null || value === undefined) return null
  if (value instanceof Date)
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
  return String(value)
}

/**
 * Assignments put a record on someone's "my tasks" list. Assigning needs update
 * permission on the record, the assignee must be able to read it, and every read
 * re-checks the record so lost access hides the task instead of leaking it.
 */
export class Assignments {
  constructor(
    private db: Knex,
    private resources: ResourceService,
    private actors: ActorLoader,
    private options: AssignmentOptions = {}
  ) {}

  async forRecord(name: string, id: number, actor: Actor): Promise<Assignment[]> {
    await this.resources.access(name, id, actor)
    const rows = await this.query()
      .where({ 'a.resource': name, 'a.record_id': id })
      .orderByRaw("(a.status = 'open') DESC, a.id DESC")
      .limit(100)
    return this.titled(
      rows.map((row) => this.present(row, actor)),
      actor
    )
  }

  async assign(
    name: string,
    id: number,
    actor: Actor,
    input: { assigneeId: unknown; title: unknown; note?: unknown; dueOn?: unknown }
  ): Promise<Assignment> {
    await this.resources.access(name, id, actor, 'update')
    const assigneeId = Number(input.assigneeId)
    if (!Number.isSafeInteger(assigneeId) || assigneeId <= 0)
      throw new AdulaError(422, 'E_ASSIGNEE', 'اختر المستخدم المكلف')
    const title = typeof input.title === 'string' ? input.title.trim() : ''
    if (!title || title.length > TITLE_LIMIT)
      throw new AdulaError(422, 'E_ASSIGNMENT_TITLE', 'عنوان المهمة مطلوب ولا يتجاوز 200 حرف')
    const note =
      input.note === undefined || input.note === null || input.note === ''
        ? null
        : typeof input.note === 'string' && input.note.length <= NOTE_LIMIT
          ? input.note.trim()
          : null
    if (input.note && note === null)
      throw new AdulaError(422, 'E_ASSIGNMENT_NOTE', 'الملاحظة لا تتجاوز 2000 حرف')
    const dueOn =
      input.dueOn === undefined || input.dueOn === null || input.dueOn === ''
        ? null
        : typeof input.dueOn === 'string' &&
            DATE.test(input.dueOn) &&
            !Number.isNaN(Date.parse(input.dueOn))
          ? input.dueOn
          : undefined
    if (dueOn === undefined)
      throw new AdulaError(422, 'E_ASSIGNMENT_DUE', 'تاريخ الاستحقاق غير صالح')
    if (!(await this.canView(name, id, assigneeId)))
      throw new AdulaError(422, 'E_ASSIGNEE', 'لا يمكن تكليف مستخدم لا يملك صلاحية عرض السجل')
    return this.create(this.db, {
      resource: name,
      recordId: id,
      assigneeId,
      assignedBy: actor.id,
      title,
      note,
      dueOn,
    }).then((created) => this.present(created, actor))
  }

  /**
   * Inserts an assignment and its notification. Used by assign() and by workflow
   * approval steps inside their own transaction; callers authorize beforehand.
   */
  async create(
    db: Knex,
    input: {
      resource: string
      recordId: number
      assigneeId: number
      assignedBy: number | null
      title: string
      note?: string | null
      dueOn?: string | null
      kind?: string
      workflowRunId?: string
      workflowStep?: string
      /**
       * The task represents open work on the record, such as a ticket to resolve. The
       * assignee cannot mark it done; module code closes it with close() (#51).
       */
      managed?: boolean
    }
  ) {
    const insert = async (trx: Knex) => {
      const [row] = await trx('assignments')
        .insert({
          resource: input.resource,
          record_id: input.recordId,
          assignee_id: input.assigneeId,
          assigned_by: input.assignedBy,
          kind: input.kind ?? 'task',
          title: input.title,
          note: input.note ?? null,
          due_on: input.dueOn ?? null,
          workflow_run_id: input.workflowRunId ?? null,
          workflow_step: input.workflowStep ?? null,
          managed: input.managed ?? false,
        })
        .returning('id')
      await notifyWithTemplate(
        trx,
        input.assigneeId,
        input.kind === 'approval' ? 'assignment.approval' : 'assignment.created',
        {
          title: input.title,
          resource: this.label(input.resource),
          id: input.recordId,
          due: input.dueOn ?? '',
        },
        undefined,
        { resource: input.resource, recordId: input.recordId }
      )
      return this.query(trx).where('a.id', row.id).first()
    }
    return 'isTransaction' in db && db.isTransaction ? insert(db) : this.db.transaction(insert)
  }

  /** The signed-in user's own tasks, open first; records they can no longer read are hidden. */
  async mine(
    actor: Actor,
    options: {
      status?: string
      /** approval: workflow decisions only; task: manual assignments only. */
      kind?: string
      cursor?: string
      limit?: number
    } = {}
  ): Promise<AssignmentPage> {
    const status = options.status === 'done' || options.status === 'all' ? options.status : 'open'
    const limit = Math.max(1, Math.min(100, Math.floor(Number(options.limit) || 50)))
    const query = this.query().where('a.assignee_id', actor.id).orderBy('a.id', 'desc')
    if (status === 'open') query.where('a.status', 'open')
    if (status === 'done') query.whereNot('a.status', 'open')
    if (options.kind === 'approval') query.whereNotNull('a.workflow_run_id')
    if (options.kind === 'task') query.whereNull('a.workflow_run_id')
    let last: number | null = null
    if (options.cursor !== undefined && options.cursor !== '') {
      last = Number(options.cursor)
      if (!Number.isSafeInteger(last) || last <= 0)
        throw new AdulaError(422, 'E_CURSOR', 'مؤشر الصفحة غير صالح')
    }
    const data: Assignment[] = []
    let more = true
    // Access is re-checked per record; scan bounded batches to fill the page.
    for (let round = 0; round < 10 && more && data.length < limit; round++) {
      const rows = await query
        .clone()
        .modify((q) => {
          if (last !== null) q.where('a.id', '<', last)
        })
        .limit(100)
      more = rows.length === 100
      for (const row of rows) {
        if (data.length >= limit) {
          more = true
          break
        }
        last = Number(row.id)
        if (await this.resources.permits(row.resource, Number(row.record_id), actor))
          data.push(this.present(row, actor))
      }
    }
    const [{ count, approvals }] = await this.db('assignments')
      .where({ assignee_id: actor.id, status: 'open' })
      .select(this.db.raw('count(*) as count'), this.db.raw('count(workflow_run_id) as approvals'))
    return {
      data: await this.titled(data, actor),
      nextCursor: more && last !== null ? String(last) : null,
      open: Number(count),
      approvals: Number(approvals),
    }
  }

  /**
   * The assignee marks the task done, or the assigner cancels it, with a closing note. The
   * note is required when the application's policy says so and for managed tasks.
   */
  async complete(
    assignmentId: unknown,
    actor: Actor,
    outcome: 'done' | 'cancelled' = 'done',
    input: { note?: unknown } = {}
  ) {
    const id = Number(assignmentId)
    if (!Number.isSafeInteger(id) || id <= 0)
      throw new AdulaError(404, 'E_ASSIGNMENT_NOT_FOUND', 'المهمة غير موجودة')
    if (input.note !== undefined && input.note !== null && typeof input.note !== 'string')
      throw new AdulaError(422, 'E_ASSIGNMENT_NOTE', 'ملاحظة الإغلاق غير صالحة')
    const note = typeof input.note === 'string' ? input.note.trim() : ''
    if (note.length > REASON_LIMIT)
      throw new AdulaError(422, 'E_ASSIGNMENT_NOTE', 'ملاحظة الإغلاق لا تتجاوز 500 حرف')
    return this.db.transaction(async (trx) => {
      const row = await trx('assignments').where('id', id).forUpdate().first()
      if (!row) throw new AdulaError(404, 'E_ASSIGNMENT_NOT_FOUND', 'المهمة غير موجودة')
      const involved = row.assignee_id === actor.id || row.assigned_by === actor.id
      if (!involved || !(await this.resources.permits(row.resource, Number(row.record_id), actor)))
        throw new AdulaError(404, 'E_ASSIGNMENT_NOT_FOUND', 'المهمة غير موجودة')
      if (row.workflow_run_id)
        throw new AdulaError(
          409,
          'E_ASSIGNMENT_WORKFLOW',
          'تُحسم خطوات الموافقة من صندوق الموافقات'
        )
      if (outcome === 'done' && row.assignee_id !== actor.id)
        throw new AdulaError(403, 'E_FORBIDDEN', 'يُنجز المهمة المكلف بها فقط')
      if (outcome === 'cancelled' && row.assigned_by !== actor.id)
        throw new AdulaError(403, 'E_FORBIDDEN', 'يلغي المهمة من أسندها فقط')
      if (row.status !== 'open')
        throw new AdulaError(409, 'E_ASSIGNMENT_CLOSED', 'المهمة مغلقة بالفعل')
      if (!note && this.closeNote(row) === 'required')
        throw new AdulaError(422, 'E_ASSIGNMENT_NOTE', 'اكتب ملاحظة الإغلاق قبل إغلاق المهمة')
      // A managed task closed by hand leaves the note in the record's history.
      await this.finish(trx, row, actor.id, outcome, note, false)
    })
  }

  /**
   * Closes the open managed tasks of a record when module code decides that its work is
   * finished (or no longer needed), for example from a listener on the record's final
   * state. Recorded in the record's activity log with the reason; the assigner (done) or
   * the assignee (cancelled) is notified as for a manual close. Returns the closed count.
   */
  async close(
    resource: string,
    recordId: number,
    options: {
      /** The user recorded as closing the tasks, usually the author of the final change. */
      actorId: number
      outcome?: 'done' | 'cancelled'
      reason?: string
      trx?: Knex.Transaction
    }
  ): Promise<number> {
    const outcome = options.outcome ?? 'done'
    if (outcome !== 'done' && outcome !== 'cancelled')
      throw new AdulaError(422, 'E_ASSIGNMENT_OUTCOME', 'Unsupported assignment outcome')
    if (!Number.isSafeInteger(options.actorId) || options.actorId <= 0)
      throw new AdulaError(422, 'E_ACTOR', 'Closing tasks requires the author user id')
    const reason = options.reason?.trim() || null
    if (reason && reason.length > REASON_LIMIT)
      throw new AdulaError(422, 'E_ASSIGNMENT_REASON', 'سبب الإغلاق لا يتجاوز 500 حرف')
    const run = async (trx: Knex.Transaction) => {
      const rows = await trx('assignments')
        .where({ resource, record_id: recordId, status: 'open', managed: true })
        .whereNull('workflow_run_id')
        .forUpdate()
        .orderBy('id')
      for (const row of rows) await this.finish(trx, row, options.actorId, outcome, reason, true)
      return rows.length
    }
    return options.trx ? run(options.trx) : this.db.transaction(run)
  }

  /**
   * Closes one locked open assignment row for complete() (by hand) and close() (by
   * module code, `system`): records the outcome, writes the record's activity entry
   * when the task is managed or closed by the system, and notifies the other party —
   * the assigner when done, the assignee when cancelled — unless that is the closer.
   */
  private async finish(
    trx: Knex.Transaction,
    row: Record<string, any>,
    actorId: number,
    outcome: 'done' | 'cancelled',
    reason: string | null,
    system: boolean
  ) {
    await trx('assignments')
      .where('id', row.id)
      .update({
        status: outcome,
        completed_at: trx.fn.now(),
        completed_by: actorId,
        close_reason: reason || null,
      })
    if (system || row.managed)
      await trx('activities').insert({
        resource: row.resource,
        record_id: row.record_id,
        actor_id: actorId,
        action: 'assignment_closed',
        changes: JSON.stringify(
          system
            ? {
                fields: [],
                system: true,
                assignmentId: Number(row.id),
                outcome,
                ...(reason ? { reason } : {}),
              }
            : { fields: [], assignmentId: Number(row.id), outcome, reason: reason ?? '' }
        ),
      })
    const notify = outcome === 'done' ? row.assigned_by : row.assignee_id
    if (notify && notify !== actorId)
      await notifyWithTemplate(
        trx,
        notify,
        outcome === 'done' ? 'assignment.done' : 'assignment.cancelled',
        { title: row.title, resource: this.label(row.resource), id: row.record_id },
        undefined,
        { resource: String(row.resource), recordId: Number(row.record_id) }
      )
  }

  private query(db: Knex = this.db) {
    return db('assignments as a')
      .leftJoin('users as u', 'u.id', 'a.assignee_id')
      .leftJoin('users as b', 'b.id', 'a.assigned_by')
      .leftJoin('workflow_runs as wr', 'wr.id', 'a.workflow_run_id')
      .select(
        'a.*',
        'u.full_name as assignee_name',
        'b.full_name as assigned_by_name',
        'wr.status as run_status',
        'wr.current_step as run_step'
      )
  }

  private present(row: Record<string, any>, actor: Actor): Assignment {
    const open = row.status === 'open'
    return {
      id: Number(row.id),
      resource: String(row.resource),
      resourceLabel: this.label(row.resource),
      recordId: Number(row.record_id),
      recordTitle: null,
      assigneeId: Number(row.assignee_id),
      assigneeName: row.assignee_name ? String(row.assignee_name) : null,
      assignedBy: row.assigned_by === null ? null : Number(row.assigned_by),
      assignedByName: row.assigned_by_name ? String(row.assigned_by_name) : null,
      kind: String(row.kind),
      title: String(row.title),
      note: row.note === null ? null : String(row.note),
      dueOn: dateOnly(row.due_on),
      status: row.status as AssignmentStatus,
      outcome: row.outcome === null || row.outcome === undefined ? null : String(row.outcome),
      createdAt: new Date(row.created_at).toISOString(),
      completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
      workflowRunId: row.workflow_run_id ? String(row.workflow_run_id) : null,
      managed: Boolean(row.managed),
      closeNote: this.closeNote(row),
      closeReason: row.close_reason ? String(row.close_reason) : null,
      canComplete: open && !row.workflow_run_id && Number(row.assignee_id) === actor.id,
      canCancel: open && !row.workflow_run_id && Number(row.assigned_by) === actor.id,
      // The same checks WorkflowEngine.decide() applies before accepting a decision.
      canDecide:
        open &&
        Boolean(row.workflow_run_id) &&
        row.run_status === 'waiting' &&
        row.run_step === row.workflow_step &&
        Number(row.assignee_id) === actor.id,
    }
  }

  /** Adds record titles in one read per resource, under the viewer's field access. */
  private async titled(list: Assignment[], actor: Actor) {
    const byResource = new Map<string, number[]>()
    for (const item of list)
      byResource.set(item.resource, [...(byResource.get(item.resource) ?? []), item.recordId])
    for (const [resource, ids] of byResource) {
      const titles = await this.resources.titles(resource, ids, actor)
      for (const item of list)
        if (item.resource === resource) item.recordTitle = titles.get(item.recordId) ?? null
    }
    return list
  }

  private closeNote(row: Record<string, any>): CloseNotePolicy {
    return row.managed || this.options.closeNote === 'required' ? 'required' : 'optional'
  }

  private label(name: string) {
    return resourceLabel(this.resources, name)
  }

  private canView(name: string, id: number, userId: number) {
    return canView(this.db, this.resources, this.actors, name, id, userId)
  }
}
