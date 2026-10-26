import type { HttpContext } from '@adonisjs/core/http'
import { AdulaError, logActivity } from 'adula'
import db from '@adonisjs/lucid/services/db'
import { changePasswordValidator, profileValidator } from '#validators/user'
import { logAuthActivity, requestContext } from '#services/auth_activity'
import { revokeUserSessions } from '#services/sessions'
import { revokeUserTokens } from '#services/access_tokens'
import { acting, activeImpersonation } from '#services/impersonation'
import { profileTwoFactor } from '#services/two_factor'
import { channelPreferences, notificationChannels } from '#services/notification_channels'
import { mutate } from '#controllers/admin/support'

export default class ProfileController {
  async show({ inertia, auth, request }: HttpContext) {
    const { userConnections } = await import('#services/social_accounts')
    return inertia.render('account/profile', {
      connections: await userConnections(auth.getUserOrFail().id),
      twoFactor: await profileTwoFactor(auth.getUserOrFail().id),
      notificationChannels: await channelPreferences(auth.getUserOrFail().id),
      // The provider link is a native form POST (it leaves the Inertia app), so it needs the token.
      csrfToken: request.csrfToken,
    })
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

  /**
   * The signed-in user's own notification channels; there is no user id to choose. A
   * phone number outlives the session, so an administrator acting as the user cannot set it.
   * The activity records which channels changed, never the number.
   */
  async channels(ctx: HttpContext) {
    const userId = ctx.auth.getUserOrFail().id
    refuseImpersonation(ctx)
    return mutate(
      ctx,
      async () => {
        const channels = await notificationChannels()
        const saved = await channels.update(userId, ctx.request.input('channels'))
        await logActivity(db.connection().getWriteClient(), {
          resource: 'users',
          recordId: userId,
          actorId: acting(ctx),
          action: 'notification_channels_updated',
          changes: {
            ...requestContext(ctx),
            channels: saved
              .filter((channel) => !channel.locked)
              .map(({ key, enabled }) => ({ key, enabled })),
          },
        })
        return saved
      },
      'تم حفظ قنوات الإشعارات.',
      '/account/profile'
    )
  }

  /** Sends a one-time code to the number the user wants to use for the channel. */
  async channelCode(ctx: HttpContext) {
    const userId = ctx.auth.getUserOrFail().id
    refuseImpersonation(ctx)
    const channels = await notificationChannels()
    const sent = await channels.requestCode(
      userId,
      String(ctx.params.key),
      ctx.request.input('address')
    )
    return { data: sent }
  }

  /** Confirms the code and enables the channel with that number; logged without it. */
  async channelConfirm(ctx: HttpContext) {
    const userId = ctx.auth.getUserOrFail().id
    refuseImpersonation(ctx)
    const key = String(ctx.params.key)
    const channels = await notificationChannels()
    const saved = await channels.confirmCode(userId, key, ctx.request.input('code'))
    await logActivity(db.connection().getWriteClient(), {
      resource: 'users',
      recordId: userId,
      actorId: acting(ctx),
      action: 'notification_channel_confirmed',
      changes: { ...requestContext(ctx), channel: key },
    })
    return { data: saved }
  }
}

/** A phone number outlives the session, so an administrator acting as the user cannot set it. */
function refuseImpersonation(ctx: HttpContext) {
  if (activeImpersonation(ctx))
    throw new AdulaError(
      403,
      'E_IMPERSONATING',
      'لا يمكن تغيير قنوات الإشعارات أثناء انتحال الهوية'
    )
}
