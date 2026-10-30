import type { Knex } from 'knex'
import type { ResourceRegistry } from '../../resource/registry.js'
import type { Action, RecordData, Resource } from '../../resource/types.js'
import { columnName, joinTable } from '../../resource/define_resource.js'
import {
  buildAbility,
  canRecord,
  inOrgScope,
  type Actor,
  type AdulaAbility,
} from '../../auth/ability.js'
import { conditionSql } from '../../auth/sql.js'
import { fromRow, selectedFields } from '../contracts.js'
import { AdulaError, forbiddenAction, notFound } from '../errors.js'
import { fieldValue, isMultipleAttachment } from '../../resource/values.js'
import { isAttachmentId, loadAttachments } from '../../attachments/attachment_service.js'
import type { RecordPermissions } from '../presentation.js'

/** What every resource operation needs: the database and the registered resources. */
export type ResourceContext = { db: Knex; registry: ResourceRegistry }

/**
 * The permission level an actor needs to see or write a field: its own permissionLevel,
 * and at least 1 when the resource lists it as hidden.
 */
export function fieldLevel(resource: Resource, key: string) {
  return Math.max(resource.fields[key].permissionLevel ?? 0, resource.hidden?.includes(key) ? 1 : 0)
}

/**
 * Whether an actor may sort, filter or search by a field. Querying reveals values
 * indirectly, so it needs unconditional view access at the field's level.
 */
export function canQueryField(
  resource: Resource,
  actor: Actor,
  ability: AdulaAbility,
  key: string
) {
  const level = fieldLevel(resource, key)
  // Conditional field rules cannot safely authorize a global sort/search.
  return (
    actor.permissionLevel >= level &&
    ability.can('view', resource.name, key) &&
    !ability.rules.some(
      (rule) =>
        rule.conditions &&
        (!rule.fields || rule.fields.includes(key)) &&
        (rule.subject === resource.name || rule.subject === 'all')
    )
  )
}

/** The actor's ability, after checking the resource offers the action and the actor holds it. */
export function authorizeAction(
  ctx: ResourceContext,
  resource: Resource,
  actor: Actor,
  action: Action
) {
  const ability = buildAbility(actor.rules, ctx.registry.all())
  if (!resource.actions.includes(action) || !ability.can(action, resource.name))
    throw forbiddenAction()
  for (const rule of ability.rulesFor(action, resource.name))
    conditionSql(rule.conditions, resource)
  return ability
}

/** Live rows of a resource inside the actor's organization scope. */
export function scopedQuery(db: Knex, resource: Resource, actor: Actor) {
  const query = db(`${resource.name} as r`).whereNull('r.deleted_at')
  if (resource.scoped) {
    query.join('org_units as ou', 'ou.id', 'r.org_unit_id').where((scope) => {
      if (!actor.orgPaths.length) scope.whereRaw('FALSE')
      actor.orgPaths.forEach((path) => scope.orWhereRaw('ou.path <@ ?::ltree', [path]))
    })
  }
  return query
}

/** The qualified columns the ability may read (or write). */
export function columns(
  resource: Resource,
  ability: AdulaAbility,
  write = false,
  extra: string[] = []
) {
  return selectedFields(resource, ability, { write, extra }).map(
    (key) => `r.${resource.fields[key]?.column ?? columnName(key)}`
  )
}

/** One live record within the actor's scope; 404 otherwise. */
export async function find(
  db: Knex,
  resource: Resource,
  actor: Actor,
  ability: AdulaAbility,
  id: number,
  lock = false
) {
  const query = scopedQuery(db, resource, actor)
    .where('r.id', id)
    .select(columns(resource, ability, lock))
  if (resource.scoped) query.select('ou.path as org_path')
  if (lock) query.forUpdate('r')
  const row = await query.first()
  if (!row) throw notFound()
  const [record] = await withLinks(db, resource, [fromRow(row, resource)])
  return record
}

/**
 * Adds the linked ids of every manyToMany field (ascending arrays) to records read
 * from the resource's table, so policies, serialization and audits see them like
 * column values. Mutates and returns the records.
 */
export async function withLinks(db: Knex, resource: Resource, records: RecordData[]) {
  if (!records.length) return records
  for (const [key, field] of Object.entries(resource.fields)) {
    if (field.type !== 'manyToMany') continue
    const join = joinTable(resource.name, key, field)
    const rows: RecordData[] = await db(join.table)
      .whereIn(
        join.owner,
        records.map((record) => Number(record.id))
      )
      .orderBy(join.target)
      .select(`${join.owner} as owner`, `${join.target} as target`)
    const links = new Map<number, number[]>()
    for (const row of rows) {
      const list = links.get(Number(row.owner)) ?? []
      list.push(Number(row.target))
      links.set(Number(row.owner), list)
    }
    for (const record of records) record[key] = links.get(Number(record.id)) ?? []
  }
  return records
}

/**
 * Applies a filter on a field without a plain column comparison: a multiSelect contains
 * the value, a manyToMany links the id. Returns false for other fields.
 */
export function collectionFilter(
  query: Knex.QueryBuilder,
  resource: Resource,
  key: string,
  value: unknown
) {
  const field = resource.fields[key]
  if (field?.type === 'multiSelect') {
    const column = `r.${field.column ?? columnName(key)}`
    if (value === null)
      query.where((q) => q.whereNull(column).orWhereRaw("?? = '[]'::jsonb", [column]))
    else query.whereRaw('?? @> ?::jsonb', [column, JSON.stringify([value])])
    return true
  }
  if (field?.type === 'manyToMany') {
    const join = joinTable(resource.name, key, field)
    const links = (exists: Knex.QueryBuilder) => {
      exists.from(join.table).whereRaw('?? = r.id', [`${join.table}.${join.owner}`])
      if (value !== null) exists.where(`${join.table}.${join.target}`, value as number)
    }
    if (value === null) query.whereNotExists(links)
    else query.whereExists(links)
    return true
  }
  return false
}

/** A live record regardless of any actor's scope, for system writes. */
export async function findAny(db: Knex, resource: Resource, id: number, lock = false) {
  const query = db(`${resource.name} as r`).whereNull('r.deleted_at').where('r.id', id)
  query.select(
    selectedFields(resource, buildAbility([], []), { write: true }).map(
      (key) => `r.${resource.fields[key]?.column ?? columnName(key)}`
    )
  )
  if (resource.scoped)
    query.leftJoin('org_units as ou', 'ou.id', 'r.org_unit_id').select('ou.path as org_path')
  if (lock) query.forUpdate('r')
  const row = await query.first()
  if (!row) throw notFound()
  const [record] = await withLinks(db, resource, [fromRow(row, resource)])
  return record
}

/** Scope (404) and conditional rules (403) of one loaded record. */
export function requireRecord(
  ability: AdulaAbility,
  actor: Actor,
  resource: Resource,
  action: Action,
  record: RecordData
) {
  if (resource.scoped && !inOrgScope(record.orgPath, actor.orgPaths)) throw notFound()
  if (!canRecord(ability, actor, resource, action, record)) throw forbiddenAction()
}

/** Which of the resource's actions the actor may take on one record now. */
export function permissions(
  resource: Resource,
  record: RecordData,
  actor: Actor,
  ability: AdulaAbility
): RecordPermissions {
  return Object.fromEntries(
    resource.actions.map((action) => [
      action,
      canRecord(ability, actor, resource, action, record) &&
        (!resource.submittable ||
          !['update', 'delete', 'submit'].includes(action) ||
          record.docStatus === 0) &&
        (action !== 'cancel' || (resource.submittable && record.docStatus === 1)) &&
        (action !== 'amend' || (resource.submittable && record.docStatus === 2)),
    ])
  )
}

/** Coerces every present field value to its stored representation (422 E_FIELD_VALUE). */
export function normalizeValues(resource: Resource, record: RecordData) {
  for (const [key, field] of Object.entries(resource.fields)) {
    if (!(key in record)) continue
    try {
      record[key] = fieldValue(field, record[key])
    } catch (error) {
      throw new AdulaError(422, 'E_FIELD_VALUE', `${key}: ${(error as Error).message}`)
    }
  }
}

/** Stored attachment ids become summaries for readers; copies keep policy checks on raw rows. */
export async function hydrate(db: Knex, resource: Resource, records: RecordData[]) {
  const keys = Object.keys(resource.fields).filter(
    (key) => resource.fields[key].type === 'attachment'
  )
  if (!keys.length || !records.length) return records
  // A multiple field holds an ordered array of ids: its summaries keep that order.
  const ids = records.flatMap((record) =>
    keys.flatMap((key) => (Array.isArray(record[key]) ? record[key] : [record[key]]))
  )
  const summaries = await loadAttachments(db, ids.filter(isAttachmentId))
  return records.map((record) => {
    const copy = { ...record }
    for (const key of keys) {
      if (!(key in copy)) continue
      const value = copy[key]
      if (isMultipleAttachment(resource.fields[key]))
        copy[key] = (Array.isArray(value) ? value : [])
          .map((id) => (isAttachmentId(id) ? summaries.get(id) : undefined))
          .filter((summary) => summary !== undefined)
      else copy[key] = isAttachmentId(value) ? (summaries.get(value) ?? null) : null
    }
    return copy
  })
}

export async function hydrateOne(db: Knex, resource: Resource, record: RecordData) {
  const [hydrated] = await hydrate(db, resource, [record])
  return hydrated
}

/**
 * Active users eligible for a user field: members of the unit at `path` or of one of
 * its ancestors, or (without a path) users sharing organization scope with the actor.
 * A system write on an unscoped resource passes no actor: any active member qualifies.
 */
export function eligibleUsers(db: Knex, path: string | null, actor: Actor | null) {
  return db('users as u')
    .whereNull('u.disabled_at')
    .whereExists((members) => {
      members
        .from('user_org_units as m')
        .join('org_units as o', 'o.id', 'm.org_unit_id')
        .whereRaw('m.user_id = u.id')
      if (path !== null) members.whereRaw('?::ltree <@ o.path', [path])
      else if (actor)
        members.where((scope) => {
          if (!actor.orgPaths.length) scope.whereRaw('FALSE')
          for (const own of actor.orgPaths)
            scope.orWhereRaw('o.path <@ ?::ltree', [own]).orWhereRaw('o.path @> ?::ltree', [own])
        })
    })
    .distinct()
}
