import { Exception } from '@adonisjs/core/exceptions'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * A request carried a session id that a rotation replaced moments ago (sign-in, starting or
 * ending impersonation): the browser sent it before the new cookie arrived. It is answered
 * without the session being written or its cookie set, so the browser keeps the new one.
 *
 * - An Inertia request gets a 409 location visit to its own URL, marked with a version that is
 *   not the page's: Inertia ignores that answer for an async reload (a deferred prop, a bell
 *   refresh) and reloads the page, with the current cookie, for a visit.
 * - A JSON read gets 409 E_SESSION_REPLACED; anything else a plain 409.
 */
export default class ReplacedSessionException extends Exception {
  static status = 409
  static code = 'E_SESSION_REPLACED'
  static message = 'تغيّرت جلستك؛ أعد المحاولة'

  async handle(error: this, { request, response }: HttpContext) {
    if (request.header('x-inertia')) {
      return response
        .status(409)
        .header('X-Inertia-Location', request.url(true))
        .header('X-Inertia-Version', 'session-replaced')
        .send('')
    }
    if (request.accepts(['html', 'json']) === 'json')
      return response.status(409).send({ code: error.code, message: error.message })
    return response.status(409).send(error.message)
  }
}
