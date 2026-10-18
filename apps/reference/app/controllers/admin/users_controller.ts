import type { HttpContext } from '@adonisjs/core/http'
import { AdulaError, OrgUnitsAdmin, RolesAdmin, UsersAdmin, logActivity } from 'adula'
import User from '#models/user'
import { adula } from '#services/adula'
import { endSession, recordSession, revokeUserSessions } from '#services/sessions'
import { listUserTokens, revokeUserTokens } from '#services/access_tokens'
import { isAdministrator } from '#middleware/admin_middleware'
import {
  activeImpersonation,
  beginImpersonation,
  endImpersonation,
  hasImpersonationMarker,
} from '#services/impersonation'
import { actorId, knex, mutate, optionalId, positiveId, text, wantsJson } from './support.js'

const service = () => new UsersAdmin(knex())
const RESOURCE = 'core.users'

export default class UsersController {
  async index(ctx: HttpContext) {
    const search = text(ctx.request.input('search')) ?? ''
    const users = await service().list({
      search,
      cursor: optionalId(ctx.request.input('cursor')) ?? undefined,
      limit: ctx.request.input('limit'),
    })
    if (wantsJson(ctx)) return users
    return ctx.inertia.render('admin/users/index', { users, search })
  }

  async show(ctx: HttpContext) {
    const user = await service().get(positiveId(ctx.params.id))
    const roles = await new RolesAdmin(knex(), adula().registry).list()
    const orgUnits = await new OrgUnitsAdmin(knex(), adula().registry).tree()
    // Metadata only: token secrets are hashed and never leave the server.
    const tokens = await listUserTokens(await User.findOrFail(user.id))
    const props = { user, roles, orgUnits, tokens }
    if (wantsJson(ctx)) return props
    return ctx.inertia.render('admin/users/show', props)
  }

  async assignRole(ctx: HttpContext) {
    const id = positiveId(ctx.params.id)
    return mutate(
      ctx,
      () =>
        service().assignRole(
          actorId(ctx),
          id,
          positiveId(ctx.request.input('roleId'), 'الدور غير موجود'),
          optionalId(ctx.request.input('orgUnitId'))
        ),
      'تم إسناد الدور'
    )
  }

  async removeRole(ctx: HttpContext) {
    return mutate(
      ctx,
      () =>
        service().removeRole(
          actorId(ctx),
          positiveId(ctx.params.id),
          positiveId(ctx.params.assignment)
        ),
      'تمت إزالة الدور'
    )
  }

  async assignOrgUnit(ctx: HttpContext) {
    return mutate(
      ctx,
      () =>
        service().assignOrgUnit(
          actorId(ctx),
          positiveId(ctx.params.id),
          positiveId(ctx.request.input('orgUnitId'), 'الوحدة التنظيمية غير موجودة')
        ),
      'تمت إضافة المستخدم إلى الوحدة'
    )
  }

  async removeOrgUnit(ctx: HttpContext) {
    return mutate(
      ctx,
      () =>
        service().removeOrgUnit(
          actorId(ctx),
          positiveId(ctx.params.id),
          positiveId(ctx.params.orgUnit)
        ),
      'تمت إزالة العضوية'
    )
  }

  async disable(ctx: HttpContext) {
    return mutate(
      ctx,
      () => service().disable(actorId(ctx), positiveId(ctx.params.id)),
      'تم تعطيل الحساب'
    )
  }

  async enable(ctx: HttpContext) {
    return mutate(
      ctx,
      () => service().enable(actorId(ctx), positiveId(ctx.params.id)),
      'تم تفعيل الحساب'
    )
  }

  async revokeSessions(ctx: HttpContext) {
    const id = positiveId(ctx.params.id)
    const admin = actorId(ctx)
    return mutate(
      ctx,
      async () => {
        await service().get(id)
        const count = await revokeUserSessions(id, admin, {
          except: id === admin ? ctx.session.sessionId : undefined,
        })
        // Revoking access also ends the user's API tokens, which outlive any session.
        const tokens = await revokeUserTokens(id)
        await logActivity(knex(), {
          resource: RESOURCE,
          recordId: id,
          actorId: admin,
          action: 'revoke_sessions',
          changes: { count, tokens },
        })
        return { count, tokens }
      },
      'تم إنهاء جلسات المستخدم ورموز الوصول'
    )
  }

  async revokeTokens(ctx: HttpContext) {
    const id = positiveId(ctx.params.id)
    const admin = actorId(ctx)
    return mutate(
      ctx,
      async () => {
        await service().get(id)
        const count = await revokeUserTokens(id)
        await logActivity(knex(), {
          resource: RESOURCE,
          recordId: id,
          actorId: admin,
          action: 'revoke_tokens',
          changes: { count },
        })
        return { count }
      },
      'تم إلغاء رموز الوصول'
    )
  }

  /** The administrator keeps their identity in the session so the target user cannot inherit it. */
  async impersonate(ctx: HttpContext) {
    const id = positiveId(ctx.params.id)
    const admin = actorId(ctx)
    return mutate(
      ctx,
      async () => {
        if (id === admin) throw new AdulaError(422, 'E_SELF_IMPERSONATE', 'لا يمكنك انتحال حسابك')
        if (hasImpersonationMarker(ctx.session))
          throw new AdulaError(422, 'E_ALREADY_IMPERSONATING', 'أنهِ الانتحال الحالي أولاً')
        const target = await service().get(id)
        if (target.disabledAt)
          throw new AdulaError(422, 'E_USER_DISABLED', 'لا يمكن انتحال حساب معطّل')
        // Acting as another administrator would hide one administrator behind another.
        if (await isAdministrator(id))
          throw new AdulaError(403, 'E_IMPERSONATE_ADMIN', 'لا يمكن انتحال حساب مسؤول آخر')
        const user = await User.findOrFail(id)
        await logActivity(knex(), {
          resource: RESOURCE,
          recordId: id,
          actorId: admin,
          action: 'impersonate',
        })
        // Login regenerates the session id; the administrator's row is closed and
        // the impersonation session gets its own row.
        const previous = ctx.session.sessionId
        await ctx.auth.use('web').login(user)
        beginImpersonation(ctx.session, admin, id)
        await endSession(previous)
        await recordSession(ctx, id)
        return { id }
      },
      'أنت الآن تتصفح باسم المستخدم',
      '/'
    )
  }

  async stopImpersonation(ctx: HttpContext) {
    const current = actorId(ctx)
    return mutate(
      ctx,
      async () => {
        // Only the impersonated user's own session may return to the administrator.
        const impersonation = activeImpersonation(ctx)
        if (!impersonation) throw new AdulaError(422, 'E_NOT_IMPERSONATING', 'لا يوجد انتحال نشط')
        const impersonator = impersonation.adminId
        endImpersonation(ctx.session)
        const previous = ctx.session.sessionId
        const original = await User.find(impersonator)
        const state = original ? await service().get(impersonator) : null
        // A disabled administrator does not get a session back. A demoted one returns
        // to their own account, which no longer carries administration rights.
        if (!original || state?.disabledAt) {
          await ctx.auth.use('web').logout()
          await endSession(previous)
          throw new AdulaError(403, 'E_IMPERSONATOR_REVOKED', 'لم يعد حساب المدير متاحاً')
        }
        await ctx.auth.use('web').login(original)
        await endSession(previous)
        await recordSession(ctx, impersonator)
        await logActivity(knex(), {
          resource: RESOURCE,
          recordId: current,
          actorId: impersonator,
          action: 'stop_impersonation',
        })
        return { id: impersonator }
      },
      'عدت إلى حسابك',
      `/admin/users/${current}`
    )
  }
}
