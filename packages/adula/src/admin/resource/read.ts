import { subject } from '@casl/ability'
import type { Knex } from 'knex'
import type { Action, RecordData, Resource, SerializedRecord } from '../../resource/types.js'
import { columnName } from '../../resource/define_resource.js'
import { buildAbility, canRecord, type Actor, type AdulaAbility } from '../../auth/ability.js'
import { accessibleBy } from '../../auth/sql.js'
import { fromRow, serialize } from '../contracts.js'
import { AdulaError, notFound } from '../errors.js'
import { formatTitle, titleFields } from '../record_title.js'
import type { ResourceDescription, ResourceNavigation } from '../presentation.js'
import {
  authorizeAction,
  canQueryField,
  columns,
  fieldLevel,
  find,
  hydrate,
  permissions,
  requireRecord,
  type ResourceContext,
} from './shared.js'

/** Project navigation is derived from registered resources and the current actor. */
export function navigation(ctx: ResourceContext, actor: Actor): ResourceNavigation {
  const { registry } = ctx
  const ability = buildAbility(actor.rules, registry.all())
  const children = new Set(
    registry
      .all()
      .flatMap((resource) =>
        Object.values(resource.fields).flatMap((field) =>
          field.type === 'hasMany' ? [field.resource] : []
        )
      )
  )
  return registry
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
      module: registry.owner(resource.name),
      moduleLabel:
        registry.modules().find((module) => module.name === registry.owner(resource.name))?.label
          .ar ?? registry.owner(resource.name),
    }))
}

export function describe(ctx: ResourceContext, name: string, actor: Actor): ResourceDescription {
  const resource = ctx.registry.get(name)
  const ability = authorizeAction(ctx, resource, actor, 'view')
  const serialized = new Set(resource.serialize ?? [...resource.list, ...resource.show])
  const fields = Object.entries(resource.fields)
    .filter(
      ([key]) =>
        serialized.has(key) &&
        actor.permissionLevel >= fieldLevel(resource, key) &&
        ability.can('view', name, key)
    )
    .map(([key, field]) => ({
      ...field,
      key,
      sortable: Boolean(field.sortable && canQueryField(resource, actor, ability, key)),
      filterable: Boolean(field.filterable && canQueryField(resource, actor, ability, key)),
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
      searchable.every(([key]) => canQueryField(resource, actor, ability, key)),
    canCreate: resource.actions.includes('create') && ability.can('create', name),
    scoped: resource.scoped,
    submittable: Boolean(resource.submittable),
    trash: resource.actions.includes('delete') && ability.can('delete', name),
    exportable: true,
    bulk: (['delete', 'submit', 'cancel', 'update'] as const).some(
      (action) => resource.actions.includes(action) && ability.can(action, name)
    ),
  }
}

/** Authorizes one record for collaboration features; see ResourceService.access. */
export async function access(
  ctx: ResourceContext,
  name: string,
  id: number,
  actor: Actor,
  action: Action,
  db: Knex
) {
  let resource: Resource
  try {
    resource = ctx.registry.get(name)
  } catch {
    throw notFound('الكيان غير موجود')
  }
  if (!Number.isSafeInteger(id) || id <= 0) throw notFound()
  const ability = authorizeAction(ctx, resource, actor, action)
  const record = await find(db, resource, actor, ability, id)
  requireRecord(ability, actor, resource, action, record)
  return { resource, record, ability }
}

/** Whether a (possibly other) actor may perform an action on a record; never throws for denial. */
export async function permits(
  ctx: ResourceContext,
  name: string,
  id: number,
  actor: Actor,
  action: Action
) {
  try {
    await access(ctx, name, id, actor, action, ctx.db)
    return true
  } catch (error) {
    if (error instanceof AdulaError && [403, 404].includes(error.status)) return false
    throw error
  }
}

/** Display rows of the users and related records referenced by the given records. */
export async function preload(
  ctx: ResourceContext,
  resource: Resource,
  records: RecordData[],
  actor: Actor
) {
  const { db, registry } = ctx
  const related: Record<string, SerializedRecord[]> = {}
  const ability = buildAbility(actor.rules, registry.all())
  for (const [key, field] of Object.entries(resource.fields)) {
    if (field.type === 'user' && records.length) {
      const ids = records
        .filter((record) => key in serialize(resource, record, ability, actor))
        .map((record) => record[key])
        .filter((v) => v !== null && v !== undefined) as number[]
      // A display name only: readers of the record need not read account e-mails.
      if (ids.length) {
        const users = await db('users')
          .whereIn('id', [...new Set(ids)])
          .select('id', 'full_name')
        related[key] = users.map((row) => ({
          id: Number(row.id),
          fullName: String(row.full_name ?? ''),
        }))
      }
      continue
    }
    if ((field.type !== 'belongsTo' && field.type !== 'manyToMany') || !records.length) continue
    const target = registry.get(field.resource)
    if (!ability.can('view', target.name)) continue
    const ids = records
      .filter((record) => key in serialize(resource, record, ability, actor))
      // A manyToMany value is an array of ids; its related rows title every link.
      .flatMap((record) => record[key])
      .filter((v) => v !== null && v !== undefined) as number[]
    if (!ids.length) continue
    const query = accessibleBy(
      db(`${target.name} as r`).whereIn('r.id', ids).whereNull('r.deleted_at'),
      ability,
      actor,
      'view',
      target
    ).select(columns(target, ability))
    if (target.scoped) query.select('ou.path as org_path')
    const rows = await query
    const targets = await hydrate(
      db,
      target,
      rows.map((r: RecordData) => fromRow(r, target))
    )
    const title = await titler(ctx, target)
    related[key] = targets.map((r) => {
      const row = serialize(target, r, ability, actor)
      // `_title` cannot collide with a field key; clients label the relation with it.
      return { ...row, _title: title(row) }
    })
  }
  return related
}

/** Formats record titles of one resource, loading the labels of its title lookups once. */
export async function titler(ctx: ResourceContext, resource: Resource) {
  const groups = titleFields(resource).flatMap((key) => {
    const field = resource.fields[key]
    return field.type === 'lookup' ? [field.group] : []
  })
  const labels = new Map<string, string>()
  if (groups.length)
    for (const row of await ctx
      .db('lookups')
      .whereIn('group', groups)
      .select('group', 'key', 'label_ar'))
      labels.set(`${row.group}\u0000${row.key}`, String(row.label_ar))
  return (record: SerializedRecord) =>
    formatTitle(resource, record, (group, key) => labels.get(`${group}\u0000${key}`))
}

/** Titles of records the actor may view; see ResourceService.titles. */
export async function titles(
  ctx: ResourceContext,
  name: string,
  ids: readonly number[],
  actor: Actor
): Promise<Map<number, string>> {
  const result = new Map<number, string>()
  let resource: Resource
  try {
    resource = ctx.registry.get(name)
  } catch {
    return result
  }
  const wanted = [...new Set(ids.filter((id) => Number.isSafeInteger(id) && id > 0))]
  const ability = buildAbility(actor.rules, ctx.registry.all())
  if (!wanted.length || !resource.actions.includes('view') || !ability.can('view', name))
    return result
  const query = accessibleBy(
    ctx.db(`${resource.name} as r`).whereIn('r.id', wanted).whereNull('r.deleted_at'),
    ability,
    actor,
    'view',
    resource
  ).select(columns(resource, ability))
  if (resource.scoped) query.select('ou.path as org_path')
  const rows: RecordData[] = await query
  const records = rows.map((row) => fromRow(row, resource))
  const title = await titler(ctx, resource)
  for (const record of records) {
    if (!canRecord(ability, actor, resource, 'view', record)) continue
    const text = title(serialize(resource, record, ability, actor))
    if (text) result.set(Number(record.id), text)
  }
  return result
}

/** One viewable record, authorized for the actor. */
async function viewable(ctx: ResourceContext, name: string, id: number, actor: Actor) {
  const resource = ctx.registry.get(name)
  const ability = authorizeAction(ctx, resource, actor, 'view')
  const record = await find(ctx.db, resource, actor, ability, id)
  requireRecord(ability, actor, resource, 'view', record)
  return { resource, ability, record }
}

/** The serialized record with its permissions and related rows. */
async function presented(
  ctx: ResourceContext,
  resource: Resource,
  record: RecordData,
  actor: Actor,
  ability: AdulaAbility
) {
  const [hydrated] = await hydrate(ctx.db, resource, [record])
  return {
    data: serialize(resource, hydrated, ability, actor),
    permissions: permissions(resource, record, actor, ability),
    related: await preload(ctx, resource, [record], actor),
  }
}

export async function show(ctx: ResourceContext, name: string, id: number, actor: Actor) {
  const { resource, ability, record } = await viewable(ctx, name, id, actor)
  return presented(ctx, resource, record, actor, ability)
}

/** Deferred relation reads re-authorize the parent and each child on every request. */
export async function recordChildren(ctx: ResourceContext, name: string, id: number, actor: Actor) {
  const { resource, ability, record } = await viewable(ctx, name, id, actor)
  return childrenOf(ctx, resource, record, actor, ability)
}

/** Inline children of an already authorized parent record. */
async function childrenOf(
  ctx: ResourceContext,
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
      actor.permissionLevel < fieldLevel(resource, key)
    )
      continue
    if (resource.serialize && !resource.serialize.includes(key)) continue
    const child = ctx.registry.get(field.resource)
    if (!ability.can('view', child.name) || !child.actions.includes('view')) continue
    const rows = await accessibleBy(
      ctx.db(`${child.name} as r`).whereNull('r.deleted_at'),
      ability,
      actor,
      'view',
      child
    )
      .where(`r.${child.fields[field.foreignKey].column ?? columnName(field.foreignKey)}`, id)
      .select([...columns(child, ability), ...(child.scoped ? ['ou.path as org_path'] : [])])
      .orderBy('r.id')
      .limit(101)
    const hydrated = await hydrate(
      ctx.db,
      child,
      rows.slice(0, 100).map((row: RecordData) => fromRow(row, child))
    )
    result[key] = {
      rows: hydrated.map((row) => serialize(child, row, ability, actor)),
      hasMore: rows.length > 100,
    }
  }
  return result
}

/** Active lookup labels for the lookup fields the actor may read on this resource. */
export async function lookups(ctx: ResourceContext, name: string, actor: Actor) {
  const options: Record<string, { value: string; label: string }[]> = {}
  for (const field of describe(ctx, name, actor).fields) {
    if (field.type !== 'lookup') continue
    const rows = await ctx
      .db('lookups')
      .where({ group: field.group, active: true })
      .orderBy(['sort', 'id'])
      .select('key', 'label_ar')
    options[field.key] = rows.map((row) => ({ value: row.key, label: row.label_ar }))
  }
  return options
}

/** The last 50 recorded mutations of one record, after authorizing the record itself. */
export async function activity(ctx: ResourceContext, name: string, id: number, actor: Actor) {
  await viewable(ctx, name, id, actor)
  return activityOf(ctx, name, id)
}

/** Inline children and recent activity of one record from a single record read. */
export async function details(ctx: ResourceContext, name: string, id: number, actor: Actor) {
  const { resource, ability, record } = await viewable(ctx, name, id, actor)
  return {
    children: await childrenOf(ctx, resource, record, actor, ability),
    activity: await activityOf(ctx, name, id),
  }
}

/** show(), children() and activity() of one record from a single record read. */
export async function recordPage(ctx: ResourceContext, name: string, id: number, actor: Actor) {
  const { resource, ability, record: found } = await viewable(ctx, name, id, actor)
  return {
    ...(await presented(ctx, resource, found, actor, ability)),
    children: await childrenOf(ctx, resource, found, actor, ability),
    activity: await activityOf(ctx, name, id),
  }
}

async function activityOf(ctx: ResourceContext, name: string, id: number) {
  const rows = await ctx
    .db('activities as a')
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
