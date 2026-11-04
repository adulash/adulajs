import type { Knex } from 'knex'
import type { Actor } from '../auth/ability.js'
import type { ResourceService } from '../admin/resource_service.js'
import { AdulaError } from '../admin/errors.js'

/**
 * Loads the full actor (roles, permission level) of a user by id. A loader may accept
 * an optional second argument, the caller's connection (ActorStore does): canView passes
 * its transaction there, so a check made while a transaction is held needs no second
 * pool connection. A loader that ignores it reads on its own connection.
 */
export type ActorLoader = { load(id: number): Promise<Actor> }

type ConnectionAwareLoader = { load(id: number, db?: Knex): Promise<Actor> }

/**
 * Whether a user may view a record: the account must exist and be active, and the
 * record must pass the same ResourceService authorization that the user's own read
 * would. Used before notifying, mentioning or assigning someone, so these features
 * never reveal a record to a user who cannot open it.
 *
 * Every query runs on `db`: a caller holding a transaction passes it, so the check
 * never waits for another pool connection while that transaction holds one.
 */
export async function canView(
  db: Knex,
  resources: Pick<ResourceService, 'access'>,
  actors: ActorLoader,
  resource: string,
  id: number,
  userId: number
) {
  const user = await db('users').where('id', userId).first('disabled_at')
  if (!user || user.disabled_at) return false
  const actor = await (actors as ConnectionAwareLoader).load(userId, db)
  try {
    await resources.access(resource, Number(id), actor, 'view', db)
    return true
  } catch (error) {
    if (error instanceof AdulaError && [403, 404].includes(error.status)) return false
    throw error
  }
}

/** The resource's display label, or its name when the resource is no longer registered. */
export function resourceLabel(resources: Pick<ResourceService, 'label'>, name: string): string {
  try {
    return resources.label(name)
  } catch {
    return String(name)
  }
}
