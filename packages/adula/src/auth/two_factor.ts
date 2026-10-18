import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import type { Knex } from 'knex'
import { Secret, TOTP } from 'otpauth'
import { AdulaError } from '../admin/errors.js'
import type { SecretBox } from '../integrations/webhooks.js'

/** Two-factor state of one user as shown to the user or an administrator; never secrets. */
export type TwoFactorStatus = {
  enabled: boolean
  /** Enrolment begun but not yet confirmed with a code. */
  pending: boolean
  enabledAt: string | null
  /** Unused recovery codes; zero while disabled. */
  recoveryRemaining: number
}

/** What the authenticator application needs; returned once by `begin`. */
export type TwoFactorEnrolment = {
  otpauthUrl: string
  /** Base32 secret for manual entry. */
  secret: string
  issuer: string
  account: string
}

/** How a second factor was proven, or false. */
export type TwoFactorResult = 'totp' | 'recovery' | false

export type TwoFactorOptions = {
  /** Clock in milliseconds; tests pass a fixed one. */
  now?: () => number
}

export type TwoFactorVerifyOptions = {
  /** Accept a recovery code as well as a TOTP code (default true). */
  allowRecovery?: boolean
}

/** RFC 6238 parameters understood by every common authenticator application. */
export const TWO_FACTOR_PERIOD = 30
export const TWO_FACTOR_DIGITS = 6
export const TWO_FACTOR_WINDOW = 1
/** 160-bit shared secret (RFC 4226 recommendation). */
const SECRET_BYTES = 20
export const RECOVERY_CODE_COUNT = 10
/** Crockford base32: no I, L, O or U, so codes read aloud and typed by hand stay unambiguous. */
const RECOVERY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
/** 20 symbols of 5 bits each: 100 bits of entropy per code. */
const RECOVERY_LENGTH = 20
const RECOVERY_GROUP = 5
const SALT_BYTES = 16
const MAX_INPUT = 64

/** Error code when the stored secret cannot be opened with the current encryption keys. */
export const TWO_FACTOR_UNREADABLE = 'E_TWO_FACTOR_UNREADABLE'

const TOTP_FORMAT = new RegExp(`^\\d{${TWO_FACTOR_DIGITS}}$`)

/** Strips separators and maps look-alike characters the way Crockford base32 does. */
export function normalizeRecoveryCode(code: string) {
  return code.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
}

function generateRecoveryCode() {
  let raw = ''
  for (let index = 0; index < RECOVERY_LENGTH; index++)
    raw += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)]
  return raw.match(new RegExp(`.{${RECOVERY_GROUP}}`, 'g'))!.join('-')
}

const hashRecoveryCode = (salt: Buffer, normalized: string) =>
  createHash('sha256').update(salt).update(normalized, 'utf8').digest()

const iso = (value: unknown) =>
  value instanceof Date ? value.toISOString() : value ? String(value) : null

/**
 * TOTP two-factor authentication (RFC 6238: SHA-1, 6 digits, 30 s, ±1 step) with
 * single-use recovery codes.
 *
 * - The shared secret is sealed at rest through the host's encryption service.
 * - A time step is accepted at most once, and never one older than the last accepted
 *   one, under a row lock: an observed code cannot be replayed.
 * - Recovery codes carry 100 bits of entropy, are stored as SHA-256 over a unique
 *   16-byte salt and the normalised code, compared in constant time, and consumed
 *   atomically (`used_at is null` guard), so each works once.
 *
 * Hosts rate-limit and lock verification, require the password before disabling,
 * and audit every change.
 */
export class TwoFactor {
  private now: () => number

  constructor(
    private db: Knex,
    private secrets: SecretBox,
    private issuer: string,
    options: TwoFactorOptions = {}
  ) {
    this.now = options.now ?? Date.now
  }

  async status(userId: number): Promise<TwoFactorStatus> {
    const row = await this.db('user_two_factor').where('user_id', userId).first()
    const enabled = Boolean(row?.enabled_at)
    return {
      enabled,
      pending: Boolean(row && !row.enabled_at),
      enabledAt: enabled ? iso(row.enabled_at) : null,
      recoveryRemaining: enabled ? await this.recoveryRemaining(userId) : 0,
    }
  }

  async isEnabled(userId: number) {
    const row = await this.db('user_two_factor')
      .where('user_id', userId)
      .whereNotNull('enabled_at')
      .first('user_id')
    return Boolean(row)
  }

  async recoveryRemaining(userId: number, client: Knex = this.db) {
    const [row] = await client('user_two_factor_recovery_codes')
      .where('user_id', userId)
      .whereNull('used_at')
      .count('* as count')
    return Number(row?.count ?? 0)
  }

  /** Starts (or restarts) a pending enrolment with a fresh secret; refused while enabled. */
  async begin(userId: number, account: string): Promise<TwoFactorEnrolment> {
    return this.db.transaction(async (trx) => {
      const existing = await trx('user_two_factor').where('user_id', userId).forUpdate().first()
      if (existing?.enabled_at)
        throw new AdulaError(409, 'E_TWO_FACTOR_ENABLED', 'التحقق بخطوتين مفعّل بالفعل')
      const secret = new Secret({ size: SECRET_BYTES }).base32
      await trx('user_two_factor')
        .insert({ user_id: userId, secret: this.secrets.seal(secret) })
        .onConflict('user_id')
        .merge({
          secret: this.secrets.seal(secret),
          last_used_step: null,
          enabled_at: null,
          updated_at: trx.fn.now(),
        })
      await trx('user_two_factor_recovery_codes').where('user_id', userId).delete()
      return {
        otpauthUrl: this.totp(secret, account).toString(),
        secret,
        issuer: this.issuer,
        account,
      }
    })
  }

  /** Confirms a pending enrolment with a current code; returns the recovery codes once. */
  async confirm(userId: number, code: unknown): Promise<string[]> {
    return this.db.transaction(async (trx) => {
      const row = await trx('user_two_factor').where('user_id', userId).forUpdate().first()
      if (!row || row.enabled_at)
        throw new AdulaError(409, 'E_TWO_FACTOR_NOT_PENDING', 'ابدأ تفعيل التحقق بخطوتين أولاً')
      const step = this.match(this.open(row.secret), code)
      if (step === null) throw new AdulaError(422, 'E_TWO_FACTOR_CODE', 'رمز التحقق غير صحيح')
      await trx('user_two_factor').where('user_id', userId).update({
        enabled_at: trx.fn.now(),
        last_used_step: step,
        updated_at: trx.fn.now(),
      })
      return this.replaceRecoveryCodes(trx, userId)
    })
  }

  /**
   * Verifies a TOTP code, or consumes a recovery code when allowed. Returns how the
   * factor was proven, or false for anything else (disabled, malformed, wrong, replayed).
   */
  async verify(
    userId: number,
    code: unknown,
    options: TwoFactorVerifyOptions = {}
  ): Promise<TwoFactorResult> {
    if (typeof code !== 'string' || code.length > MAX_INPUT) return false
    return this.db.transaction(async (trx) => {
      const row = await trx('user_two_factor').where('user_id', userId).forUpdate().first()
      if (!row?.enabled_at) return false
      const step = this.match(this.open(row.secret), code)
      if (step !== null) {
        const last = row.last_used_step === null ? null : Number(row.last_used_step)
        if (last !== null && step <= last) return false
        await trx('user_two_factor')
          .where('user_id', userId)
          .update({ last_used_step: step, updated_at: trx.fn.now() })
        return 'totp'
      }
      if (options.allowRecovery === false) return false
      return (await this.consumeRecoveryCode(trx, userId, code)) ? 'recovery' : false
    })
  }

  /** Replaces every recovery code; callers verify a current code first. */
  async regenerateRecoveryCodes(userId: number): Promise<string[]> {
    return this.db.transaction(async (trx) => {
      const row = await trx('user_two_factor')
        .where('user_id', userId)
        .whereNotNull('enabled_at')
        .forUpdate()
        .first()
      if (!row) throw new AdulaError(409, 'E_TWO_FACTOR_NOT_ENABLED', 'التحقق بخطوتين غير مفعّل')
      return this.replaceRecoveryCodes(trx, userId)
    })
  }

  /**
   * Removes the authenticator and every recovery code (self-service disable or an
   * administrator's reset). Returns what was removed.
   */
  async disable(userId: number) {
    return this.db.transaction(async (trx) => {
      const removed = await trx('user_two_factor').where('user_id', userId).delete()
      const codes = await trx('user_two_factor_recovery_codes').where('user_id', userId).delete()
      return { removed: Number(removed) > 0, recoveryCodes: Number(codes) }
    })
  }

  /** Alias of `disable` for administrative resets. */
  reset(userId: number) {
    return this.disable(userId)
  }

  private async replaceRecoveryCodes(trx: Knex.Transaction, userId: number) {
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode)
    await trx('user_two_factor_recovery_codes').where('user_id', userId).delete()
    await trx('user_two_factor_recovery_codes').insert(
      codes.map((code) => {
        const salt = randomBytes(SALT_BYTES)
        return {
          user_id: userId,
          salt: salt.toString('hex'),
          code_hash: hashRecoveryCode(salt, normalizeRecoveryCode(code)).toString('hex'),
        }
      })
    )
    return codes
  }

  private async consumeRecoveryCode(trx: Knex.Transaction, userId: number, code: string) {
    const normalized = normalizeRecoveryCode(code)
    if (normalized.length !== RECOVERY_LENGTH) return false
    const rows: { id: number; salt: string; code_hash: string }[] = await trx(
      'user_two_factor_recovery_codes'
    )
      .where('user_id', userId)
      .whereNull('used_at')
      .select('id', 'salt', 'code_hash')
    // Every unused code is compared, so timing does not reveal which one matched.
    let matched: number | null = null
    for (const row of rows) {
      const stored = Buffer.from(row.code_hash, 'hex')
      const candidate = hashRecoveryCode(Buffer.from(row.salt, 'hex'), normalized)
      if (stored.length === candidate.length && timingSafeEqual(stored, candidate)) matched = row.id
    }
    if (matched === null) return false
    const used = await trx('user_two_factor_recovery_codes')
      .where({ id: matched })
      .whereNull('used_at')
      .update({ used_at: trx.fn.now() })
      .returning('id')
    return used.length === 1
  }

  private totp(secret: string, account: string) {
    return new TOTP({
      issuer: this.issuer,
      label: account,
      algorithm: 'SHA1',
      digits: TWO_FACTOR_DIGITS,
      period: TWO_FACTOR_PERIOD,
      secret: Secret.fromBase32(secret),
    })
  }

  /**
   * A secret sealed under a key the host no longer holds (an APP_KEY rotated without
   * keeping the old one) is a handled refusal, never a crash and never a match.
   */
  private open(sealed: string) {
    let secret: string | null = null
    try {
      secret = this.secrets.open(sealed)
    } catch {
      secret = null
    }
    if (!secret)
      throw new AdulaError(
        503,
        TWO_FACTOR_UNREADABLE,
        'تعذّر قراءة إعداد التحقق بخطوتين لهذا الحساب. تواصل مع مدير النظام.'
      )
    return secret
  }

  /** The absolute time step of a valid code within the window, or null. */
  private match(secret: string, code: unknown) {
    if (typeof code !== 'string') return null
    const token = code.replace(/\s/g, '')
    if (!TOTP_FORMAT.test(token)) return null
    const timestamp = this.now()
    const delta = this.totp(secret, 'account').validate({
      token,
      timestamp,
      window: TWO_FACTOR_WINDOW,
    })
    if (delta === null) return null
    return Math.floor(timestamp / 1000 / TWO_FACTOR_PERIOD) + delta
  }
}
