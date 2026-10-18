import db from '@adonisjs/lucid/services/db'
import type { HttpContext } from '@adonisjs/core/http'
import { activeImpersonation } from '#services/impersonation'

/** Authentication events recorded in AdulaJS "activities" table (resource "users"). */
export type AuthAction =
  | 'login'
  | 'login_failed'
  | 'login_locked'
  | 'logout'
  | 'password_reset_requested'
  | 'password_reset_delivery_failed'
  | 'password_reset'
  | 'session_revoked'
  | 'oauth_login'
  | 'social_linked'
  | 'social_unlinked'
  | 'social_link_refused'
  | 'profile_updated'
  | 'password_changed'
  | 'two_factor_enabled'
  | 'two_factor_disabled'
  | 'two_factor_recovery_regenerated'
  | 'two_factor_recovery_used'
  | 'two_factor_failed'
  | 'two_factor_locked'
  | 'password_confirmation_failed'

export type AuthActivityEntry = {
  /** The user the event is about; also the record id of the activity row. */
  userId: number
  /** Defaults to the user (self-service). Administrators pass their own id. */
  actorId?: number
  action: AuthAction
  changes?: Record<string, unknown>
}

type Client = ReturnType<ReturnType<typeof db.connection>['getWriteClient']>

/**
 * Request facts stored with every authentication activity. While an administrator
 * impersonates the user, the administrator is recorded as `impersonatedBy`.
 */
export function requestContext(
  ctx: Pick<HttpContext, 'request'> & Partial<Pick<HttpContext, 'session' | 'auth'>>
) {
  const impersonation = activeImpersonation(ctx)
  return {
    ip: ctx.request.ip(),
    userAgent: ctx.request.header('user-agent')?.slice(0, 512) ?? null,
    ...(impersonation ? { impersonatedBy: impersonation.adminId } : {}),
  }
}

/**
 * Failed logins for unknown e-mails cannot be stored here (actor_id references
 * users); the limiter alone counts those.
 */
export async function logAuthActivity(
  entry: AuthActivityEntry,
  client: Client = db.connection().getWriteClient()
) {
  await client('activities').insert({
    resource: 'users',
    record_id: entry.userId,
    actor_id: entry.actorId ?? entry.userId,
    action: entry.action,
    changes: JSON.stringify(entry.changes ?? {}),
  })
}
