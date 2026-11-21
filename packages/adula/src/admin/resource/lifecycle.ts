import { subject } from '@casl/ability'
import type { Knex } from 'knex'
import type { Action, LifecycleHookContext, RecordData, Resource } from '../../resource/types.js'
import { columnName } from '../../resource/define_resource.js'
import { currentLanguage, labelText, translate } from '../../languages/catalog.js'
import type { Actor } from '../../auth/ability.js'
import { fromRow, serialize } from '../contracts.js'
import {
  AdulaError,
  documentLocked,
  forbiddenField,
  inlineScope,
  invalidDocumentState,
} from '../errors.js'
import { recordMutation, type FieldChange } from '../../events/record_mutation.js'
import {
  authorizeAction,
  fieldLevel,
  find,
  findAny,
  hydrateOne,
  requireRecord,
  type ResourceContext,
  withLinks,
} from './shared.js'

/** The parent record an inline write belongs to, with the action taken on that parent. */
export type ParentWrite = {
  name: string
  id: number
  action: 'create' | 'update' | 'amend'
  /** Set by the inline row's persist() when it created the row or changed a value. */
  changed?: boolean
}

/** Optimistic lock of versioned resources (409 E_VERSION_CONFLICT). */
export function requireVersion(resource: Resource, existing: RecordData, version: unknown) {
  if (resource.version && (!Number.isSafeInteger(version) || version !== existing.version))
    throw new AdulaError(
      409,
      'E_VERSION_CONFLICT',
      'تم تعديل السجل بواسطة مستخدم آخر. حدّث الصفحة وحاول مجدداً.'
    )
}

/** Inline children share the parent's draft state, organization and update authority. */
export async function requireInlineParents(
  ctx: ResourceContext,
  trx: Knex.Transaction,
  resource: Resource,
  actor: Actor,
  candidate: RecordData,
  existing: RecordData = {},
  parentWrite?: ParentWrite,
  system = false
) {
  for (const parent of ctx.registry.all()) {
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
      if (system || action === 'amend') record = await findAny(trx, parent, Number(parentId), true)
      else {
        const ability = authorizeAction(ctx, parent, actor, action)
        record = await find(trx, parent, actor, ability, Number(parentId), true)
        requireRecord(ability, actor, parent, action, record)
        if (
          !ability.can(action, subject(parent.name, record), key) ||
          actor.permissionLevel < fieldLevel(parent, key)
        )
          throw forbiddenField('ليس لديك صلاحية تعديل البنود')
      }
      if (parent.submittable && record.docStatus !== 0)
        throw documentLocked('Only draft document lines can be edited')
      if (
        parent.scoped &&
        resource.scoped &&
        Number(record.orgUnitId) !== Number(candidate.orgUnitId)
      )
        throw inlineScope('Inline records must use the parent organization')
    }
  }
}

/**
 * Refuses deleting a record while live records of any registered resource reference it
 * through a belongsTo: 409 E_HAS_DEPENDENTS naming each resource and its count (#133).
 * Inline lines are part of their parent document and do not count.
 */
export async function requireNoDependents(
  ctx: ResourceContext,
  trx: Knex.Transaction,
  resource: Resource,
  id: number
) {
  const inline = new Set<string>()
  for (const [, field] of Object.entries(resource.fields))
    if (field.type === 'hasMany' && field.inline)
      inline.add(`${field.resource}.${field.foreignKey}`)
  const dependents: string[] = []
  for (const child of ctx.registry.all()) {
    const columns = Object.entries(child.fields).flatMap(([key, field]) =>
      field.type === 'belongsTo' &&
      field.resource === resource.name &&
      !inline.has(`${child.name}.${key}`)
        ? [field.column ?? columnName(key)]
        : []
    )
    if (!columns.length) continue
    const query = trx(child.name)
      .whereNull('deleted_at')
      .where((refs) => columns.forEach((column) => refs.orWhere(column, id)))
    // A record referencing itself does not keep itself alive.
    if (child.name === resource.name) query.whereNot('id', id)
    const [{ count }] = await query.count({ count: 'id' })
    if (Number(count)) dependents.push(`${labelText(child.label)} (${Number(count)})`)
  }
  if (dependents.length)
    throw new AdulaError(
      409,
      'E_HAS_DEPENDENTS',
      translate('errors.E_HAS_DEPENDENTS', currentLanguage(), {
        dependents: dependents.join('، '),
      })
    )
}

/**
 * Refuses restoring a record whose belongsTo parent is soft-deleted: 409 E_PARENT_DELETED
 * naming the field (#133). The parent is restored first.
 */
export async function requireLiveParents(
  ctx: ResourceContext,
  trx: Knex.Transaction,
  resource: Resource,
  record: RecordData
) {
  for (const [key, field] of Object.entries(resource.fields)) {
    if (field.type !== 'belongsTo' || record[key] === null || record[key] === undefined) continue
    const parent = await trx(ctx.registry.get(field.resource).name)
      .where('id', Number(record[key]))
      .first('deleted_at')
    if (parent?.deleted_at)
      throw new AdulaError(
        409,
        'E_PARENT_DELETED',
        translate('errors.E_PARENT_DELETED', currentLanguage(), { field: labelText(field.label) })
      )
  }
}

/** The context of beforeDelete and beforeRestore: the HookContext shape for a user's action. */
export function lifecycleHookContext(
  trx: Knex.Transaction,
  actor: Actor,
  action: 'delete' | 'restore',
  record: RecordData
): LifecycleHookContext {
  return { trx, userId: actor.id, action, existing: { ...record }, changes: [], system: false }
}

/** Records one mutation in the activity log and the domain event stream. */
export async function audit(
  ctx: ResourceContext,
  trx: Knex.Transaction,
  resource: Resource,
  actor: Actor,
  action: Action | 'restore',
  record: RecordData,
  fields: string[],
  changes?: FieldChange[],
  system?: { reason?: string }
) {
  await recordMutation(trx, {
    ...(system ? { system: true, reason: system.reason } : {}),
    module: ctx.registry.owner(resource.name),
    resource: resource.name,
    id: record.id,
    actorId: actor.id,
    impersonatorId: actor.impersonatorId,
    action,
    fields,
    changes,
  })
}

/** Soft delete, submit or cancel of one record; see ResourceService.transition. */
export async function transition(
  ctx: ResourceContext,
  name: string,
  id: number,
  actor: Actor,
  action: 'delete' | 'submit' | 'cancel',
  version?: unknown,
  transaction?: Knex.Transaction
) {
  const resource = ctx.registry.get(name)
  const ability = authorizeAction(ctx, resource, actor, action)
  const work = async (trx: Knex.Transaction) => {
    const record = await find(trx, resource, actor, ability, id, true)
    requireRecord(ability, actor, resource, action, record)
    requireVersion(resource, record, version)
    await requireInlineParents(ctx, trx, resource, actor, record)
    const values: RecordData = { updated_by: actor.id, updated_at: trx.fn.now() }
    if (resource.version) values.version = Number(record.version) + 1
    if (action === 'delete') {
      if (resource.submittable && record.docStatus !== 0)
        throw documentLocked('Only drafts can be deleted')
      // The hook runs first, so an application rule may also remove dependents itself.
      await resource.hooks?.beforeDelete?.(
        record,
        lifecycleHookContext(trx, actor, 'delete', record)
      )
      await requireNoDependents(ctx, trx, resource, id)
      values.deleted_at = trx.fn.now()
    } else {
      if (!resource.submittable || record.docStatus !== (action === 'submit' ? 0 : 1))
        throw invalidDocumentState('Invalid document transition')
      values.doc_status = action === 'submit' ? 1 : 2
    }
    const [row] = await trx(name).where({ id }).update(values).returning('*')
    // manyToMany links are not columns; the response carries them like show().
    const [saved] = await withLinks(trx, resource, [fromRow(row, resource)])
    await audit(ctx, trx, resource, actor, action, saved, [])
    return serialize(
      resource,
      await hydrateOne(trx, resource, saved, ctx.attachments),
      ability,
      actor
    )
  }
  return transaction ? work(transaction) : ctx.db.transaction(work)
}
