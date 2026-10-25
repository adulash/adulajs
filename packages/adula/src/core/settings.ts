import type { Knex } from 'knex'
import type { JsonValue } from '../resource/types.js'
import { AdulaError } from '../admin/errors.js'
import { logActivity } from './activity.js'
import { UI_PREFERENCES_KEY, validateUiPreferences } from './ui_preferences.js'

export type SettingScope = 'system' | 'org_unit' | 'user'
export type SettingRow = {
  id: number
  key: string
  scope: SettingScope
  scopeId: string
  value: JsonValue
  readOnly: boolean
}
export type SettingInput = { key: string; scope: SettingScope; scopeId?: string; value: unknown }

export const SETTING_SCOPES: SettingScope[] = ['system', 'org_unit', 'user']
// Written by install, scheduler, worker and backup verification; never by the settings screen.
export const PROTECTED_SETTING_KEYS = [
  'adula.version',
  'scheduler.heartbeat',
  'worker.heartbeat',
  'mail.delivery_test',
]
const RESOURCE = 'core.settings'

export function isProtectedSetting(key: string) {
  return (
    PROTECTED_SETTING_KEYS.includes(key) ||
    key.startsWith('backup.') ||
    key.startsWith('setup.') ||
    isSealedSetting(key)
  )
}

/**
 * Settings that hold a sealed secret (`channels.*`, written by their own section). The
 * settings screen lists them read-only and never returns the sealed value.
 */
export function isSealedSetting(key: string) {
  return key.startsWith('channels.')
}

function presentValue(key: string, value: JsonValue): JsonValue {
  if (!isSealedSetting(key) || !value || typeof value !== 'object' || Array.isArray(value))
    return value
  const rest = { ...(value as Record<string, JsonValue>) }
  delete rest.secret
  return rest
}

export function parseSettingValue(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    throw new AdulaError(422, 'E_SETTING_JSON', 'القيمة يجب أن تكون JSON صالحاً')
  }
}

function settingKey(value: unknown) {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9_.-]{0,99}$/i.test(value))
    throw new AdulaError(
      422,
      'E_SETTING_KEY',
      'المفتاح يبدأ بحرف ويحوي حروفاً وأرقاماً ونقاطاً فقط'
    )
  return value
}
function settingScope(value: unknown): SettingScope {
  if (!SETTING_SCOPES.includes(value as SettingScope))
    throw new AdulaError(422, 'E_SETTING_SCOPE', 'النطاق غير معروف')
  return value as SettingScope
}
function toRow(row: Record<string, unknown>): SettingRow {
  return {
    id: Number(row.id),
    key: String(row.key),
    scope: row.scope as SettingScope,
    scopeId: String(row.scope_id),
    value: presentValue(String(row.key), row.value as JsonValue),
    readOnly: isProtectedSetting(String(row.key)),
  }
}

export class SettingsAdmin {
  constructor(private db: Knex) {}

  async list(scope: SettingScope, scopeId = '0'): Promise<SettingRow[]> {
    const rows = await this.db('settings')
      .where({ scope: settingScope(scope), scope_id: scopeId })
      .orderBy('key')
    return rows.map(toRow)
  }

  async upsert(actorId: number, input: SettingInput): Promise<SettingRow> {
    const key = settingKey(input.key)
    const scope = settingScope(input.scope)
    if (key === UI_PREFERENCES_KEY) {
      if (scope !== 'system')
        throw new AdulaError(422, 'E_SETTING_SCOPE', 'تفضيلات الواجهة تُضبط على مستوى النظام')
      validateUiPreferences(input.value)
    }
    if (isProtectedSetting(key))
      throw new AdulaError(403, 'E_SETTING_READ_ONLY', 'هذا المفتاح تشغيلي للقراءة فقط')
    const serialized = JSON.stringify(input.value)
    if (serialized === undefined)
      throw new AdulaError(422, 'E_SETTING_JSON', 'القيمة يجب أن تكون JSON صالحاً')
    return this.db.transaction(async (trx) => {
      const scopeId = await this.scopeId(trx, scope, input.scopeId)
      const [row] = await trx('settings')
        .insert({ key, scope, scope_id: scopeId, value: serialized })
        .onConflict(['key', 'scope', 'scope_id'])
        .merge(['value'])
        .returning('*')
      await logActivity(trx, {
        resource: RESOURCE,
        recordId: row.id,
        actorId,
        action: 'upsert',
        changes: { key, scope, scopeId, value: input.value },
      })
      return toRow(row)
    })
  }

  async delete(actorId: number, id: number) {
    return this.db.transaction(async (trx) => {
      const row = await trx('settings').where('id', id).first()
      if (!row) throw new AdulaError(404, 'E_SETTING_NOT_FOUND', 'الإعداد غير موجود')
      if (isProtectedSetting(row.key))
        throw new AdulaError(403, 'E_SETTING_READ_ONLY', 'هذا المفتاح تشغيلي للقراءة فقط')
      await trx('settings').where('id', id).delete()
      await logActivity(trx, {
        resource: RESOURCE,
        recordId: id,
        actorId,
        action: 'delete',
        changes: { key: row.key, scope: row.scope, scopeId: row.scope_id },
      })
    })
  }

  private async scopeId(db: Knex, scope: SettingScope, value: unknown) {
    if (scope === 'system') return '0'
    const id = Number(value)
    if (!Number.isSafeInteger(id) || id <= 0)
      throw new AdulaError(422, 'E_SETTING_SCOPE', 'معرّف النطاق مطلوب')
    const table = scope === 'org_unit' ? 'org_units' : 'users'
    if (!(await db(table).where('id', id).first('id')))
      throw new AdulaError(
        404,
        'E_SETTING_SCOPE',
        scope === 'org_unit' ? 'الوحدة التنظيمية غير موجودة' : 'المستخدم غير موجود'
      )
    return String(id)
  }
}
