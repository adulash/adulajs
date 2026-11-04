import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import { logActivity } from 'adula'

/** Session key of the impersonation marker. */
export const IMPERSONATOR_KEY = 'impersonator_id'

/**
 * An administrator acting as another user in this session. `startedAt` (epoch milliseconds)
 * and `activityId` (the start row, which holds the reason) are absent on markers written
 * before they were recorded. The reason itself stays out of the session, which may be a cookie.
 */
export type Impersonation = {
  adminId: number
  targetId: number
  startedAt?: number
  activityId?: number
}

/** Bounds of the written reason an administrator gives before impersonating. */
export const IMPERSONATION_REASON = { min: 10, max: 500 } as const

type SessionLike = Pick<HttpContext, 'session'>['session'] | undefined
type Context = { session?: SessionLike; auth?: Pick<HttpContext, 'auth'>['auth'] }

const positive = (value: unknown) => Number.isSafeInteger(value) && (value as number) > 0

/**
 * The trimmed reason when its length (in characters, not UTF-16 units) is within
 * `IMPERSONATION_REASON`, else null.
 */
export function impersonationReason(value: unknown) {
  if (typeof value !== 'string') return null
  const reason = value.trim()
  const length = [...reason].length
  return length >= IMPERSONATION_REASON.min && length <= IMPERSONATION_REASON.max ? reason : null
}

/** Starts impersonation bound to the target, so the marker is useless to anyone else. */
export function beginImpersonation(
  session: SessionLike,
  adminId: number,
  targetId: number,
  activityId?: number
) {
  session?.put(IMPERSONATOR_KEY, {
    adminId,
    targetId,
    startedAt: Date.now(),
    ...(activityId ? { activityId } : {}),
  })
}

/**
 * What the activity log records when an impersonation ends: how it ended, how long it lasted
 * and the start row (which holds the reason).
 */
export function impersonationEnd(impersonation: Impersonation, ended: string) {
  const startedAt = impersonation.startedAt
  return {
    ended,
    startActivityId: impersonation.activityId ?? null,
    startedAt: startedAt === undefined ? null : new Date(startedAt).toISOString(),
    durationSeconds:
      startedAt === undefined ? null : Math.max(0, Math.round((Date.now() - startedAt) / 1000)),
  }
}

/**
 * Records the end of an impersonation on the impersonated account, under the administrator:
 * `ended` says how (`stop`, `revoked` or `logout`).
 */
export async function logImpersonationEnd(impersonation: Impersonation, ended: string) {
  await logActivity(db.connection().getWriteClient(), {
    resource: 'core.users',
    recordId: impersonation.targetId,
    actorId: impersonation.adminId,
    action: 'stop_impersonation',
    changes: impersonationEnd(impersonation, ended),
  })
}

/** Drops the marker; every sign-out path calls this. */
export function endImpersonation(session: SessionLike) {
  session?.forget(IMPERSONATOR_KEY)
}

/**
 * The active impersonation, only when the signed-in user is its target. A marker
 * left behind for anyone else (for example after a sign-out on a shared browser)
 * is discarded instead of being trusted.
 */
export function activeImpersonation(ctx: Context): Impersonation | null {
  const raw = ctx.session?.get(IMPERSONATOR_KEY) as Partial<Impersonation> | undefined
  if (raw === undefined || raw === null) return null
  const userId = ctx.auth?.user?.id
  if (
    typeof raw === 'object' &&
    positive(raw.adminId) &&
    positive(raw.targetId) &&
    userId !== undefined &&
    raw.targetId === userId
  )
    return {
      adminId: raw.adminId!,
      targetId: raw.targetId!,
      ...(typeof raw.startedAt === 'number' && Number.isFinite(raw.startedAt) && raw.startedAt > 0
        ? { startedAt: raw.startedAt }
        : {}),
      ...(positive(raw.activityId) ? { activityId: raw.activityId } : {}),
    }
  endImpersonation(ctx.session)
  return null
}

/** Whether any marker is present, valid or not; used to refuse nested impersonation. */
export function hasImpersonationMarker(session: SessionLike) {
  const raw = session?.get(IMPERSONATOR_KEY)
  return raw !== undefined && raw !== null
}

/** The user who really acted: the administrator while impersonating, else the user. */
export function acting(ctx: Context & { auth: Pick<HttpContext, 'auth'>['auth'] }) {
  return activeImpersonation(ctx)?.adminId ?? ctx.auth.getUserOrFail().id
}
