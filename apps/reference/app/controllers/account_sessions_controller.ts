import type { HttpContext } from '@adonisjs/core/http'
import { Exception } from '@adonisjs/core/exceptions'
import {
  listUserSessions,
  resolveSessionHandle,
  revokeSession,
  revokeUserSessions,
  sessionHandle,
} from '#services/sessions'
import {
  acting,
  activeImpersonation,
  endImpersonation,
  logImpersonationEnd,
} from '#services/impersonation'

export default class AccountSessionsController {
  async index({ inertia, auth, session }: HttpContext) {
    const user = auth.getUserOrFail()
    return inertia.render('account/sessions', {
      sessions: await listUserSessions(user.id),
      currentSessionId: sessionHandle(session.sessionId),
    })
  }

  /** Ending the current session signs the user out at once. */
  async destroy(ctx: HttpContext) {
    const { auth, params, response, session } = ctx
    const user = auth.getUserOrFail()
    const id = await resolveSessionHandle(String(params.id), user.id)
    if (!id)
      throw new Exception('الجلسة غير موجودة', {
        status: 404,
        code: 'E_ROUTE_NOT_FOUND',
      })
    await revokeSession(id, acting(ctx))
    if (id === session.sessionId) {
      const impersonation = activeImpersonation(ctx)
      await auth.use('web').logout()
      endImpersonation(session)
      if (impersonation) await logImpersonationEnd(impersonation, 'logout')
      session.flash('success', 'أُنهيت جلستك الحالية. سجّل الدخول مجدداً عند الحاجة.')
      return response.redirect().toRoute('session.create')
    }
    session.flash('success', 'أُنهيت الجلسة.')
    return response.redirect().toRoute('account_sessions.index')
  }

  async purge(ctx: HttpContext) {
    const { auth, response, session } = ctx
    const user = auth.getUserOrFail()
    const count = await revokeUserSessions(user.id, acting(ctx), { except: session.sessionId })
    session.flash('success', count ? `أُنهيت ${count} من الجلسات الأخرى.` : 'لا توجد جلسات أخرى.')
    return response.redirect().toRoute('account_sessions.index')
  }
}
