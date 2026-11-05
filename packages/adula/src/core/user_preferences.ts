import type { Knex } from 'knex'
import type { JsonValue } from '../resource/types.js'
import { AdulaError } from '../admin/errors.js'

/**
 * One per-user interface preference (ADR 049): the sidebar state, the navigation layout, the
 * theme, an arrangement. The application declares its keys once; each key validates its own
 * value, so a stored value is always one the interface understands.
 */
export type PreferenceDefinition<T extends JsonValue = JsonValue> = {
  /** Lower camel segments joined by dots: `shell.sidebar`, `overview.layout`. */
  key: string
  default: T
  /** Returns the normalized value, or throws `AdulaError(422, 'E_PREFERENCE_VALUE', …)`. */
  validate: (value: unknown) => T
}

/** Preferences live in `settings` with scope `user`; this prefix keeps them apart. */
export const PREFERENCE_PREFIX = 'preference.'
/** Upper bound for one stored value, in UTF-8 bytes. */
export const PREFERENCE_MAX_BYTES = 4096
const KEY = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/
// The settings key column accepts at most 100 characters, prefix included.
const MAX_KEY_LENGTH = 100 - PREFERENCE_PREFIX.length

export function definePreference<T extends JsonValue>(
  definition: PreferenceDefinition<T>
): PreferenceDefinition<T> {
  if (!KEY.test(definition.key) || definition.key.length > MAX_KEY_LENGTH)
    throw new Error(`Invalid preference key "${definition.key}"`)
  return definition
}

/** True for a settings key that stores a user's own preference. */
export function isPreferenceSetting(key: string) {
  return key.startsWith(PREFERENCE_PREFIX)
}

function invalid(): never {
  throw new AdulaError(422, 'E_PREFERENCE_VALUE', 'قيمة التفضيل غير صالحة')
}

function sized(value: unknown) {
  const text = JSON.stringify(value)
  if (text === undefined) invalid()
  if (Buffer.byteLength(text, 'utf8') > PREFERENCE_MAX_BYTES)
    throw new AdulaError(422, 'E_PREFERENCE_TOO_LARGE', 'قيمة التفضيل أكبر من المسموح')
  return text
}

function userScope(userId: number) {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error('Invalid user id')
  return String(userId)
}

export class UserPreferences {
  readonly #definitions = new Map<string, PreferenceDefinition>()

  constructor(
    private db: Knex,
    definitions: PreferenceDefinition[],
    private report: (key: string, error: unknown) => void = () => {}
  ) {
    UserPreferences.validate(definitions)
    for (const definition of definitions) this.#definitions.set(definition.key, definition)
  }

  /** Boot check: keys are well formed and unique, and every default passes its validator. */
  static validate(definitions: PreferenceDefinition[]) {
    const seen = new Set<string>()
    for (const definition of definitions) {
      definePreference(definition)
      if (seen.has(definition.key)) throw new Error(`Duplicate preference "${definition.key}"`)
      seen.add(definition.key)
      sized(definition.default)
      const normalized = definition.validate(definition.default)
      if (JSON.stringify(normalized) !== JSON.stringify(definition.default))
        throw new Error(`The default of preference "${definition.key}" does not validate`)
    }
  }

  keys() {
    return [...this.#definitions.keys()]
  }

  /** Every registered preference of the user, defaults filled in. */
  async all(userId: number): Promise<Record<string, JsonValue>> {
    const keys = this.keys()
    const rows = keys.length
      ? await this.db('settings')
          .where({ scope: 'user', scope_id: userScope(userId) })
          .whereIn(
            'key',
            keys.map((key) => PREFERENCE_PREFIX + key)
          )
          .select('key', 'value')
      : []
    const stored = new Map(rows.map((row) => [String(row.key), row.value as unknown]))
    const result: Record<string, JsonValue> = {}
    for (const [key, definition] of this.#definitions)
      result[key] = this.#read(definition, stored.get(PREFERENCE_PREFIX + key))
    return result
  }

  async get<T extends JsonValue = JsonValue>(userId: number, key: string): Promise<T> {
    const definition = this.#definition(key)
    const row = await this.db('settings')
      .where({ key: PREFERENCE_PREFIX + key, scope: 'user', scope_id: userScope(userId) })
      .first('value')
    return this.#read(definition, row?.value) as T
  }

  async set<T extends JsonValue = JsonValue>(userId: number, key: string, value: unknown) {
    const definition = this.#definition(key)
    sized(value)
    const normalized = definition.validate(value)
    await this.db('settings')
      .insert({
        key: PREFERENCE_PREFIX + key,
        scope: 'user',
        scope_id: userScope(userId),
        value: sized(normalized),
      })
      .onConflict(['key', 'scope', 'scope_id'])
      .merge(['value'])
    return normalized as T
  }

  /** Removes the stored value; the user sees the default again. */
  async reset<T extends JsonValue = JsonValue>(userId: number, key: string): Promise<T> {
    const definition = this.#definition(key)
    await this.db('settings')
      .where({ key: PREFERENCE_PREFIX + key, scope: 'user', scope_id: userScope(userId) })
      .delete()
    return definition.default as T
  }

  #definition(key: string) {
    const definition = this.#definitions.get(key)
    if (!definition) throw new AdulaError(404, 'E_PREFERENCE_UNKNOWN', 'التفضيل غير معروف')
    return definition
  }

  // A value stored by an older release that no longer validates falls back to the default.
  #read(definition: PreferenceDefinition, value: unknown): JsonValue {
    if (value === undefined || value === null) return definition.default
    try {
      return definition.validate(value)
    } catch (error) {
      this.report(definition.key, error)
      return definition.default
    }
  }
}
