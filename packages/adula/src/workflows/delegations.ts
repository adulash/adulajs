import type { Knex } from 'knex'
import { AdulaError } from '../admin/errors.js'
import { logActivity } from '../core/activity.js'
import { notifyWithTemplate } from '../core/message_templates.js'
import { escapeLike } from '../core/like.js'

/** A user's approvals routed to a delegate for an inclusive date range (ADR 044). */
export type WorkflowDelegation = {
  id: number
  delegatorId: number
  delegatorName: string | null
  delegateId: number
  delegateName: string | null
  /** Inclusive dates (YYYY-MM-DD), compared with the UTC calendar date. */
  startsOn: string
  endsOn: string
  note: string | null
  status: 'scheduled' | 'active' | 'ended' | 'revoked'
  createdBy: number | null
  createdAt: string
  revokedAt: string | null
}
export type WorkflowDelegationInput = {
  delegatorId: number
  delegateId: unknown
  startsOn: unknown
  endsOn: unknown
  note?: unknown
}
export type WorkflowDelegationOptions = { now?: () => Date }

const DATE = /^\d{4}-\d{2}-\d{2}$/
const MAX_DAYS = 366
const NOTE_LIMIT = 500
/** The activity log subject for delegation changes. */
export const DELEGATION_ACTIVITY = 'core.workflow_delegations'

/** The UTC calendar date of an instant: delegation ranges are whole days. */
export function utcDate(now: Date) {
  return now.toISOString().slice(0, 10)
}

/** node-postgres reads a date column as local midnight; read it back with local fields. */
function dateText(value: unknown) {
  if (value instanceof Date)
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
  return String(value).slice(0, 10)
}

/**
 * Narrows an assignments query (aliased `a`) to the rows a user may act on today:
 * - their own rows, and rows routed to them through a delegation still in force;
 * - rows routed away from them (on_behalf_of): the approver always keeps them;
 * - as a delegate, the open approvals of users who delegated to them for today,
 *   including rows routed earlier through a delegation that has since ended.
 * A delegate never holds an approval of a run they started themselves, so delegation
 * cannot let anyone approve their own request. Delegation never widens record access:
 * every caller still checks the record with the acting user's own rights.
 */
export function actionableBy(db: Knex, actorId: number, today: string) {
  const active = (alias: string) =>
    db.raw(
      `${alias}.revoked_at IS NULL AND ${alias}.starts_on <= ?::date AND ${alias}.ends_on >= ?::date`,
      [today, today]
    )
  const routedActive = () =>
    db('workflow_delegations as dr').whereRaw('dr.id = a.delegation_id').whereRaw(active('dr'))
  const ownRun = () =>
    db('workflow_runs as ws').whereRaw('ws.id = a.workflow_run_id').where('ws.started_by', actorId)
  const delegators = () =>
    db('workflow_delegations as dd')
      .where('dd.delegate_id', actorId)
      .whereRaw(active('dd'))
      .select('dd.delegator_id')
  return (query: Knex.QueryBuilder) =>
    query.where((where) => {
      where
        .where((own) =>
          own
            .where('a.assignee_id', actorId)
            .where((routed) =>
              routed
                .whereNull('a.delegation_id')
                .orWhere((held) => held.whereExists(routedActive()).whereNotExists(ownRun()))
            )
        )
        .orWhere('a.on_behalf_of', actorId)
        .orWhere((delegated) =>
          delegated
            .whereNotNull('a.workflow_run_id')
            .whereNotExists(ownRun())
            .where((source) =>
              source
                .where((plain) =>
                  plain.whereNull('a.delegation_id').whereIn('a.assignee_id', delegators())
                )
                .orWhere((stale) =>
                  stale
                    .whereNotNull('a.delegation_id')
                    .whereNotExists(routedActive())
                    .whereIn('a.on_behalf_of', delegators())
                )
            )
        )
    })
}

/** The SQL flag `delegation_active` for an assignments query aliased `a`. */
export function delegationActive(db: Knex, today: string) {
  return db.raw(
    'EXISTS (SELECT 1 FROM workflow_delegations wd WHERE wd.id = a.delegation_id AND wd.revoked_at IS NULL AND wd.starts_on <= ?::date AND wd.ends_on >= ?::date) AS delegation_active',
    [today, today]
  )
}

/**
 * Out-of-office delegation of workflow approvals. A user delegates to one person per
 * date range (overlapping ranges are refused); administrators manage delegations for
 * others. Creation and revocation are written to the activity log and the delegate is
 * notified. Manual tasks are never delegated, only workflow approvals.
 */
export class WorkflowDelegations {
  constructor(
    private db: Knex,
    private options: WorkflowDelegationOptions = {}
  ) {}

  /** A user's own delegations (given and received), newest first. */
  async forUser(userId: number): Promise<{
    given: WorkflowDelegation[]
    received: WorkflowDelegation[]
  }> {
    const rows = await this.query()
      .where((q) => q.where('d.delegator_id', userId).orWhere('d.delegate_id', userId))
      .orderBy('d.id', 'desc')
      .limit(100)
    const list = rows.map((row) => this.present(row))
    return {
      given: list.filter((item) => item.delegatorId === userId),
      received: list.filter((item) => item.delegateId === userId && item.status !== 'revoked'),
    }
  }

  /**
   * Active users a delegate can be chosen from (id and display name only), at most 20.
   * The search needs two characters and matches names, or an e-mail address exactly, so
   * the picker cannot list the whole user directory or probe e-mail fragments.
   */
  async candidates(search: unknown, exceptId: number) {
    const text = typeof search === 'string' ? search.trim().slice(0, 100) : ''
    if (text.length < 2) return []
    const rows = await this.db('users')
      .whereNull('disabled_at')
      .whereNot('id', exceptId)
      .where((q) =>
        q
          .whereILike('full_name', `%${escapeLike(text)}%`)
          .orWhereRaw('lower(email) = lower(?)', [text])
      )
      .orderBy('full_name')
      .limit(20)
      .select('id', 'full_name', 'email')
    return rows.map((row) => ({
      id: Number(row.id),
      name: String(row.full_name ?? row.email ?? `#${row.id}`),
    }))
  }

  /** Every delegation that has not ended, for administrators. */
  async current(): Promise<WorkflowDelegation[]> {
    const rows = await this.query()
      .whereNull('d.revoked_at')
      .where('d.ends_on', '>=', this.today())
      .orderBy('d.starts_on')
      .limit(500)
    return rows.map((row) => this.present(row))
  }

  /** The delegation in force today for a user, if any. */
  async active(delegatorId: number, db: Knex = this.db) {
    const today = this.today()
    const row = await db('workflow_delegations')
      .where('delegator_id', delegatorId)
      .whereNull('revoked_at')
      .where('starts_on', '<=', today)
      .where('ends_on', '>=', today)
      .orderBy('id', 'desc')
      .first('id', 'delegate_id')
    return row ? { id: Number(row.id), delegateId: Number(row.delegate_id) } : null
  }

  /** Creates a delegation; the caller decides whether `createdBy` may act for the delegator. */
  async create(input: WorkflowDelegationInput, createdBy: number): Promise<WorkflowDelegation> {
    const delegatorId = Number(input.delegatorId)
    const delegateId = Number(input.delegateId)
    if (!Number.isSafeInteger(delegatorId) || delegatorId <= 0)
      throw new AdulaError(422, 'E_DELEGATION_USER', 'المستخدم غير صالح')
    if (!Number.isSafeInteger(delegateId) || delegateId <= 0)
      throw new AdulaError(422, 'E_DELEGATE', 'اختر المفوَّض إليه')
    if (delegateId === delegatorId)
      throw new AdulaError(422, 'E_DELEGATE', 'لا يمكن التفويض إلى النفس')
    const startsOn = this.date(input.startsOn, 'تاريخ البداية')
    const endsOn = this.date(input.endsOn, 'تاريخ النهاية')
    if (endsOn < startsOn)
      throw new AdulaError(422, 'E_DELEGATION_RANGE', 'تاريخ النهاية قبل تاريخ البداية')
    if (endsOn < this.today())
      throw new AdulaError(422, 'E_DELEGATION_RANGE', 'لا يمكن إنشاء تفويض انتهت مدته')
    if ((Date.parse(endsOn) - Date.parse(startsOn)) / 86400000 >= MAX_DAYS)
      throw new AdulaError(422, 'E_DELEGATION_RANGE', 'مدة التفويض لا تتجاوز سنة')
    const note =
      input.note === undefined || input.note === null || input.note === ''
        ? null
        : typeof input.note === 'string' && input.note.trim().length <= NOTE_LIMIT
          ? input.note.trim() || null
          : undefined
    if (note === undefined)
      throw new AdulaError(422, 'E_DELEGATION_NOTE', 'الملاحظة لا تتجاوز 500 حرف')
    return this.db.transaction(async (trx) => {
      // The delegator's row serializes concurrent requests, so overlap checks hold.
      // Locked in id order and without blocking foreign-key checks on these users.
      const users = await trx('users')
        .whereIn('id', [delegatorId, delegateId])
        .orderBy('id')
        .forNoKeyUpdate()
      const delegator = users.find((user) => Number(user.id) === delegatorId)
      const delegate = users.find((user) => Number(user.id) === delegateId)
      if (!delegator) throw new AdulaError(422, 'E_DELEGATION_USER', 'المستخدم غير صالح')
      if (!delegate || delegate.disabled_at)
        throw new AdulaError(422, 'E_DELEGATE', 'المفوَّض إليه غير موجود أو معطّل')
      const overlap = await trx('workflow_delegations')
        .where('delegator_id', delegatorId)
        .whereNull('revoked_at')
        .where('starts_on', '<=', endsOn)
        .where('ends_on', '>=', startsOn)
        .first('id')
      if (overlap)
        throw new AdulaError(
          409,
          'E_DELEGATION_OVERLAP',
          'يوجد تفويض آخر في هذه المدة؛ ألغه أو اختر مدة أخرى'
        )
      const [row] = await trx('workflow_delegations')
        .insert({
          delegator_id: delegatorId,
          delegate_id: delegateId,
          starts_on: startsOn,
          ends_on: endsOn,
          note,
          created_by: createdBy,
        })
        .returning('id')
      const id = Number(row.id)
      await logActivity(trx, {
        resource: DELEGATION_ACTIVITY,
        recordId: id,
        actorId: createdBy,
        action: 'delegation_created',
        changes: { delegatorId, delegateId, startsOn, endsOn },
      })
      await notifyWithTemplate(trx, delegateId, 'workflow.delegated', {
        delegator: delegator.full_name ?? delegator.email ?? `#${delegatorId}`,
        from: startsOn,
        to: endsOn,
      })
      return this.present(await this.query(trx).where('d.id', id).first())
    })
  }

  /**
   * Ends a delegation now. `ownerId` must be the delegator unless `any` (administrators);
   * unknown or foreign ids read as not found. `actorId` (default `ownerId`) is recorded,
   * for example the administrator behind an impersonation. Open approvals routed through
   * the delegation return to their approver.
   */
  async revoke(id: unknown, ownerId: number, options: { any?: boolean; actorId?: number } = {}) {
    const key = Number(id)
    const actorId = options.actorId ?? ownerId
    if (!Number.isSafeInteger(key) || key <= 0)
      throw new AdulaError(404, 'E_DELEGATION_NOT_FOUND', 'التفويض غير موجود')
    await this.db.transaction(async (trx) => {
      const row = await trx('workflow_delegations').where('id', key).forUpdate().first()
      if (!row || (!options.any && Number(row.delegator_id) !== ownerId))
        throw new AdulaError(404, 'E_DELEGATION_NOT_FOUND', 'التفويض غير موجود')
      if (row.revoked_at) return
      await trx('workflow_delegations')
        .where('id', key)
        .update({ revoked_at: this.now(), revoked_by: actorId })
      const returned = await trx('assignments')
        .where({ delegation_id: key, status: 'open' })
        .update({
          assignee_id: trx.raw('on_behalf_of'),
          on_behalf_of: null,
          delegation_id: null,
        })
      await logActivity(trx, {
        resource: DELEGATION_ACTIVITY,
        recordId: key,
        actorId,
        action: 'delegation_revoked',
        changes: {
          delegatorId: Number(row.delegator_id),
          delegateId: Number(row.delegate_id),
          returned,
        },
      })
    })
  }

  private date(value: unknown, field: string) {
    // Round-trip the date: Date.parse accepts impossible days such as 2027-02-30.
    if (
      typeof value !== 'string' ||
      !DATE.test(value) ||
      Number.isNaN(Date.parse(value)) ||
      new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value
    )
      throw new AdulaError(422, 'E_DELEGATION_RANGE', `${field} غير صالح`)
    return value
  }

  private query(db: Knex = this.db) {
    return db('workflow_delegations as d')
      .leftJoin('users as f', 'f.id', 'd.delegator_id')
      .leftJoin('users as t', 't.id', 'd.delegate_id')
      .select('d.*', 'f.full_name as delegator_name', 't.full_name as delegate_name')
  }

  private present(row: Record<string, any>): WorkflowDelegation {
    const today = this.today()
    const startsOn = dateText(row.starts_on)
    const endsOn = dateText(row.ends_on)
    return {
      id: Number(row.id),
      delegatorId: Number(row.delegator_id),
      delegatorName: row.delegator_name ? String(row.delegator_name) : null,
      delegateId: Number(row.delegate_id),
      delegateName: row.delegate_name ? String(row.delegate_name) : null,
      startsOn,
      endsOn,
      note: row.note ? String(row.note) : null,
      status: row.revoked_at
        ? 'revoked'
        : endsOn < today
          ? 'ended'
          : startsOn > today
            ? 'scheduled'
            : 'active',
      createdBy: row.created_by === null ? null : Number(row.created_by),
      createdAt: new Date(row.created_at).toISOString(),
      revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
    }
  }

  private now() {
    return this.options.now?.() ?? new Date()
  }

  private today() {
    return utcDate(this.now())
  }
}
