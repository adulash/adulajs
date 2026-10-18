import { createHash, randomBytes } from 'node:crypto'
import { DateTime } from 'luxon'
import env from '#start/env'
import User from '#models/user'
import db from '@adonisjs/lucid/services/db'
import mail from '@adonisjs/mail/services/main'
import type { HttpContext } from '@adonisjs/core/http'
import PasswordResetNotification from '#mails/password_reset_notification'
import { forgotPasswordValidator, resetPasswordValidator } from '#validators/user'
import { logAuthActivity, requestContext } from '#services/auth_activity'
import { revokeUserSessions } from '#services/sessions'
import { revokeUserTokens } from '#services/access_tokens'
import { loginAccountKey, loginAccountLimiter, loginLockoutLimiter } from '#start/limiter'

/** Recovery links expire after one hour and can be used once. */
const TOKEN_TTL_MS = 60 * 60 * 1000
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')
const knex = () => db.connection().getWriteClient()

/** The pending token row, or null when unknown, already used or expired. */
async function pendingToken(token: unknown) {
  if (typeof token !== 'string' || token.length < 16 || token.length > 128) return null
  const row = await knex()('password_reset_tokens')
    .where({ token_hash: hashToken(token) })
    .first()
  if (!row || row.used_at || new Date(row.expires_at).getTime() < Date.now()) return null
  return row
}

export default class PasswordResetController {
  async forgot({ inertia }: HttpContext) {
    return inertia.render('auth/forgot', {})
  }

  /** Always answers the same way so the form cannot be used to probe e-mails. */
  async send(ctx: HttpContext) {
    const { request, response, session } = ctx
    const { email } = await request.validateUsing(forgotPasswordValidator)
    const user = await User.query().whereRaw('lower(email) = lower(?)', [email]).first()
    if (user && !user.disabledAt) {
      const token = randomBytes(32).toString('base64url')
      await knex()('password_reset_tokens')
        .where({ user_id: user.id })
        .whereNull('used_at')
        .delete()
      await knex()('password_reset_tokens').insert({
        user_id: user.id,
        token_hash: hashToken(token),
        expires_at: new Date(Date.now() + TOKEN_TTL_MS),
      })
      let accepted = false
      try {
        await mail.send(
          new PasswordResetNotification(user, `${env.get('APP_URL')}/password/reset/${token}`)
        )
        accepted = true
      } catch {
        // Revoke only this attempt, preserving any newer concurrent request.
        await knex()('password_reset_tokens')
          .where({ token_hash: hashToken(token) })
          .delete()
      }
      await logAuthActivity({
        userId: user.id,
        action: accepted ? 'password_reset_requested' : 'password_reset_delivery_failed',
        changes: requestContext(ctx),
      })
    }
    session.flash(
      'success',
      'إن كان البريد مسجلاً لدينا فستصلك رسالة تحوي رابط إعادة التعيين خلال دقائق.'
    )
    return response.redirect().toRoute('password_reset.forgot')
  }

  async reset({ inertia, params, response }: HttpContext) {
    const token = String(params.token)
    // The bearer token is in the path: keep it out of Referer headers and caches.
    response.header('Referrer-Policy', 'no-referrer').header('Cache-Control', 'no-store')
    return inertia.render('auth/reset', { token, valid: Boolean(await pendingToken(token)) })
  }

  async update(ctx: HttpContext) {
    const { request, response, session, params } = ctx
    const { password } = await request.validateUsing(resetPasswordValidator)
    const row = await pendingToken(params.token)
    const user = row ? await User.find(row.user_id) : null
    // The conditional update makes the token single-use even under concurrent submits.
    const consumed = row
      ? await knex()('password_reset_tokens')
          .where({ id: row.id })
          .whereNull('used_at')
          .update({ used_at: knex().fn.now() })
      : 0
    if (!row || !user || user.disabledAt || !consumed) {
      session.flash('error', 'رابط إعادة التعيين غير صالح أو انتهت صلاحيته. اطلب رابطاً جديداً.')
      return response.redirect().toRoute('password_reset.forgot')
    }

    user.password = password
    // Completing mailed recovery proves ownership of the address.
    user.emailVerifiedAt ??= DateTime.now()
    await user.save()
    await revokeUserSessions(user.id, user.id)
    // Whoever knew the old password may have minted API tokens; recovery ends them too.
    const tokensRevoked = await revokeUserTokens(user.id)
    // Proven ownership lifts a lockout caused by someone else's failed guesses.
    // Lockouts are per address; the owner usually recovers from the device they sign in on.
    await loginAccountLimiter.delete(loginAccountKey(user.email, ctx.request.ip()))
    await loginLockoutLimiter.delete(loginAccountKey(user.email, ctx.request.ip()))
    await logAuthActivity({
      userId: user.id,
      action: 'password_reset',
      changes: { ...requestContext(ctx), tokensRevoked },
    })
    session.flash('success', 'تم تغيير كلمة المرور. سجّل الدخول بكلمة المرور الجديدة.')
    return response.redirect().toRoute('session.create')
  }
}
