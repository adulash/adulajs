import db from '@adonisjs/lucid/services/db'
import { Secret, TOTP } from 'otpauth'
import { TWO_FACTOR_REQUIRED_KEY, twoFactor } from '#services/two_factor'

const knex = () => db.connection().getWriteClient()

/** The code an authenticator application shows for `secret` at `timestamp`. */
export function totpCode(secret: string, timestamp = Date.now()) {
  return new TOTP({
    secret: Secret.fromBase32(secret),
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  }).generate({ timestamp })
}

/** Enrols a user through the real service, as the profile Dialog would. */
export async function enrolTwoFactor(userId: number, account = `user-${userId}@example.test`) {
  const service = await twoFactor()
  const { secret } = await service.begin(userId, account)
  const recoveryCodes = await service.confirm(userId, totpCode(secret))
  return { secret, recoveryCodes }
}

/**
 * Sets the administrators' two-factor rule (`undefined` removes the key: the default,
 * required) and returns a cleanup that restores the suites' baseline (false, see
 * tests/bootstrap.ts).
 */
export async function requireTwoFactorForAdministrators(value: boolean | undefined) {
  await knex()('settings').where({ key: TWO_FACTOR_REQUIRED_KEY }).delete()
  if (value !== undefined)
    await knex()('settings').insert({ key: TWO_FACTOR_REQUIRED_KEY, value: JSON.stringify(value) })
  return async () => {
    await knex()('settings').where({ key: TWO_FACTOR_REQUIRED_KEY }).delete()
    await knex()('settings').insert({ key: TWO_FACTOR_REQUIRED_KEY, value: JSON.stringify(false) })
  }
}
