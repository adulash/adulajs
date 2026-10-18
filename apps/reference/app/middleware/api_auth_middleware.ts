import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import { refuseTwoFactorRequired, twoFactorRequirementUnmet } from '#services/two_factor'

/**
 * Authenticates /api/v1 requests with a personal bearer token only. Disabled
 * users are refused, and read-only tokens may only issue GET/HEAD requests.
 */
export default class ApiAuthMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const user = await ctx.auth.authenticateUsing(['api'])
    if (user.disabledAt)
      return ctx.response.unauthorized({
        error: { code: 'E_ACCOUNT_DISABLED', message: 'هذا الحساب معطّل' },
      })
    const token = ctx.auth.use('api').user?.currentAccessToken
    const write = !['GET', 'HEAD'].includes(ctx.request.method())
    if (!token || (write ? token.denies('write') : token.denies('read')))
      return ctx.response.forbidden({
        error: { code: 'E_TOKEN_SCOPE', message: 'صلاحية الرمز لا تسمح بهذا الطلب' },
      })
    // A token minted before the requirement (or before a reset) carries no administrator
    // power until its owner enrols.
    if (await twoFactorRequirementUnmet(user.id))
      return refuseTwoFactorRequired(ctx, {
        json: true,
        message: 'فعّل التحقق بخطوتين لحسابك قبل استخدام رموز الوصول.',
      })
    // API responses are always JSON, whatever Accept header the client sends.
    ctx.request.request.headers.accept = 'application/json'
    return next()
  }
}
