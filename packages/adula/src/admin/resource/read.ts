import { subject } from '@casl/ability'
import type { Knex } from 'knex'
import type { Action, RecordData, Resource, SerializedRecord } from '../../resource/types.js'
import { columnName } from '../../resource/define_resource.js'
import { buildAbility, canRecord, type Actor, type AdulaAbility } from '../../auth/ability.js'
import { accessibleBy } from '../../auth/sql.js'
import { fromRow, serialize } from '../contracts.js'
import { AdulaError, notFound } from '../errors.js'
import { avatarUrlFor, avatarVersionColumn } from '../../core/user_avatars.js'
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
  readableField,
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
        ability.can('view', resource.name) &&
        // A role that may add records keeps the entry: creating and importing start there.
        (ability.can('create', resource.name) || !referenceOnly(resource, actor))
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

/**
 * Whether the actor reads the resource only to name its records: every rule that grants
 * `view` on it is limited to its title fields (#141). Such a role reads the resource for
 * titles, pickers and inherited scope checks, so navigation does not present it. A rule
 * meant only for references must therefore name title fields (the resource's `title`).
 */
function referenceOnly(resource: Resource, actor: Actor) {
  const title = new Set(titleFields(resource))
  const grants = actor.rules.filter((rule) => {
    const actions = Array.isArray(rule.action) ? rule.action : [rule.action]
    return (
      !rule.inverted &&
      (rule.subject === resource.name || rule.subject === 'all') &&
      (actions.includes('view') || actions.includes('manage'))
    )
  })
  return (
    grants.length > 0 &&
    grants.every((rule) => rule.fields?.length && rule.fields.every((key) => title.has(key)))
  )
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
    ...(resource.printTemplates?.length
      ? {
          printTemplates: resource.printTemplates.map((template) => ({
            key: template.key,
            label: template.label,
          })),
        }
      : {}),
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
        const users = await db('users as u')
          .whereIn('u.id', [...new Set(ids)])
          .select('u.id', 'u.full_name', avatarVersionColumn(db, 'u.id'))
        related[key] = users.map((row) => ({
          id: Number(row.id),
          fullName: String(row.full_name ?? ''),
          // The versioned picture, or null so the page shows initials and requests nothing.
          avatarUrl: avatarUrlFor(row.id, row.avatar_version),
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
      rows.map((r: RecordData) => fromRow(r, target)),
      ctx.attachments
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
  const [hydrated] = await hydrate(ctx.db, resource, [record], ctx.attachments)
  const related = await preload(ctx, resource, [record], actor)
  // A reader of the record may read the name of its unit; clients show it instead of an id.
  if (resource.scoped && record.orgUnitId !== null && record.orgUnitId !== undefined) {
    const unit = await ctx.db('org_units').where('id', Number(record.orgUnitId)).first('id', 'name')
    if (unit)
      related.orgUnitId = [
        { id: Number(unit.id), name: String(unit.name), _title: String(unit.name) },
      ]
  }
  return {
    data: serialize(resource, hydrated, ability, actor),
    permissions: permissions(resource, record, actor, ability),
    related,
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

/**
 * The lines of a printed document (ADR 048): the named hasMany fields, up to `limit` rows
 * each, with the display rows of the lines' own relations. See ResourceService.documentLines.
 */
export async function documentLines(
  ctx: ResourceContext,
  name: string,
  id: number,
  actor: Actor,
  keys: readonly string[],
  limit: number
) {
  const { resource, ability, record } = await viewable(ctx, name, id, actor)
  return childrenOf(ctx, resource, record, actor, ability, keys, { limit, related: true })
}

/** Inline children of an already authorized parent record. */
async function childrenOf(
  ctx: ResourceContext,
  resource: Resource,
  parent: RecordData,
  actor: Actor,
  ability: AdulaAbility,
  keys: readonly string[] = resource.show,
  options: { limit?: number; related?: boolean } = {}
) {
  const name = resource.name
  const id = Number(parent.id)
  const limit = options.limit ?? 100
  // A line group is readable where the record exposes it (serialize, or list and show),
  // or where the resource's own code print templates declare it (ADR 048). Declaring a
  // group in a code print template is the resource author exposing it like a detail field:
  // children() returns it to any caller that names it, not only to printing (the record
  // page itself names `show`).
  const exposed = new Set([
    ...(resource.serialize ?? [...resource.list, ...resource.show]),
    ...(resource.printTemplates ?? []).flatMap((template) => Object.keys(template.lines ?? {})),
  ])
  const result: Record<
    string,
    { rows: SerializedRecord[]; hasMore: boolean; related?: Record<string, SerializedRecord[]> }
  > = {}
  for (const key of keys) {
    const field = resource.fields[key]
    if (
      field?.type !== 'hasMany' ||
      !ability.can('view', subject(name, parent), key) ||
      actor.permissionLevel < fieldLevel(resource, key)
    )
      continue
    if (!exposed.has(key)) continue
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
      .limit(limit + 1)
    const hydrated = await hydrate(
      ctx.db,
      child,
      rows.slice(0, limit).map((row: RecordData) => fromRow(row, child)),
      ctx.attachments
    )
    result[key] = {
      rows: hydrated.map((row) => serialize(child, row, ability, actor)),
      hasMore: rows.length > limit,
      ...(options.related ? { related: await preload(ctx, child, hydrated, actor) } : {}),
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
  const { resource, ability, record } = await viewable(ctx, name, id, actor)
  return activityOf(ctx, resource, record, ability, actor)
}

/** Inline children and recent activity of one record from a single record read. */
export async function details(ctx: ResourceContext, name: string, id: number, actor: Actor) {
  const { resource, ability, record } = await viewable(ctx, name, id, actor)
  return {
    children: await childrenOf(ctx, resource, record, actor, ability),
    activity: await activityOf(ctx, resource, record, ability, actor),
  }
}

/** show(), children() and activity() of one record from a single record read. */
export async function recordPage(ctx: ResourceContext, name: string, id: number, actor: Actor) {
  const { resource, ability, record: found } = await viewable(ctx, name, id, actor)
  return {
    ...(await presented(ctx, resource, found, actor, ability)),
    children: await childrenOf(ctx, resource, found, actor, ability),
    activity: await activityOf(ctx, resource, found, ability, actor),
  }
}

/**
 * The record's recent activity. Each entry names only fields the viewer may read
 * (readableField, as the field history); an update names the fields its field history
 * recorded, plus the inline line groups it wrote, so entries stored with every submitted
 * key are narrowed too.
 */
async function activityOf(
  ctx: ResourceContext,
  resource: Resource,
  record: RecordData,
  ability: AdulaAbility,
  actor: Actor
) {
  const rows = await ctx
    .db('activities as a')
    .leftJoin('users as u', 'u.id', 'a.actor_id')
    .where({ 'a.resource': resource.name, 'a.record_id': Number(record.id) })
    .orderBy('a.id', 'desc')
    .limit(50)
    .select(
      'a.id',
      'a.action',
      'a.changes',
      'a.actor_id',
      'a.created_at',
      'u.full_name as actor_name',
      avatarVersionColumn(ctx.db, 'a.actor_id')
    )
  const updates = rows.filter((row) => row.action === 'update').map((row) => Number(row.id))
  const changed = new Map<number, string[]>()
  if (updates.length)
    for (const change of await ctx
      .db('field_changes')
      .whereIn('activity_id', updates)
      .orderBy('id')
      .select('activity_id', 'field')) {
      const keys = changed.get(Number(change.activity_id)) ?? []
      if (!keys.includes(String(change.field))) keys.push(String(change.field))
      changed.set(Number(change.activity_id), keys)
    }
  const named = (row: { id: unknown; action: unknown; changes?: { fields?: unknown } }) => {
    const stored = Array.isArray(row.changes?.fields) ? row.changes.fields.map(String) : []
    if (row.action !== 'update') return stored
    const keys = [...(changed.get(Number(row.id)) ?? [])]
    for (const key of stored)
      if (resource.fields[key]?.type === 'hasMany' && !keys.includes(key)) keys.push(key)
    return keys
  }
  return rows.map((row) => ({
    id: Number(row.id),
    action: String(row.action) as Action,
    fields: named(row).filter((key) => readableField(resource, record, ability, actor, key)),
    actorId: Number(row.actor_id),
    // A display name only: record viewers need not be able to read account e-mails.
    actorName: row.actor_name ? String(row.actor_name) : null,
    actorAvatarUrl: avatarUrlFor(row.actor_id, row.avatar_version),
    /**
     * @deprecated Always null. Kept so project-owned copies of resource-show from
     * earlier releases still compile; they fall back to the actor id.
     */
    actorEmail: null as string | null,
    createdAt: new Date(row.created_at).toISOString(),
  }))
}
