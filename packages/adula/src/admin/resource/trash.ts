import type { Knex } from 'knex'
import type { Resource } from '../../resource/types.js'
import type { Actor, AdulaAbility } from '../../auth/ability.js'
import { fromRow, serialize } from '../contracts.js'
import { notFound } from '../errors.js'
import { audit, requireInlineParents } from './lifecycle.js'
import {
  authorizeAction,
  columns,
  hydrateOne,
  requireRecord,
  type ResourceContext,
} from './shared.js'

/**
 * One soft-deleted record within the actor's organization scope; 404 otherwise. It
 * mirrors shared.find() for rows whose deleted_at is set, so restore never sees a live row.
 */
async function findDeleted(
  db: Knex,
  resource: Resource,
  actor: Actor,
  ability: AdulaAbility,
  id: number
) {
  const query = db(`${resource.name} as r`).whereNotNull('r.deleted_at').where('r.id', id)
  if (resource.scoped) {
    query
      .join('org_units as ou', 'ou.id', 'r.org_unit_id')
      .where((scope) => {
        if (!actor.orgPaths.length) scope.whereRaw('FALSE')
        actor.orgPaths.forEach((path) => scope.orWhereRaw('ou.path <@ ?::ltree', [path]))
      })
      .select('ou.path as org_path')
  }
  query.select(columns(resource, ability, true)).forUpdate('r')
  const row = await query.first()
  if (!row) throw notFound()
  return fromRow(row, resource)
}

/**
 * Clears deleted_at of a soft-deleted record; see ResourceService.restore. Restore is
 * authorized by the actor's delete rule (ADR 046): the resource must offer delete, the
 * actor must hold it, and its conditions and organization scope are evaluated on the
 * deleted record (404 outside the scope, 403 when a condition refuses).
 */
export async function restore(
  ctx: ResourceContext,
  name: string,
  id: number,
  actor: Actor,
  transaction?: Knex.Transaction
) {
  const resource = ctx.registry.get(name)
  const ability = authorizeAction(ctx, resource, actor, 'delete')
  if (!Number.isSafeInteger(id) || id <= 0) throw notFound()
  const work = async (trx: Knex.Transaction) => {
    const record = await findDeleted(trx, resource, actor, ability, id)
    requireRecord(ability, actor, resource, 'delete', record)
    // An inline line comes back only while its parent is a draft the actor may update.
    await requireInlineParents(ctx, trx, resource, actor, record)
    const values: Record<string, unknown> = {
      deleted_at: null,
      updated_by: actor.id,
      updated_at: trx.fn.now(),
    }
    if (resource.version) values.version = Number(record.version) + 1
    const [row] = await trx(name).where({ id }).update(values).returning('*')
    const saved = fromRow(row, resource)
    await audit(ctx, trx, resource, actor, 'restore', saved, [])
    return serialize(resource, await hydrateOne(trx, resource, saved), ability, actor)
  }
  return transaction ? work(transaction) : ctx.db.transaction(work)
}
