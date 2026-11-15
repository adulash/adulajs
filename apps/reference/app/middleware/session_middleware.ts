import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import SessionMiddleware from '@adonisjs/session/session_middleware'
import ReplacedSessionException from '#exceptions/replaced_session_exception'
import { endSuccessor, recordRotation, rotationOf, signedOutIn } from '#services/sessions'

/**
 * AdonisJS's session middleware, keeping flash messages for the page they belong to and a
 * rotated session from coming back.
 *
 * Rotation. Signing in and starting or ending impersonation replace the session id. A request
 * the browser sent with the old id and the server answers after the rotation (a deferred prop,
 * the bell, a dialog's view) used to be written back under the old id and hand the browser the
 * old cookie: the next page found the old session ended and signed the user out. The replaced
 * id is recorded before the rotating request's own write, and the old session is never written
 * back nor its cookie set again:
 * - a request arriving with it within a minute of the rotation is refused before its handler
 *   (ReplacedSessionException, 409);
 * - a request already in flight when it rotated (the record changed while its handler ran,
 *   however long that took): a read is refused the same way; a write keeps its own answer (its
 *   redirect, followed with the new cookie), so what it saved is not reported as a failure and
 *   saved twice on a retry; only the session write is skipped. The user's own sign-out sent
 *   just before the rotation (markSignedOut) also ends the session that replaced its own, so
 *   the browser, which by then holds the new cookie, is signed out as the user asked.
 * Only a rotation is recorded: a session an administrator revokes or a sign-out ends is
 * refused as before, and past the minute a replaced id is an ended session like any other.
 *
 * Flash messages.
 * Every request takes the flash messages out of the session when it starts and writes the
 * session back when it ends. A background JSON read (a dialog's related lists, a view fetched
 * ahead of a click) that the server answers between a write and its redirect took the write's
 * message and wrote the session back without it: the page never showed «تم تعيين كل الإشعارات
 * كمقروءة». Such a read cannot show a message, so when taking the messages was its only change
 * to the session, the session is not written back and the messages stay for the next page; when
 * it changed something else, the session is written as usual, with the messages kept
 * (reflashed) unless the read regenerated or emptied the session.
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
      // Sessions turned off (`enabled: false`): AdonisJS's middleware calls next() without one.
      if (!ctx.session) return next()
      const session = ctx.session
      // The id the browser sent, if any (a first visit has none).
      const presented = session.fresh ? undefined : session.sessionId
      const rotated = presented ? await rotationOf(presented) : null
      if (rotated?.recent) throw new ReplacedSessionException()
      const background = isBackgroundRead(ctx) && !session.flashMessages.isEmpty
      const before = background ? JSON.stringify(session.all()) : ''
      const response = await next()
      if (presented && session.hasRegeneratedSession) {
        // This request rotated the session: record the old id before its write and its answer.
        await recordRotation(presented, session.sessionId)
      } else if (presented && (await rotatedSince(presented, rotated?.at))) {
        // Another request rotated it while this one was in flight. A read is refused: throwing
        // here, inside AdonisJS's next(), skips its commit (nothing written, no cookie).
        if (isRead(ctx)) throw new ReplacedSessionException()
        // The user's own sign-out: its session is already gone, so it ends the one that
        // replaced it. Not an automatic sign-out (a revoked session), which a rotation causes.
        if (signedOutIn(ctx)) await endSuccessor(presented)
        // A write has done its work: its answer stands, without the old session's write and
        // cookie (the commit skipped as for an unchanged background read, below).
        session.commit = async () => {}
        return response
      }
      if (!background) return response
      const unchanged =
        !session.hasRegeneratedSession &&
        session.responseFlashMessages.isEmpty &&
        JSON.stringify(session.all()) === before
      if (unchanged) {
        // Nothing of this request's own to keep: the stored session, messages included, stays
        // as it is. Checked against @adonisjs/session 8.1.0, whose middleware calls
        // session.initiate(), then next(), then session.commit() on this same instance, so
        // replacing commit here skips that one write; flash_messages.spec fails if it changes.
        session.commit = async () => {}
      } else if (!session.hasRegeneratedSession && !session.isEmpty) {
        // Written as usual, with the messages kept. Not into a regenerated session (a sign-in
        // or sign-out starts without the old page's messages and flashed input), nor into one
        // the read emptied, which AdonisJS then destroys.
        session.reflash()
      }
      return response
    })
  }
}

/** True when the session id's rotation record is not the one seen before the handler. */
async function rotatedSince(sessionId: string, seen: string | undefined) {
  const now = await rotationOf(sessionId)
  return now !== null && now.at !== seen
}

/** GET or HEAD, by the method the server routed. */
function isRead({ request }: HttpContext) {
  const method = request.method()
  return method === 'GET' || method === 'HEAD'
}

/** A read for data, not a page: JSON accepted, not an Inertia page visit or partial reload. */
function isBackgroundRead(ctx: HttpContext) {
  const { request } = ctx
  return isRead(ctx) && !request.header('x-inertia') && request.accepts(['html', 'json']) === 'json'
}
