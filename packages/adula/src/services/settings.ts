import type { Knex } from 'knex'

export class Settings {
  constructor(private db: Knex) {}
  async get<T>(key: string, scope = 'system', scopeId = '0'): Promise<T | undefined> {
    const row = await this.db('settings').where({ key, scope, scope_id: scopeId }).first('value')
    return row?.value as T | undefined
  }
  async set(key: string, value: unknown, scope = 'system', scopeId = '0') {
    await this.db('settings')
      .insert({ key, scope, scope_id: scopeId, value: JSON.stringify(value) })
      .onConflict(['key', 'scope', 'scope_id'])
      .merge(['value'])
  }
}
/** The number a sequence value is issued as: `ORD-000042`. */
export function formatSequence(key: string, value: string | number | bigint) {
  return `${key}-${String(value).padStart(6, '0')}`
}
export async function sequence(trx: Knex.Transaction, key: string) {
  const result = await trx.raw(
    'INSERT INTO sequences (key,value) VALUES (?,1) ON CONFLICT (key) DO UPDATE SET value=sequences.value+1 RETURNING value',
    [key]
  )
  return formatSequence(key, result.rows[0].value)
}
/** The record a notification is about; opening the notification opens the record. */
export type NotificationTarget = { resource: string; recordId: number }

export function targetColumns(target?: NotificationTarget | null) {
  if (!target) return {}
  if (!/^[a-z][a-z0-9_]*$/.test(target.resource) || !Number.isSafeInteger(target.recordId))
    throw new Error('Invalid notification target')
  return { resource: target.resource, record_id: target.recordId }
}

export async function notify(
  db: Knex,
  userId: number,
  title: string,
  body: string,
  target?: NotificationTarget | null
) {
  await db('notifications').insert({ user_id: userId, title, body, ...targetColumns(target) })
}
