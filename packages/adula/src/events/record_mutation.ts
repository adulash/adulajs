import { randomUUID } from 'node:crypto'
import type { Knex } from 'knex'
import type { Action } from '../resource/types.js'

export type FieldChange = { field: string; before: unknown; after: unknown }

/** Infrastructure writes for a module-owned mutation, inside its existing transaction. */
export async function recordMutation(
  trx: Knex.Transaction,
  mutation: {
    module: string
    resource: string
    id: unknown
    actorId: number
    /** The administrator acting as actorId, when impersonating. */
    impersonatorId?: number
    /** A resource action, or `restore` of a soft-deleted record (ADR 046). */
    action: Action | 'restore'
    fields: string[]
    /** Before/after values of the changed fields; read back per viewer's field access. */
    changes?: FieldChange[]
    /** Written by module code through ResourceService.systemSave, not by a user's edit. */
    system?: boolean
    /** Why module code made the change; shown with the activity entry. */
    reason?: string
  }
) {
  const past: Record<string, string> = {
    create: 'created',
    update: 'updated',
    delete: 'deleted',
    submit: 'submitted',
    cancel: 'cancelled',
    amend: 'amended',
    restore: 'restored',
  }
  if (!past[mutation.action]) throw new Error('Unsupported mutation event')
  const eventId = randomUUID()
  const event = `${mutation.module}.${mutation.resource}.${past[mutation.action]}`
  const payload = {
    resource: mutation.resource,
    id: mutation.id,
    actorId: mutation.actorId,
    ...(mutation.impersonatorId ? { impersonatorId: mutation.impersonatorId } : {}),
  }
  const [activity] = await trx('activities')
    .insert({
      resource: mutation.resource,
      record_id: mutation.id,
      actor_id: mutation.actorId,
      action: mutation.action,
      changes: JSON.stringify({
        fields: mutation.fields,
        ...(mutation.impersonatorId ? { impersonatedBy: mutation.impersonatorId } : {}),
        ...(mutation.system ? { system: true } : {}),
        ...(mutation.reason ? { reason: mutation.reason } : {}),
      }),
    })
    .returning('id')
  if (mutation.changes?.length)
    await trx('field_changes').insert(
      mutation.changes.map((change) => ({
        activity_id: activity.id,
        resource: mutation.resource,
        record_id: mutation.id,
        field: change.field,
        before: JSON.stringify(change.before ?? null),
        after: JSON.stringify(change.after ?? null),
      }))
    )
  await trx('outbox').insert({
    id: eventId,
    event,
    payload: JSON.stringify(payload),
  })
  // A durable submission envelope, not an executing workflow definition.
  // The later workflow engine can claim it using the same outbox event ID.
  if (mutation.action === 'submit')
    await trx('workflow_runs').insert({
      id: eventId,
      resource: mutation.resource,
      record_id: mutation.id,
      definition: event,
      definition_version: 1,
      snapshot: JSON.stringify({ kind: 'submission', schemaVersion: 1, eventId, ...payload }),
      status: 'pending_definition',
    })
}
