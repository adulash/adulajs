import { createHmac } from 'node:crypto'
import env from '#start/env'
import db from '@adonisjs/lucid/services/db'
import { avatarUrlFor, avatarVersionColumn } from 'adula'
import type { HttpContext } from '@adonisjs/core/http'
import { logAuthActivity, requestContext } from '#services/auth_activity'

/** A signed-in browser session as shown to users and administrators. */
export type UserSession = {
  /** Opaque handle; the session-store id itself never leaves the server. */
  id: string
  userId: number
  ip: string | null
  userAgent: string | null
  createdAt: string
  lastSeenAt: string
  revokedAt: string | null
}
export type ActiveSession = UserSession & {
  email: string
  fullName: string | null
  /** The user's versioned picture URL, or null without one (ADR 050). */
  avatarUrl: string | null
}

/** Presence is refreshed at most once per window to keep reads cheap. */
const PRESENCE_WINDOW_MS = 5 * 60 * 1000

const knex = () => db.connection().getWriteClient()
/**
 * Stable per-deployment handle for a session id. Pages, route parameters and
 * activity records use it so that no script or log reader learns a live id.
 */
export function sessionHandle(sessionId: string) {
  return createHmac('sha256', env.get('APP_KEY').release())
    .update(`user-session:${sessionId}`)
    .digest('base64url')
    .slice(0, 32)
}
const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : String(value))
function toSession(row: Record<string, unknown>): UserSession {
  return {
    id: sessionHandle(String(row.id)),
    userId: Number(row.user_id),
    ip: (row.ip as string | null) ?? null,
    userAgent: (row.user_agent as string | null) ?? null,
    createdAt: iso(row.created_at),
    lastSeenAt: iso(row.last_seen_at),
    revokedAt: row.revoked_at ? iso(row.revoked_at) : null,
  }
}

/** Records the current session for a user right after login, signup or OAuth login. */
export async function recordSession(ctx: HttpContext, userId: number) {
  const { ip, userAgent } = requestContext(ctx)
  await knex()('user_sessions')
    .insert({ id: ctx.session.sessionId, user_id: userId, ip, user_agent: userAgent })
    .onConflict('id')
    .merge({ user_id: userId, ip, user_agent: userAgent, last_seen_at: knex().fn.now() })
}

/** A voluntary logout closes the row without a "session_revoked" activity. */
export async function endSession(sessionId: string) {
  await knex()('user_sessions')
    .where({ id: sessionId })
    .whereNull('revoked_at')
    .update({ revoked_at: knex().fn.now() })
}

/**
 * How long after a rotation a request with the replaced id is refused rather than served. Late
 * answers arrive within seconds; past this, a browser that somehow kept the old cookie is
 * treated as before (the old session is gone, so it is signed out) instead of refused forever.
 * A request already in flight when its session rotates is caught whatever its length
 * (rotationOf, compared before and after its handler).
 */
const ROTATION_GRACE_SECONDS = 60

/**
 * Records that a rotation replaced this session id (see session_rotations): its handle, as
 * user_sessions shows them, never the id itself. Rows older than ten minutes go on each write.
 */
export async function recordRotation(sessionId: string) {
  await knex()('session_rotations')
    .insert({ id: sessionHandle(sessionId), rotated_at: knex().fn.now() })
    .onConflict('id')
    .merge()
  await knex()('session_rotations')
    .where('rotated_at', '<', knex().raw(`now() - interval '10 minutes'`))
    .delete()
}

/**
 * The recorded rotation of this session id, if any: when it happened (as the database wrote
 * it, so two readings compare without a clock) and whether that is within the grace period.
 */
export async function rotationOf(sessionId: string) {
  const row = await knex()('session_rotations')
    .where({ id: sessionHandle(sessionId) })
    .first(
      knex().raw('rotated_at::text as at'),
      knex().raw(`rotated_at > now() - make_interval(secs => ?) as recent`, [
        ROTATION_GRACE_SECONDS,
      ])
    )
  return row ? { at: String(row.at), recent: Boolean(row.recent) } : null
}

export type SessionState = { active: true } | { active: false; reason: 'disabled' | 'revoked' }

/** The silent and strict auth middleware both check; one query per request is enough. */
const checked = new WeakMap<HttpContext, Promise<SessionState>>()

/**
 * Verifies that the authenticated request still owns a live session: the user
 * is not disabled and the session row was not revoked. Sessions created outside
 * the login flow (for example by the test client) are recorded lazily, and the
 * presence timestamp is refreshed at most every five minutes.
 */
export function ensureSessionActive(ctx: HttpContext): Promise<SessionState> {
  let pending = checked.get(ctx)
  if (!pending) {
    pending = checkSession(ctx)
    checked.set(ctx, pending)
  }
  return pending
}

async function checkSession(ctx: HttpContext): Promise<SessionState> {
  const user = ctx.auth.user
  if (!user) return { active: true }
  if (user.disabledAt) return { active: false, reason: 'disabled' }
  const sessionId = ctx.session.sessionId
  const row = await knex()('user_sessions').where({ id: sessionId }).first()
  if (!row) {
    const { ip, userAgent } = requestContext(ctx)
    await knex()('user_sessions')
      .insert({ id: sessionId, user_id: user.id, ip, user_agent: userAgent })
      .onConflict('id')
      .ignore()
    return { active: true }
  }
  if (row.revoked_at) return { active: false, reason: 'revoked' }
  const stale = Date.now() - new Date(row.last_seen_at).getTime() > PRESENCE_WINDOW_MS
  if (stale || row.user_id !== user.id) {
    const { ip, userAgent } = requestContext(ctx)
    await knex()('user_sessions')
      .where({ id: sessionId })
      .update({ user_id: user.id, ip, user_agent: userAgent, last_seen_at: knex().fn.now() })
  }
  return { active: true }
}

/** Live sessions of one user, most recently seen first. */
export async function listUserSessions(userId: number): Promise<UserSession[]> {
  const rows = await knex()('user_sessions')
    .where({ user_id: userId })
    .whereNull('revoked_at')
    .orderBy('last_seen_at', 'desc')
  return rows.map(toSession)
}

/** Every live session across users, for the administrative screen. */
export async function listActiveSessions(): Promise<ActiveSession[]> {
  const rows = await knex()('user_sessions')
    .join('users', 'users.id', 'user_sessions.user_id')
    .whereNull('user_sessions.revoked_at')
    .orderBy('user_sessions.last_seen_at', 'desc')
    .select(
      'user_sessions.*',
      'users.email',
      'users.full_name',
      avatarVersionColumn(knex(), 'users.id')
    )
  return rows.map((row) => ({
    ...toSession(row),
    email: String(row.email),
    fullName: (row.full_name as string | null) ?? null,
    avatarUrl: avatarUrlFor(row.user_id, row.avatar_version),
  }))
}

/** Resolves a handle among live sessions, optionally only those of one user. */
export async function resolveSessionHandle(handle: string, userId?: number) {
  const query = knex()('user_sessions').whereNull('revoked_at').select('id')
  if (userId !== undefined) query.where({ user_id: userId })
  const rows: { id: string }[] = await query
  return rows.find((row) => sessionHandle(String(row.id)) === handle)?.id ?? null
}

/**
 * Revokes one session: marks the row, deletes the session-store row so the
 * guard drops it on the next request, and records the activity for the owner.
 * Returns null when the session is unknown or already revoked.
 */
export async function revokeSession(sessionId: string, actorId: number) {
  return await knex().transaction(async (trx) => {
    const [row] = await trx('user_sessions')
      .where({ id: sessionId })
      .whereNull('revoked_at')
      .update({ revoked_at: trx.fn.now() })
      .returning('*')
    if (!row) return null
    await trx('sessions').where({ id: sessionId }).delete()
    await logAuthActivity(
      {
        userId: row.user_id,
        actorId,
        action: 'session_revoked',
        changes: {
          sessionIds: [sessionHandle(sessionId)],
          ip: row.ip,
          userAgent: row.user_agent,
        },
      },
      trx
    )
    return toSession(row)
  })
}

/** Revokes every live session of a user, optionally keeping the current one. */
export async function revokeUserSessions(
  userId: number,
  actorId: number,
  options: { except?: string } = {}
) {
  return await knex().transaction(async (trx) => {
    const query = trx('user_sessions').where({ user_id: userId }).whereNull('revoked_at')
    if (options.except) query.whereNot({ id: options.except })
    const rows = await query.update({ revoked_at: trx.fn.now() }).returning('*')
    if (!rows.length) return 0
    const ids = rows.map((row) => String(row.id))
    await trx('sessions').whereIn('id', ids).delete()
    await logAuthActivity(
      {
        userId,
        actorId,
        action: 'session_revoked',
        changes: { sessionIds: ids.map(sessionHandle) },
      },
      trx
    )
    return rows.length
  })
}
