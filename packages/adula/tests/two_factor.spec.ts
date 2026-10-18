import { test } from '@japa/runner'
import { Secret, TOTP } from 'otpauth'
import {
  AdulaError,
  TwoFactor,
  normalizeRecoveryCode,
  RECOVERY_CODE_COUNT,
  TWO_FACTOR_UNREADABLE,
} from '../index.js'
import type { SecretBox } from '../index.js'
import { db, setup } from './helpers.js'

/** A reversible test box; production passes the framework's authenticated encryption. */
const box: SecretBox = {
  seal: (value) => `sealed:${Buffer.from(value).toString('base64')}`,
  open: (value) =>
    value.startsWith('sealed:') ? Buffer.from(value.slice(7), 'base64').toString() : null,
}
const T0 = Date.UTC(2026, 9, 18, 12, 0, 0)
const USER = 1

async function failure(run: () => Promise<unknown>): Promise<AdulaError> {
  try {
    await run()
  } catch (error) {
    if (error instanceof AdulaError) return error
    throw error
  }
  throw new Error('Expected an AdulaError')
}

const codeAt = (secret: string, timestamp: number) =>
  new TOTP({
    secret: Secret.fromBase32(secret),
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  }).generate({ timestamp })

test.group('Two-factor authentication (TOTP)', (group) => {
  let clock = T0
  const service = () => new TwoFactor(db, box, 'AdulaJS', { now: () => clock })

  group.setup(() => setup())
  group.each.setup(async () => {
    clock = T0
    await db('user_two_factor_recovery_codes').del()
    await db('user_two_factor').del()
  })

  async function enrol() {
    const enrolment = await service().begin(USER, 'admin@example.test')
    const codes = await service().confirm(USER, codeAt(enrolment.secret, clock))
    return { secret: enrolment.secret, codes }
  }

  test('enrolment seals a 160-bit secret and needs a valid code to enable', async ({ assert }) => {
    const enrolment = await service().begin(USER, 'admin@example.test')
    assert.equal(Secret.fromBase32(enrolment.secret).bytes.length, 20)
    assert.match(enrolment.otpauthUrl, /^otpauth:\/\/totp\/AdulaJS:admin%40example\.test\?/)
    assert.include(enrolment.otpauthUrl, 'algorithm=SHA1&digits=6&period=30')
    const row = await db('user_two_factor').where('user_id', USER).first()
    assert.notInclude(row.secret, enrolment.secret)
    assert.equal(box.open(row.secret), enrolment.secret)
    assert.deepInclude(await service().status(USER), { enabled: false, pending: true })

    const wrong = await failure(() => service().confirm(USER, '000000'))
    assert.equal(wrong.code, 'E_TWO_FACTOR_CODE')
    assert.equal(wrong.status, 422)
    const codes = await service().confirm(USER, codeAt(enrolment.secret, clock))
    assert.lengthOf(codes, RECOVERY_CODE_COUNT)
    const status = await service().status(USER)
    assert.isTrue(status.enabled)
    assert.isFalse(status.pending)
    assert.equal(status.recoveryRemaining, 10)
    assert.isString(status.enabledAt)

    const again = await failure(() => service().begin(USER, 'admin@example.test'))
    assert.equal(again.code, 'E_TWO_FACTOR_ENABLED')
    assert.equal(again.status, 409)
    const confirmed = await failure(() => service().confirm(USER, codeAt(enrolment.secret, clock)))
    assert.equal(confirmed.code, 'E_TWO_FACTOR_NOT_PENDING')
  })

  test('a time step is accepted once and never an older one; the window is one step', async ({
    assert,
  }) => {
    const { secret } = await enrol()
    // The confirmation consumed the current step.
    assert.isFalse(await service().verify(USER, codeAt(secret, clock)))
    clock += 30_000
    const next = codeAt(secret, clock)
    assert.equal(await service().verify(USER, next), 'totp')
    assert.isFalse(await service().verify(USER, next))
    // One step ahead is inside the window; the previous step is older than the last accepted.
    assert.equal(await service().verify(USER, codeAt(secret, clock + 30_000)), 'totp')
    assert.isFalse(await service().verify(USER, next))
    assert.isFalse(await service().verify(USER, codeAt(secret, clock - 30_000)))
    // Two steps away is outside the window.
    clock += 90_000
    assert.isFalse(await service().verify(USER, codeAt(secret, clock + 60_000)))
    assert.isFalse(await service().verify(USER, codeAt(secret, clock - 60_000)))
    assert.equal(await service().verify(USER, codeAt(secret, clock)), 'totp')
    assert.isFalse(await service().verify(USER, 'abcdef'))
    assert.isFalse(await service().verify(USER, 123456))
    assert.isFalse(await service().verify(USER, '1'.repeat(200)))
  })

  test('concurrent verification of one code succeeds once', async ({ assert }) => {
    const { secret } = await enrol()
    clock += 30_000
    const code = codeAt(secret, clock)
    const results = await Promise.all([1, 2, 3, 4].map(() => service().verify(USER, code)))
    assert.equal(results.filter((result) => result === 'totp').length, 1)
  })

  test('recovery codes have 100 bits, are salted SHA-256 hashes and work once', async ({
    assert,
  }) => {
    const { codes } = await enrol()
    for (const code of codes)
      assert.match(code, /^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){3}$/)
    assert.lengthOf(new Set(codes), codes.length)
    const rows = await db('user_two_factor_recovery_codes').where('user_id', USER)
    assert.lengthOf(rows, 10)
    assert.lengthOf(new Set(rows.map((row) => row.salt)), 10)
    for (const row of rows) {
      assert.lengthOf(row.salt, 32)
      assert.lengthOf(row.code_hash, 64)
      for (const code of codes) assert.notInclude(row.code_hash, normalizeRecoveryCode(code))
    }

    // Lower case, no separators and spaces are accepted; look-alikes map to digits.
    const typed = codes[0].toLowerCase().replace(/-/g, ' ')
    assert.equal(await service().verify(USER, typed), 'recovery')
    assert.isFalse(await service().verify(USER, codes[0]))
    assert.isFalse(await service().verify(USER, codes[1], { allowRecovery: false }))
    assert.equal(await service().recoveryRemaining(USER), 9)

    const concurrent = await Promise.all([1, 2, 3].map(() => service().verify(USER, codes[2])))
    assert.equal(concurrent.filter((result) => result === 'recovery').length, 1)
    assert.equal(await service().recoveryRemaining(USER), 8)
  })

  test('regeneration replaces every code; disable removes all state', async ({ assert }) => {
    const { codes } = await enrol()
    const fresh = await service().regenerateRecoveryCodes(USER)
    assert.lengthOf(fresh, 10)
    assert.isFalse(await service().verify(USER, codes[0]))
    assert.equal(await service().verify(USER, fresh[0]), 'recovery')

    assert.deepEqual(await service().disable(USER), { removed: true, recoveryCodes: 10 })
    assert.deepEqual(await service().status(USER), {
      enabled: false,
      pending: false,
      enabledAt: null,
      recoveryRemaining: 0,
    })
    assert.isFalse(await service().verify(USER, fresh[1]))
    const regenerate = await failure(() => service().regenerateRecoveryCodes(USER))
    assert.equal(regenerate.code, 'E_TWO_FACTOR_NOT_ENABLED')
    assert.deepEqual(await service().reset(USER), { removed: false, recoveryCodes: 0 })
  })

  test('a secret sealed under another key is never accepted', async ({ assert }) => {
    await enrol()
    await db('user_two_factor').where('user_id', USER).update({ secret: 'foreign' })
    // A handled refusal (503 with a code), not a crash; status still renders.
    const refused = await failure(() => service().verify(USER, '123456'))
    assert.equal(refused.status, 503)
    assert.equal(refused.code, TWO_FACTOR_UNREADABLE)
    assert.include(refused.message, 'مدير النظام')
    const status = await service().status(USER)
    assert.isTrue(status.enabled)
    assert.equal(status.recoveryRemaining, RECOVERY_CODE_COUNT)
    // A box that throws (malformed ciphertext) is refused the same way.
    const throwing = new TwoFactor(
      db,
      {
        ...box,
        open: () => {
          throw new Error('bad ciphertext')
        },
      },
      'AdulaJS',
      { now: () => clock }
    )
    const thrown = await failure(() => throwing.verify(USER, '123456'))
    assert.equal(thrown.code, TWO_FACTOR_UNREADABLE)
  })
})
