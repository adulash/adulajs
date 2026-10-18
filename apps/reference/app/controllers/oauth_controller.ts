import type { HttpContext } from '@adonisjs/core/http'
import { Exception } from '@adonisjs/core/exceptions'
import {
  enabledProvider,
  isKnownProvider,
  linkOrCreateSocialUser,
  linkSocialAccount,
  providerLabel,
  unlinkSocialAccount,
  type SocialProvider,
} from '#services/social_accounts'
import { logAuthActivity, requestContext } from '#services/auth_activity'
import { activeImpersonation } from '#services/impersonation'
import {
  REAUTH_REQUIRED,
  REAUTH_WRONG_PASSWORD,
  completeSignIn,
  confirmRecentAuthentication,
} from '#services/sign_in'
import { twoFactorEnabled } from '#services/two_factor'
import { Settings } from 'adula'
import db from '@adonisjs/lucid/services/db'
import { oauthFingerprint } from '#services/initial_setup'
import { signupEnabled } from '#services/signup'

/** Unknown, unconfigured or disabled providers behave like a missing route. */
const notFound = () =>
  new Exception('الصفحة غير موجودة', { status: 404, code: 'E_ROUTE_NOT_FOUND' })

/** Generic refusal while signup is closed; it does not say whether the address is registered. */
export const OAUTH_UNAVAILABLE =
  'تعذّر تسجيل الدخول عبر المزوّد. إن كان لديك حساب فسجّل الدخول بكلمة المرور أو تواصل مع مدير النظام.'
/** Shown for any provider-side failure; the provider's own text is only logged. */
export const OAUTH_PROVIDER_FAILED = 'تعذّر إكمال الطلب لدى المزوّد. حاول مجدداً لاحقاً.'
export const OAUTH_EXPIRED = 'انتهت صلاحية الطلب أو لم يبدأ من هذا المتصفح. حاول مجدداً.'
export const OAUTH_LINK_IMPERSONATING =
  'لا يمكن ربط الحسابات الخارجية أو فكّها أثناء انتحال مستخدم.'

/** Session key of a pending "link this identity to my account" request. */
export const LINK_INTENT_KEY = 'oauth_link_intent'
const LINK_INTENT_TTL_MS = 10 * 60 * 1000
type LinkIntent = { userId: number; provider: SocialProvider; expiresAt: number }

const wantsJson = ({ request }: HttpContext) => request.accepts(['html', 'json']) === 'json'

/** Provider error text is attacker-influenced (it arrives in the query string): log it bounded. */
const boundedText = (value: unknown) => String(value ?? '').slice(0, 200)

export default class OauthController {
  async redirect({ params, ally }: HttpContext) {
    const provider = await enabledProvider(params.provider)
    if (!provider) throw notFound()
    return ally.use(provider).redirect()
  }

  /** POST /account/connections/:provider — starts linking an identity to the signed-in user. */
  async link(ctx: HttpContext) {
    const { params, ally, auth, session } = ctx
    const provider = await enabledProvider(params.provider)
    if (!provider) throw notFound()
    const user = auth.getUserOrFail()
    if (activeImpersonation(ctx)) {
      await this.logRefusal(ctx, user.id, provider, 'impersonation')
      return this.refuseImpersonation(ctx)
    }
    // Adding a sign-in method is a sensitive change: a recent sign-in or the password.
    const confirmed = await confirmRecentAuthentication(ctx, user)
    if (confirmed === 'missing' || confirmed === 'wrong') {
      session.flash('error', confirmed === 'wrong' ? REAUTH_WRONG_PASSWORD : REAUTH_REQUIRED)
      return ctx.response.redirect().toRoute('profile.show')
    }
    const intent: LinkIntent = {
      userId: user.id,
      provider,
      expiresAt: Date.now() + LINK_INTENT_TTL_MS,
    }
    session.put(LINK_INTENT_KEY, intent)
    return ally.use(provider).redirect()
  }

  /** DELETE /account/connections/:provider — removes the signed-in user's identity. */
  async unlink(ctx: HttpContext) {
    const { params, auth, response, session } = ctx
    const provider: unknown = params.provider
    // A provider disabled later can still be unlinked; unknown names are a missing route.
    if (!isKnownProvider(provider)) throw notFound()
    const user = auth.getUserOrFail()
    if (activeImpersonation(ctx)) {
      await this.logRefusal(ctx, user.id, provider, 'impersonation', 'unlink')
      return this.refuseImpersonation(ctx)
    }
    const removed = await unlinkSocialAccount(user.id, provider)
    if (removed > 0)
      await logAuthActivity({
        userId: user.id,
        action: 'social_unlinked',
        changes: { ...requestContext(ctx), provider },
      })
    if (wantsJson(ctx)) return { data: { provider, removed: removed > 0 } }
    session.flash(
      'success',
      removed > 0
        ? `تم فكّ ارتباط حساب ${providerLabel(provider)}.`
        : 'لا يوجد حساب مرتبط بهذا المزوّد.'
    )
    return response.redirect().toRoute('profile.show')
  }

  async callback(ctx: HttpContext) {
    const { params, ally, auth, request, response, session, logger } = ctx
    const provider = await enabledProvider(params.provider)
    if (!provider) throw notFound()
    // Constructing the driver reads and clears the one-time state cookies.
    const driver = ally.use(provider)
    // A link intent is single-use, whatever the outcome.
    const intent = session.pull(LINK_INTENT_KEY) as Partial<LinkIntent> | undefined
    const user = auth.user
    const linking = !!user
    const fail = (message: string) => {
      session.flash('error', message)
      return response
        .redirect()
        .clearQs()
        .toRoute(linking ? 'profile.show' : 'session.create')
    }

    if (user) {
      // A signed-in user reaches here only to link; anything else changes nothing.
      const valid =
        !!intent &&
        intent.userId === user.id &&
        intent.provider === provider &&
        typeof intent.expiresAt === 'number' &&
        intent.expiresAt > Date.now()
      if (!valid) return response.redirect().clearQs().toRoute('home')
      if (activeImpersonation(ctx)) {
        await this.logRefusal(ctx, user.id, provider, 'impersonation')
        return fail(OAUTH_LINK_IMPERSONATING)
      }
    } else if (intent) {
      // The linking session ended (sign-out or expiry) before the provider answered.
      return fail(OAUTH_EXPIRED)
    }

    // Ally treats "no state cookie and no state parameter" as a match; require a value.
    const state: unknown = request.input('state')
    if (typeof state !== 'string' || state === '' || driver.stateMisMatch())
      return fail(OAUTH_EXPIRED)
    if (driver.accessDenied()) return fail('ألغيت العملية قبل منح الإذن.')
    if (driver.hasError()) {
      logger.warn(
        { provider, error: boundedText(driver.getError()) },
        'OAuth provider returned an error'
      )
      return fail(OAUTH_PROVIDER_FAILED)
    }

    let profile: Awaited<ReturnType<typeof driver.user>>
    try {
      profile = await driver.user()
    } catch (error) {
      logger.warn(
        { provider, error: boundedText((error as Error)?.message) },
        'OAuth profile could not be obtained'
      )
      return fail(OAUTH_PROVIDER_FAILED)
    }
    const providerId = String(profile.id ?? '')
    if (!providerId) return fail(OAUTH_PROVIDER_FAILED)

    if (user) return this.completeLink(ctx, user.id, provider, providerId, fail)

    if (!profile.email || profile.emailVerificationState !== 'verified')
      return fail('يتطلب الدخول بريداً إلكترونياً موثقاً لدى المزوّد.')
    // Closed signup still lets existing accounts sign in; it only stops creating new ones.
    const open = await signupEnabled()
    const resolved = await linkOrCreateSocialUser(
      {
        provider,
        providerId,
        email: profile.email,
        name: profile.name || profile.nickName || null,
      },
      // With a second factor the e-mail link waits until the code passes.
      { allowCreate: open, deferLink: twoFactorEnabled }
    )
    if (resolved.refused) {
      if (resolved.refused === 'disabled') return fail('هذا الحساب معطّل. تواصل مع مدير النظام.')
      if (open && resolved.refused === 'unverified')
        return fail(
          'يوجد حساب بهذا البريد لم يُثبت امتلاكه بعد. سجّل الدخول بكلمة المرور، أو استعد كلمة المرور من رابط البريد ثم أعد المحاولة.'
        )
      // Unknown (signup closed), unproven (signup closed) and conflicting identities get
      // one answer that reveals neither whether nor how the address is registered.
      return fail(OAUTH_UNAVAILABLE)
    }
    const { user: account, created, pendingLink } = resolved
    if (resolved.linked)
      await logAuthActivity({
        userId: account.id,
        action: 'social_linked',
        changes: { ...requestContext(ctx), provider, automatic: true },
      })

    await new Settings(db.connection().getWriteClient()).set(`setup.oauth.${provider}`, {
      fingerprint: oauthFingerprint(provider),
      at: new Date().toISOString(),
    })
    const outcome = await completeSignIn(ctx, account, {
      method: 'oauth',
      provider,
      created,
      ...(pendingLink ? { pendingLink } : {}),
    })
    if (outcome === 'challenge') return response.redirect().clearQs().toPath('/login/two-factor')
    return response.redirect().clearQs().toRoute('home')
  }

  private async completeLink(
    ctx: HttpContext,
    userId: number,
    provider: SocialProvider,
    providerId: string,
    fail: (message: string) => unknown
  ) {
    const result = await linkSocialAccount(userId, provider, providerId)
    const label = providerLabel(provider)
    if (result === 'taken' || result === 'conflict') {
      await this.logRefusal(ctx, userId, provider, result)
      return fail(
        result === 'taken'
          ? `حساب ${label} هذا مرتبط بمستخدم آخر.`
          : `حسابك مرتبط مسبقاً بحساب ${label} آخر. افكك ارتباطه أولاً.`
      )
    }
    if (result === 'linked')
      await logAuthActivity({
        userId,
        action: 'social_linked',
        changes: { ...requestContext(ctx), provider },
      })
    ctx.session.flash(
      'success',
      result === 'linked' ? `تم ربط حساب ${label}.` : `حساب ${label} هذا مرتبط بحسابك مسبقاً.`
    )
    return ctx.response.redirect().clearQs().toRoute('profile.show')
  }

  private async logRefusal(
    ctx: HttpContext,
    userId: number,
    provider: SocialProvider,
    reason: 'impersonation' | 'taken' | 'conflict',
    operation: 'link' | 'unlink' = 'link'
  ) {
    const impersonation = activeImpersonation(ctx)
    await logAuthActivity({
      userId,
      actorId: impersonation?.adminId,
      action: 'social_link_refused',
      changes: { ...requestContext(ctx), provider, reason, operation },
    })
  }

  private refuseImpersonation(ctx: HttpContext) {
    if (wantsJson(ctx))
      return ctx.response.forbidden({
        error: { code: 'E_IMPERSONATION', message: OAUTH_LINK_IMPERSONATING },
      })
    ctx.session.flash('error', OAUTH_LINK_IMPERSONATING)
    return ctx.response.redirect().toRoute('profile.show')
  }
}
