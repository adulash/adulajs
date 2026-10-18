import type { HttpContext } from '@adonisjs/core/http'
import { changePasswordValidator, profileValidator } from '#validators/user'
import { logAuthActivity, requestContext } from '#services/auth_activity'
import { revokeUserSessions } from '#services/sessions'
import { revokeUserTokens } from '#services/access_tokens'
import { acting } from '#services/impersonation'

export default class ProfileController {
  async show({ inertia }: HttpContext) {
    return inertia.render('account/profile', {})
  }

  async update(ctx: HttpContext) {
    const { request, auth, response, session } = ctx
    const { fullName } = await request.validateUsing(profileValidator)
    const user = auth.getUserOrFail()
    const previous = user.fullName
    user.fullName = fullName
    await user.save()
    await logAuthActivity({
      userId: user.id,
      actorId: acting(ctx),
      action: 'profile_updated',
      changes: { ...requestContext(ctx), fields: ['fullName'], previous: { fullName: previous } },
    })
    session.flash('success', 'تم حفظ بيانات الملف الشخصي.')
    return response.redirect().toRoute('profile.show')
  }

  /** Changing the password ends every other session of the user. */
  async password(ctx: HttpContext) {
    const { request, auth, response, session } = ctx
    const { currentPassword, password } = await request.validateUsing(changePasswordValidator)
    const user = auth.getUserOrFail()
    if (!(await user.verifyPassword(currentPassword))) {
      session.flash('inputErrorsBag', { currentPassword: ['كلمة المرور الحالية غير صحيحة'] })
      return response.redirect().toRoute('profile.show')
    }
    user.password = password
    await user.save()
    await revokeUserSessions(user.id, acting(ctx), { except: session.sessionId })
    // API tokens were minted under the old password; they end with it.
    const tokensRevoked = await revokeUserTokens(user.id)
    await logAuthActivity({
      userId: user.id,
      actorId: acting(ctx),
      action: 'password_changed',
      changes: { ...requestContext(ctx), tokensRevoked },
    })
    session.flash('success', 'تم تغيير كلمة المرور وإنهاء الجلسات الأخرى ورموز الوصول.')
    return response.redirect().toRoute('profile.show')
  }
}
