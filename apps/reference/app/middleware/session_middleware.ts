import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import SessionMiddleware from '@adonisjs/session/session_middleware'

/**
 * AdonisJS's session middleware, keeping flash messages for the page they belong to.
 *
 * Every request takes the flash messages out of the session when it starts and writes the
 * session back when it ends. A background JSON read (a dialog's related lists, a view fetched
 * ahead of a click) that the server answers between a write and its redirect took the write's
 * message and wrote the session back without it: the page never showed «تم تعيين كل الإشعارات
 * كمقروءة». Such a read cannot show a message, so when taking the messages was its only change
 * to the session, the session is not written back and the messages stay for the next page; when
 * it changed something else, the session is written as usual, with the messages kept
 * (reflashed).
 *
 * What it never does, by construction (the session is written whenever anything but the taken
 * messages differs):
 * - skip the write of a request that regenerated the session (sign-in, sign-out, rotation),
 *   changed a value (impersonation, a CSRF secret, the intended URL) or flashed a message;
 * - treat a write as a read: only GET and HEAD qualify, by the method the server routed. Accept
 *   and X-Inertia are the client's to set, but a request that misstates them can at most leave
 *   its own pending messages for the next page; it cannot lose a change it made.
 * It does skip, for those reads only, the store's expiry refresh and the cookie's: the next
 * page request refreshes both, and a session with messages waiting gets one at once.
 */
@inject()
export default class FlashKeepingSessionMiddleware {
  constructor(private session: SessionMiddleware<any>) {}

  handle(ctx: HttpContext, next: NextFn) {
    return this.session.handle(ctx, async () => {
      const session = ctx.session
      const background = isBackgroundRead(ctx) && !session.flashMessages.isEmpty
      const before = background ? JSON.stringify(session.all()) : ''
      const response = await next()
      if (!background) return response
      const unchanged =
        !session.hasRegeneratedSession &&
        session.responseFlashMessages.isEmpty &&
        JSON.stringify(session.all()) === before
      if (unchanged) {
        // Nothing of this request's own to keep: the stored session, messages included, stays
        // as it is (AdonisJS's middleware commits through this method once next() returns).
        session.commit = async () => {}
      } else session.reflash()
      return response
    })
  }
}

/** A read for data, not a page: JSON accepted, not an Inertia page visit or partial reload. */
function isBackgroundRead({ request }: HttpContext) {
  const method = request.method()
  return (
    (method === 'GET' || method === 'HEAD') &&
    !request.header('x-inertia') &&
    request.accepts(['html', 'json']) === 'json'
  )
}
