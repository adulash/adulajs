import type { HttpContext } from '@adonisjs/core/http'
import { AdulaError } from 'adula'
import { logAuthActivity, requestContext } from '#services/auth_activity'
import { activeImpersonation } from '#services/impersonation'
import {
  REAUTH_REQUIRED,
  REAUTH_WRONG_PASSWORD,
  confirmRecentAuthentication,
} from '#services/sign_in'
import {
  enrolmentQr,
  lockedMessage,
  reserveAccountAttempt,
  settleAccountAttempt,
  twoFactor,
} from '#services/two_factor'

const WRONG_CODE = () => new AdulaError(422, 'E_TWO_FACTOR_CODE', 'رمز التحقق غير صحيح')
const WRONG_PASSWORD = () => new AdulaError(422, 'E_PASSWORD', REAUTH_WRONG_PASSWORD)
type Operation = 'regenerate' | 'disable'

/**
 * Self-service two-factor authentication under /account/two-factor. Every answer is
 * JSON for the profile page's Dialogs. An administrator impersonating a user cannot
 * change that user's authenticators.
 */
export default class TwoFactorController {
  /** Starts enrolment: the secret is shown once for the authenticator application. */
  async begin(ctx: HttpContext) {
    const user = this.owner(ctx)
    // Replacing the authenticator is sensitive: a recent sign-in or the password.
    const confirmed = await confirmRecentAuthentication(ctx, user)
    if (confirmed === 'missing') throw new AdulaError(403, 'E_REAUTH_REQUIRED', REAUTH_REQUIRED)
    if (confirmed === 'wrong') throw WRONG_PASSWORD()
    const service = await twoFactor()
    const enrolment = await service.begin(user.id, user.email)
    return {
      data: {
        otpauthUrl: enrolment.otpauthUrl,
        secret: enrolment.secret,
        issuer: enrolment.issuer,
        account: enrolment.account,
        qrDataUri: enrolmentQr(enrolment.otpauthUrl),
      },
    }
  }

  /** Confirms enrolment with a current code; the recovery codes are shown once. */
  async confirm(ctx: HttpContext) {
    const user = this.owner(ctx)
    const service = await twoFactor()
    const recoveryCodes = await service.confirm(user.id, ctx.request.input('code'))
    await logAuthActivity({
      userId: user.id,
      action: 'two_factor_enabled',
      changes: requestContext(ctx),
    })
    return { data: { recoveryCodes } }
  }

  /** New recovery codes replace the old ones; a current authenticator code is required. */
  async regenerate(ctx: HttpContext) {
    const user = this.owner(ctx)
    const service = await twoFactor()
    if (!(await service.isEnabled(user.id)))
      throw new AdulaError(409, 'E_TWO_FACTOR_NOT_ENABLED', 'التحقق بخطوتين غير مفعّل')
    await this.checkCode(ctx, user.id, 'regenerate', { allowRecovery: false })
    const recoveryCodes = await service.regenerateRecoveryCodes(user.id)
    await logAuthActivity({
      userId: user.id,
      action: 'two_factor_recovery_regenerated',
      changes: requestContext(ctx),
    })
    return { data: { recoveryCodes } }
  }

  /** Disabling needs the password and a current code or an unused recovery code. */
  async destroy(ctx: HttpContext) {
    const user = this.owner(ctx)
    const service = await twoFactor()
    if (!(await service.isEnabled(user.id)))
      throw new AdulaError(409, 'E_TWO_FACTOR_NOT_ENABLED', 'التحقق بخطوتين غير مفعّل')
    const password = ctx.request.input('password')
    if (typeof password !== 'string' || !(await user.verifyPassword(password))) {
      await logAuthActivity({
        userId: user.id,
        action: 'password_confirmation_failed',
        changes: { ...requestContext(ctx), operation: 'disable_two_factor' },
      })
      throw WRONG_PASSWORD()
    }
    const secondFactor = await this.checkCode(ctx, user.id, 'disable')
    const { recoveryCodes } = await service.disable(user.id)
    await logAuthActivity({
      userId: user.id,
      action: 'two_factor_disabled',
      changes: { ...requestContext(ctx), secondFactor, recoveryCodesRemoved: recoveryCodes },
    })
    return { data: { enabled: false } }
  }

  /**
   * Verifies a code under the sign-in challenge's per-account ceiling: the attempt is
   * counted first, refused unchecked over the ceiling, logged as two_factor_failed
   * when wrong, and given back when right.
   */
  private async checkCode(
    ctx: HttpContext,
    userId: number,
    operation: Operation,
    options: { allowRecovery?: boolean } = {}
  ) {
    const attempt = await reserveAccountAttempt(userId)
    if (!attempt.allowed) {
      await logAuthActivity({
        userId,
        action: 'two_factor_failed',
        changes: { ...requestContext(ctx), operation, reason: 'locked' },
      })
      throw new AdulaError(429, 'E_TWO_FACTOR_LOCKED', lockedMessage(attempt.availableIn))
    }
    const service = await twoFactor()
    let result: Awaited<ReturnType<typeof service.verify>>
    try {
      result = await service.verify(userId, ctx.request.input('code'), options)
    } catch (error) {
      // An unreadable secret (rotated key) is not the user's guess.
      await settleAccountAttempt(ctx, userId, attempt, true)
      throw error
    }
    await settleAccountAttempt(ctx, userId, attempt, Boolean(result))
    if (!result || (options.allowRecovery === false && result !== 'totp')) {
      await logAuthActivity({
        userId,
        action: 'two_factor_failed',
        changes: { ...requestContext(ctx), operation },
      })
      throw WRONG_CODE()
    }
    return result
  }

  private owner(ctx: HttpContext) {
    if (activeImpersonation(ctx))
      throw new AdulaError(
        403,
        'E_IMPERSONATING',
        'لا يمكن تغيير التحقق بخطوتين أثناء انتحال حساب مستخدم'
      )
    return ctx.auth.getUserOrFail()
  }
}
