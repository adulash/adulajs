import { subject } from '@casl/ability'
import type { Knex } from 'knex'
import type { Action, RecordData, Resource } from '../../resource/types.js'
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
} from './shared.js'

/** The parent record an inline write belongs to, with the action taken on that parent. */
export type ParentWrite = { name: string; id: number; action: 'create' | 'update' | 'amend' }

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
      values.deleted_at = trx.fn.now()
    } else {
      if (!resource.submittable || record.docStatus !== (action === 'submit' ? 0 : 1))
        throw invalidDocumentState('Invalid document transition')
      values.doc_status = action === 'submit' ? 1 : 2
    }
    const [row] = await trx(name).where({ id }).update(values).returning('*')
    const saved = fromRow(row, resource)
    await audit(ctx, trx, resource, actor, action, saved, [])
    return serialize(resource, await hydrateOne(trx, resource, saved), ability, actor)
  }
  return transaction ? work(transaction) : ctx.db.transaction(work)
}
