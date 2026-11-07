import type { HttpContext } from '@adonisjs/core/http'
import { AdulaError, UserInvitations } from 'adula'
import db from '@adonisjs/lucid/services/db'
import hash from '@adonisjs/core/services/hash'
import mail from '@adonisjs/mail/services/main'
import env from '#start/env'
import { ValidationError } from '@vinejs/vine'
import UserInvitationNotification from '#mails/user_invitation_notification'
import { invitationValidator, acceptInvitationValidator } from '#validators/user'
import { requestActor } from '#services/adula'
import { isAdministrator } from '#middleware/admin_middleware'

const service = () => new UserInvitations(db.connection().getWriteClient())

/**
 * Where the invitation dialog is shown: over the users list it was opened from (keeping its
 * search), or the invitation page for someone who may invite without administering users.
 */
function dialogPage(ctx: HttpContext) {
  try {
    const referrer = new URL(ctx.request.header('referer') ?? '', ctx.request.completeUrl())
    if (referrer.host === ctx.request.host() && referrer.pathname === '/admin/users') {
      referrer.searchParams.set('invite', '1')
      return `${referrer.pathname}${referrer.search}`
    }
  } catch {}
  return '/users/invite'
}

export default class UserInvitationsController {
  async create(ctx: HttpContext) {
    if (!(await service().canInvite(ctx.auth.getUserOrFail().id)))
      throw new AdulaError(403, 'E_FORBIDDEN', 'ليس لديك صلاحية دعوة المستخدمين')
    // Administrators invite over the users list; the direct address opens the same dialog there.
    if (await isAdministrator(ctx.auth.getUserOrFail().id)) {
      ctx.session.reflash()
      return ctx.response.redirect('/admin/users?invite=1')
    }
    return ctx.inertia.render('users/invite', {})
  }

  async store(ctx: HttpContext) {
    const actor = await requestActor(ctx)
    const id = actor.id
    if (!(await service().canInvite(id)))
      throw new AdulaError(403, 'E_FORBIDDEN', 'ليس لديك صلاحية دعوة المستخدمين')
    try {
      const input = await ctx.request.validateUsing(invitationValidator)
      const data = await service().invite(
        id,
        input,
        async ({ email, token }) => {
          await mail.send(
            new UserInvitationNotification(
              email,
              `${env.get('APP_URL').replace(/\/$/, '')}/invitations/${token}`
            )
          )
        },
        { impersonatorId: actor.impersonatorId }
      )
      if (ctx.request.accepts(['html', 'json']) === 'json') return { data }
      ctx.session.flash(
        'success',
        'تم إرسال الدعوة بالبريد. يمكن إعادة إرسالها بعد دقيقة؛ عندها يُلغى الرابط السابق.'
      )
      return ctx.response.redirect(dialogPage(ctx))
    } catch (error) {
      return this.failure(ctx, error, dialogPage(ctx))
    }
  }

  async show(ctx: HttpContext) {
    const token = String(ctx.params.token)
    ctx.response.header('Referrer-Policy', 'no-referrer').header('Cache-Control', 'no-store')
    return ctx.inertia.render('auth/invitation', { token, valid: await service().valid(token) })
  }

  async accept(ctx: HttpContext) {
    try {
      const { password } = await ctx.request.validateUsing(acceptInvitationValidator)
      const data = await service().accept(String(ctx.params.token), password, (value) =>
        hash.make(value)
      )
      // Receiving the invitation link proves ownership of the invited address.
      await db.from('users').where('id', data.id).update({ email_verified_at: new Date() })
      if (ctx.request.accepts(['html', 'json']) === 'json') return { data }
      ctx.session.flash(
        'success',
        'تم إنشاء حسابك. سجّل الدخول بكلمة مرورك الجديدة؛ يعيّن المسؤول صلاحيات العمل.'
      )
      return ctx.response.redirect('/login')
    } catch (error) {
      return this.failure(ctx, error)
    }
  }

  private failure(ctx: HttpContext, error: unknown, target = ctx.request.url()) {
    if (ctx.request.accepts(['html', 'json']) === 'json') throw error
    if (error instanceof ValidationError) {
      const messages = Array.isArray(error.messages)
        ? Object.fromEntries(
            error.messages.map((entry: { field: string; message: string }) => [
              entry.field,
              entry.message,
            ])
          )
        : error.messages
      ctx.session.flash('inputErrorsBag', messages)
    } else if (error instanceof AdulaError) {
      ctx.session.flash('inputErrorsBag', { form: error.message })
    } else throw error
    // Bearer-token pages deliberately omit Referer; redirect to the known GET route explicitly.
    return ctx.response.redirect(target)
  }
}
