import { test } from '@japa/runner'
import { randomUUID } from 'node:crypto'
import type { ApiClient } from '@japa/api-client'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import encryptionService from '@adonisjs/core/services/encryption'
import { CookieClient, type HttpContext } from '@adonisjs/core/http'
import { HttpContextFactory, RequestFactory, ResponseFactory } from '@adonisjs/core/factories/http'
import { SessionMiddlewareFactory } from '@adonisjs/session/factories'
import type { SessionData, SessionStoreContract } from '@adonisjs/session/types'
import db from '@adonisjs/lucid/services/db'
import FlashKeepingSessionMiddleware from '#middleware/session_middleware'
import ReplacedSessionException from '#exceptions/replaced_session_exception'
import { endSession, markSignedOut, sessionHandle } from '#services/sessions'
import { CopyingMemoryStore } from '#config/session'
import User from '#models/user'

/**
 * The invariants of the starter's session middleware (app/middleware/session_middleware.ts):
 * a background JSON read leaves the session untouched only when taking the flash messages was
 * its only change. A read that regenerated the session, changed a value or flashed a message
 * is written as usual. Driven through AdonisJS's own session middleware over a store that
 * keeps copies, as Redis and the database store do.
 */
class Store implements SessionStoreContract {
  writes = 0
  /** Its own sessions, or the application's (the tests' store) for a request the app serves. */
  constructor(public sessions = new Map<string, SessionData>()) {}
  read(id: string) {
    const data = this.sessions.get(id)
    return data ? structuredClone(data) : null
  }
  write(id: string, data: SessionData) {
    this.writes++
    this.sessions.set(id, structuredClone(data))
  }
  destroy(id: string) {
    this.sessions.delete(id)
  }
  touch() {}
}

const COOKIE = 'adonis-session'
/** The application's own encrypter, so cookies sign and verify as on a real request. */
const encryption = () => encryptionService.use()

async function middleware(store: Store, enabled = true) {
  const session = await new SessionMiddlewareFactory()
    .merge({
      config: {
        enabled,
        cookieName: COOKIE,
        age: '2h',
        cookie: {},
        store: 'copies',
        stores: { copies: () => store },
      },
    })
    .create()
  return new FlashKeepingSessionMiddleware(session)
}

type RequestOptions = {
  sessionId?: string
  method?: string
  accept?: string
  headers?: Record<string, string>
  url?: string
}

/** A request context as AdonisJS builds one: `GET` JSON (a background read) unless told. */
function context(options: RequestOptions = {}) {
  const req = new IncomingMessage(new Socket())
  req.method = options.method ?? 'GET'
  req.url = options.url ?? '/notifications'
  req.headers = { accept: options.accept ?? 'application/json', ...options.headers }
  if (options.sessionId)
    req.headers.cookie = `${COOKIE}=${new CookieClient(encryption()).sign(COOKIE, options.sessionId)}`
  const res = new ServerResponse(req)
  const request = new RequestFactory().merge({ req, res, encryption: encryption() }).create()
  const response = new ResponseFactory().merge({ req, res, encryption: encryption() }).create()
  return new HttpContextFactory().merge({ request, response }).create()
}

/** One request through the middleware. */
async function send(
  store: Store,
  handler: (ctx: HttpContext) => void | Promise<void>,
  options: RequestOptions & { enabled?: boolean } = {}
) {
  const ctx = context(options)
  const sessions = await middleware(store, options.enabled)
  await sessions.handle(ctx, async () => {
    await handler(ctx)
  })
  return ctx
}

/** A signed-in session with a write's message waiting for its page. */
async function withMessage(store: Store) {
  const ctx = await send(
    store,
    ({ session }) => {
      session.put('auth_web', 1)
      session.flash('success', 'تم الحفظ')
    },
    { method: 'POST', accept: 'text/html' }
  )
  return ctx.session.sessionId
}

const flashOf = (store: Store, id: string) => store.sessions.get(id)?.__flash__ as any

test.group('Session middleware keeps flash messages for their page', () => {
  test('a background read that only took the messages leaves the session as stored', async ({
    assert,
  }) => {
    const store = new Store()
    const id = await withMessage(store)
    const writes = store.writes
    await send(store, () => {}, { sessionId: id })
    assert.equal(store.writes, writes, 'not written back')
    assert.deepEqual(flashOf(store, id), { success: 'تم الحفظ' })
  })

  test('a page request takes the messages as before', async ({ assert }) => {
    const store = new Store()
    const id = await withMessage(store)
    const ctx = await send(store, () => {}, { sessionId: id, accept: 'text/html' })
    assert.equal(ctx.session.flashMessages.get('success'), 'تم الحفظ')
    assert.isUndefined(flashOf(store, id), 'written without them')
  })

  test('a background read that changed a value is written, with the messages kept', async ({
    assert,
  }) => {
    const store = new Store()
    const id = await withMessage(store)
    const writes = store.writes
    await send(store, ({ session }) => session.put('impersonating', 7), { sessionId: id })
    assert.isAbove(store.writes, writes)
    assert.equal(store.sessions.get(id)?.impersonating, 7)
    assert.deepEqual(flashOf(store, id), { success: 'تم الحفظ' })
  })

  test('a background read that flashed a message is written with it', async ({ assert }) => {
    const store = new Store()
    const id = await withMessage(store)
    await send(store, ({ session }) => session.flash('warning', 'تنبيه'), { sessionId: id })
    assert.deepEqual(flashOf(store, id), { success: 'تم الحفظ', warning: 'تنبيه' })
  })

  test('a background read that regenerated the session is written under the new id, without the old messages', async ({
    assert,
  }) => {
    const store = new Store()
    const id = await withMessage(store)
    const ctx = await send(store, ({ session }) => session.regenerate(), { sessionId: id })
    const next = ctx.session.sessionId
    assert.notEqual(next, id)
    assert.isFalse(store.sessions.has(id), 'the old session is gone')
    assert.equal(store.sessions.get(next)?.auth_web, 1, 'the new session is stored')
    assert.isUndefined(flashOf(store, next), 'no messages carried into it')
  })

  test('a background read that cleared the session lets it be destroyed', async ({ assert }) => {
    const store = new Store()
    const id = await withMessage(store)
    await send(store, ({ session }) => session.clear(), { sessionId: id })
    assert.isFalse(store.sessions.has(id))
  })

  test('a write is never treated as a read, whatever it accepts', async ({ assert }) => {
    const store = new Store()
    const id = await withMessage(store)
    await send(store, () => {}, { sessionId: id, method: 'POST' })
    assert.isUndefined(flashOf(store, id), 'the POST took the messages and was written')
  })

  test('with sessions turned off it passes the request on', async ({ assert }) => {
    const store = new Store()
    let reached = false
    const ctx = await send(
      store,
      () => {
        reached = true
      },
      { enabled: false }
    )
    assert.isTrue(reached)
    assert.isUndefined(ctx.session)
    assert.equal(store.writes, 0)
  })
})

/**
 * A rotation (sign-in, starting or ending impersonation) replaces the session id. A request
 * still carrying the old id, answered after the rotation, must not write the old session back
 * or hand the browser its cookie: it is refused, with nothing written. An ended session that no
 * rotation replaced (an administrator's revocation, a sign-out) is not refused here; the auth
 * middleware signs it out as before.
 */
test.group('Session middleware refuses a rotated session', () => {
  const knex = () => db.connection().getWriteClient()
  /**
   * A rotation through the middleware: the old id is replaced, and the new one returned. With a
   * user, the new session is recorded for them, as impersonation and sign-in record it.
   */
  async function rotate(store: Store, id: string, userId?: number) {
    const ctx = await send(
      store,
      async ({ session }) => {
        session.regenerate()
        if (userId) await knex()('user_sessions').insert({ id: session.sessionId, user_id: userId })
      },
      { sessionId: id, method: 'POST', accept: 'text/html' }
    )
    return ctx.session.sessionId
  }

  /** A user signed in on a session of the application's own store, recorded as sign-in does. */
  async function signedIn(label: string) {
    const user = await User.create({
      fullName: `تدوير ${label}`,
      email: `rotation-${label}-${randomUUID()}@example.test`,
      password: 'rotation-test-only-password',
    })
    const store = new Store(CopyingMemoryStore.sessions)
    const ctx = await send(store, ({ session }) => session.put('auth_web', user.id), {
      method: 'POST',
      accept: 'text/html',
    })
    const id = ctx.session.sessionId
    await knex()('user_sessions').insert({ id, user_id: user.id })
    return { user, store, id }
  }

  /** What the application answers a page request carrying this session id. */
  async function pageWith(client: ApiClient, id: string) {
    const request = client.get('/account/profile').redirects(0)
    request.sessionClient.sessionId = id as ReturnType<typeof randomUUID>
    return request
  }

  test('a rotating request records the id it replaced', async ({ assert }) => {
    const store = new Store()
    const id = await withMessage(store)
    const next = await rotate(store, id)
    assert.notEqual(next, id)
    // Stored by handle, never the session id itself.
    assert.exists(
      await knex()('session_rotations')
        .where({ id: sessionHandle(id) })
        .first()
    )
    assert.notExists(await knex()('session_rotations').where({ id }).first())
    assert.notExists(
      await knex()('session_rotations')
        .where({ id: sessionHandle(next) })
        .first()
    )
  })

  test('a request with the replaced id is refused before its handler, nothing written', async ({
    assert,
  }) => {
    const store = new Store()
    const id = await withMessage(store)
    await rotate(store, id)
    const writes = store.writes
    let reached = false
    await assert.rejects(
      () =>
        send(
          store,
          () => {
            reached = true
          },
          { sessionId: id, accept: 'text/html' }
        ),
      ReplacedSessionException
    )
    assert.isFalse(reached)
    assert.equal(store.writes, writes)
    assert.isFalse(store.sessions.has(id), 'the old session is not written back')
  })

  test('a request already in flight when the session rotates is refused before its write', async ({
    assert,
  }) => {
    const store = new Store()
    const id = await withMessage(store)
    let next: string | undefined
    // The late request read the old session, then the rotation happens while it is handled.
    await assert.rejects(
      () =>
        send(
          store,
          async ({ session }) => {
            assert.equal(session.get('auth_web'), 1, 'it read the old session')
            next = await rotate(store, id)
            session.put('touched', true)
          },
          { sessionId: id, accept: 'text/html' }
        ),
      ReplacedSessionException
    )
    assert.isFalse(store.sessions.has(id), 'the old session is not written back')
    assert.equal(store.sessions.get(next!)?.auth_web, 1, 'the new session stays as stored')
    assert.isUndefined(store.sessions.get(next!)?.touched)
  })

  test('a replaced id is refused for a minute only, then treated as any ended session', async ({
    assert,
  }) => {
    const store = new Store()
    const id = await withMessage(store)
    await rotate(store, id)
    await knex()('session_rotations')
      .where({ id: sessionHandle(id) })
      .update({ rotated_at: knex().raw(`now() - interval '2 minutes'`) })
    const ctx = await send(store, () => {}, { sessionId: id, accept: 'text/html' })
    assert.isUndefined(ctx.session.get('auth_web'), 'the old session is gone: a guest')
  })

  test('a session that ended without a rotation is not refused here', async ({ assert }) => {
    const store = new Store()
    const id = await withMessage(store)
    // An administrator's revocation: the stored session is removed, no rotation is recorded.
    store.destroy(id)
    let reached = false
    await send(
      store,
      () => {
        reached = true
      },
      { sessionId: id, accept: 'text/html' }
    )
    assert.isTrue(reached)
  })

  test('a write in flight when the session rotates keeps its answer, saved once, the old session not written', async ({
    assert,
  }) => {
    const store = new Store()
    const id = await withMessage(store)
    let saves = 0
    let next: string | undefined
    const ctx = await send(
      store,
      async ({ session, response }) => {
        saves++
        next = await rotate(store, id)
        session.put('touched', true)
        response.redirect('/notifications')
      },
      { sessionId: id, method: 'POST', accept: 'text/html' }
    )
    assert.equal(saves, 1)
    assert.equal(ctx.response.getStatus(), 302, 'its own answer: the redirect')
    assert.isFalse(store.sessions.has(id), 'the old session is not written back')
    assert.isUndefined(store.sessions.get(next!)?.touched)
  })

  test('a request in flight across a rotation is caught however long it ran', async ({
    assert,
  }) => {
    const store = new Store()
    const id = await withMessage(store)
    await assert.rejects(
      () =>
        send(
          store,
          async () => {
            await rotate(store, id)
            // The handler outlasted the minute: the rotation it saw is no longer recent.
            await knex()('session_rotations')
              .whereIn('id', [sessionHandle(id), id])
              .update({ rotated_at: knex().raw(`now() - interval '5 minutes'`) })
          },
          { sessionId: id, accept: 'text/html' }
        ),
      ReplacedSessionException
    )
    assert.isFalse(store.sessions.has(id))
  })

  test('a sign-out in flight when the session rotates signs out the session that replaced it', async ({
    client,
    assert,
  }) => {
    const { user, store, id } = await signedIn('signout')
    let next: string | undefined
    // Impersonation starts (X becomes Y) while a sign-out sent with X is being handled.
    const ctx = await send(
      store,
      async (request) => {
        next = await rotate(store, id, user.id)
        // As the sign-out does (session_controller.destroy).
        request.session.forget('auth_web')
        markSignedOut(request)
        await endSession(id)
        request.response.redirect('/login')
      },
      { sessionId: id, method: 'POST', accept: 'text/html' }
    )
    assert.equal(ctx.response.getStatus(), 302, 'its own answer: the redirect')
    const row = await knex()('user_sessions').where({ id: next! }).first()
    assert.isNotNull(row.revoked_at, 'the replacing session is ended')
    // The browser follows the redirect with the new cookie, and is signed out.
    const after = await pageWith(client, next!)
    after.assertStatus(302)
    after.assertHeader('location', '/login')
  })

  test('an automatic sign-out of the replaced session in flight leaves the new one signed in', async ({
    client,
    assert,
  }) => {
    const { user, store, id } = await signedIn('revoked')
    let next: string | undefined
    // An autosave sent with X while impersonation starts: the rotation revokes X before it is
    // recorded, so the auth middleware finds X revoked and signs the request out, as it does
    // any revoked session. That is not the user's sign-out: Y stays signed in.
    await send(
      store,
      async ({ session, response }) => {
        await endSession(id)
        next = await rotate(store, id, user.id)
        // As the auth middleware does for a revoked session.
        session.forget('auth_web')
        response.redirect('/login')
      },
      { sessionId: id, method: 'POST', accept: 'text/html' }
    )
    const row = await knex()('user_sessions').where({ id: next! }).first()
    assert.isNull(row.revoked_at, 'the replacing session stays')
    const after = await pageWith(client, next!)
    after.assertStatus(200)
  })

  test('a write in flight across a rotation that did not sign out leaves the new session signed in', async ({
    client,
    assert,
  }) => {
    const { user, store, id } = await signedIn('write')
    let next: string | undefined
    await send(
      store,
      async ({ session, response }) => {
        next = await rotate(store, id, user.id)
        session.put('touched', true)
        response.redirect('/notifications')
      },
      { sessionId: id, method: 'POST', accept: 'text/html' }
    )
    const row = await knex()('user_sessions').where({ id: next! }).first()
    assert.isNull(row.revoked_at)
    const after = await pageWith(client, next!)
    after.assertStatus(200)
  })

  test('the refusal links only to this host, whatever the path starts with', async ({ assert }) => {
    for (const url of [
      '//evil.example/account',
      '/\\evil.example/account',
      '///evil.example/account',
    ])
      for (const headers of [
        { 'x-inertia': 'true', 'accept': 'text/html' },
        { accept: 'text/html' },
      ] as Record<string, string>[]) {
        const ctx = context({ url, headers })
        const error = new ReplacedSessionException()
        await error.handle(error, ctx)
        const location = ctx.response.getHeader('x-inertia-location')
        if (location !== undefined) assert.equal(location, '/evil.example/account', url)
        else assert.include(String(ctx.response.getBody()), 'href="/evil.example/account"', url)
      }
  })

  test('rotations older than ten minutes are pruned on the next one', async ({ assert }) => {
    const store = new Store()
    const old = await withMessage(store)
    await rotate(store, old)
    await knex()('session_rotations')
      .whereIn('id', [sessionHandle(old), old])
      .update({ rotated_at: knex().raw(`now() - interval '11 minutes'`) })
    await rotate(store, await withMessage(store))
    assert.notExists(
      await knex()('session_rotations')
        .whereIn('id', [sessionHandle(old), old])
        .first()
    )
  })

  test('the refusal answers each kind of request without the session', async ({ assert }) => {
    const store = new Store()
    const id = await withMessage(store)
    await rotate(store, id)
    for (const [headers, status, check] of [
      [{ 'x-inertia': 'true', 'accept': 'text/html' }, 409, 'location'],
      [{ accept: 'application/json' }, 409, 'json'],
      [{ accept: 'text/html' }, 409, 'text'],
    ] as const) {
      const error = await send(store, () => {}, { sessionId: id, headers }).catch((e) => e)
      assert.instanceOf(error, ReplacedSessionException)
      const ctx = context({ sessionId: id, headers })
      await error.handle(error, ctx)
      assert.equal(ctx.response.getStatus(), status)
      if (check === 'location') {
        assert.equal(ctx.response.getHeader('x-inertia-location'), '/notifications')
        assert.notEqual(ctx.response.getHeader('x-inertia-version'), undefined)
      }
      if (check === 'json') assert.equal(ctx.response.getBody().code, 'E_SESSION_REPLACED')
      if (check === 'text') {
        assert.match(String(ctx.response.getHeader('content-type')), /text\/html/)
        assert.include(String(ctx.response.getBody()), 'href="/notifications"')
      }
      assert.notExists(ctx.response.getHeader('set-cookie'), 'no cookie')
      // Answered before shield: its own headers keep it out of caches and frames.
      assert.equal(ctx.response.getHeader('cache-control'), 'no-store')
      assert.equal(ctx.response.getHeader('x-frame-options'), 'DENY')
      assert.equal(ctx.response.getHeader('content-security-policy'), "frame-ancestors 'none'")
    }
  })
})
