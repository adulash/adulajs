import type { HttpContext } from '@adonisjs/core/http'
import { AdulaError } from 'adula'
import { adula } from '#services/adula'
import { activeImpersonation } from '#services/impersonation'

/**
 * The signed-in user's own interface preferences (ADR 049). There is no user id in the
 * address or the body: a user can only read and change their own.
 */
export default class PreferencesController {
  async update(ctx: HttpContext) {
    const userId = this.#owner(ctx)
    const key = String(ctx.params.key)
    const value = await adula().preferences.set(userId, key, ctx.request.input('value'))
    return { data: { key, value } }
  }

  async destroy(ctx: HttpContext) {
    const userId = this.#owner(ctx)
    const key = String(ctx.params.key)
    return { data: { key, value: await adula().preferences.reset(userId, key) } }
  }

  // An administrator acting as another user does not change that person's preferences.
  #owner(ctx: HttpContext) {
    if (activeImpersonation(ctx))
      throw new AdulaError(403, 'E_IMPERSONATING', 'لا يمكن تغيير التفضيلات أثناء انتحال الهوية')
    return ctx.auth.getUserOrFail().id
  }
}
