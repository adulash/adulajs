import { createHash } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import encryption from '@adonisjs/core/services/encryption'
import type { HttpContext } from '@adonisjs/core/http'
import { Settings, TwoFactor } from 'adula'
import { identity } from '#services/initial_setup'
import { logAuthActivity, requestContext } from '#services/auth_activity'
import {
  TWO_FACTOR_ACCOUNT_LIMIT,
  twoFactorAccountKey,
  twoFactorAccountLimiter,
} from '#start/limiter'
import type { SignInMethod } from '#services/sign_in'

/** System setting: administrators must enrol a second factor. Absent means required. */
export const TWO_FACTOR_REQUIRED_KEY = 'auth.twoFactorRequiredForAdministrators'
/** Session key of a sign-in whose first factor passed and that awaits the second. */
export const PENDING_KEY = 'two_factor_pending'
/** How long the second step stays open after the first factor. */
export const PENDING_TTL_MS = 5 * 60 * 1000

const knex = () => db.connection().getWriteClient()

/** The authenticator application shows the application's name next to the account. */
async function issuer() {
  const brand = await identity()
  return brand.company
}

/** The core primitive bound to this application's encryption key and name. */
export async function twoFactor() {
  return new TwoFactor(
    knex(),
    {
      seal: (value) => encryption.encrypt(value),
      open: (value) => encryption.decrypt<string>(value),
    },
    await issuer()
  )
}

/**
 * Extension point for a QR image of the enrolment URL (a `data:` URI). No renderer is
 * configured today, so the enrolment Dialog shows the secret and the otpauth link only.
 */
export function enrolmentQr(_otpauthUrl: string): string | null {
  return null
}

/** Two-factor state of a user (never secrets). */
export async function twoFactorStatus(userId: number) {
  const service = await twoFactor()
  return service.status(userId)
}

/** Whether the user has a confirmed authenticator. */
export async function twoFactorEnabled(userId: number) {
  const service = await twoFactor()
  return service.isEnabled(userId)
}

/** Whether administrators of this system must use two-factor authentication. */
export async function twoFactorRequiredForAdministrators() {
  return (await new Settings(knex()).get<unknown>(TWO_FACTOR_REQUIRED_KEY)) !== false
}

/** A sign-in that passed its first factor; no session user exists yet. */
export type PendingChallenge = {
  userId: number
  method: SignInMethod['method']
  provider?: string
  created?: boolean
  /** An automatic e-mail link of an OAuth identity, created only once the code passes. */
  link?: { provider: string; providerId: string }
  /** Credential state when the first factor passed; see `credentialFingerprint`. */
  fingerprint: string
  expiresAt: number
}

/**
 * Short digest of the user's password hash and authenticator enrolment time. A
 * password change, password reset or two-factor reset during a pending challenge
 * changes it, so the half-finished sign-in cannot be completed afterwards.
 */
export async function credentialFingerprint(userId: number) {
  const user = await knex()('users').where('id', userId).first('password')
  const factor = await knex()('user_two_factor').where('user_id', userId).first('enabled_at')
  const enabledAt = factor?.enabled_at ? new Date(factor.enabled_at).toISOString() : ''
  return createHash('sha256')
    .update(
      `${user?.password ?? ''}
${enabledAt}`
    )
    .digest('base64url')
    .slice(0, 22)
}

/**
 * Opens the second step: a fresh session id (the pre-login id is never reused) that
 * holds only the user id, how the first factor was proven and a five-minute expiry.
 */
export function beginChallenge(
  ctx: HttpContext,
  userId: number,
  via: SignInMethod,
  fingerprint: string
) {
  ctx.session.regenerate()
  const pending: PendingChallenge = {
    userId,
    method: via.method,
    ...(via.method === 'oauth' ? { provider: via.provider, created: via.created } : {}),
    ...(via.method === 'oauth' && via.pendingLink ? { link: via.pendingLink } : {}),
    fingerprint,
    expiresAt: Date.now() + PENDING_TTL_MS,
  }
  ctx.session.put(PENDING_KEY, pending)
}

/** The live pending challenge, or null when absent, malformed or expired. */
export function pendingChallenge(ctx: HttpContext): PendingChallenge | null {
  const raw = ctx.session.get(PENDING_KEY) as Partial<PendingChallenge> | undefined
  if (
    !raw ||
    typeof raw !== 'object' ||
    !Number.isSafeInteger(raw.userId) ||
    (raw.userId as number) <= 0 ||
    (raw.method !== 'password' && raw.method !== 'oauth') ||
    typeof raw.fingerprint !== 'string' ||
    (raw.link !== undefined &&
      (typeof raw.link?.provider !== 'string' || typeof raw.link?.providerId !== 'string')) ||
    typeof raw.expiresAt !== 'number' ||
    raw.expiresAt <= Date.now()
  )
    return null
  return raw as PendingChallenge
}

export function clearChallenge(ctx: HttpContext) {
  ctx.session.forget(PENDING_KEY)
}

/** Where an administrator without a second factor is sent to enrol. */
export const ENROLMENT_PATH = '/account/profile?enrol=two-factor'
export const TWO_FACTOR_REQUIRED_MESSAGE = 'فعّل التحقق بخطوتين لحسابك قبل استخدام صلاحيات الإدارة.'

/**
 * Whether the user is an administrator (manage all) who has not enrolled while the
 * system requires it. The one rule behind every administrator gate: /admin/*, the
 * sessions screen, minting API tokens, bearer API calls and MCP. Cheapest checks
 * first; pass `administrator` when the caller already knows it.
 */
export async function twoFactorRequirementUnmet(
  userId: number,
  { administrator }: { administrator?: boolean } = {}
) {
  if (!(await twoFactorRequiredForAdministrators())) return false
  if (await twoFactorEnabled(userId)) return false
  if (administrator !== undefined) return administrator
  // Imported lazily: the admin middleware imports this module for enforcement.
  const { isAdministrator } = await import('#middleware/admin_middleware')
  return isAdministrator(userId)
}

/** JSON 403 E_TWO_FACTOR_REQUIRED, or a flash and a redirect to the enrolment Dialog. */
export function refuseTwoFactorRequired(
  ctx: HttpContext,
  { json = false, message = TWO_FACTOR_REQUIRED_MESSAGE }: { json?: boolean; message?: string } = {}
) {
  if (json || ctx.request.accepts(['html', 'json']) === 'json')
    return ctx.response.forbidden({ error: { code: 'E_TWO_FACTOR_REQUIRED', message } })
  ctx.session.flash('error', message)
  return ctx.response.redirect().toPath(ENROLMENT_PATH)
}

/** The profile page's two-factor block; `required` drives the forced enrolment prompt. */
export async function profileTwoFactor(userId: number) {
  // Imported lazily: the admin middleware imports this module for enforcement.
  const { isAdministrator } = await import('#middleware/admin_middleware')
  const { enabled, pending, recoveryRemaining } = await twoFactorStatus(userId)
  const required = (await twoFactorRequiredForAdministrators()) && (await isAdministrator(userId))
  return { enabled, pending, recoveryRemaining, required }
}

/** One code attempt counted against the account-wide ceiling before the code is checked. */
export type AccountAttempt = { allowed: boolean; consumed: number; availableIn: number }

/**
 * Counts a code attempt against the per-account ceiling (20 per hour across addresses)
 * before verification, atomically in the limiter store, so concurrent requests cannot
 * all pass a stale check. Over the ceiling the code must not be checked.
 */
export async function reserveAccountAttempt(userId: number): Promise<AccountAttempt> {
  const state = await twoFactorAccountLimiter.increment(twoFactorAccountKey(userId))
  return {
    allowed: state.consumed <= TWO_FACTOR_ACCOUNT_LIMIT,
    consumed: state.consumed,
    availableIn: state.availableIn,
  }
}

/**
 * Settles a reserved attempt: a valid code gives its unit back (only failures count
 * toward the ceiling); the failure that reaches the ceiling blocks the account for an
 * hour and is logged.
 */
export async function settleAccountAttempt(
  ctx: HttpContext,
  userId: number,
  attempt: AccountAttempt,
  passed: boolean
) {
  const key = twoFactorAccountKey(userId)
  if (passed) {
    await twoFactorAccountLimiter.decrement(key)
    return
  }
  if (attempt.consumed === TWO_FACTOR_ACCOUNT_LIMIT) {
    await twoFactorAccountLimiter.block(key, '1 hour')
    await logAuthActivity({
      userId,
      action: 'two_factor_locked',
      changes: { ...requestContext(ctx), scope: 'account', minutes: 60 },
    })
  }
}

/** Arabic refusal while code attempts are locked. */
export const lockedMessage = (seconds: number) =>
  `تجاوزت محاولات رمز التحقق الفاشلة. حاول بعد ${Math.max(1, Math.ceil(seconds / 60))} دقيقة.`
