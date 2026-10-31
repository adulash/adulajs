import type { HttpContext } from '@adonisjs/core/http'
import { AdulaError, TWO_FACTOR_UNREADABLE, type TwoFactorResult } from 'adula'
import User from '#models/user'
import { logAuthActivity, requestContext } from '#services/auth_activity'
import { establishSession, type PendingLink, type SignInMethod } from '#services/sign_in'
import {
  clearChallenge,
  credentialFingerprint,
  lockedMessage,
  pendingChallenge,
  reserveAccountAttempt,
  settleAccountAttempt,
  twoFactor,
  type PendingChallenge,
} from '#services/two_factor'
import {
  loginLockoutLimiter,
  lockoutMinutes,
  twoFactorAttemptKey,
  twoFactorAttemptLimiter,
  twoFactorLockoutKey,
} from '#start/limiter'

const CHALLENGE_PATH = '/login/two-factor'
const LOGIN_PATH = '/login'
const EXPIRED = 'انتهت مهلة خطوة التحقق. سجّل الدخول مجدداً.'

const methodOf = (pending: PendingChallenge): SignInMethod =>
  pending.method === 'oauth'
    ? {
        method: 'oauth',
        provider: String(pending.provider ?? ''),
        created: Boolean(pending.created),
        ...(pending.link ? { pendingLink: pending.link as PendingLink } : {}),
      }
    : { method: 'password' }

/**
 * Second sign-in step: a TOTP or recovery code for a user whose password or OAuth
 * identity was already verified. Failures follow the login lockout rules per account
 * and address, plus a per-account ceiling across addresses. Every attempt is counted
 * before the code is checked, so concurrent requests cannot outrun the limits.
 */
export default class TwoFactorChallengeController {
  async create(ctx: HttpContext) {
    if (!pendingChallenge(ctx)) {
      clearChallenge(ctx)
      return this.refuse(ctx, EXPIRED, LOGIN_PATH)
    }
    // Nothing secret reaches the page: the user id and method stay in the session.
    return ctx.inertia.render('auth/two_factor', {})
  }

  async store(ctx: HttpContext) {
    const pending = pendingChallenge(ctx)
    if (!pending) {
      clearChallenge(ctx)
      return this.refuse(ctx, EXPIRED, LOGIN_PATH)
    }
    const user = await User.find(pending.userId)
    if (!user || user.disabledAt) {
      clearChallenge(ctx)
      if (user)
        await logAuthActivity({
          userId: user.id,
          action: 'two_factor_failed',
          changes: { ...requestContext(ctx), reason: 'disabled' },
        })
      return this.refuse(ctx, 'هذا الحساب معطّل. تواصل مع مدير النظام.', LOGIN_PATH)
    }

    // The password, a password reset or a two-factor reset changed since the first factor.
    if ((await credentialFingerprint(user.id)) !== pending.fingerprint) {
      clearChallenge(ctx)
      await logAuthActivity({
        userId: user.id,
        action: 'two_factor_failed',
        changes: { ...requestContext(ctx), reason: 'credentials_changed' },
      })
      return this.refuse(ctx, EXPIRED, LOGIN_PATH)
    }

    const ip = ctx.request.ip()
    const attemptKey = twoFactorAttemptKey(user.id, ip)
    // Counted first, atomically in the limiter store: a locked pair or account never
    // reaches code verification, however many requests arrive at once.
    const pair = await twoFactorAttemptLimiter.increment(attemptKey)
    const account = pair.consumed <= pair.limit ? await reserveAccountAttempt(user.id) : null
    if (!account?.allowed) {
      // An attempt refused by the account ceiling was never a guess at this address.
      if (account) await twoFactorAttemptLimiter.decrement(attemptKey)
      await logAuthActivity({
        userId: user.id,
        action: 'two_factor_failed',
        changes: { ...requestContext(ctx), reason: 'locked' },
      })
      return this.refuse(
        ctx,
        lockedMessage(account ? account.availableIn : pair.availableIn),
        CHALLENGE_PATH
      )
    }

    const service = await twoFactor()
    let result: TwoFactorResult
    try {
      result = await service.verify(user.id, ctx.request.input('code'))
    } catch (error) {
      if (!(error instanceof AdulaError) || error.code !== TWO_FACTOR_UNREADABLE) throw error
      // The encryption key changed without keeping the old one: not the user's guess.
      await twoFactorAttemptLimiter.decrement(attemptKey)
      await settleAccountAttempt(ctx, user.id, account, true)
      ctx.logger.error({ userId: user.id }, 'Two-factor secret cannot be decrypted')
      await logAuthActivity({
        userId: user.id,
        action: 'two_factor_failed',
        changes: { ...requestContext(ctx), reason: 'unreadable_secret' },
      })
      return this.refuse(ctx, error.message, CHALLENGE_PATH)
    }
    if (!result) {
      await logAuthActivity({
        userId: user.id,
        action: 'two_factor_failed',
        changes: requestContext(ctx),
      })
      // The attempt that exhausts the pair locks it for an escalating period.
      if (pair.consumed >= pair.limit) await this.lockPair(ctx, user.id, attemptKey)
      await settleAccountAttempt(ctx, user.id, account, false)
      return this.refuse(ctx, 'رمز التحقق غير صحيح', CHALLENGE_PATH)
    }

    await twoFactorAttemptLimiter.delete(attemptKey)
    await settleAccountAttempt(ctx, user.id, account, true)
    await establishSession(ctx, user, methodOf(pending), result)
    if (result === 'recovery')
      await logAuthActivity({
        userId: user.id,
        action: 'two_factor_recovery_used',
        changes: { ...requestContext(ctx), remaining: await service.recoveryRemaining(user.id) },
      })
    if (ctx.request.accepts(['html', 'json']) === 'json')
      return { data: { signedIn: true, secondFactor: result } }
    return ctx.response.redirect().toRoute('home')
  }

  /** Blocks the account and address for 1, 2, 4 … 60 minutes after consecutive lockouts. */
  private async lockPair(ctx: HttpContext, userId: number, attemptKey: string) {
    const lockoutKey = twoFactorLockoutKey(userId, ctx.request.ip())
    const { consumed: lockouts } = await loginLockoutLimiter.increment(lockoutKey)
    const minutes = lockoutMinutes(lockouts)
    await twoFactorAttemptLimiter.block(attemptKey, `${minutes} minutes`)
    await logAuthActivity({
      userId,
      action: 'two_factor_locked',
      changes: { ...requestContext(ctx), scope: 'address', minutes, lockouts },
    })
  }

  private refuse(
    { request, response, session }: HttpContext,
    message: string,
    path: typeof CHALLENGE_PATH | typeof LOGIN_PATH
  ) {
    if (request.accepts(['html', 'json']) === 'json')
      return response.unauthorized({ errors: [{ message }] })
    if (path === LOGIN_PATH) session.flash('inputErrorsBag', { email: [message] })
    else session.flash('inputErrorsBag', { code: [message] })
    return response.redirect().toPath(path)
  }
}
