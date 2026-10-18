import type { HttpContext } from '@adonisjs/core/http'
import { AdulaError } from 'adula'
import User from '#models/user'
import { positiveId, wantsJson } from '#controllers/admin/support'
import { activeImpersonation } from '#services/impersonation'
import { listUserTokens, presentToken as present } from '#services/access_tokens'
import { refuseTwoFactorRequired, twoFactorRequirementUnmet } from '#services/two_factor'

const ACCESS = { read: ['read'], write: ['read', 'write'] } as const

/** Users manage their own personal API tokens; secrets are shown once. */
export default class ApiTokensController {
  async index(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail()
    const tokens = await listUserTokens(user)
    if (wantsJson(ctx)) return { data: tokens }
    return ctx.inertia.render('account/tokens', { tokens })
  }

  async store(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail()
    // A token outlives the session, so an administrator acting as this user cannot mint one.
    if (activeImpersonation(ctx))
      throw new AdulaError(403, 'E_IMPERSONATING', 'لا يمكن إنشاء رمز وصول أثناء انتحال الهوية')
    // A token would carry administrator power past the second-factor requirement.
    if (await twoFactorRequirementUnmet(user.id))
      return refuseTwoFactorRequired(ctx, {
        message: 'فعّل التحقق بخطوتين لحسابك قبل إنشاء رمز وصول.',
      })
    const name = String(ctx.request.input('name') ?? '').trim()
    if (!name || name.length > 60)
      throw new AdulaError(422, 'E_TOKEN_NAME', 'اسم الرمز مطلوب ولا يتجاوز 60 حرفاً')
    const access = ctx.request.input('access') === 'write' ? 'write' : 'read'
    const days = Number(ctx.request.input('expiresInDays') ?? 90)
    if (!Number.isInteger(days) || days < 1 || days > 365)
      throw new AdulaError(422, 'E_TOKEN_EXPIRY', 'مدة الصلاحية بين يوم و365 يوماً')
    const existing = await User.accessTokens.all(user)
    if (existing.length >= 20)
      throw new AdulaError(422, 'E_TOKEN_LIMIT', 'بلغت الحد الأقصى للرموز (20)')
    const token = await User.accessTokens.create(user, [...ACCESS[access]], {
      name,
      expiresIn: `${days} days`,
    })
    return ctx.response.created({ data: { token: present(token), secret: token.value!.release() } })
  }

  async destroy(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail()
    const removed = await User.accessTokens.delete(
      user,
      positiveId(ctx.params.id, 'الرمز غير موجود')
    )
    if (!removed) throw new AdulaError(404, 'E_TOKEN_NOT_FOUND', 'الرمز غير موجود')
    return { data: true }
  }
}
