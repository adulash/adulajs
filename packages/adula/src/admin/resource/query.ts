import type { Knex } from 'knex'
import type { Field, JsonValue, RecordData, Resource } from '../../resource/types.js'
import { columnName } from '../../resource/define_resource.js'
import type { Actor } from '../../auth/ability.js'
import { accessibleBy, conditionSql } from '../../auth/sql.js'
import { fromRow, jsonValue, serialize } from '../contracts.js'
import { resolveActorConditions, type Conditions } from '../../auth/conditions.js'
import {
  AdulaError,
  forbiddenField,
  invalidCursor,
  invalidFilter,
  searchUnavailable,
} from '../errors.js'
import { fieldValue } from '../../resource/values.js'
import {
  authorizeAction,
  canQueryField,
  columns,
  hydrate,
  permissions,
  type ResourceContext,
  collectionFilter,
  withLinks,
} from './shared.js'
import { preload } from './read.js'

/** Per-process cache of planner row estimates for identical list queries. */
const estimates = new Map<string, { rows: number; at: number }>()
const ESTIMATE_TTL_MS = 30_000
const ESTIMATE_CACHE_LIMIT = 500

export type AggregateOptions = {
  /** Up to three queryable fields (docStatus and orgUnitId are also accepted). */
  groupBy?: string[]
  /** Count rows per group (default true). */
  count?: boolean
  /** Integer, money, decimal or percent fields to total per group; totals are decimal strings. */
  sum?: string[]
  /** Equality filters, as in list(). */
  filters?: Record<string, unknown>
  /** Role-rule style conditions ($eq, $ne, $in, $lt, $gt, $like, "$actor.id"). */
  where?: Conditions
  search?: string
}
export type AggregateRow = {
  group: Record<string, JsonValue>
  count?: number
  sum?: Record<string, string | null>
}
const AGGREGATE_GROUP_LIMIT = 1000

export type ListOptions = {
  limit?: number
  cursor?: string
  search?: string
  sort?: string
  direction?: 'asc' | 'desc'
  filters?: Record<string, unknown>
  /** Only records carrying this tag (see RecordCollaboration.setTags). */
  tag?: string
  estimate?: boolean
}

/**
 * Coerces a query-string or API filter/cursor value to the field's stored representation,
 * so a mismatch is rejected before PostgreSQL raises an invalid-input error.
 */
function queryValue(field: Field, value: unknown): unknown {
  if (value === null) return null
  let candidate: unknown = value
  switch (field.type) {
    case 'integer':
    case 'belongsTo':
    case 'user':
    case 'attachment':
      if (typeof value === 'string' && /^-?\d{1,10}$/.test(value)) candidate = Number(value)
      break
    // A multiSelect filter is one option it contains; a manyToMany filter one linked id.
    case 'multiSelect':
      return (
        fieldValue({ ...field, min: undefined, max: undefined }, [String(value)]) as string[]
      )[0]
    case 'manyToMany':
      return (
        fieldValue(field, [
          typeof value === 'string' && /^\d{1,10}$/.test(value) ? Number(value) : value,
        ]) as number[]
      )[0]
    case 'decimal':
    case 'percent':
    case 'enum':
    case 'email':
    case 'phone':
    case 'url':
      if (typeof value === 'number') candidate = String(value)
      break
    case 'boolean':
      if (value === 'true') candidate = true
      else if (value === 'false') candidate = false
      break
    case 'string':
    case 'text':
    case 'lookup':
      if (typeof value === 'number' || typeof value === 'boolean') candidate = String(value)
      break
    case 'money':
    case 'date':
    case 'datetime':
      break
    default:
      throw new Error('Field cannot be compared')
  }
  // Length, pattern and range limits describe stored values, not the probes compared with them.
  return fieldValue(
    { ...field, min: undefined, max: undefined, pattern: undefined } as Field,
    candidate
  )
}

/**
 * Equality filters shared by list() and aggregate(): each key must be a filterable field
 * the caller allows querying, and each value must coerce to the field's type.
 */
function applyFilters(
  query: Knex.QueryBuilder,
  resource: Resource,
  filters: Record<string, unknown>,
  queryable: (key: string) => boolean
) {
  for (const [key, value] of Object.entries(filters)) {
    if (!resource.fields[key]?.filterable || !queryable(key))
      throw invalidFilter('Unsupported filter')
    if (value !== null && !['string', 'number', 'boolean'].includes(typeof value))
      throw invalidFilter('Invalid filter value')
    let typed: unknown
    try {
      typed = queryValue(resource.fields[key], value)
    } catch {
      throw invalidFilter(`Invalid filter value: ${key}`)
    }
    const column = `r.${resource.fields[key].column ?? columnName(key)}`
    if (collectionFilter(query, resource, key, typed)) continue
    if (typed === null) query.whereNull(column)
    else query.where(column, typed as string)
  }
}

/** Full-text search, allowed only when the caller may query every searchable field. */
function applySearch(
  query: Knex.QueryBuilder,
  resource: Resource,
  search: string,
  queryable: (key: string) => boolean
) {
  const searchable = Object.entries(resource.fields).filter(([, f]) => f.searchable)
  if (!searchable.length || searchable.some(([key]) => !queryable(key))) throw searchUnavailable()
  query.whereRaw("r.search_vector @@ plainto_tsquery('simple', ?)", [search])
}

export async function list(
  ctx: ResourceContext,
  name: string,
  actor: Actor,
  options: ListOptions = {}
) {
  const resource = ctx.registry.get(name)
  const ability = authorizeAction(ctx, resource, actor, 'view')
  const queryable = (key: string) => canQueryField(resource, actor, ability, key)
  const limit = Math.max(1, Math.min(100, Math.floor(Number(options.limit) || 25)))
  const sort = options.sort ?? 'id'
  const direction = options.direction === 'desc' ? 'desc' : 'asc'
  if (sort !== 'id' && !resource.fields[sort]?.sortable)
    throw new AdulaError(422, 'E_SORT', 'Unsupported sort field')
  // Sorting/filtering private fields would otherwise reveal their values indirectly.
  if (sort !== 'id' && !queryable(sort)) throw forbiddenField('Forbidden sort field')
  const sortColumn = `r.${resource.fields[sort]?.column ?? columnName(sort)}`
  const query = accessibleBy(
    ctx.db(`${name} as r`).whereNull('r.deleted_at'),
    ability,
    actor,
    'view',
    resource
  )
  query.select(columns(resource, ability, false, [sort]))
  if (resource.scoped) query.select('ou.path as org_path')
  if (options.search) applySearch(query, resource, options.search, queryable)
  applyFilters(query, resource, options.filters ?? {}, queryable)
  if (options.tag !== undefined && options.tag !== null && options.tag !== '') {
    if (typeof options.tag !== 'string' || options.tag.length > 60)
      throw invalidFilter('Invalid tag filter')
    query.whereExists((exists) =>
      exists
        .from('taggables as tg')
        .join('tags as tn', 'tn.id', 'tg.tag_id')
        .where('tg.resource', name)
        .whereRaw('tg.record_id = r.id')
        .where('tn.name', options.tag as string)
    )
  }
  // Estimate the authorized, filtered query, never the deployment-wide table cardinality.
  // Only the first page pays for the extra planner round trip; later pages keep its figure.
  let estimatedTotal: number | undefined
  if (options.estimate !== false && !options.cursor) {
    estimatedTotal = await estimate(ctx.db, query)
  }
  if (options.cursor) {
    const cursor = decodeCursor(resource, options.cursor, sort, direction)
    query.where((q) => {
      if (cursor.value === null)
        q.whereNull(sortColumn).andWhere('r.id', direction === 'asc' ? '>' : '<', cursor.id)
      else
        q.where(sortColumn, direction === 'asc' ? '>' : '<', cursor.value as string)
          .orWhere((same) =>
            same
              .where(sortColumn, cursor.value as string)
              .andWhere('r.id', direction === 'asc' ? '>' : '<', cursor.id)
          )
          .orWhereNull(sortColumn)
    })
  }
  query.orderBy(sortColumn, direction, 'last')
  if (sort !== 'id') query.orderBy('r.id', direction)
  const rows = await query.limit(limit + 1)
  const records: RecordData[] = rows
    .slice(0, limit)
    .map((row: RecordData) => fromRow(row, resource))
  await withLinks(ctx.db, resource, records)
  const last = records.at(-1)
  if (estimatedTotal !== undefined) {
    estimatedTotal =
      !options.cursor && rows.length <= limit ? rows.length : Math.max(estimatedTotal, rows.length)
  }
  const hydrated = await hydrate(ctx.db, resource, records)
  return {
    data: hydrated.map((record) => serialize(resource, record, ability, actor)),
    permissions: Object.fromEntries(
      records.map((record) => [String(record.id), permissions(resource, record, actor, ability)])
    ),
    meta: {
      limit,
      estimatedTotal,
      nextCursor:
        rows.length > limit && last
          ? Buffer.from(
              JSON.stringify({ id: last.id, value: last[sort] ?? null, sort, direction })
            ).toString('base64url')
          : null,
    },
    related: await preload(ctx, resource, records, actor),
  }
}

/** The planner's row estimate of a list query, reused briefly for the identical query. */
async function estimate(db: Knex, query: Knex.QueryBuilder) {
  const compiled = query.clone().clearSelect().select('r.id').toSQL()
  // The planner estimate is approximate by nature; reuse it briefly for the same
  // authorized, filtered query instead of planning it on every first page.
  const key = `${compiled.sql}\u0000${JSON.stringify(compiled.bindings)}`
  const cached = estimates.get(key)
  if (cached && cached.at > Date.now() - ESTIMATE_TTL_MS) return cached.rows
  const plan = await db.raw(`EXPLAIN (FORMAT JSON) ${compiled.sql}`, [...compiled.bindings])
  const rows = Number(plan.rows[0]['QUERY PLAN'][0].Plan['Plan Rows'])
  if (estimates.size >= ESTIMATE_CACHE_LIMIT) estimates.delete(estimates.keys().next().value!)
  estimates.set(key, { rows, at: Date.now() })
  return rows
}

/** A keyset cursor of list(), checked against the current sort and the sort field's type. */
function decodeCursor(resource: Resource, encoded: unknown, sort: string, direction: string) {
  let cursor: { id: number; value: unknown; sort: string; direction: string }
  try {
    if (typeof encoded !== 'string') throw new Error('Cursor must be a string')
    cursor = JSON.parse(Buffer.from(encoded, 'base64url').toString())
  } catch {
    throw invalidCursor()
  }
  if (
    !cursor ||
    typeof cursor !== 'object' ||
    Array.isArray(cursor) ||
    cursor.sort !== sort ||
    cursor.direction !== direction ||
    !Number.isSafeInteger(cursor.id) ||
    cursor.id < 1 ||
    cursor.id > 2147483647 ||
    cursor.value === undefined ||
    (cursor.value !== null && !['number', 'string', 'boolean'].includes(typeof cursor.value))
  )
    throw invalidCursor()
  // The sort key must have the sort field's type, or PostgreSQL rejects the comparison.
  try {
    if (sort === 'id') {
      if (cursor.value !== cursor.id) throw new Error('Cursor id mismatch')
    } else cursor.value = fieldValue(resource.fields[sort], cursor.value)
  } catch {
    throw invalidCursor()
  }
  return cursor
}

/** Counts and totals over viewable records; see ResourceService.aggregate. */
export async function aggregate(
  ctx: ResourceContext,
  name: string,
  actor: Actor,
  options: AggregateOptions = {}
): Promise<{ rows: AggregateRow[]; truncated: boolean }> {
  const resource = ctx.registry.get(name)
  const ability = authorizeAction(ctx, resource, actor, 'view')
  const standard = new Set([
    ...(resource.submittable ? ['docStatus'] : []),
    ...(resource.scoped ? ['orgUnitId'] : []),
  ])
  const column = (key: string) => `r.${resource.fields[key]?.column ?? columnName(key)}`
  const queryable = (key: unknown, kinds?: string[]) => {
    if (typeof key !== 'string') return false
    if (standard.has(key)) return !kinds
    // Own keys only: names such as "constructor" are not fields.
    if (!Object.hasOwn(resource.fields, key)) return false
    const field = resource.fields[key]
    return (
      Boolean(field) &&
      !['hasMany', 'manyToMany', 'json', 'attachment'].includes(field.type) &&
      (!kinds || kinds.includes(field.type)) &&
      canQueryField(resource, actor, ability, key)
    )
  }
  const groupBy = options.groupBy ?? []
  const sums = options.sum ?? []
  if (!Array.isArray(groupBy) || groupBy.length > 3 || !Array.isArray(sums) || sums.length > 5)
    throw new AdulaError(422, 'E_AGGREGATE', 'Group by up to three fields and total up to five')
  for (const key of groupBy)
    if (!queryable(key)) throw forbiddenField(`Field cannot be grouped: ${String(key)}`)
  for (const key of sums)
    if (!queryable(key, ['integer', 'money', 'decimal', 'percent']))
      throw forbiddenField(`Field cannot be totalled: ${String(key)}`)
  const query = accessibleBy(
    ctx.db(`${name} as r`).whereNull('r.deleted_at'),
    ability,
    actor,
    'view',
    resource
  )
  applyFilters(query, resource, options.filters ?? {}, (key) => queryable(key))
  if (options.where !== undefined && options.where !== null) {
    if (typeof options.where !== 'object' || Array.isArray(options.where))
      throw invalidFilter('Conditions must be an object')
    for (const key of Object.keys(options.where))
      if (!queryable(key)) throw forbiddenField(`Field cannot be filtered: ${key}`)
    let where
    try {
      where = conditionSql(resolveActorConditions(options.where, actor.id), resource)
    } catch (error) {
      throw invalidFilter((error as Error).message)
    }
    query.whereRaw(where.text, where.bindings)
  }
  if (options.search) applySearch(query, resource, options.search, (key) => queryable(key))
  const selects: (string | Knex.Raw)[] = groupBy.map(
    (key, index) => `${key === 'docStatus' ? 'r.doc_status' : column(key)} as g${index}`
  )
  if (options.count !== false) selects.push(ctx.db.raw('count(*)::int as count'))
  sums.forEach((key, index) =>
    selects.push(ctx.db.raw(`sum(??)::text as s${index}`, [column(key)]))
  )
  query.select(selects)
  groupBy.forEach((_, index) => query.groupByRaw(`${index + 1}`))
  groupBy.forEach((_, index) => query.orderByRaw(`${index + 1} ASC NULLS LAST`))
  const rows = await query.limit(AGGREGATE_GROUP_LIMIT + 1)
  return {
    truncated: rows.length > AGGREGATE_GROUP_LIMIT,
    rows: rows.slice(0, AGGREGATE_GROUP_LIMIT).map((row: RecordData) => {
      const group = fromRow(
        Object.fromEntries(
          groupBy.map((key, index) => [
            key === 'docStatus'
              ? 'doc_status'
              : key === 'orgUnitId'
                ? 'org_unit_id'
                : (resource.fields[key].column ?? columnName(key)),
            row[`g${index}`],
          ])
        ),
        resource
      )
      return {
        group: Object.fromEntries(groupBy.map((key) => [key, jsonValue(group[key])])),
        ...(options.count !== false ? { count: Number(row.count) } : {}),
        ...(sums.length
          ? {
              sum: Object.fromEntries(
                sums.map((key, index) => [
                  key,
                  row[`s${index}`] === null ? null : String(row[`s${index}`]),
                ])
              ),
            }
          : {}),
      }
    }),
  }
}
