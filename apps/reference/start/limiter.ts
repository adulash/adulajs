/*
|--------------------------------------------------------------------------
| Define HTTP limiters
|--------------------------------------------------------------------------
|
| The "limiter.define" method creates an HTTP middleware to apply rate
| limits on a route or a group of routes. Authentication endpoints are
| keyed by IP (login also by e-mail); resource and MCP endpoints by user.
|
*/

import env from '#start/env'
import limiter from '@adonisjs/limiter/services/main'
import type { HttpContext } from '@adonisjs/core/http'
import { trustedProxy } from '#config/app'
import { isDirectProxyRequest } from '#services/trusted_proxies'

const message = 'محاولات كثيرة في وقت قصير. انتظر دقيقة ثم حاول مجدداً.'
const withMessage = (error: { setMessage(value: string): unknown }) => {
  error.setMessage(message)
}
const emailOf = (ctx: HttpContext) =>
  String(ctx.request.input('email', '') ?? '')
    .trim()
    .toLowerCase()

/** Login: 5 attempts per minute for one e-mail from one address. */
export const loginThrottle = limiter.define('login', (ctx) =>
  limiter
    .allowRequests(5)
    .every('1 minute')
    .usingKey(`${ctx.request.ip()}:${emailOf(ctx)}`)
    .limitExceeded(withMessage)
)

/**
 * Login attempts per minute from one address across all e-mails (password spraying).
 * Offices behind one public address share it, so it stays well above a team's
 * morning sign-in; per-account lockout below limits guessing independently.
 */
export const LOGIN_ADDRESS_LIMIT = env.get('LOGIN_ADDRESS_LIMIT', 100)
export const loginAddressThrottle = limiter.define('login_address', (ctx) =>
  limiter
    .allowRequests(LOGIN_ADDRESS_LIMIT)
    .every('1 minute')
    .usingKey(ctx.request.ip())
    .limitExceeded(withMessage)
)

/**
 * Login: failed attempts per account and address. Only failures count and a success
 * clears the counter; the controller applies it with `penalize`. Keying by address
 * too means a stranger's guesses cannot lock the owner out from their own device.
 */
export const loginAccountLimiter = limiter.use({
  requests: 5,
  duration: '15 minutes',
  blockDuration: '1 minute',
})
/** Lockouts of one account and address within a day; each one doubles the wait. */
export const loginLockoutLimiter = limiter.use({ requests: 1000, duration: '24 hours' })
/** Waits after consecutive lockouts: 1, 2, 4 … minutes, capped at one hour. */
export const LOCKOUT_MAX_MINUTES = 60
export const lockoutMinutes = (lockouts: number) =>
  Math.min(2 ** Math.max(lockouts - 1, 0), LOCKOUT_MAX_MINUTES)
export const loginAccountKey = (email: string, ip: string) => `login_account:${email}:${ip}`

/** Public health probe: 60 per minute per address, ample for orchestrators polling it. */
export const HEALTH_LIMIT = 60
export const healthThrottle = limiter.define('health', (ctx) =>
  // The reverse proxy's own probe (trusted peer, nothing forwarded) is never starved
  // by clients; relayed requests always carry X-Forwarded-For and are throttled.
  isDirectProxyRequest(ctx.request.request, trustedProxy)
    ? limiter.noLimit()
    : limiter
        .allowRequests(HEALTH_LIMIT)
        .every('1 minute')
        .usingKey(ctx.request.ip())
        .limitExceeded(withMessage)
)

/** Password change: 5 attempts per minute per signed-in user. */
export const passwordChangeThrottle = limiter.define('password_change', (ctx) =>
  limiter
    .allowRequests(5)
    .every('1 minute')
    .usingKey(`user:${ctx.auth.user?.id ?? ctx.request.ip()}`)
    .limitExceeded(withMessage)
)

/** Signup: 3 accounts per minute per address. */
export const signupThrottle = limiter.define('signup', (ctx) =>
  limiter.allowRequests(3).every('1 minute').usingKey(ctx.request.ip()).limitExceeded(withMessage)
)

/** Recovery (forgot + reset): 3 submissions per minute per address. */
export const passwordThrottle = limiter.define('password', (ctx) =>
  limiter.allowRequests(3).every('1 minute').usingKey(ctx.request.ip()).limitExceeded(withMessage)
)

/** OAuth redirects and callbacks: 10 per minute per address. */
export const oauthThrottle = limiter.define('oauth', (ctx) =>
  limiter.allowRequests(10).every('1 minute').usingKey(ctx.request.ip()).limitExceeded(withMessage)
)

/** Resource and MCP routes: 300 requests per minute per authenticated user. */
export const apiThrottle = limiter.define('api', (ctx) =>
  limiter
    .allowRequests(300)
    .every('1 minute')
    .usingKey(ctx.auth.user ? `user:${ctx.auth.user.id}` : `ip:${ctx.request.ip()}`)
    .limitExceeded(withMessage)
)

/** Signed inbound webhooks: 300 deliveries per minute per source and sender address. */
export const inboundThrottle = limiter.define('inbound_webhooks', (ctx) =>
  limiter
    .allowRequests(300)
    .every('1 minute')
    .usingKey(`${String(ctx.params.source)}:${ctx.request.ip()}`)
    .limitExceeded(withMessage)
)

/** Inbound webhooks per sender address across all sources, so path keys cannot be rotated. */
export const inboundAddressThrottle = limiter.define('inbound_webhooks_address', (ctx) =>
  limiter.allowRequests(600).every('1 minute').usingKey(ctx.request.ip()).limitExceeded(withMessage)
)

/**
 * Second-factor codes: failed attempts per account and address, with the login rules
 * (5 failures in 15 minutes, then escalating blocks of `lockoutMinutes` tracked by
 * `loginLockoutLimiter` under `twoFactorLockoutKey`). Only failures count.
 */
export const twoFactorAttemptLimiter = limiter.use({ requests: 5, duration: '15 minutes' })
export const twoFactorAttemptKey = (userId: number, ip: string) => `two_factor:${userId}:${ip}`
export const twoFactorLockoutKey = (userId: number, ip: string) =>
  `two_factor_lockout:${userId}:${ip}`
/**
 * Second-factor failures per account across all addresses. The attacker already holds
 * the password, so rotating addresses must not multiply guesses; a success does not reset it.
 */
export const TWO_FACTOR_ACCOUNT_LIMIT = 20
export const twoFactorAccountLimiter = limiter.use({
  requests: TWO_FACTOR_ACCOUNT_LIMIT,
  duration: '1 hour',
})
export const twoFactorAccountKey = (userId: number) => `two_factor_account:${userId}`

/** Second-factor submissions: 10 per minute per address (beside the address-wide login cap). */
export const twoFactorThrottle = limiter.define('two_factor', (ctx) =>
  limiter.allowRequests(10).every('1 minute').usingKey(ctx.request.ip()).limitExceeded(withMessage)
)

/** Phone confirmation codes cost a message each: 3 per 15 minutes per signed-in user. */
export const channelCodeThrottle = limiter.define('channel_code', (ctx) =>
  limiter
    .allowRequests(3)
    .every('15 minutes')
    .usingKey(`user:${ctx.auth.user?.id ?? ctx.request.ip()}`)
    .limitExceeded(withMessage)
)

/** Confirming a code and saving channel choices: 10 per 15 minutes per signed-in user. */
export const channelChangeThrottle = limiter.define('channel_change', (ctx) =>
  limiter
    .allowRequests(10)
    .every('15 minutes')
    .usingKey(`user:${ctx.auth.user?.id ?? ctx.request.ip()}`)
    .limitExceeded(withMessage)
)

/** Provider test messages from the settings screen: 5 per 15 minutes per administrator. */
export const channelTestThrottle = limiter.define('channel_test', (ctx) =>
  limiter
    .allowRequests(5)
    .every('15 minutes')
    .usingKey(`user:${ctx.auth.user?.id ?? ctx.request.ip()}`)
    .limitExceeded(withMessage)
)

/** Disabling 2FA and regenerating recovery codes: 5 per 15 minutes per signed-in user. */
export const twoFactorManageThrottle = limiter.define('two_factor_manage', (ctx) =>
  limiter
    .allowRequests(5)
    .every('15 minutes')
    .usingKey(`user:${ctx.auth.user?.id ?? ctx.request.ip()}`)
    .limitExceeded(withMessage)
)
