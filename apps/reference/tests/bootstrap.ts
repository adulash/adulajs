import { assert } from '@japa/assert'
import app from '@adonisjs/core/services/app'
import type { Config } from '@japa/runner/types'
import { pluginAdonisJS } from '@japa/plugin-adonisjs'
import { dbAssertions } from '@adonisjs/lucid/plugins/db'
import testUtils from '@adonisjs/core/services/test_utils'
import { browserClient } from '@japa/browser-client'
import { authBrowserClient } from '@adonisjs/auth/plugins/browser_client'
import { sessionBrowserClient } from '@adonisjs/session/plugins/browser_client'
import { apiClient } from '@japa/api-client'
import { authApiClient } from '@adonisjs/auth/plugins/api_client'
import { sessionApiClient } from '@adonisjs/session/plugins/api_client'
import { shieldApiClient } from '@adonisjs/shield/plugins/api_client'
import { inertiaApiClient } from '@adonisjs/inertia/plugins/api_client'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import cache from '@adonisjs/cache/services/main'
import queue from '@nemoventures/adonis-jobs/services/main'
import { createServer } from 'node:http'
import type { Socket } from 'node:net'
import { readFile, writeFile } from 'node:fs/promises'

/**
 * This file is imported by the "bin/test.ts" entrypoint file
 */

/**
 * Configure Japa plugins in the plugins array.
 * Learn more - https://japa.dev/docs/runner-config#plugins-optional
 */
export const plugins: Config['plugins'] = [
  assert(),
  pluginAdonisJS(app),
  dbAssertions(app),
  browserClient({ runInSuites: ['browser'] }),
  sessionBrowserClient(app),
  authBrowserClient(app),
  apiClient(),
  sessionApiClient(app),
  authApiClient(app),
  shieldApiClient(),
  inertiaApiClient(app),
]

/**
 * Configure lifecycle function to run before and after all the
 * tests.
 *
 * The setup functions are executed before all the tests
 * The teardown functions are executed after all the tests
 */
export const runnerHooks: Required<Pick<Config, 'setup' | 'teardown'>> = {
  setup: [
    async () => {
      if (!env.get('DB_DATABASE').endsWith('_test') || !app.inTest)
        throw new Error('HTTP tests require a dedicated *_test database')
      // Both stores use the explicit adula-reference-test prefix and Redis DB 15.
      await queue.clear(['events'])
      await cache.clear()
      await testUtils.db().migrate()
      await db.rawQuery(
        'TRUNCATE users, user_sessions, password_reset_tokens, social_accounts, org_units, roles, settings, lookups, sequences, activities, outbox, processed_events, notifications, workflow_runs, attachments, saved_views, tags, taggables, assignments, message_templates, webhooks, auth_access_tokens, import_batches, workflow_events, user_two_factor, user_two_factor_recovery_codes RESTART IDENTITY CASCADE'
      )
      // Suites create administrators without a second factor. Enforcement is switched off
      // here; tests/functional/two_factor.spec.ts restores the default (required) and covers it.
      await db.from('settings').where('key', 'auth.twoFactorRequiredForAdministrators').delete()
      await db
        .table('settings')
        .insert({ key: 'auth.twoFactorRequiredForAdministrators', value: JSON.stringify(false) })
    },
  ],
  teardown: [
    async () => {
      // Lucid regenerates this project-owned file while migrating. Formatting it here keeps
      // `test` a single command, so `npm test -- <args>` reaches Japa (issue #22).
      const { format, resolveConfig } = await import('prettier')
      const path = app.makePath('database/schema.ts')
      const source = await readFile(path, 'utf8')
      const formatted = await format(source, {
        ...(await resolveConfig(path)),
        filepath: path,
      })
      if (formatted !== source) await writeFile(path, formatted)
    },
  ],
}

/**
 * Configure suites by tapping into the test suite instance.
 * Learn more - https://japa.dev/docs/test-suites#lifecycle-hooks
 */
export const configureSuite: Config['configureSuite'] = (suite) => {
  if (['browser', 'functional', 'e2e'].includes(suite.name)) {
    return suite.setup(async () => {
      const sockets = new Set<Socket>()
      const stop = await testUtils.httpServer().start((handler) => {
        const server = createServer(handler)
        server.on('connection', (socket) => {
          sockets.add(socket)
          socket.once('close', () => sockets.delete(socket))
        })
        return server
      })
      return async () => {
        const closing = stop()
        // Tests are finished; close preview/HMR connections too, including upgraded sockets.
        for (const socket of sockets) socket.destroy()
        await closing
      }
    })
  }
}
