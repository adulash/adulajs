import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import db from '@adonisjs/lucid/services/db'
import { NotificationsAdmin, UserInvitations, buildAbility, isBackupStale } from 'adula'
import { IMPERSONATOR_KEY, adula } from '#services/adula'
import { activeImpersonation } from '#services/impersonation'
import { setupPending } from '#services/initial_setup'
import { refuseTwoFactorRequired, twoFactorRequirementUnmet } from '#services/two_factor'

export { IMPERSONATOR_KEY }

export async function isAdministrator(userId: number) {
  const runtime = adula()
  const actor = await runtime.actors.load(userId)
  return buildAbility(actor.rules, runtime.registry.all()).can('manage', 'all')
}

async function countRows(table: string, where: Record<string, string | number>) {
  const [row] = await db.connection().getWriteClient()(table).where(where).count('* as count')
  return Number(row?.count ?? 0)
}

/** Whether the actor can create any resource, which is what importing needs. */
async function canImport(userId: number) {
  const runtime = adula()
  const actor = await runtime.actors.load(userId)
  const ability = buildAbility(actor.rules, runtime.registry.all())
  return runtime.registry
    .all()
    .some((resource) => resource.actions.includes('create') && ability.can('create', resource.name))
}

/** Shell props for every Inertia page: navigation signals, backup bar, bell and impersonation. */
export async function sharedAdminProps(ctx: HttpContext) {
  const { auth, session } = ctx as Partial<HttpContext>
  const userId = auth?.user?.id
  const knex = db.connection().getWriteClient()
  const isAdmin = userId ? await isAdministrator(userId) : false
  const backupStale = isAdmin && (await isBackupStale(knex))
  const failedRuns = isAdmin ? await countRows('workflow_runs', { status: 'failed' }) : 0
  return {
    isAdmin: ctx.inertia.always(isAdmin),
    /** Failed workflows and a stale backup: a badge on the single administration entry. */
    adminAlerts: ctx.inertia.always(failedRuns + (backupStale ? 1 : 0)),
    setupPending: ctx.inertia.always(isAdmin && (await setupPending())),
    canImport: ctx.inertia.always(userId ? await canImport(userId) : false),
    openTasks: ctx.inertia.always(
      userId ? await countRows('assignments', { assignee_id: userId, status: 'open' }) : 0
    ),
    canInviteUsers: ctx.inertia.always(
      userId ? await new UserInvitations(knex).canInvite(userId) : false
    ),
    backupWarning: ctx.inertia.always(backupStale),
    unreadNotifications: ctx.inertia.always(
      userId ? await new NotificationsAdmin(knex).unreadCount(userId) : 0
    ),
    impersonating: ctx.inertia.always(Boolean(activeImpersonation({ session, auth }))),
  }
}

export default class AdminMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const user = ctx.auth.getUserOrFail()
    if (!(await isAdministrator(user.id))) {
      if (ctx.request.accepts(['html', 'json']) === 'json')
        return ctx.response.forbidden({
          error: { code: 'E_FORBIDDEN', message: 'هذه المنطقة للمديرين فقط' },
        })
      ctx.response.status(403)
      return ctx.response.send(await ctx.inertia.render('admin/forbidden', {}))
    }
    // An administrator without a second factor enrols before using the administration.
    if (await twoFactorRequirementUnmet(user.id, { administrator: true }))
      return refuseTwoFactorRequired(ctx, {
        message: 'فعّل التحقق بخطوتين لحسابك قبل استخدام لوحة الإدارة.',
      })
    return next()
  }
}
