import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { HttpContext } from '@adonisjs/core/http'
import { Exception } from '@adonisjs/core/exceptions'
import { Oauth2Driver } from '@adonisjs/ally'
import type {
  AllyUserContract,
  ApiRequestContract,
  Oauth2AccessToken,
  Oauth2DriverConfig,
  RedirectRequestContract,
} from '@adonisjs/ally/types'

/** The issuer authority of Entra ID tokens. Never configurable: it pins whom tokens come from. */
export const MICROSOFT_ISSUER_AUTHORITY = 'https://login.microsoftonline.com'
/** The tenant of personal Microsoft accounts (MSA). */
export const MICROSOFT_CONSUMER_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad'

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
/** Accepted clock difference when checking exp, nbf and iat. */
const CLOCK_SKEW_SECONDS = 120

export type MicrosoftScopes = 'openid' | 'profile' | 'email' | 'offline_access' | 'User.Read'

export type MicrosoftDriverConfig = Oauth2DriverConfig & {
  /**
   * A tenant GUID (recommended: only that directory signs in, and its e-mail
   * claims count as verified), or `organizations`, `common` or `consumers`.
   */
  tenantId: string
  /**
   * Base URL of the authorize and token endpoints. Defaults to the public
   * Entra authority; tests point it at a local server. Issuer validation always
   * uses the public authority.
   */
  authority?: string
  scopes?: MicrosoftScopes[]
  prompt?: 'login' | 'none' | 'consent' | 'select_account'
  disallowLocalSignup?: boolean
}

export type MicrosoftToken = Oauth2AccessToken & { idToken: string }

/** The validated ID token claims this driver relies on. */
export type MicrosoftClaims = {
  iss: string
  aud: string
  exp: number
  nbf?: number
  iat?: number
  nonce: string
  tid: string
  oid: string
  name?: string
  email?: string
  preferred_username?: string
  xms_edov?: boolean
  /** Identity provider of a guest; absent (or the tenant's own issuer) for members. */
  idp?: string
  /** 0 member, 1 guest (optional claim). */
  acct?: number
  [claim: string]: unknown
}

/** The ID token is missing or one of its claims is not acceptable. */
export class MicrosoftIdTokenError extends Exception {
  static status = 401
  static code = 'E_MICROSOFT_ID_TOKEN'
}

function decodeSegment(segment: string | undefined): Record<string, unknown> {
  if (!segment) throw new MicrosoftIdTokenError('Malformed ID token')
  try {
    const value: unknown = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not object')
    return value as Record<string, unknown>
  } catch {
    throw new MicrosoftIdTokenError('Malformed ID token')
  }
}

function sameText(a: string, b: string) {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

/**
 * Microsoft Entra ID (v2.0 endpoints) sign-in through OpenID Connect with the
 * authorization code flow, PKCE (S256), a CSRF state and a nonce, each kept in
 * an encrypted, HTTP-only cookie for the duration of one round trip.
 *
 * The identity comes from the ID token only (no Graph call). The provider id is
 * `${tid}:${oid}`: the object id is unique per directory and never reassigned,
 * unlike e-mail addresses or UPNs.
 */
export class MicrosoftDriver extends Oauth2Driver<MicrosoftToken, MicrosoftScopes> {
  declare config: MicrosoftDriverConfig

  protected stateCookieName = 'microsoft_oauth_state'
  protected codeVerifierCookieName = 'microsoft_oauth_code_verifier'
  protected nonceCookieName = 'microsoft_oauth_nonce'
  protected stateParamName = 'state'
  protected errorParamName = 'error'
  protected codeParamName = 'code'
  protected scopeParamName = 'scope'
  protected scopesSeparator = ' '
  protected authorizeUrl: string
  protected accessTokenUrl: string
  protected nonceCookieValue?: string

  constructor(ctx: HttpContext, config: MicrosoftDriverConfig) {
    super(ctx, config)
    this.config = config
    const authority = (config.authority ?? MICROSOFT_ISSUER_AUTHORITY).replace(/\/+$/, '')
    const tenant = encodeURIComponent(config.tenantId)
    this.authorizeUrl = `${authority}/${tenant}/oauth2/v2.0/authorize`
    this.accessTokenUrl = `${authority}/${tenant}/oauth2/v2.0/token`
    this.loadState()
    this.nonceCookieValue = ctx.request.encryptedCookie(this.nonceCookieName) ?? undefined
    ctx.response.clearCookie(this.nonceCookieName)
  }

  private scopeList() {
    return this.config.scopes ?? ['openid', 'profile', 'email']
  }

  protected configureRedirectRequest(request: RedirectRequestContract<MicrosoftScopes>) {
    request.scopes(this.scopeList())
    request.param('response_type', 'code')
    request.param('response_mode', 'query')
    if (this.config.prompt) request.param('prompt', this.config.prompt)
    const nonce = randomBytes(32).toString('base64url')
    this.ctx.response.encryptedCookie(this.nonceCookieName, nonce, {
      sameSite: false,
      httpOnly: true,
    })
    this.nonceCookieValue = nonce
    request.param('nonce', nonce)
  }

  protected configureAccessTokenRequest(request: ApiRequestContract) {
    request.field('scope', this.scopeList().join(' '))
  }

  accessDenied() {
    return this.getError() === 'access_denied'
  }

  /**
   * A state mismatch also covers a missing nonce cookie: without it the ID
   * token cannot be bound to this browser's request.
   */
  stateMisMatch() {
    return super.stateMisMatch() || !this.nonceCookieValue
  }

  async accessToken(callback?: (request: ApiRequestContract) => void): Promise<MicrosoftToken> {
    const token = await super.accessToken(callback)
    const idToken = (token as unknown as { id_token?: unknown }).id_token
    if (typeof idToken !== 'string' || !idToken)
      throw new MicrosoftIdTokenError('The token response has no ID token')
    return { ...token, idToken }
  }

  /**
   * Validates the ID token claims. The signature is not checked: per OpenID
   * Connect Core 1.0 section 3.1.3.7 step 6, a confidential client that receives
   * the ID token directly from the token endpoint over TLS (this driver posts the
   * code with its client secret to the HTTPS token endpoint and reads the token
   * from that response, never from the browser) may rely on TLS server
   * validation instead of the signature. Never pass this method an ID token that
   * arrived any other way.
   */
  validateIdToken(idToken: string, now = Math.floor(Date.now() / 1000)): MicrosoftClaims {
    const parts = idToken.split('.')
    if (parts.length !== 3) throw new MicrosoftIdTokenError('Malformed ID token')
    decodeSegment(parts[0])
    const claims = decodeSegment(parts[1])
    const tid = claims.tid
    const oid = claims.oid
    if (typeof tid !== 'string' || !GUID.test(tid))
      throw new MicrosoftIdTokenError('ID token without a valid tenant')
    if (typeof oid !== 'string' || !GUID.test(oid))
      throw new MicrosoftIdTokenError('ID token without a valid object id')
    if (claims.iss !== `${MICROSOFT_ISSUER_AUTHORITY}/${tid}/v2.0`)
      throw new MicrosoftIdTokenError('ID token issuer does not match its tenant')
    if (typeof claims.aud !== 'string' || claims.aud !== this.config.clientId)
      throw new MicrosoftIdTokenError('ID token audience is not this application')
    if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_SECONDS < now)
      throw new MicrosoftIdTokenError('ID token expired')
    if (typeof claims.nbf === 'number' && claims.nbf - CLOCK_SKEW_SECONDS > now)
      throw new MicrosoftIdTokenError('ID token not yet valid')
    if (typeof claims.iat === 'number' && claims.iat - CLOCK_SKEW_SECONDS > now)
      throw new MicrosoftIdTokenError('ID token issued in the future')
    const expected = this.nonceCookieValue
    if (!expected || typeof claims.nonce !== 'string' || !sameText(claims.nonce, expected))
      throw new MicrosoftIdTokenError('ID token nonce does not match this request')
    const tenant = this.config.tenantId.toLowerCase()
    if (GUID.test(tenant) && tid.toLowerCase() !== tenant)
      throw new MicrosoftIdTokenError('ID token comes from another tenant')
    if (tenant === 'organizations' && tid.toLowerCase() === MICROSOFT_CONSUMER_TENANT)
      throw new MicrosoftIdTokenError('Personal accounts are not accepted')
    if (tenant === 'consumers' && tid.toLowerCase() !== MICROSOFT_CONSUMER_TENANT)
      throw new MicrosoftIdTokenError('Only personal accounts are accepted')
    return claims as MicrosoftClaims
  }

  /**
   * Entra e-mail claims are editable by tenant administrators and are not
   * proof of mailbox ownership ("nOAuth"). An address counts as verified only
   * when the tenant is the one specific directory this application trusts, or
   * Entra states the domain owner verified it (xms_edov, an optional claim).
   * In the trusted directory only members count: a B2B guest (`acct` 1, or an
   * `idp` claim naming another issuer such as live.com) brings an address that
   * directory never proved, so it is trusted only with xms_edov.
   */
  emailOf(claims: MicrosoftClaims) {
    const email =
      typeof claims.email === 'string' && ADDRESS.test(claims.email)
        ? claims.email
        : typeof claims.preferred_username === 'string' && ADDRESS.test(claims.preferred_username)
          ? claims.preferred_username
          : null
    const tenant = this.config.tenantId.toLowerCase()
    const trustedTenant =
      GUID.test(tenant) && claims.tid.toLowerCase() === tenant && this.isMember(claims)
    const verified = trustedTenant || claims.xms_edov === true
    return {
      email,
      emailVerificationState: verified ? ('verified' as const) : ('unverified' as const),
    }
  }

  /** A member of the token's own directory, not a guest homed elsewhere. */
  private isMember(claims: MicrosoftClaims) {
    if (claims.acct === 1) return false
    if (claims.idp === undefined) return true
    const tid = claims.tid.toLowerCase()
    const own = [`https://sts.windows.net/${tid}/`, `${MICROSOFT_ISSUER_AUTHORITY}/${tid}/v2.0`]
    return typeof claims.idp === 'string' && own.includes(claims.idp.toLowerCase())
  }

  async user(
    callback?: (request: ApiRequestContract) => void
  ): Promise<AllyUserContract<MicrosoftToken>> {
    const token = await this.accessToken(callback)
    const claims = this.validateIdToken(token.idToken)
    const { email, emailVerificationState } = this.emailOf(claims)
    const name = typeof claims.name === 'string' ? claims.name : ''
    return {
      id: `${claims.tid.toLowerCase()}:${claims.oid.toLowerCase()}`,
      nickName: name,
      name,
      email,
      emailVerificationState,
      avatarUrl: null,
      original: claims,
      token,
    }
  }

  /** An access token alone carries no verifiable identity for this application. */
  async userFromToken(): Promise<never> {
    throw new Exception('"userFromToken" is not supported by the Microsoft driver')
  }
}
