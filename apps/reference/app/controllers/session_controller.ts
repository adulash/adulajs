import User from '#models/user'
import { loginValidator } from '#validators/user'
import type { HttpContext } from '@adonisjs/core/http'
import { errors as authErrors } from '@adonisjs/auth'
import { logAuthActivity, requestContext } from '#services/auth_activity'
import { endSession } from '#services/sessions'
import { completeSignIn } from '#services/sign_in'
import { socialProviders } from '#services/social_accounts'
import {
  loginAccountKey,
  loginAccountLimiter,
  loginLockoutLimiter,
  lockoutMinutes,
} from '#start/limiter'
import { endImpersonation } from '#services/impersonation'

export default class SessionController {
  async create({ inertia }: HttpContext) {
    return inertia.render('auth/login', { socialProviders: await socialProviders() })
  }

  async store(ctx: HttpContext) {
    const { request, response } = ctx
    const { email, password } = await request.validateUsing(loginValidator)
    let user: User
    const key = loginAccountKey(email, request.ip())
    try {
      // verifyCredentials hashes even for unknown e-mails, so timing does not reveal accounts.
      const [blocked, verified] = await loginAccountLimiter.penalize(key, () =>
        User.verifyCredentials(email, password)
      )
      if (blocked) {
        const known = await User.findBy('email', email)
        if (known)
          await logAuthActivity({
            userId: known.id,
            action: 'login_failed',
            changes: { ...requestContext(ctx), reason: 'locked' },
          })
        const minutes = Math.max(1, Math.ceil(blocked.response.availableIn / 60))
        return this.refuse(
          ctx,
          `تجاوزت محاولات الدخول الفاشلة لهذا الحساب من هذا الجهاز. حاول بعد ${minutes} دقيقة أو استعد كلمة المرور.`
        )
      }
      user = verified as User
    } catch (error) {
      if (!(error instanceof authErrors.E_INVALID_CREDENTIALS)) throw error
      // Unknown e-mails cannot be logged (activities reference users); the limiter counts them.
      const known = await User.findBy('email', email)
      if (known)
        await logAuthActivity({
          userId: known.id,
          action: 'login_failed',
          changes: requestContext(ctx),
        })
      // This failure exhausted the allowance: lock for an escalating period and record it.
      if ((await loginAccountLimiter.remaining(key)) === 0) {
        const { consumed } = await loginLockoutLimiter.increment(key)
        const minutes = lockoutMinutes(consumed)
        await loginAccountLimiter.block(key, `${minutes} minutes`)
        if (known)
          await logAuthActivity({
            userId: known.id,
            action: 'login_locked',
            changes: { ...requestContext(ctx), minutes, lockouts: consumed },
          })
      }
      return this.refuse(ctx, 'البريد الإلكتروني أو كلمة المرور غير صحيحة')
    }
    if (user.disabledAt) {
      await logAuthActivity({
        userId: user.id,
        action: 'login_failed',
        changes: { ...requestContext(ctx), reason: 'disabled' },
      })
      return this.refuse(ctx, 'هذا الحساب معطّل. تواصل مع مدير النظام.')
    }

    if ((await completeSignIn(ctx, user, { method: 'password' })) === 'challenge')
      return response.redirect().toRoute('two_factor.challenge')
    response.redirect().toRoute('home')
  }

  async destroy(ctx: HttpContext) {
    const { auth, response, session } = ctx
    const user = auth.getUserOrFail()
    const sessionId = session.sessionId
    await auth.use('web').logout()
    endImpersonation(session)
    await endSession(sessionId)
    await logAuthActivity({ userId: user.id, action: 'logout', changes: requestContext(ctx) })
    response.redirect().toRoute('session.create')
  }

  private refuse({ request, response, session }: HttpContext, message: string) {
    if (request.accepts(['html', 'json']) === 'json')
      return response.unauthorized({ errors: [{ message }] })
    session.flashExcept(['password'])
    session.flash('inputErrorsBag', { email: [message] })
    return response.redirect().toRoute('session.create')
  }
}
