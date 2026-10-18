import type { Knex } from 'knex'
import type { ResourceRegistry } from '../resource/registry.js'
import { RolesAdmin } from './roles.js'

export type ModuleSeedResult = {
  /** Lookup rows inserted now; rows that already existed are left as they are. */
  lookups: number
  created: string[]
  adopted: string[]
  kept: string[]
}

/**
 * Applies the lookups and default roles declared by registered modules. It is
 * idempotent and additive: existing lookup rows and roles are never changed, so
 * administrator edits survive every later installation (adula:install runs it).
 */
export async function seedModules(
  db: Knex,
  registry: ResourceRegistry,
  actorId: number
): Promise<ModuleSeedResult> {
  return db.transaction(async (trx) => {
    await trx.raw('SELECT pg_advisory_xact_lock(717012)')
    let lookups = 0
    for (const module of registry.modules())
      for (const [group, rows] of Object.entries(module.lookups ?? {}))
        for (const [index, row] of rows.entries()) {
          const inserted = await trx('lookups')
            .insert({
              group,
              key: row.key,
              label_ar: row.label.ar,
              // label_en is NOT NULL; an Arabic-only lookup shows its Arabic text there.
              label_en: row.label.en ?? row.label.ar,
              sort: row.sort ?? index,
              active: true,
            })
            .onConflict(['group', 'key'])
            .ignore()
            .returning('id')
          lookups += inserted.length
        }
    const roles = await new RolesAdmin(trx, registry).ensureDefaults(
      actorId,
      registry.modules().flatMap((module) => [...(module.defaultRoles ?? [])])
    )
    return { lookups, ...roles }
  })
}
