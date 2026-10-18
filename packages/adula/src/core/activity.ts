import type { Knex } from 'knex'
import type { JsonValue } from '../resource/types.js'
import { AdulaError } from '../admin/errors.js'

export type ActivityEntry = {
  resource: string
  recordId: number
  actorId: number
  action: string
  changes?: Record<string, unknown>
  /** The administrator acting as actorId through impersonation; stored as impersonatedBy. */
  impersonatorId?: number | null
}
export type ActivityFilters = {
  resource?: string
  actorId?: number
  action?: string
  from?: string
  to?: string
  cursor?: string
  limit?: number
}
export type ActivityRow = {
  id: string
  resource: string
  recordId: number
  actorId: number
  actor: string | null
  action: string
  changes: JsonValue
  createdAt: string
}
export type ActivityPage = { data: ActivityRow[]; nextCursor: string | null }

export function pageLimit(limit: unknown, fallback = 50) {
  const value = Number(limit ?? fallback)
  if (!Number.isSafeInteger(value) || value < 1) return fallback
  return Math.min(value, 100)
}

export async function logActivity(db: Knex, entry: ActivityEntry) {
  // Only the trusted impersonatorId may mark an entry as impersonated.
  const changes = { ...entry.changes }
  delete changes.impersonatedBy
  await db('activities').insert({
    resource: entry.resource,
    record_id: entry.recordId,
    actor_id: entry.actorId,
    action: entry.action,
    changes: JSON.stringify({
      ...changes,
      ...(entry.impersonatorId ? { impersonatedBy: entry.impersonatorId } : {}),
    }),
  })
}

function boundary(value: string, end: boolean) {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value)
  const parsed = Date.parse(dateOnly ? `${value}T00:00:00Z` : value)
  if (!Number.isFinite(parsed)) throw new AdulaError(422, 'E_ACTIVITY_DATE', 'تاريخ غير صالح')
  return new Date(dateOnly && end ? parsed + 86400000 : parsed)
}

export class ActivityAdmin {
  constructor(private db: Knex) {}

  async list(filters: ActivityFilters = {}): Promise<ActivityPage> {
    const limit = pageLimit(filters.limit)
    const query = this.db('activities as a')
      .leftJoin('users as u', 'u.id', 'a.actor_id')
      .select('a.*', 'u.email as actor_email')
      .orderBy('a.id', 'desc')
      .limit(limit + 1)
    if (filters.resource) query.where('a.resource', filters.resource)
    if (filters.actorId) query.where('a.actor_id', filters.actorId)
    if (filters.action) query.where('a.action', filters.action)
    if (filters.from) query.where('a.created_at', '>=', boundary(filters.from, false))
    if (filters.to) {
      const end = /^\d{4}-\d{2}-\d{2}$/.test(filters.to)
      query.where('a.created_at', end ? '<' : '<=', boundary(filters.to, end))
    }
    if (filters.cursor) {
      if (!/^\d{1,18}$/.test(filters.cursor))
        throw new AdulaError(422, 'E_ACTIVITY_CURSOR', 'مؤشر الصفحة غير صالح')
      query.where('a.id', '<', filters.cursor)
    }
    const rows = await query
    const page = rows.slice(0, limit)
    return {
      data: page.map((row) => ({
        id: String(row.id),
        resource: row.resource,
        recordId: row.record_id,
        actorId: row.actor_id,
        actor: row.actor_email ?? null,
        action: row.action,
        changes: row.changes,
        createdAt: new Date(row.created_at).toISOString(),
      })),
      nextCursor: rows.length > limit ? String(page[page.length - 1].id) : null,
    }
  }

  async facets(): Promise<{ resources: string[]; actions: string[] }> {
    const resources = await this.db('activities').distinct('resource').orderBy('resource')
    const actions = await this.db('activities').distinct('action').orderBy('action')
    return {
      resources: resources.map((row) => row.resource),
      actions: actions.map((row) => row.action),
    }
  }
}
