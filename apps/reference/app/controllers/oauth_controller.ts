import type { HttpContext } from '@adonisjs/core/http'
import { Exception } from '@adonisjs/core/exceptions'
import { isSocialProvider, linkOrCreateSocialUser } from '#services/social_accounts'
import { logAuthActivity, requestContext } from '#services/auth_activity'
import { recordSession } from '#services/sessions'
import { Settings } from 'adula'
import db from '@adonisjs/lucid/services/db'
import { oauthFingerprint } from '#services/initial_setup'
import { signupEnabled } from '#services/signup'

/** Unknown or unconfigured providers behave like a missing route. */
const notFound = () =>
  new Exception('الصفحة غير موجودة', { status: 404, code: 'E_ROUTE_NOT_FOUND' })

/** Generic refusal while signup is closed; it does not say whether the address is registered. */
export const OAUTH_UNAVAILABLE =
  'تعذّر تسجيل الدخول عبر المزوّد. إن كان لديك حساب فسجّل الدخول بكلمة المرور أو تواصل مع مدير النظام.'

export default class OauthController {
  async redirect({ params, ally }: HttpContext) {
    const provider: unknown = params.provider
    if (!isSocialProvider(provider)) throw notFound()
    return ally.use(provider).redirect()
  }

  async callback(ctx: HttpContext) {
    const { params, ally, auth, response, session } = ctx
    const provider: unknown = params.provider
    if (!isSocialProvider(provider)) throw notFound()
    const driver = ally.use(provider)
    const fail = (message: string) => {
      session.flash('error', message)
      return response.redirect().clearQs().toRoute('session.create')
    }
    if (driver.accessDenied()) return fail('ألغيت تسجيل الدخول قبل منح الإذن.')
    if (driver.stateMisMatch()) return fail('انتهت صلاحية طلب تسجيل الدخول. حاول مجدداً.')
    if (driver.hasError()) return fail(`تعذّر تسجيل الدخول عبر المزوّد: ${driver.getError()}`)

    const profile = await driver.user()
    if (!profile.email || profile.emailVerificationState !== 'verified')
      return fail('يتطلب الدخول بريداً إلكترونياً موثقاً لدى المزوّد.')
    // Closed signup still lets existing accounts sign in; it only stops creating new ones.
    const open = await signupEnabled()
    const resolved = await linkOrCreateSocialUser(
      {
        provider,
        providerId: String(profile.id),
        email: profile.email,
        name: profile.name || profile.nickName || null,
      },
      { allowCreate: open }
    )
    // With signup closed, unknown and unproven addresses get one answer that reveals neither.
    if (resolved.closed || (!open && resolved.unverified)) return fail(OAUTH_UNAVAILABLE)
    if (resolved.unverified)
      return fail(
        'يوجد حساب بهذا البريد لم يُثبت امتلاكه بعد. سجّل الدخول بكلمة المرور، أو استعد كلمة المرور من رابط البريد ثم أعد المحاولة.'
      )
    const { user, created } = resolved
    if (user.disabledAt) return fail('هذا الحساب معطّل. تواصل مع مدير النظام.')

    await auth.use('web').login(user)
    await recordSession(ctx, user.id)
    await new Settings(db.connection().getWriteClient()).set(`setup.oauth.${provider}`, {
      fingerprint: oauthFingerprint(provider),
      at: new Date().toISOString(),
    })
    await logAuthActivity({
      userId: user.id,
      action: 'oauth_login',
      changes: { ...requestContext(ctx), provider, created },
    })
    return response.redirect().clearQs().toRoute('home')
  }
}
