import type { HttpContext } from '@adonisjs/core/http'
import { SettingsAdmin } from 'adula'
import { actorId, knex, mutate } from './support.js'
import { authenticationSettingsValidator } from '#validators/authentication_settings'
import {
  DISABLED_PROVIDERS_KEY,
  disabledProviders,
  providerStatuses,
} from '#services/social_accounts'
import { TWO_FACTOR_REQUIRED_KEY, twoFactorRequiredForAdministrators } from '#services/two_factor'

/** The authentication block of the administration settings page. */
export async function authenticationSettings() {
  return {
    providers: await providerStatuses(),
    // Absent = required (app/services/two_factor.ts).
    twoFactorRequiredForAdministrators: await twoFactorRequiredForAdministrators(),
  }
}

export default class AuthenticationSettingsController {
  /**
   * Writes both keys in one transaction. SettingsAdmin records each change in
   * the activity log (resource core.settings) with the administrator as actor.
   */
  async update(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(authenticationSettingsValidator)
    // An unconfigured provider has no switch on the screen, so a body that omits it says
    // nothing about it: an earlier "disabled" is kept, and the provider stays off once
    // credentials are added. Configured providers follow the body exactly.
    const statuses = await providerStatuses()
    const unconfigured = new Set(statuses.filter((p) => !p.configured).map((p) => p.name))
    const previous = await disabledProviders()
    const kept = previous.filter(
      (name) => unconfigured.has(name) && !input.disabledProviders.includes(name)
    )
    const disabled = [...input.disabledProviders, ...kept]
    return mutate(
      ctx,
      async () => {
        await knex().transaction(async (trx) => {
          const admin = new SettingsAdmin(trx)
          await admin.upsert(actorId(ctx), {
            key: DISABLED_PROVIDERS_KEY,
            scope: 'system',
            value: disabled,
          })
          await admin.upsert(actorId(ctx), {
            key: TWO_FACTOR_REQUIRED_KEY,
            scope: 'system',
            value: input.twoFactorRequiredForAdministrators,
          })
        })
        return authenticationSettings()
      },
      'تم حفظ إعدادات الدخول',
      '/admin/settings'
    )
  }
}
