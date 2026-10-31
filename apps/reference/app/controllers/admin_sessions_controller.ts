import type { HttpContext } from '@adonisjs/core/http'
import { Exception } from '@adonisjs/core/exceptions'
import { buildAbility } from 'adula'
import { adula } from '#services/adula'
import { refuseTwoFactorRequired, twoFactorRequirementUnmet } from '#services/two_factor'
import {
  listActiveSessions,
  resolveSessionHandle,
  revokeSession,
  sessionHandle,
} from '#services/sessions'

/** Every live session across users; only actors who can manage everything. */
export default class AdminSessionsController {
  async index(ctx: HttpContext) {
    if (!(await this.authorize(ctx))) return
    return ctx.inertia.render('admin/sessions/index', {
      sessions: await listActiveSessions(),
      currentSessionId: sessionHandle(ctx.session.sessionId),
    })
  }

  async destroy(ctx: HttpContext) {
    const actor = await this.authorize(ctx)
    if (!actor) return
    const id = await resolveSessionHandle(String(ctx.params.id))
    const revoked = id ? await revokeSession(id, actor.id) : null
    if (revoked) ctx.session.flash('success', 'أُنهيت الجلسة وسيُطلب من صاحبها الدخول مجدداً.')
    else ctx.session.flash('error', 'الجلسة غير موجودة أو أُنهيت من قبل.')
    return ctx.response.redirect().toRoute('admin_sessions.index')
  }

  /** The administrator, or null once the response says to enrol a second factor first. */
  private async authorize(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail()
    const actor = await adula().actors.load(user.id)
    const ability = buildAbility(actor.rules, adula().registry.all())
    if (!ability.can('manage', 'all'))
      throw new Exception('غير مصرح لك بالوصول إلى هذه الصفحة', {
        status: 403,
        code: 'E_FORBIDDEN',
      })
    if (await twoFactorRequirementUnmet(user.id, { administrator: true })) {
      refuseTwoFactorRequired(ctx)
      return null
    }
    return user
  }
}
