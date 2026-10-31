import type { Knex } from 'knex'
import type { Actor } from '../auth/ability.js'
import type { ResourceService } from '../admin/resource_service.js'

/** Loads the full actor (roles, permission level) of a user by id. */
export type ActorLoader = { load(id: number): Promise<Actor> }

/**
 * Whether a user may view a record: the account must exist and be active, and the
 * record must pass the same ResourceService authorization that the user's own read
 * would. Used before notifying, mentioning or assigning someone, so these features
 * never reveal a record to a user who cannot open it.
 */
export async function canView(
  db: Knex,
  resources: Pick<ResourceService, 'permits'>,
  actors: ActorLoader,
  resource: string,
  id: number,
  userId: number
) {
  const user = await db('users').where('id', userId).first('disabled_at')
  if (!user || user.disabled_at) return false
  return resources.permits(resource, Number(id), await actors.load(userId))
}

/** The resource's display label, or its name when the resource is no longer registered. */
export function resourceLabel(resources: Pick<ResourceService, 'label'>, name: string): string {
  try {
    return resources.label(name)
  } catch {
    return String(name)
  }
}
