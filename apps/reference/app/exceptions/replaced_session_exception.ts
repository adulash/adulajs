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
 * - A JSON read gets 409 E_SESSION_REPLACED; a page load a short Arabic page that reloads
 *   it on request (by then the browser has the new cookie, which is left as it is).
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
    const url = escapeHtml(request.url(true))
    return response
      .status(409)
      .header('Content-Type', 'text/html; charset=utf-8')
      .send(
        `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">` +
          `<meta name="viewport" content="width=device-width, initial-scale=1">` +
          `<title>${error.message}</title></head><body style="font-family: system-ui, sans-serif; margin: 3rem auto; max-width: 32rem; padding: 0 1rem">` +
          `<p>${error.message}</p><p><a href="${url}">أعد تحميل الصفحة</a></p></body></html>`
      )
  }
}

function escapeHtml(text: string) {
  return text.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!
  )
}
