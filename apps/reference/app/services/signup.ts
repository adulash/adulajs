import db from '@adonisjs/lucid/services/db'
import { administratorExists } from 'adula'
import env from '#start/env'

type Client = ReturnType<ReturnType<typeof db.connection>['getWriteClient']>

/**
 * Self-signup policy. An explicit SIGNUP_ENABLED is obeyed; when it is unset,
 * signup stays open only while the application has no administrator, so a fresh
 * deployment is not left open to anyone once its first administrator exists.
 * The value is read per request, never cached, so changing it needs no rebuild.
 */
export async function signupEnabled(
  client: Client = db.connection().getWriteClient(),
  configured: boolean | undefined = env.get('SIGNUP_ENABLED')
) {
  if (configured !== undefined) return configured
  return !(await administratorExists(client))
}
