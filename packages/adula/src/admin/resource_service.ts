import { subject } from '@casl/ability'
import type { Knex } from 'knex'
import type { ResourceRegistry } from '../resource/registry.js'
import type {
  Action,
  Field,
  JsonValue,
  RecordData,
  Resource,
  SerializedRecord,
} from '../resource/types.js'
import { columnName } from '../resource/define_resource.js'
import {
  buildAbility,
  canRecord,
  inOrgScope,
  type Actor,
  type AdulaAbility,
} from '../auth/ability.js'
import { accessibleBy, conditionSql } from '../auth/sql.js'
import {
  fromRow,
  jsonValue,
  selectedFields,
  serialize,
  systemInput,
  writableInput,
} from './contracts.js'
import { resolveActorConditions, type Conditions } from '../auth/conditions.js'
import { AdulaError } from './errors.js'
import { sequence } from '../services/settings.js'
import { recordMutation, type FieldChange } from '../events/record_mutation.js'
import { formatTitle, titleFields } from './record_title.js'
import { fieldValue } from '../resource/values.js'
import { escapeLike } from '../core/like.js'
import {
  claimAttachment,
  isAttachmentId,
  loadAttachments,
  releaseAttachment,
} from '../attachments/attachment_service.js'
import type {
  RecordPermissions,
  ResourceDescription,
  ResourceNavigation,
  ResourceField,
} from './presentation.js'

/** Per-process cache of planner row estimates for identical list queries. */
const estimates = new Map<string, { rows: number; at: number }>()
const ESTIMATE_TTL_MS = 30_000
const ESTIMATE_CACHE_LIMIT = 500

export type AggregateOptions = {
  /** Up to three queryable fields (docStatus and orgUnitId are also accepted). */
  groupBy?: string[]
  /** Count rows per group (default true). */
  count?: boolean
  /** Integer or money fields to total per group; money totals are decimal strings. */
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
  return fieldValue(field, candidate)
}

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
 * Whether an actor may sort, filter or search by a field. Querying reveals values
 * indirectly, so it needs unconditional view access at the field's level.
 */
export function canQueryField(
  resource: Resource,
  actor: Actor,
  ability: AdulaAbility,
  key: string
) {
  const level = Math.max(
    resource.fields[key].permissionLevel ?? 0,
    resource.hidden?.includes(key) ? 1 : 0
  )
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

/** Options of ResourceService.systemSave. */
export type SystemSaveOptions = {
  /**
   * The user recorded as the author: created/updated by, activity and events. null is an
   * unattributed update by the system itself (for example a workflow whose triggering
   * event named no user): it runs the validator, hooks and lock, keeps updated_by, and
   * writes no activity entry or domain event because there is no author. Creates need one.
   */
  actorId: number | null
  /** Write inside the module's transaction. */
  trx?: Knex.Transaction
  /** Why module code wrote the record; stored with the activity entry. */
  reason?: string
  /** Optimistic lock: when given, it must match the stored version. */
  version?: number
  /**
   * The person who chose the values, when module code writes a choice made by a user,
   * such as a supervisor reassigning a record. A new value of a user field must then be
   * eligible for them as in a user save; without it, any active member qualifies on
   * unscoped resources.
   */
  chooser?: Actor
  /**
   * Also write a submitted document (docStatus 1), as workflow update steps do. Drafts
   * are always writable; cancelled documents stay locked.
   */
  submitted?: boolean
}

export class ResourceService {
  constructor(
    private db: Knex,
    private registry: ResourceRegistry
  ) {}

  /** The Arabic label of a registered resource, for notifications and titles. */
  label(name: string) {
    return this.registry.get(name).label.ar
  }

  /** Project navigation is derived from registered resources and the current actor. */
  navigation(actor: Actor): ResourceNavigation {
    const ability = buildAbility(actor.rules, this.registry.all())
    const children = new Set(
      this.registry
        .all()
        .flatMap((resource) =>
          Object.values(resource.fields).flatMap((field) =>
            field.type === 'hasMany' ? [field.resource] : []
          )
        )
    )
    return this.registry
      .all()
      .filter(
        (resource) =>
          !children.has(resource.name) &&
          resource.actions.includes('view') &&
          (!resource.scoped || actor.orgPaths.length > 0) &&
          ability.can('view', resource.name)
      )
      .map((resource) => ({
        name: resource.name,
        label: resource.label.ar,
        href: `/resources/${resource.name}`,
        module: this.registry.owner(resource.name),
        moduleLabel:
          this.registry
            .modules()
            .find((module) => module.name === this.registry.owner(resource.name))?.label.ar ??
          this.registry.owner(resource.name),
      }))
  }

  describe(name: string, actor: Actor): ResourceDescription {
    const resource = this.registry.get(name)
    const ability = this.authorizeAction(resource, actor, 'view')
    const serialized = new Set(resource.serialize ?? [...resource.list, ...resource.show])
    const fields = Object.entries(resource.fields)
      .filter(
        ([key, field]) =>
          serialized.has(key) &&
          actor.permissionLevel >=
            Math.max(field.permissionLevel ?? 0, resource.hidden?.includes(key) ? 1 : 0) &&
          ability.can('view', name, key)
      )
      .map(([key, field]) => ({
        ...field,
        key,
        sortable: Boolean(field.sortable && this.canQueryField(resource, actor, ability, key)),
        filterable: Boolean(field.filterable && this.canQueryField(resource, actor, ability, key)),
      }))
    const visible = new Set(fields.map((field) => field.key))
    const searchable = Object.entries(resource.fields).filter(([, field]) => field.searchable)
    return {
      name,
      label: resource.label.ar,
      recordLabel: resource.recordLabel?.ar ?? null,
      createLabel: resource.createLabel?.ar ?? null,
      fields,
      list: resource.list.filter((key) => visible.has(key)),
      show: resource.show.filter((key) => visible.has(key)),
      searchable:
        searchable.length > 0 &&
        searchable.every(([key]) => this.canQueryField(resource, actor, ability, key)),
      canCreate: resource.actions.includes('create') && ability.can('create', name),
      scoped: resource.scoped,
      submittable: Boolean(resource.submittable),
    }
  }

  private permissions(
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

  private normalizeValues(resource: Resource, record: RecordData) {
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
  private async hydrate(db: Knex, resource: Resource, records: RecordData[]) {
    const keys = Object.keys(resource.fields).filter(
      (key) => resource.fields[key].type === 'attachment'
    )
    if (!keys.length || !records.length) return records
    const ids = records.flatMap((record) => keys.map((key) => record[key]).filter(isAttachmentId))
    const summaries = await loadAttachments(db, ids)
    return records.map((record) => {
      const copy = { ...record }
      for (const key of keys)
        if (key in copy)
          copy[key] = isAttachmentId(copy[key]) ? (summaries.get(copy[key]) ?? null) : null
      return copy
    })
  }
  private async hydrateOne(db: Knex, resource: Resource, record: RecordData) {
    const [hydrated] = await this.hydrate(db, resource, [record])
    return hydrated
  }

  private authorizeAction(resource: Resource, actor: Actor, action: Action) {
    const ability = buildAbility(actor.rules, this.registry.all())
    if (!resource.actions.includes(action) || !ability.can(action, resource.name))
      throw new AdulaError(403, 'E_FORBIDDEN', 'ليس لديك صلاحية لهذا الإجراء')
    for (const rule of ability.rulesFor(action, resource.name))
      conditionSql(rule.conditions, resource)
    return ability
  }

  private scopedQuery(db: Knex, resource: Resource, actor: Actor) {
    const query = db(`${resource.name} as r`).whereNull('r.deleted_at')
    if (resource.scoped) {
      query.join('org_units as ou', 'ou.id', 'r.org_unit_id').where((scope) => {
        if (!actor.orgPaths.length) scope.whereRaw('FALSE')
        actor.orgPaths.forEach((path) => scope.orWhereRaw('ou.path <@ ?::ltree', [path]))
      })
    }
    return query
  }
  private columns(resource: Resource, ability: AdulaAbility, write = false, extra: string[] = []) {
    return selectedFields(resource, ability, { write, extra }).map(
      (key) => `r.${resource.fields[key]?.column ?? columnName(key)}`
    )
  }
  private async find(
    db: Knex,
    resource: Resource,
    actor: Actor,
    ability: AdulaAbility,
    id: number,
    lock = false
  ) {
    const query = this.scopedQuery(db, resource, actor)
      .where('r.id', id)
      .select(this.columns(resource, ability, lock))
    if (resource.scoped) query.select('ou.path as org_path')
    if (lock) query.forUpdate('r')
    const row = await query.first()
    if (!row) throw new AdulaError(404, 'E_NOT_FOUND', 'السجل غير موجود')
    return fromRow(row, resource)
  }
  /** A live record regardless of any actor's scope, for system writes. */
  private async findAny(db: Knex, resource: Resource, id: number, lock = false) {
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
    if (!row) throw new AdulaError(404, 'E_NOT_FOUND', 'السجل غير موجود')
    return fromRow(row, resource)
  }
  private requireRecord(
    ability: AdulaAbility,
    actor: Actor,
    resource: Resource,
    action: Action,
    record: RecordData
  ) {
    if (resource.scoped && !inOrgScope(record.orgPath, actor.orgPaths))
      throw new AdulaError(404, 'E_NOT_FOUND', 'السجل غير موجود')
    if (!canRecord(ability, actor, resource, action, record))
      throw new AdulaError(403, 'E_FORBIDDEN', 'ليس لديك صلاحية لهذا الإجراء')
  }

  /**
   * Authorizes one record for collaboration features (comments, tags, assignments...).
   * Scope and conditional rules apply exactly as for show/update.
   */
  async access(
    name: string,
    id: number,
    actor: Actor,
    action: Action = 'view',
    db: Knex = this.db
  ) {
    let resource: Resource
    try {
      resource = this.registry.get(name)
    } catch {
      throw new AdulaError(404, 'E_NOT_FOUND', 'الكيان غير موجود')
    }
    if (!Number.isSafeInteger(id) || id <= 0)
      throw new AdulaError(404, 'E_NOT_FOUND', 'السجل غير موجود')
    const ability = this.authorizeAction(resource, actor, action)
    const record = await this.find(db, resource, actor, ability, id)
    this.requireRecord(ability, actor, resource, action, record)
    return { resource, record, ability }
  }

  /** Whether a (possibly other) actor may perform an action on a record; never throws for denial. */
  async permits(name: string, id: number, actor: Actor, action: Action = 'view') {
    try {
      await this.access(name, id, actor, action)
      return true
    } catch (error) {
      if (error instanceof AdulaError && [403, 404].includes(error.status)) return false
      throw error
    }
  }

  async list(name: string, actor: Actor, options: ListOptions = {}) {
    const resource = this.registry.get(name)
    const ability = this.authorizeAction(resource, actor, 'view')
    const limit = Math.max(1, Math.min(100, Math.floor(Number(options.limit) || 25)))
    const sort = options.sort ?? 'id'
    const direction = options.direction === 'desc' ? 'desc' : 'asc'
    if (sort !== 'id' && !resource.fields[sort]?.sortable)
      throw new AdulaError(422, 'E_SORT', 'Unsupported sort field')
    // Sorting/filtering private fields would otherwise reveal their values indirectly.
    if (sort !== 'id' && !this.canQueryField(resource, actor, ability, sort))
      throw new AdulaError(403, 'E_FIELD_FORBIDDEN', 'Forbidden sort field')
    const sortColumn = `r.${resource.fields[sort]?.column ?? columnName(sort)}`
    const query = accessibleBy(
      this.db(`${name} as r`).whereNull('r.deleted_at'),
      ability,
      actor,
      'view',
      resource
    )
    query.select(this.columns(resource, ability, false, [sort]))
    if (resource.scoped) query.select('ou.path as org_path')
    if (options.search) {
      const searchable = Object.entries(resource.fields).filter(([, f]) => f.searchable)
      if (
        !searchable.length ||
        searchable.some(([key]) => !this.canQueryField(resource, actor, ability, key))
      )
        throw new AdulaError(403, 'E_SEARCH', 'Search is unavailable')
      query.whereRaw("r.search_vector @@ plainto_tsquery('simple', ?)", [options.search])
    }
    for (const [key, value] of Object.entries(options.filters ?? {})) {
      if (!resource.fields[key]?.filterable || !this.canQueryField(resource, actor, ability, key))
        throw new AdulaError(422, 'E_FILTER', 'Unsupported filter')
      if (value !== null && !['string', 'number', 'boolean'].includes(typeof value))
        throw new AdulaError(422, 'E_FILTER', 'Invalid filter value')
      let typed: unknown
      try {
        typed = queryValue(resource.fields[key], value)
      } catch {
        throw new AdulaError(422, 'E_FILTER', `Invalid filter value: ${key}`)
      }
      if (typed === null) query.whereNull(`r.${resource.fields[key].column ?? columnName(key)}`)
      else query.where(`r.${resource.fields[key].column ?? columnName(key)}`, typed as string)
    }
    if (options.tag !== undefined && options.tag !== null && options.tag !== '') {
      if (typeof options.tag !== 'string' || options.tag.length > 60)
        throw new AdulaError(422, 'E_FILTER', 'Invalid tag filter')
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
      const compiled = query.clone().clearSelect().select('r.id').toSQL()
      // The planner estimate is approximate by nature; reuse it briefly for the same
      // authorized, filtered query instead of planning it on every first page.
      const key = `${compiled.sql}\u0000${JSON.stringify(compiled.bindings)}`
      const cached = estimates.get(key)
      if (cached && cached.at > Date.now() - ESTIMATE_TTL_MS) estimatedTotal = cached.rows
      else {
        const estimate = await this.db.raw(`EXPLAIN (FORMAT JSON) ${compiled.sql}`, [
          ...compiled.bindings,
        ])
        estimatedTotal = Number(estimate.rows[0]['QUERY PLAN'][0].Plan['Plan Rows'])
        if (estimates.size >= ESTIMATE_CACHE_LIMIT) estimates.delete(estimates.keys().next().value!)
        estimates.set(key, { rows: estimatedTotal, at: Date.now() })
      }
    }
    if (options.cursor) {
      let cursor: { id: number; value: unknown; sort: string; direction: string }
      try {
        if (typeof options.cursor !== 'string') throw new Error('Cursor must be a string')
        cursor = JSON.parse(Buffer.from(options.cursor, 'base64url').toString())
      } catch {
        throw new AdulaError(422, 'E_CURSOR', 'Invalid cursor')
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
        throw new AdulaError(422, 'E_CURSOR', 'Invalid cursor')
      // The sort key must have the sort field's type, or PostgreSQL rejects the comparison.
      try {
        if (sort === 'id') {
          if (cursor.value !== cursor.id) throw new Error('Cursor id mismatch')
        } else cursor.value = fieldValue(resource.fields[sort], cursor.value)
      } catch {
        throw new AdulaError(422, 'E_CURSOR', 'Invalid cursor')
      }
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
    const last = records.at(-1)
    if (estimatedTotal !== undefined) {
      estimatedTotal =
        !options.cursor && rows.length <= limit
          ? rows.length
          : Math.max(estimatedTotal, rows.length)
    }
    const hydrated = await this.hydrate(this.db, resource, records)
    return {
      data: hydrated.map((record) => serialize(resource, record, ability, actor)),
      permissions: Object.fromEntries(
        records.map((record) => [
          String(record.id),
          this.permissions(resource, record, actor, ability),
        ])
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
      related: await this.preload(resource, records, actor),
    }
  }
  private canQueryField(resource: Resource, actor: Actor, ability: AdulaAbility, key: string) {
    return canQueryField(resource, actor, ability, key)
  }

  /**
   * Counts and totals over the records the actor may view, grouped by queryable fields,
   * for dashboards. Authorization is list()'s: the same rules, organization scope and
   * soft-delete filter apply, and every grouped, totalled or filtered field must be one
   * the actor may query (E_FIELD_FORBIDDEN otherwise), so no hidden value leaks.
   */
  async aggregate(
    name: string,
    actor: Actor,
    options: AggregateOptions = {}
  ): Promise<{ rows: AggregateRow[]; truncated: boolean }> {
    const resource = this.registry.get(name)
    const ability = this.authorizeAction(resource, actor, 'view')
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
        !['hasMany', 'json', 'attachment'].includes(field.type) &&
        (!kinds || kinds.includes(field.type)) &&
        this.canQueryField(resource, actor, ability, key)
      )
    }
    const groupBy = options.groupBy ?? []
    const sums = options.sum ?? []
    if (!Array.isArray(groupBy) || groupBy.length > 3 || !Array.isArray(sums) || sums.length > 5)
      throw new AdulaError(422, 'E_AGGREGATE', 'Group by up to three fields and total up to five')
    for (const key of groupBy)
      if (!queryable(key))
        throw new AdulaError(403, 'E_FIELD_FORBIDDEN', `Field cannot be grouped: ${String(key)}`)
    for (const key of sums)
      if (!queryable(key, ['integer', 'money']))
        throw new AdulaError(403, 'E_FIELD_FORBIDDEN', `Field cannot be totalled: ${String(key)}`)
    const query = accessibleBy(
      this.db(`${name} as r`).whereNull('r.deleted_at'),
      ability,
      actor,
      'view',
      resource
    )
    for (const [key, value] of Object.entries(options.filters ?? {})) {
      if (!resource.fields[key]?.filterable || !queryable(key))
        throw new AdulaError(422, 'E_FILTER', 'Unsupported filter')
      if (value !== null && !['string', 'number', 'boolean'].includes(typeof value))
        throw new AdulaError(422, 'E_FILTER', 'Invalid filter value')
      let typed: unknown
      try {
        typed = queryValue(resource.fields[key], value)
      } catch {
        throw new AdulaError(422, 'E_FILTER', `Invalid filter value: ${key}`)
      }
      if (typed === null) query.whereNull(column(key))
      else query.where(column(key), typed as string)
    }
    if (options.where !== undefined && options.where !== null) {
      if (typeof options.where !== 'object' || Array.isArray(options.where))
        throw new AdulaError(422, 'E_FILTER', 'Conditions must be an object')
      for (const key of Object.keys(options.where))
        if (!queryable(key))
          throw new AdulaError(403, 'E_FIELD_FORBIDDEN', `Field cannot be filtered: ${key}`)
      let where
      try {
        where = conditionSql(resolveActorConditions(options.where, actor.id), resource)
      } catch (error) {
        throw new AdulaError(422, 'E_FILTER', (error as Error).message)
      }
      query.whereRaw(where.text, where.bindings)
    }
    if (options.search) {
      const searchable = Object.entries(resource.fields).filter(([, f]) => f.searchable)
      if (!searchable.length || searchable.some(([key]) => !queryable(key)))
        throw new AdulaError(403, 'E_SEARCH', 'Search is unavailable')
      query.whereRaw("r.search_vector @@ plainto_tsquery('simple', ?)", [options.search])
    }
    const selects: (string | Knex.Raw)[] = groupBy.map(
      (key, index) => `${key === 'docStatus' ? 'r.doc_status' : column(key)} as g${index}`
    )
    if (options.count !== false) selects.push(this.db.raw('count(*)::int as count'))
    sums.forEach((key, index) =>
      selects.push(this.db.raw(`sum(??)::text as s${index}`, [column(key)]))
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
  private async preload(resource: Resource, records: RecordData[], actor: Actor) {
    const related: Record<string, SerializedRecord[]> = {}
    const ability = buildAbility(actor.rules, this.registry.all())
    for (const [key, field] of Object.entries(resource.fields)) {
      if (field.type === 'user' && records.length) {
        const ids = records
          .filter((record) => key in serialize(resource, record, ability, actor))
          .map((record) => record[key])
          .filter((v) => v !== null && v !== undefined) as number[]
        // A display name only: readers of the record need not read account e-mails.
        if (ids.length) {
          const users = await this.db('users')
            .whereIn('id', [...new Set(ids)])
            .select('id', 'full_name')
          related[key] = users.map((row) => ({
            id: Number(row.id),
            fullName: String(row.full_name ?? ''),
          }))
        }
        continue
      }
      if (field.type !== 'belongsTo' || !records.length) continue
      const target = this.registry.get(field.resource)
      if (!ability.can('view', target.name)) continue
      const ids = records
        .filter((record) => key in serialize(resource, record, ability, actor))
        .map((record) => record[key])
        .filter((v) => v !== null && v !== undefined) as number[]
      if (!ids.length) continue
      const query = accessibleBy(
        this.db(`${target.name} as r`).whereIn('r.id', ids).whereNull('r.deleted_at'),
        ability,
        actor,
        'view',
        target
      ).select(this.columns(target, ability))
      if (target.scoped) query.select('ou.path as org_path')
      const rows = await query
      const targets = await this.hydrate(
        this.db,
        target,
        rows.map((r: RecordData) => fromRow(r, target))
      )
      const title = await this.titler(target)
      related[key] = targets.map((r) => {
        const row = serialize(target, r, ability, actor)
        // `_title` cannot collide with a field key; clients label the relation with it.
        return { ...row, _title: title(row) }
      })
    }
    return related
  }

  /** Formats record titles of one resource, loading the labels of its title lookups once. */
  private async titler(resource: Resource) {
    const groups = titleFields(resource).flatMap((key) => {
      const field = resource.fields[key]
      return field.type === 'lookup' ? [field.group] : []
    })
    const labels = new Map<string, string>()
    if (groups.length)
      for (const row of await this.db('lookups')
        .whereIn('group', groups)
        .select('group', 'key', 'label_ar'))
        labels.set(`${row.group}\u0000${row.key}`, String(row.label_ar))
    return (record: SerializedRecord) =>
      formatTitle(resource, record, (group, key) => labels.get(`${group}\u0000${key}`))
  }

  /**
   * Titles of records the actor may view, read under the actor's field access (#32).
   * Records the actor cannot view are left out; callers fall back to the record id.
   */
  async titles(name: string, ids: readonly number[], actor: Actor): Promise<Map<number, string>> {
    const result = new Map<number, string>()
    let resource: Resource
    try {
      resource = this.registry.get(name)
    } catch {
      return result
    }
    const wanted = [...new Set(ids.filter((id) => Number.isSafeInteger(id) && id > 0))]
    const ability = buildAbility(actor.rules, this.registry.all())
    if (!wanted.length || !resource.actions.includes('view') || !ability.can('view', name))
      return result
    const query = accessibleBy(
      this.db(`${resource.name} as r`).whereIn('r.id', wanted).whereNull('r.deleted_at'),
      ability,
      actor,
      'view',
      resource
    ).select(this.columns(resource, ability))
    if (resource.scoped) query.select('ou.path as org_path')
    const rows: RecordData[] = await query
    const records = rows.map((row) => fromRow(row, resource))
    const title = await this.titler(resource)
    for (const record of records) {
      if (!canRecord(ability, actor, resource, 'view', record)) continue
      const text = title(serialize(resource, record, ability, actor))
      if (text) result.set(Number(record.id), text)
    }
    return result
  }
  async show(name: string, id: number, actor: Actor) {
    const resource = this.registry.get(name)
    const ability = this.authorizeAction(resource, actor, 'view')
    const record = await this.find(this.db, resource, actor, ability, id)
    this.requireRecord(ability, actor, resource, 'view', record)
    const [hydrated] = await this.hydrate(this.db, resource, [record])
    return {
      data: serialize(resource, hydrated, ability, actor),
      permissions: this.permissions(resource, record, actor, ability),
      related: await this.preload(resource, [record], actor),
    }
  }
  async relationOptions(
    name: string,
    key: string,
    actor: Actor,
    options: {
      id?: number
      search?: string
      cursor?: string
      /** User fields: the organization unit chosen in the form. */
      orgUnitId?: number
      /** User fields: choices for a list filter instead of a form. */
      purpose?: 'form' | 'filter'
    } = {}
  ) {
    if (this.registry.get(name).fields[key]?.type === 'user')
      return this.userOptions(name, key, actor, options)
    const editor = await this.editor(name, actor, options.id)
    const field = editor.fields.find((entry) => entry.key === key)
    if (!field || field.type !== 'belongsTo')
      throw new AdulaError(403, 'E_FIELD_FORBIDDEN', 'ليس لديك صلاحية لهذا الحقل')
    const target = this.registry.get(field.resource)
    const page = await this.list(target.name, actor, {
      search: options.search,
      cursor: options.cursor,
      limit: 50,
      estimate: false,
    })
    const title = await this.titler(target)
    return {
      data: page.data.map((row) => ({
        value: String(row.id),
        label: title(row) ?? `#${row.id}`,
      })),
      nextCursor: page.meta.nextCursor,
    }
  }

  /**
   * Choices for a user field. A form lists active members of the record's unit or its
   * ancestors (the users the record is visible to through membership); a filter lists
   * active users who share organization scope with the actor. Only names are returned.
   */
  private async userOptions(
    name: string,
    key: string,
    actor: Actor,
    options: { id?: number; search?: string; cursor?: string; orgUnitId?: number; purpose?: string }
  ) {
    const resource = this.registry.get(name)
    let path: string | null = null
    if (options.purpose === 'filter') {
      const field = this.describe(name, actor).fields.find((entry) => entry.key === key)
      if (!field?.filterable)
        throw new AdulaError(403, 'E_FIELD_FORBIDDEN', 'ليس لديك صلاحية لهذا الحقل')
    } else {
      const editor = await this.editor(name, actor, options.id)
      if (!editor.fields.some((entry) => entry.key === key))
        throw new AdulaError(403, 'E_FIELD_FORBIDDEN', 'ليس لديك صلاحية لهذا الحقل')
      if (resource.scoped) {
        const unit =
          options.orgUnitId ??
          (editor.record?.orgUnitId === undefined ? undefined : Number(editor.record.orgUnitId))
        // Without a unit (for example an inline row) the choices follow the actor's scope;
        // saving still checks the record's unit.
        if (unit !== undefined) {
          const row = await this.db('org_units').where('id', unit).first('path')
          // Only units the actor works in (or the record's current unit) may be probed.
          if (
            !row ||
            (!inOrgScope(row.path, actor.orgPaths) &&
              Number(unit) !== Number(editor.record?.orgUnitId))
          )
            return { data: [], nextCursor: null }
          path = String(row.path)
        }
      }
    }
    let after = 0
    if (options.cursor !== undefined && options.cursor !== '') {
      after = Number(options.cursor)
      if (!Number.isSafeInteger(after) || after < 0)
        throw new AdulaError(422, 'E_CURSOR', 'Invalid cursor')
    }
    const query = this.eligibleUsers(this.db, path, actor)
      .where('u.id', '>', after)
      .orderBy('u.id')
      .limit(51)
      .select('u.id', 'u.full_name')
    if (options.search) query.whereILike('u.full_name', `%${escapeLike(options.search)}%`)
    const rows = await query
    return {
      data: rows.slice(0, 50).map((row) => ({
        value: String(row.id),
        label: String(row.full_name || `#${row.id}`),
      })),
      nextCursor: rows.length > 50 ? String(rows[49].id) : null,
    }
  }

  /**
   * Active users eligible for a user field: members of the unit at `path` or of one of
   * its ancestors, or (without a path) users sharing organization scope with the actor.
   * A system write on an unscoped resource passes no actor: any active member qualifies.
   */
  private eligibleUsers(db: Knex, path: string | null, actor: Actor | null) {
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

  /** Deferred relation reads re-authorize the parent and each child on every request. */
  async children(name: string, id: number, actor: Actor) {
    const resource = this.registry.get(name)
    const ability = this.authorizeAction(resource, actor, 'view')
    const parent = await this.find(this.db, resource, actor, ability, id)
    this.requireRecord(ability, actor, resource, 'view', parent)
    return this.childrenOf(resource, parent, actor, ability)
  }
  /** Inline children of an already authorized parent record. */
  private async childrenOf(
    resource: Resource,
    parent: RecordData,
    actor: Actor,
    ability: AdulaAbility
  ) {
    const name = resource.name
    const id = Number(parent.id)
    const result: Record<string, { rows: SerializedRecord[]; hasMore: boolean }> = {}
    for (const key of resource.show) {
      const field = resource.fields[key]
      if (
        field.type !== 'hasMany' ||
        !ability.can('view', subject(name, parent), key) ||
        actor.permissionLevel <
          Math.max(field.permissionLevel ?? 0, resource.hidden?.includes(key) ? 1 : 0)
      )
        continue
      if (resource.serialize && !resource.serialize.includes(key)) continue
      const child = this.registry.get(field.resource)
      if (!ability.can('view', child.name) || !child.actions.includes('view')) continue
      const rows = await accessibleBy(
        this.db(`${child.name} as r`).whereNull('r.deleted_at'),
        ability,
        actor,
        'view',
        child
      )
        .where(`r.${child.fields[field.foreignKey].column ?? columnName(field.foreignKey)}`, id)
        .select([...this.columns(child, ability), ...(child.scoped ? ['ou.path as org_path'] : [])])
        .orderBy('r.id')
        .limit(101)
      const children = await this.hydrate(
        this.db,
        child,
        rows.slice(0, 100).map((row: RecordData) => fromRow(row, child))
      )
      result[key] = {
        rows: children.map((row) => serialize(child, row, ability, actor)),
        hasMore: rows.length > 100,
      }
    }
    return result
  }
  /** Active lookup labels for the lookup fields the actor may read on this resource. */
  async lookups(name: string, actor: Actor) {
    const options: Record<string, { value: string; label: string }[]> = {}
    for (const field of this.describe(name, actor).fields) {
      if (field.type !== 'lookup') continue
      const rows = await this.db('lookups')
        .where({ group: field.group, active: true })
        .orderBy(['sort', 'id'])
        .select('key', 'label_ar')
      options[field.key] = rows.map((row) => ({ value: row.key, label: row.label_ar }))
    }
    return options
  }
  /** The last 50 recorded mutations of one record, after authorizing the record itself. */
  async activity(name: string, id: number, actor: Actor) {
    const resource = this.registry.get(name)
    const ability = this.authorizeAction(resource, actor, 'view')
    const record = await this.find(this.db, resource, actor, ability, id)
    this.requireRecord(ability, actor, resource, 'view', record)
    return this.activityOf(name, id)
  }

  /**
   * Inline children and recent activity of one record, authorized with a single record
   * read (for deferred page props that would otherwise read the record twice).
   */
  async details(name: string, id: number, actor: Actor) {
    const resource = this.registry.get(name)
    const ability = this.authorizeAction(resource, actor, 'view')
    const record = await this.find(this.db, resource, actor, ability, id)
    this.requireRecord(ability, actor, resource, 'view', record)
    return {
      children: await this.childrenOf(resource, record, actor, ability),
      activity: await this.activityOf(name, id),
    }
  }

  /** show(), children() and activity() of one record from a single record read. */
  async record(name: string, id: number, actor: Actor) {
    const resource = this.registry.get(name)
    const ability = this.authorizeAction(resource, actor, 'view')
    const record = await this.find(this.db, resource, actor, ability, id)
    this.requireRecord(ability, actor, resource, 'view', record)
    const [hydrated] = await this.hydrate(this.db, resource, [record])
    return {
      data: serialize(resource, hydrated, ability, actor),
      permissions: this.permissions(resource, record, actor, ability),
      related: await this.preload(resource, [record], actor),
      children: await this.childrenOf(resource, record, actor, ability),
      activity: await this.activityOf(name, id),
    }
  }

  private async activityOf(name: string, id: number) {
    const rows = await this.db('activities as a')
      .leftJoin('users as u', 'u.id', 'a.actor_id')
      .where({ 'a.resource': name, 'a.record_id': id })
      .orderBy('a.id', 'desc')
      .limit(50)
      .select(
        'a.id',
        'a.action',
        'a.changes',
        'a.actor_id',
        'a.created_at',
        'u.full_name as actor_name'
      )
    return rows.map((row) => ({
      id: Number(row.id),
      action: String(row.action) as Action,
      fields: Array.isArray(row.changes?.fields) ? (row.changes.fields as string[]) : [],
      actorId: Number(row.actor_id),
      // A display name only: record viewers need not be able to read account e-mails.
      actorName: row.actor_name ? String(row.actor_name) : null,
      /**
       * @deprecated Always null. Kept so project-owned copies of resource-show from
       * earlier releases still compile; they fall back to the actor id.
       */
      actorEmail: null as string | null,
      createdAt: new Date(row.created_at).toISOString(),
    }))
  }
  /**
   * The form description for create (no id) or update. `defaults` pre-fills a create form
   * (#48), for example `?defaults[violation]=13`: only visible form fields are used, a
   * related record must be viewable by the actor and a lookup must be active. Anything else
   * is dropped. Defaults are only initial values; saving validates as usual.
   */
  async editor(
    name: string,
    actor: Actor,
    id?: number,
    request: { defaults?: Record<string, unknown> } = {}
  ) {
    const resource = this.registry.get(name)
    const action = id === undefined ? 'create' : 'update'
    const ability = this.authorizeAction(resource, actor, action)
    const record =
      id === undefined ? undefined : await this.find(this.db, resource, actor, ability, id)
    if (record) {
      this.requireRecord(ability, actor, resource, action, record)
      if (resource.submittable && record.docStatus !== 0)
        throw new AdulaError(409, 'E_DOCUMENT_LOCKED', 'Only draft documents can be edited')
    }
    const fields = resource.form
      .filter((key) => {
        const field = resource.fields[key]
        return (
          !field.sequence &&
          actor.permissionLevel >=
            Math.max(field.permissionLevel ?? 0, resource.hidden?.includes(key) ? 1 : 0) &&
          ability.can(action, record ? subject(name, record) : name, key)
        )
      })
      .map((key) => ({ key, ...resource.fields[key] }))
    const options: Record<string, { value: string; label: string }[]> = {}
    const relationSearch: Record<string, boolean> = {}
    const inline: Record<
      string,
      {
        rows: SerializedRecord[]
        hasMore: boolean
        canCreate: boolean
        permissions: Record<string, { update: boolean; delete: boolean }>
        fields: ResourceField[]
        createFields: string[]
        updateFields: Record<string, string[]>
      }
    > = {}
    for (const field of fields) {
      if (field.type === 'hasMany' && field.inline) {
        const child = this.registry.get(field.resource)
        const rows: RecordData[] =
          record && ability.can('view', child.name)
            ? await accessibleBy(
                this.db(`${child.name} as r`).whereNull('r.deleted_at'),
                ability,
                actor,
                'view',
                child
              )
                .where(
                  `r.${child.fields[field.foreignKey].column ?? columnName(field.foreignKey)}`,
                  id
                )
                .select([
                  ...this.columns(child, ability),
                  ...(child.scoped ? ['ou.path as org_path'] : []),
                ])
                .orderBy('r.id')
                .limit(101)
            : []
        const records = rows.slice(0, 100).map((row) => fromRow(row, child))
        const hydratedRows = await this.hydrate(this.db, child, records)
        const childFields = child.form.filter(
          (key) =>
            key !== field.foreignKey &&
            !child.fields[key].sequence &&
            actor.permissionLevel >=
              Math.max(child.fields[key].permissionLevel ?? 0, child.hidden?.includes(key) ? 1 : 0)
        )
        inline[field.key] = {
          fields: childFields.map((key) => ({ key, ...child.fields[key] })),
          createFields: childFields.filter((key) => ability.can('create', child.name, key)),
          updateFields: Object.fromEntries(
            records.map((row) => [
              String(row.id),
              childFields.filter((key) => ability.can('update', subject(child.name, row), key)),
            ])
          ),
          rows: hydratedRows.map((row) => serialize(child, row, ability, actor)),
          hasMore: rows.length > 100,
          canCreate: child.actions.includes('create') && ability.can('create', child.name),
          permissions: Object.fromEntries(
            records.map((row) => [
              String(row.id),
              {
                update:
                  child.actions.includes('update') &&
                  ability.can('update', subject(child.name, row)),
                delete:
                  child.actions.includes('delete') &&
                  ability.can('delete', subject(child.name, row)),
              },
            ])
          ),
        }
      }
      if (field.type === 'lookup') {
        const lookups = await this.db('lookups')
          .where({ group: field.group, active: true })
          .orderBy('id')
          .select('key', 'label_ar')
        options[field.key] = lookups.map((row) => ({ value: row.key, label: row.label_ar }))
      } else if (field.type === 'belongsTo') {
        const target = this.registry.get(field.resource)
        if (ability.can('view', target.name)) {
          relationSearch[field.key] = this.describe(target.name, actor).searchable
          const page = await this.list(target.name, actor, { limit: 50, estimate: false })
          const title = await this.titler(target)
          options[field.key] = page.data.map((row) => ({
            value: String(row.id),
            label: title(row) ?? `#${row.id}`,
          }))
          const selected = record?.[field.key]
          if (
            selected !== null &&
            selected !== undefined &&
            !options[field.key].some((option) => option.value === String(selected))
          ) {
            try {
              const current = await this.show(target.name, Number(selected), actor)
              options[field.key].push({
                value: String(current.data.id),
                label: title(current.data) ?? `#${current.data.id}`,
              })
            } catch (error) {
              if (!(error instanceof AdulaError) || ![403, 404].includes(error.status)) throw error
            }
          }
        } else options[field.key] = []
      } else if (field.type === 'user') {
        // Choices depend on the unit chosen in the form; they load from relationOptions.
        relationSearch[field.key] = true
        options[field.key] = []
        const selected = record?.[field.key]
        if (selected !== null && selected !== undefined) {
          const current = await this.db('users')
            .where('id', Number(selected))
            .first('id', 'full_name')
          if (current)
            options[field.key].push({
              value: String(current.id),
              label: String(current.full_name || `#${current.id}`),
            })
        }
      }
    }
    const units =
      resource.scoped && !resource.scope
        ? await this.db('org_units')
            .where((query) => {
              if (!actor.orgPaths.length) query.whereRaw('FALSE')
              for (const path of actor.orgPaths) query.orWhereRaw('path <@ ?::ltree', [path])
            })
            .orderBy('path')
            .limit(100)
            .select('id', 'name')
        : []
    if (record?.orgUnitId && !units.some((unit) => Number(unit.id) === Number(record.orgUnitId))) {
      const current = await this.db('org_units')
        .where('id', Number(record.orgUnitId))
        .first('id', 'name')
      if (current) units.push(current)
    }
    const defaults: SerializedRecord = {}
    const requested = request.defaults
    if (id === undefined && requested && typeof requested === 'object')
      for (const field of fields) {
        const raw = Object.hasOwn(requested, field.key) ? requested[field.key] : undefined
        if (typeof raw !== 'string' && typeof raw !== 'number' && typeof raw !== 'boolean') continue
        let value: unknown = raw
        try {
          if (['integer', 'belongsTo', 'user'].includes(field.type)) value = Number(raw)
          else if (field.type === 'boolean') value = raw === true || raw === 'true'
          else value = String(raw)
          value = fieldValue(field, value)
        } catch {
          continue
        }
        if (['attachment', 'json', 'hasMany'].includes(field.type)) continue
        if (field.type === 'user') {
          // The unit is chosen later in the form; saving checks the record's unit.
          const user = await this.eligibleUsers(this.db, null, actor)
            .where('u.id', Number(value))
            .first('u.id', 'u.full_name')
          if (!user) continue
          const choices = options[field.key] ?? (options[field.key] = [])
          if (!choices.some((option) => option.value === String(user.id)))
            choices.push({ value: String(user.id), label: String(user.full_name || `#${user.id}`) })
        }
        if (field.type === 'lookup' || field.type === 'belongsTo') {
          const choices = options[field.key] ?? []
          if (!choices.some((option) => option.value === String(value))) {
            if (field.type === 'lookup') continue
            try {
              // Authorized exactly like opening the related record.
              const target = this.registry.get(field.resource)
              const current = await this.show(target.name, Number(value), actor)
              const title = await this.titler(target)
              choices.push({
                value: String(current.data.id),
                label: title(current.data) ?? `#${current.data.id}`,
              })
            } catch (error) {
              if (!(error instanceof AdulaError) || ![403, 404].includes(error.status)) throw error
              continue
            }
          }
        }
        defaults[field.key] = value as SerializedRecord[string]
      }
    return {
      mode: action,
      name,
      label: resource.label.ar,
      recordLabel: resource.recordLabel?.ar ?? null,
      fields,
      /** Initial values of a create form, already checked against the actor's access. */
      defaults,
      inline,
      options,
      relationSearch,
      orgUnits: units.map((row) => ({ value: String(row.id), label: String(row.name) })),
      scoped: resource.scoped,
      /** The belongsTo field whose record decides the unit; the form shows no unit picker. */
      scopeFrom: resource.scope?.from ?? null,
      record: record
        ? serialize(resource, await this.hydrateOne(this.db, resource, record), ability, actor)
        : null,
    }
  }
  async save(
    name: string,
    actor: Actor,
    input: RecordData,
    id?: number,
    transaction?: Knex.Transaction
  ): Promise<SerializedRecord> {
    return this.persist(name, actor, input, id, transaction)
  }

  /**
   * A write decided by module code rather than by a user's role rules: state transitions,
   * snapshots and listener updates. It runs the validator, hooks, lookup, relation and
   * attachment checks, versioning and the audit trail exactly like save(), and skips only
   * the actor's role rules and organization scope. Values may set any stored field except
   * sequences and inline children. Updates merge the given values into the stored record.
   * Returns the full stored record; module code must not send it to users unfiltered.
   */
  async systemSave(
    name: string,
    values: RecordData,
    id: number | undefined,
    options: SystemSaveOptions
  ): Promise<RecordData> {
    const unattributed = options.actorId === null
    if (unattributed) {
      if (id === undefined)
        throw new AdulaError(422, 'E_ACTOR', 'systemSave requires the author user id to create')
      const resource = this.registry.get(name)
      // Attachments are claimed for their uploader; without one nothing can be claimed.
      if (Object.keys(values).some((key) => resource.fields[key]?.type === 'attachment'))
        throw new AdulaError(422, 'E_ACTOR', 'Attachment writes require the author user id')
    } else if (!Number.isSafeInteger(options.actorId) || Number(options.actorId) <= 0)
      throw new AdulaError(422, 'E_ACTOR', 'systemSave requires the author user id')
    const actor: Actor = {
      id: unattributed ? 0 : Number(options.actorId),
      orgPaths: [],
      permissionLevel: 0,
      rules: [],
    }
    return this.persist(name, actor, values, id, options.trx, undefined, {
      reason: options.reason,
      version: options.version,
      chooser: options.chooser,
      submitted: options.submitted,
      unattributed,
    })
  }

  /**
   * Moves the records whose scope follows this parent (`scope: { from }`) to the parent's
   * current organization unit, through systemSave. Call it from a listener on the parent's
   * `updated` event, or right after moving the parent. Returns the number of moved records.
   */
  async rehome(
    parentName: string,
    parentId: number,
    options: Omit<SystemSaveOptions, 'version'>
  ): Promise<number> {
    const run = async (trx: Knex.Transaction) => {
      const parent = await this.findAny(trx, this.registry.get(parentName), parentId)
      let moved = 0
      for (const child of this.registry.all()) {
        const field = child.scope && child.fields[child.scope.from]
        if (!field || field.type !== 'belongsTo' || field.resource !== parentName) continue
        const column = field.column ?? columnName(child.scope!.from)
        const ids = await trx(child.name)
          .where(column, parentId)
          .whereNull('deleted_at')
          .whereNot('org_unit_id', Number(parent.orgUnitId))
          .orderBy('id')
          .pluck('id')
        for (const id of ids) {
          await this.systemSave(child.name, {}, Number(id), { ...options, trx })
          moved++
        }
      }
      return moved
    }
    return options.trx ? run(options.trx) : this.db.transaction(run)
  }

  private async persist(
    name: string,
    actor: Actor,
    input: RecordData,
    id?: number,
    transaction?: Knex.Transaction,
    parentWrite?: { name: string; id: number; action: 'create' | 'update' | 'amend' },
    system?: {
      reason?: string
      version?: number
      chooser?: Actor
      submitted?: boolean
      unattributed?: boolean
    }
  ): Promise<SerializedRecord> {
    const resource = this.registry.get(name)
    const action = id === undefined ? 'create' : 'update'
    // System writes carry no role rules; this ability is used only for serialization shape.
    const ability = system
      ? buildAbility([{ action: 'manage', subject: 'all' }], this.registry.all())
      : this.authorizeAction(resource, actor, action)
    const form = system ? systemInput(resource, input) : writableInput(resource, input)
    const load = (db: Knex, target: Resource, key: number, lock = false) =>
      system
        ? this.findAny(db, target, key, lock)
        : this.find(db, target, actor, ability, key, lock)
    const check = (target: Resource, act: Action, record: RecordData) => {
      if (!system) this.requireRecord(ability, actor, target, act, record)
    }
    const validated = system ? {} : await resource.validator.validate(form)
    const work = async (trx: Knex.Transaction) => {
      const existing = id === undefined ? {} : await load(trx, resource, id, true)
      if (id !== undefined) {
        check(resource, action, existing)
        if (!system || system.version !== undefined)
          this.requireVersion(resource, existing, system ? system.version : input.version)
        if (
          resource.submittable &&
          existing.docStatus !== 0 &&
          !(system?.submitted && existing.docStatus === 1)
        )
          throw new AdulaError(409, 'E_DOCUMENT_LOCKED', 'Only draft documents can be edited')
      }
      if (system) {
        // The validator sees the complete form, so a partial update keeps required values.
        const formKeys = resource.form.filter((key) => resource.fields[key].type !== 'hasMany')
        const pick = (record: RecordData) =>
          Object.fromEntries(
            formKeys.filter((key) => key in record).map((key) => [key, record[key]])
          )
        Object.assign(
          validated,
          await resource.validator.validate({ ...pick(existing), ...pick(form) }),
          Object.fromEntries(Object.entries(form).filter(([key]) => !formKeys.includes(key)))
        )
      }
      const candidate: RecordData = {
        ...existing,
        ...validated,
        createdBy: existing.createdBy ?? actor.id,
        updatedBy: system?.unattributed ? existing.updatedBy : actor.id,
      }
      if (resource.submittable) candidate.docStatus = existing.docStatus ?? 0
      this.normalizeValues(resource, candidate)
      const locate = async () => {
        if (!resource.scoped) return
        if (resource.scope) {
          // Inherited scope: the parent decides the unit before any authorization (#45).
          const field = resource.fields[resource.scope.from]
          const parentId = Number(candidate[resource.scope.from])
          if (field.type !== 'belongsTo' || !Number.isSafeInteger(parentId) || parentId <= 0)
            throw new AdulaError(422, 'E_REQUIRED', `Required field: ${resource.scope.from}`)
          const parentResource = this.registry.get(field.resource)
          const parent = await load(trx, parentResource, parentId)
          check(parentResource, 'view', parent)
          candidate.orgUnitId = parent.orgUnitId
        } else if (!system || 'orgUnitId' in input || id === undefined)
          candidate.orgUnitId = input.orgUnitId ?? existing.orgUnitId
        const unit = await trx('org_units')
          .where('id', Number(candidate.orgUnitId) || -1)
          .first('path')
        if (system && !unit) throw new AdulaError(422, 'E_ORG_UNIT', 'الوحدة التنظيمية غير موجودة')
        candidate.orgPath = unit?.path
      }
      await locate()
      check(resource, action, candidate)
      // Validators may add fields (defaults, transforms); those are written too, so check them.
      const written = new Set(
        system
          ? []
          : [
              ...Object.keys(form),
              ...Object.keys(validated).filter((key) => key in resource.fields),
            ]
      )
      for (const key of written) {
        const field = resource.fields[key]
        if (
          !ability.can(action, subject(name, candidate), key) ||
          (id !== undefined && !ability.can(action, subject(name, existing), key)) ||
          actor.permissionLevel <
            Math.max(field.permissionLevel ?? 0, resource.hidden?.includes(key) ? 1 : 0)
        )
          throw new AdulaError(403, 'E_FIELD_FORBIDDEN', `Field is forbidden: ${key}`)
        if (field.sequence)
          throw new AdulaError(422, 'E_SEQUENCE_READONLY', 'Sequence fields are generated')
      }
      for (const [key, field] of Object.entries(resource.fields))
        if (field.sequence && id === undefined) candidate[key] = await sequence(trx, field.sequence)
      const context = { trx, userId: actor.id, action } as const
      await resource.hooks?.beforeSave?.(candidate, context)
      this.normalizeValues(resource, candidate)
      // A hook may change the parent of an inherited scope; the unit follows it.
      if (resource.scope) await locate()
      // A hook may also move the record: later checks use the unit it chose.
      if (resource.scoped) {
        const unit = await trx('org_units')
          .where('id', Number(candidate.orgUnitId) || -1)
          .first('path')
        candidate.orgPath = unit?.path
      }
      for (const [key, field] of Object.entries(resource.fields)) {
        if (
          field.required &&
          field.type !== 'hasMany' &&
          (candidate[key] === null || candidate[key] === undefined)
        )
          throw new AdulaError(422, 'E_REQUIRED', `Required field: ${key}`)
        if (field.type === 'belongsTo' && candidate[key] !== null && candidate[key] !== undefined) {
          const related = this.registry.get(field.resource)
          const target = await load(trx, related, Number(candidate[key]))
          check(related, 'view', target)
        }
        // A new user, or a record moved by a user to another unit, needs an eligible user.
        // An unchanged value never blocks other edits, even after the account is disabled.
        if (
          field.type === 'user' &&
          candidate[key] !== null &&
          candidate[key] !== undefined &&
          (Number(candidate[key]) !== Number(existing[key]) ||
            (!system &&
              resource.scoped &&
              Number(candidate.orgUnitId) !== Number(existing.orgUnitId)))
        ) {
          const eligible = await this.eligibleUsers(
            trx,
            resource.scoped ? String(candidate.orgPath ?? '') || null : null,
            system ? (system.chooser ?? null) : actor
          )
            .where('u.id', Number(candidate[key]))
            .first('u.id')
          if (!eligible || (resource.scoped && !candidate.orgPath))
            throw new AdulaError(
              422,
              'E_USER_FIELD',
              `${key}: اختر مستخدماً نشطاً من الوحدة التنظيمية للسجل أو الوحدات الأعلى منها`
            )
        }
        if (field.type === 'lookup' && candidate[key] !== null && candidate[key] !== undefined) {
          if (
            !(await trx('lookups')
              .where({ group: field.group, key: candidate[key], active: true })
              .first())
          )
            throw new AdulaError(422, 'E_LOOKUP', `Invalid lookup: ${key}`)
        }
        if (
          field.type === 'attachment' &&
          isAttachmentId(candidate[key]) &&
          (candidate[key] !== existing[key] ||
            (resource.scoped && Number(candidate.orgUnitId) !== Number(existing.orgUnitId)))
        )
          await claimAttachment(trx, {
            attachmentId: candidate[key],
            actor,
            resource: name,
            field: key,
            recordId: id,
            orgUnitId: resource.scoped ? Number(candidate.orgUnitId) : null,
            scoped: resource.scoped,
          })
      }
      // Hooks may calculate fields, but may never move a record past authorization.
      check(resource, action, candidate)
      await this.requireInlineParents(
        trx,
        resource,
        actor,
        candidate,
        existing,
        parentWrite,
        Boolean(system)
      )
      if (
        id !== undefined &&
        resource.scoped &&
        Number(candidate.orgUnitId) !== Number(existing.orgUnitId)
      ) {
        for (const field of Object.values(resource.fields)) {
          if (field.type !== 'hasMany' || !field.inline) continue
          const child = this.registry.get(field.resource)
          if (
            await trx(child.name)
              .where(child.fields[field.foreignKey].column ?? columnName(field.foreignKey), id)
              .whereNull('deleted_at')
              .first('id')
          )
            throw new AdulaError(
              422,
              'E_INLINE_SCOPE',
              'Cannot change organization while inline rows exist'
            )
        }
      }
      const values: RecordData = { updated_at: trx.fn.now() }
      if (!system?.unattributed) values.updated_by = actor.id
      if (id === undefined) values.created_by = actor.id
      if (resource.scoped) values.org_unit_id = candidate.orgUnitId
      if (resource.version) values.version = id === undefined ? 1 : Number(existing.version) + 1
      for (const [key, field] of Object.entries(resource.fields)) {
        if (field.type !== 'hasMany' && key in candidate)
          values[field.column ?? columnName(key)] =
            field.type === 'json' ? JSON.stringify(candidate[key]) : candidate[key]
      }
      const [row] =
        id === undefined
          ? await trx(name).insert(values).returning('*')
          : await trx(name).where({ id }).update(values).returning('*')
      const saved: RecordData = { ...fromRow(row, resource), orgPath: candidate.orgPath }
      for (const [key, field] of Object.entries(resource.fields)) {
        if (field.type !== 'attachment' || !(key in candidate)) continue
        const next = isAttachmentId(candidate[key]) ? candidate[key] : null
        const previous = isAttachmentId(existing[key]) ? existing[key] : null
        if (next !== null && id === undefined)
          await claimAttachment(trx, {
            attachmentId: next,
            actor,
            resource: name,
            field: key,
            recordId: Number(row.id),
            orgUnitId: resource.scoped ? Number(candidate.orgUnitId) : null,
            scoped: resource.scoped,
          })
        if (previous !== null && previous !== next) await releaseAttachment(trx, previous)
      }
      for (const [key, field] of Object.entries(resource.fields)) {
        if (field.type !== 'hasMany' || !(key in form)) continue
        if (!field.inline || !Array.isArray(form[key]) || (form[key] as unknown[]).length > 100)
          throw new AdulaError(422, 'E_INLINE', 'Invalid inline rows (maximum 100)')
        const childResource = this.registry.get(field.resource)
        const seen = new Set<number>()
        for (const child of form[key] as RecordData[]) {
          if (!child || typeof child !== 'object' || Array.isArray(child))
            throw new AdulaError(422, 'E_INLINE', 'Inline rows must be objects')
          const { id: childId, _delete: remove, ...data } = child
          if (remove !== undefined && typeof remove !== 'boolean')
            throw new AdulaError(422, 'E_INLINE', 'Invalid deletion marker')
          if (childId !== undefined) {
            if (
              id === undefined ||
              !Number.isSafeInteger(childId) ||
              Number(childId) <= 0 ||
              seen.has(Number(childId))
            )
              throw new AdulaError(422, 'E_INLINE', 'Invalid or repeated inline record identifier')
            seen.add(Number(childId))
            const childAbility = this.authorizeAction(
              childResource,
              actor,
              remove ? 'delete' : 'update'
            )
            const owned = await this.find(
              trx,
              childResource,
              actor,
              childAbility,
              Number(childId),
              true
            )
            if (Number(owned[field.foreignKey]) !== Number(row.id))
              throw new AdulaError(404, 'E_NOT_FOUND', 'السجل غير موجود')
          }
          if (remove) {
            if (childId === undefined)
              throw new AdulaError(
                422,
                'E_INLINE',
                'Deleting an inline row requires its identifier'
              )
            await this.transition(
              field.resource,
              Number(childId),
              actor,
              'delete',
              data.version,
              trx
            )
            continue
          }
          await this.persist(
            field.resource,
            actor,
            {
              ...data,
              [field.foreignKey]: row.id,
              ...(childResource.scoped && !childResource.scope
                ? { orgUnitId: candidate.orgUnitId }
                : {}),
            },
            childId === undefined ? undefined : Number(childId),
            trx,
            { name, id: Number(row.id), action }
          )
        }
      }
      const changes: FieldChange[] = []
      if (id !== undefined)
        for (const key of Object.keys(resource.fields)) {
          if (resource.fields[key].type === 'hasMany' || !(key in saved)) continue
          const before = existing[key] ?? null
          const after = saved[key] ?? null
          if (JSON.stringify(before) !== JSON.stringify(after))
            changes.push({ field: key, before, after })
        }
      if (!system?.unattributed)
        await this.audit(trx, resource, actor, action, saved, Object.keys(form), changes, system)
      await resource.hooks?.afterSave?.(saved, context)
      if (system) return (await this.hydrateOne(trx, resource, saved)) as SerializedRecord
      return serialize(resource, await this.hydrateOne(trx, resource, saved), ability, actor)
    }
    return transaction ? work(transaction) : this.db.transaction(work)
  }
  private requireVersion(resource: Resource, existing: RecordData, version: unknown) {
    if (resource.version && (!Number.isSafeInteger(version) || version !== existing.version))
      throw new AdulaError(
        409,
        'E_VERSION_CONFLICT',
        'تم تعديل السجل بواسطة مستخدم آخر. حدّث الصفحة وحاول مجدداً.'
      )
  }
  /** Inline children share the parent's draft state, organization and update authority. */
  private async requireInlineParents(
    trx: Knex.Transaction,
    resource: Resource,
    actor: Actor,
    candidate: RecordData,
    existing: RecordData = {},
    parentWrite?: { name: string; id: number; action: 'create' | 'update' | 'amend' },
    system = false
  ) {
    for (const parent of this.registry.all()) {
      for (const [key, field] of Object.entries(parent.fields)) {
        if (field.type !== 'hasMany' || !field.inline || field.resource !== resource.name) continue
        const parentId = candidate[field.foreignKey]
        if (parentId === undefined || parentId === null) continue
        if (
          existing[field.foreignKey] !== undefined &&
          Number(existing[field.foreignKey]) !== Number(parentId)
        )
          throw new AdulaError(
            422,
            'E_INLINE_PARENT',
            'Inline records cannot be moved to another parent'
          )
        const action =
          parentWrite?.name === parent.name && parentWrite.id === Number(parentId)
            ? parentWrite.action
            : 'update'
        let record: RecordData
        // amend() authorized the cancelled source; its new draft is checked for state and
        // scope below, and each copied line by the child's own create rules.
        if (system || action === 'amend')
          record = await this.findAny(trx, parent, Number(parentId), true)
        else {
          const ability = this.authorizeAction(parent, actor, action)
          record = await this.find(trx, parent, actor, ability, Number(parentId), true)
          this.requireRecord(ability, actor, parent, action, record)
          if (
            !ability.can(action, subject(parent.name, record), key) ||
            actor.permissionLevel <
              Math.max(field.permissionLevel ?? 0, parent.hidden?.includes(key) ? 1 : 0)
          )
            throw new AdulaError(403, 'E_FIELD_FORBIDDEN', 'ليس لديك صلاحية تعديل البنود')
        }
        if (parent.submittable && record.docStatus !== 0)
          throw new AdulaError(409, 'E_DOCUMENT_LOCKED', 'Only draft document lines can be edited')
        if (
          parent.scoped &&
          resource.scoped &&
          Number(record.orgUnitId) !== Number(candidate.orgUnitId)
        )
          throw new AdulaError(
            422,
            'E_INLINE_SCOPE',
            'Inline records must use the parent organization'
          )
      }
    }
  }
  async transition(
    name: string,
    id: number,
    actor: Actor,
    action: 'delete' | 'submit' | 'cancel',
    version?: unknown,
    transaction?: Knex.Transaction
  ) {
    const resource = this.registry.get(name)
    const ability = this.authorizeAction(resource, actor, action)
    const work = async (trx: Knex.Transaction) => {
      const record = await this.find(trx, resource, actor, ability, id, true)
      this.requireRecord(ability, actor, resource, action, record)
      this.requireVersion(resource, record, version)
      await this.requireInlineParents(trx, resource, actor, record)
      const values: RecordData = { updated_by: actor.id, updated_at: trx.fn.now() }
      if (resource.version) values.version = Number(record.version) + 1
      if (action === 'delete') {
        if (resource.submittable && record.docStatus !== 0)
          throw new AdulaError(409, 'E_DOCUMENT_LOCKED', 'Only drafts can be deleted')
        values.deleted_at = trx.fn.now()
      } else {
        if (!resource.submittable || record.docStatus !== (action === 'submit' ? 0 : 1))
          throw new AdulaError(409, 'E_DOCUMENT_STATE', 'Invalid document transition')
        values.doc_status = action === 'submit' ? 1 : 2
      }
      const [row] = await trx(name).where({ id }).update(values).returning('*')
      const saved = fromRow(row, resource)
      await this.audit(trx, resource, actor, action, saved, [])
      return serialize(resource, await this.hydrateOne(trx, resource, saved), ability, actor)
    }
    return transaction ? work(transaction) : this.db.transaction(work)
  }
  /**
   * Amend-by-copy: a cancelled document is copied into a new draft that points to
   * it through amended_from_id, together with its inline lines. The original stays
   * cancelled and unchanged; sequence fields receive new numbers.
   */
  async amend(name: string, id: number, actor: Actor, transaction?: Knex.Transaction) {
    const resource = this.registry.get(name)
    if (!resource.submittable)
      throw new AdulaError(409, 'E_DOCUMENT_STATE', 'Only submittable documents can be amended')
    const ability = this.authorizeAction(resource, actor, 'amend')
    const work = async (trx: Knex.Transaction) => {
      const source = await this.find(trx, resource, actor, ability, id, true)
      this.requireRecord(ability, actor, resource, 'amend', source)
      if (source.docStatus !== 2)
        throw new AdulaError(409, 'E_DOCUMENT_STATE', 'Only cancelled documents can be amended')
      const existing = await trx(name)
        .where('amended_from_id', id)
        .whereNull('deleted_at')
        .first('id')
      if (existing)
        throw new AdulaError(409, 'E_ALREADY_AMENDED', 'تم تعديل هذا المستند بالنسخ من قبل')
      const values: RecordData = {
        created_by: actor.id,
        updated_by: actor.id,
        doc_status: 0,
        amended_from_id: id,
      }
      if (resource.scoped) values.org_unit_id = source.orgUnitId
      if (resource.version) values.version = 1
      const copied: string[] = []
      for (const [key, field] of Object.entries(resource.fields)) {
        if (field.type === 'hasMany' || !(key in source)) continue
        const column = field.column ?? columnName(key)
        if (field.sequence) values[column] = await sequence(trx, field.sequence)
        else if (field.type === 'attachment') continue
        else {
          values[column] = field.type === 'json' ? JSON.stringify(source[key]) : source[key]
          copied.push(key)
        }
      }
      const [row] = await trx(name).insert(values).returning('*')
      const saved: RecordData = { ...fromRow(row, resource), orgPath: source.orgPath }
      for (const [lineKey, field] of Object.entries(resource.fields)) {
        if (field.type !== 'hasMany' || !field.inline) continue
        const child = this.registry.get(field.resource)
        const foreign = child.fields[field.foreignKey].column ?? columnName(field.foreignKey)
        const lines = await trx(child.name).where(foreign, id).whereNull('deleted_at').orderBy('id')
        if (!lines.length) continue
        if (
          !ability.can('amend', subject(name, source), lineKey) ||
          actor.permissionLevel <
            Math.max(field.permissionLevel ?? 0, resource.hidden?.includes(lineKey) ? 1 : 0)
        )
          throw new AdulaError(403, 'E_FIELD_FORBIDDEN', 'ليس لديك صلاحية تعديل البنود')
        // Copies are new child records: they go through persist(), so the actor needs
        // create on the child resource and its field rules, validator and hooks apply.
        const childAbility = this.authorizeAction(child, actor, 'create')
        for (const line of lines) {
          const stored = fromRow(line, child)
          const data: RecordData = {}
          for (const key of child.form) {
            const childField = child.fields[key]
            if (
              key === field.foreignKey ||
              !(key in stored) ||
              childField.type === 'hasMany' ||
              childField.type === 'attachment' ||
              childField.sequence ||
              // Values the actor could not have entered are not carried into the copy.
              !childAbility.can('create', child.name, key) ||
              actor.permissionLevel <
                Math.max(childField.permissionLevel ?? 0, child.hidden?.includes(key) ? 1 : 0)
            )
              continue
            data[key] = stored[key]
          }
          await this.persist(
            child.name,
            actor,
            {
              ...data,
              [field.foreignKey]: row.id,
              ...(child.scoped && !child.scope ? { orgUnitId: saved.orgUnitId } : {}),
            },
            undefined,
            trx,
            { name, id: Number(row.id), action: 'amend' }
          )
        }
      }
      await this.audit(trx, resource, actor, 'amend', saved, copied)
      return serialize(resource, await this.hydrateOne(trx, resource, saved), ability, actor)
    }
    return transaction ? work(transaction) : this.db.transaction(work)
  }

  private async audit(
    trx: Knex.Transaction,
    resource: Resource,
    actor: Actor,
    action: Action,
    record: RecordData,
    fields: string[],
    changes?: FieldChange[],
    system?: { reason?: string }
  ) {
    await recordMutation(trx, {
      ...(system ? { system: true, reason: system.reason } : {}),
      module: this.registry.owner(resource.name),
      resource: resource.name,
      id: record.id,
      actorId: actor.id,
      impersonatorId: actor.impersonatorId,
      action,
      fields,
      changes,
    })
  }
}
