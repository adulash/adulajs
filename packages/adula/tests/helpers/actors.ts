import type { Actor } from '../../index.js'
import { db, reader } from '../helpers.js'

/**
 * Actor factories for the shapes the specs build repeatedly. Each returns a fresh object,
 * so a spec may spread or override it without affecting another spec.
 */

/** A user in the sibling unit 1.3: may view and update orders, never records of unit 1.2. */
export function outsider(overrides: Partial<Actor> = {}): Actor {
  return {
    id: 3,
    orgPaths: ['1.3'],
    permissionLevel: 0,
    rules: [{ subject: 'orders', action: ['view', 'update'] }],
    ...overrides,
  }
}

/** Reads orders in unit 1.2 but cannot update them, and never the level-1 total field. */
export function viewer(overrides: Partial<Actor> = {}): Actor {
  return {
    id: 4,
    orgPaths: ['1.2'],
    permissionLevel: 0,
    rules: [{ subject: 'orders', action: 'view' }],
    ...overrides,
  }
}

/** The reader with every permission, still limited to the reader's units and level. */
export function ace(overrides: Partial<Actor> = {}): Actor {
  return { ...reader, rules: [{ subject: 'all', action: 'manage' }], ...overrides }
}

/** The reader with no permission at all. */
export function powerless(overrides: Partial<Actor> = {}): Actor {
  return { ...reader, rules: [], ...overrides }
}

/** Adds the profile columns the user directory reads to the helper `users` table. */
export async function addUserProfileColumns() {
  await db.raw('ALTER TABLE users ADD COLUMN full_name varchar, ADD COLUMN disabled_at timestamptz')
}

export interface SeedUser {
  email?: string
  /** Needs addUserProfileColumns(). */
  fullName?: string
  /** Marks the user disabled now; needs addUserProfileColumns(). */
  disabled?: boolean
}

/**
 * Stores the user row behind an actor (or any `{ id }`) and returns it unchanged. An
 * existing row with the same id (such as the helper's users 1 and 2) keeps its other
 * columns and only takes the values supplied here.
 */
export async function seedActor<A extends Pick<Actor, 'id'>>(
  actor: A,
  user: SeedUser = {}
): Promise<A> {
  const row: Record<string, unknown> = { id: actor.id }
  if (user.email !== undefined) row.email = user.email
  if (user.fullName !== undefined) row.full_name = user.fullName
  if (user.disabled) row.disabled_at = db.fn.now()
  await db('users').insert(row).onConflict('id').merge()
  return actor
}
