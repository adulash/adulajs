import env from '#start/env'
import app from '@adonisjs/core/services/app'
import { defineConfig, stores } from '@adonisjs/session'
import type { SessionData, SessionStoreContract } from '@adonisjs/session/types'

/**
 * The memory store of the tests, holding copies like every real store (Redis, cookie,
 * database): a request's changes reach the store only when it writes the session. AdonisJS's
 * own memory store hands out the stored object itself, so a request that takes a flash message
 * without writing the session would still remove it, unlike production.
 */
class CopyingMemoryStore implements SessionStoreContract {
  static sessions = new Map<string, SessionData>()
  read(sessionId: string) {
    const data = CopyingMemoryStore.sessions.get(sessionId)
    return data ? structuredClone(data) : null
  }
  write(sessionId: string, data: SessionData) {
    CopyingMemoryStore.sessions.set(sessionId, structuredClone(data))
  }
  destroy(sessionId: string) {
    CopyingMemoryStore.sessions.delete(sessionId)
  }
  touch() {}
}

const sessionConfig = defineConfig({
  /**
   * Enable or disable session support globally.
   */
  enabled: true,

  /**
   * Cookie name storing the session identifier.
   */
  cookieName: 'adonis-session',

  /**
   * When set to true, the session id cookie will be deleted
   * once the user closes the browser.
   */
  clearWithBrowser: false,

  /**
   * Define how long to keep the session data alive without
   * any activity.
   */
  age: '2h',

  /**
   * Configuration for session cookie and the
   * cookie store.
   */
  cookie: {
    /**
     * Restrict the cookie to a URL path. '/' means all routes.
     */
    path: '/',

    /**
     * Prevent JavaScript access to the cookie in the browser.
     */
    httpOnly: true,

    /**
     * Send cookies only over HTTPS in production.
     */
    secure: app.inProduction,

    /**
     * Cross-site policy for cookie sending.
     */
    sameSite: 'lax',
  },

  /**
   * The store to use. Make sure to validate the environment
   * variable in order to infer the store name without any
   * errors.
   */
  // The official Japa session client persists into the memory store.
  store: app.inTest ? 'memory' : env.get('SESSION_DRIVER'),

  /**
   * List of configured stores. Refer documentation to see
   * list of available stores and their config.
   */
  stores: {
    /** The tests' store (the Japa session clients use it too). */
    memory: () => new CopyingMemoryStore(),

    /**
     * Store session data inside encrypted cookies.
     */
    cookie: stores.cookie(),

    /**
     * Store session data inside the configured database.
     */
    database: stores.database(),
  },
})

export default sessionConfig
