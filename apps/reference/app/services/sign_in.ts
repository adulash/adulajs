import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'
import { logAuthActivity, requestContext } from '#services/auth_activity'
import { recordSession } from '#services/sessions'
import { linkSocialAccount, type SocialProvider } from '#services/social_accounts'
import {
  beginChallenge,
  clearChallenge,
  credentialFingerprint,
  twoFactorEnabled,
} from '#services/two_factor'

/** An OAuth identity matched to the account by e-mail; linked once the sign-in completes. */
export type PendingLink = { provider: SocialProvider; providerId: string }

/** How the first factor was proven. */
export type SignInMethod =
  | { method: 'password' }
  | { method: 'oauth'; provider: string; created: boolean; pendingLink?: PendingLink }

/** Session key: when (and for whom) the user last proved their credentials. */
export const AUTHENTICATED_AT_KEY = 'auth_confirmed_at'
/** Sensitive account changes need a proof of the credentials this recent (ASVS 3.7.1). */
export const REAUTH_WINDOW_MS = 10 * 60 * 1000
export const REAUTH_REQUIRED = 'أكّد كلمة المرور للمتابعة.'
export const REAUTH_WRONG_PASSWORD = 'كلمة المرور غير صحيحة'

/** How the second factor was proven, when one was required. */
export type SecondFactor = 'totp' | 'recovery'

/**
 * Finishes a sign-in whose first factor (password or OAuth) succeeded. Both
 * controllers call it so the second-factor rule cannot be skipped by one path.
 * Returns 'signed_in' when a session user now exists, or 'challenge' when the
 * user must still pass the two-factor step (no session user yet, nothing logged
 * as a login; the session holds only the pending challenge).
 */
export async function completeSignIn(
  ctx: HttpContext,
  user: User,
  via: SignInMethod
): Promise<'signed_in' | 'challenge'> {
  if (await twoFactorEnabled(user.id)) {
    beginChallenge(ctx, user.id, via, await credentialFingerprint(user.id))
    return 'challenge'
  }
  await establishSession(ctx, user, via)
  return 'signed_in'
}

/**
 * Creates the session user, records the session and logs the login. The two-factor
 * challenge calls it after a valid code with how the second factor was proven.
 */
export async function establishSession(
  ctx: HttpContext,
  user: User,
  via: SignInMethod,
  secondFactor?: SecondFactor
) {
  clearChallenge(ctx)
  await ctx.auth.use('web').login(user)
  markAuthenticated(ctx, user.id)
  await recordSession(ctx, user.id)
  if (via.method === 'oauth' && via.pendingLink)
    await linkAutomatically(ctx, user.id, via.pendingLink)
  await logAuthActivity({
    userId: user.id,
    action: via.method === 'oauth' ? 'oauth_login' : 'login',
    changes: {
      ...requestContext(ctx),
      ...(via.method === 'oauth' ? { provider: via.provider, created: via.created } : {}),
      ...(secondFactor ? { secondFactor } : {}),
    },
  })
}

/**
 * Creates the automatic e-mail link of an OAuth identity after the whole sign-in
 * (second factor included) succeeded, with the explicit link's conflict checks
 * under a row lock. The sign-in itself stands either way; a refusal is logged.
 */
async function linkAutomatically(ctx: HttpContext, userId: number, link: PendingLink) {
  const result = await linkSocialAccount(userId, link.provider, link.providerId)
  if (result === 'linked')
    await logAuthActivity({
      userId,
      action: 'social_linked',
      changes: { ...requestContext(ctx), provider: link.provider, automatic: true },
    })
  else if (result === 'taken' || result === 'conflict')
    await logAuthActivity({
      userId,
      action: 'social_link_refused',
      changes: { ...requestContext(ctx), provider: link.provider, reason: result, automatic: true },
    })
}

/** Records that the user just proved their credentials in this session. */
export function markAuthenticated(ctx: HttpContext, userId: number) {
  ctx.session.put(AUTHENTICATED_AT_KEY, { userId, at: Date.now() })
}

/** Whether this session proved the user's credentials within the re-authentication window. */
export function recentlyAuthenticated(ctx: HttpContext, userId: number) {
  const raw = ctx.session.get(AUTHENTICATED_AT_KEY) as
    { userId?: unknown; at?: unknown } | undefined
  return (
    !!raw &&
    raw.userId === userId &&
    typeof raw.at === 'number' &&
    raw.at <= Date.now() &&
    Date.now() - raw.at < REAUTH_WINDOW_MS
  )
}

/**
 * Re-authentication for sensitive account changes: passes when the session is fresh,
 * otherwise the request must carry the current `password`. A correct password
 * refreshes the session; a wrong one is logged as `password_confirmation_failed`
 * (the route's per-user throttle bounds guessing). Sessions from before this rule
 * carry no timestamp and are never fresh.
 */
export async function confirmRecentAuthentication(
  ctx: HttpContext,
  user: User
): Promise<'fresh' | 'confirmed' | 'missing' | 'wrong'> {
  if (recentlyAuthenticated(ctx, user.id)) return 'fresh'
  const password: unknown = ctx.request.input('password')
  if (typeof password !== 'string' || password === '') return 'missing'
  if (!(await user.verifyPassword(password))) {
    await logAuthActivity({
      userId: user.id,
      action: 'password_confirmation_failed',
      changes: { ...requestContext(ctx), operation: ctx.route?.pattern ?? ctx.request.url() },
    })
    return 'wrong'
  }
  markAuthenticated(ctx, user.id)
  return 'confirmed'
}
