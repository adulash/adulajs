import { test } from '@japa/runner'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import encryptionService from '@adonisjs/core/services/encryption'
import { CookieClient, type HttpContext } from '@adonisjs/core/http'
import { HttpContextFactory, RequestFactory, ResponseFactory } from '@adonisjs/core/factories/http'
import { SessionMiddlewareFactory } from '@adonisjs/session/factories'
import type { SessionData, SessionStoreContract } from '@adonisjs/session/types'
import FlashKeepingSessionMiddleware from '#middleware/session_middleware'

/**
 * The invariants of the starter's session middleware (app/middleware/session_middleware.ts):
 * a background JSON read leaves the session untouched only when taking the flash messages was
 * its only change. A read that regenerated the session, changed a value or flashed a message
 * is written as usual. Driven through AdonisJS's own session middleware over a store that
 * keeps copies, as Redis and the database store do.
 */
class Store implements SessionStoreContract {
  sessions = new Map<string, SessionData>()
  writes = 0
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

/** One request through the middleware: `GET` JSON (a background read) unless told otherwise. */
async function send(
  store: Store,
  handler: (ctx: HttpContext) => void | Promise<void>,
  options: { sessionId?: string; method?: string; accept?: string; enabled?: boolean } = {}
) {
  const req = new IncomingMessage(new Socket())
  req.method = options.method ?? 'GET'
  req.url = '/notifications'
  req.headers = { accept: options.accept ?? 'application/json' }
  if (options.sessionId)
    req.headers.cookie = `${COOKIE}=${new CookieClient(encryption()).sign(COOKIE, options.sessionId)}`
  const res = new ServerResponse(req)
  const request = new RequestFactory().merge({ req, res, encryption: encryption() }).create()
  const response = new ResponseFactory().merge({ req, res, encryption: encryption() }).create()
  const ctx = new HttpContextFactory().merge({ request, response }).create()
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
