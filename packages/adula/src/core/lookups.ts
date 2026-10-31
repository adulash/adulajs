import type { Knex } from 'knex'
import type { ResourceRegistry } from '../resource/registry.js'
import { columnName } from '../resource/define_resource.js'
import { AdulaError } from '../admin/errors.js'
import { logActivity } from './activity.js'

/** A resource field that stores values of a lookup group. */
export type LookupFieldUse = { resource: string; field: string; label: string }
export type LookupGroupSummary = {
  group: string
  total: number
  active: number
  /** Registered resource fields that store this group's keys. */
  fields: LookupFieldUse[]
  /** Declared by a registered module, which seeds it on installation. */
  declared: boolean
}
export type LookupValue = {
  id: number
  group: string
  key: string
  labelAr: string
  labelEn: string
  sort: number
  active: boolean
  /** Stored records (including deleted ones) holding this key; null without a registry. */
  usage: number | null
  /** Declared by a registered module; such values are never deleted. */
  declared: boolean
}
export type LookupInput = {
  group: unknown
  key: unknown
  labelAr: unknown
  labelEn?: unknown
  sort?: unknown
}
export type LookupUpdate = { labelAr?: unknown; labelEn?: unknown; sort?: unknown; key?: unknown }

const RESOURCE = 'core.lookups'
const GROUP = /^[a-z][a-z0-9_]{0,99}$/
const KEY = /^[a-z0-9][a-z0-9_-]{0,99}$/

function group(value: unknown) {
  if (typeof value !== 'string' || !GROUP.test(value))
    throw new AdulaError(
      422,
      'E_LOOKUP_GROUP',
      'اسم القائمة يبدأ بحرف إنجليزي صغير ويحوي حروفاً صغيرة وأرقاماً وشرطة سفلية فقط'
    )
  return value
}
function key(value: unknown) {
  if (typeof value !== 'string' || !KEY.test(value))
    throw new AdulaError(
      422,
      'E_LOOKUP_KEY',
      'المفتاح يحوي حروفاً إنجليزية صغيرة وأرقاماً وشرطة أو شرطة سفلية فقط'
    )
  return value
}
function label(value: unknown, required: boolean) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (value !== undefined && value !== null && typeof value !== 'string')
    throw new AdulaError(422, 'E_LOOKUP_LABEL', 'التسمية يجب أن تكون نصاً')
  if (required && !text) throw new AdulaError(422, 'E_LOOKUP_LABEL', 'التسمية العربية مطلوبة')
  if (text.length > 255) throw new AdulaError(422, 'E_LOOKUP_LABEL', 'التسمية لا تتجاوز 255 حرفاً')
  return text
}
function sort(value: unknown) {
  const number = typeof value === 'string' && value.trim() ? Number(value) : value
  if (typeof number !== 'number' || !Number.isSafeInteger(number) || Math.abs(number) > 2 ** 31 - 1)
    throw new AdulaError(422, 'E_LOOKUP_SORT', 'الترتيب يجب أن يكون عدداً صحيحاً')
  return number
}
function lookupId(value: unknown) {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0)
    throw new AdulaError(404, 'E_LOOKUP_NOT_FOUND', 'القيمة غير موجودة')
  return id
}
/** The English label column is required; a value without one shows its key, as imports match it. */
const english = (text: string, fallback: string) => text || fallback

/**
 * Administration of lookup values (lookups table). Values are never renamed or removed while
 * records hold them: the key is immutable, a value stored by any record cannot be disabled
 * (the record validator requires an active value on every save, so a disabled stored value
 * would block editing those records), and only an unused value that no registered module
 * declares may be deleted (a declared value would be seeded again on the next installation).
 * Usage is counted from the registered resources' lookup fields; without a registry it is
 * unknown and disabling or deleting is refused.
 */
export class LookupsAdmin {
  constructor(
    private db: Knex,
    private registry?: ResourceRegistry
  ) {}

  /** Lookup fields of the registered resources, by group. */
  fields(name?: string): (LookupFieldUse & { table: string; column: string; group: string })[] {
    if (!this.registry) return []
    return this.registry.all().flatMap((resource) =>
      Object.entries(resource.fields).flatMap(([field, definition]) =>
        definition.type === 'lookup' && (name === undefined || definition.group === name)
          ? [
              {
                resource: resource.name,
                field,
                label: definition.label.ar,
                table: resource.name,
                column: definition.column ?? columnName(field),
                group: definition.group,
              },
            ]
          : []
      )
    )
  }

  private declared() {
    const keys = new Set<string>()
    for (const module of this.registry?.modules() ?? [])
      for (const [name, rows] of Object.entries(module.lookups ?? {}))
        for (const row of rows) keys.add(`${name}\u0000${row.key}`)
    return keys
  }

  async groups(): Promise<LookupGroupSummary[]> {
    const rows = await this.db('lookups')
      .select('group')
      .count('* as total')
      .select(this.db.raw('count(*) FILTER (WHERE active) AS active'))
      .groupBy('group')
    const declared = [...this.declared()].map((entry) => entry.split('\u0000')[0])
    const names = new Set([
      ...rows.map((row) => String(row.group)),
      ...this.fields().map((field) => field.group),
      ...declared,
    ])
    return [...names].sort().map((name) => {
      const row = rows.find((entry) => entry.group === name)
      return {
        group: name,
        total: Number(row?.total ?? 0),
        active: Number(row?.active ?? 0),
        fields: this.fields(name).map(({ resource, field, label: text }) => ({
          resource,
          field,
          label: text,
        })),
        declared: declared.includes(name),
      }
    })
  }

  async values(name: unknown): Promise<LookupValue[]> {
    // A group named by a registered field is listed even when it predates the slug rule.
    const selected = typeof name === 'string' && this.fields(name).length ? name : group(name)
    const rows = await this.db('lookups').where('group', selected).orderBy(['sort', 'key'])
    const usage = await this.usageByKey(
      this.db,
      selected,
      rows.map((row) => String(row.key))
    )
    const declared = this.declared()
    return rows.map((row) => ({
      ...this.toValue(row, declared),
      usage: usage ? (usage.get(String(row.key)) ?? 0) : null,
    }))
  }

  async create(actorId: number, input: LookupInput): Promise<LookupValue> {
    const values = {
      group: group(input.group),
      key: key(input.key),
      labelAr: label(input.labelAr, true),
      labelEn: label(input.labelEn, false),
    }
    return this.db.transaction(async (trx) => {
      if (await trx('lookups').where({ group: values.group, key: values.key }).first('id'))
        throw new AdulaError(409, 'E_LOOKUP_EXISTS', 'هذا المفتاح موجود في القائمة')
      const last = await trx('lookups').where('group', values.group).max('sort as max').first()
      const position =
        input.sort === undefined || input.sort === null || input.sort === ''
          ? Number(last?.max ?? -1) + 1
          : sort(input.sort)
      const [row] = await trx('lookups')
        .insert({
          group: values.group,
          key: values.key,
          label_ar: values.labelAr,
          label_en: english(values.labelEn, values.key),
          sort: position,
          active: true,
        })
        .returning('*')
      await logActivity(trx, {
        resource: RESOURCE,
        recordId: row.id,
        actorId,
        action: 'create',
        changes: {
          group: row.group,
          key: row.key,
          labelAr: row.label_ar,
          labelEn: row.label_en,
          sort: row.sort,
        },
      })
      return { ...this.toValue(row, this.declared()), usage: 0 }
    })
  }

  async update(actorId: number, id: unknown, input: LookupUpdate): Promise<LookupValue> {
    const recordId = lookupId(id)
    return this.db.transaction(async (trx) => {
      const row = await this.lock(trx, recordId)
      if (input.key !== undefined && input.key !== row.key)
        throw new AdulaError(
          422,
          'E_LOOKUP_KEY_IMMUTABLE',
          'لا يمكن تغيير المفتاح لأن السجلات تحفظه؛ أضف قيمة جديدة وعطّل القديمة'
        )
      const next: Record<string, unknown> = {}
      if (input.labelAr !== undefined) next.label_ar = label(input.labelAr, true)
      if (input.labelEn !== undefined) next.label_en = english(label(input.labelEn, false), row.key)
      if (input.sort !== undefined) next.sort = sort(input.sort)
      const changes = Object.fromEntries(
        Object.entries(next).filter(([column, value]) => row[column] !== value)
      )
      if (!Object.keys(changes).length) return this.withUsage(trx, row)
      const [updated] = await trx('lookups').where('id', recordId).update(changes).returning('*')
      await logActivity(trx, {
        resource: RESOURCE,
        recordId,
        actorId,
        action: 'update',
        changes: {
          group: row.group,
          key: row.key,
          ...Object.fromEntries(
            Object.entries(changes).map(([column, value]) => [
              { label_ar: 'labelAr', label_en: 'labelEn', sort: 'sort' }[column]!,
              { from: row[column], to: value },
            ])
          ),
        },
      })
      return this.withUsage(trx, updated)
    })
  }

  /** Sets the order of a whole group: `ids` lists every value of the group once, first to last. */
  async reorder(actorId: number, name: unknown, ids: unknown): Promise<LookupValue[]> {
    const selected = group(name)
    if (!Array.isArray(ids) || !ids.length)
      throw new AdulaError(422, 'E_LOOKUP_ORDER', 'أرسل ترتيب قيم القائمة كاملة')
    const order = ids.map((id) => lookupId(id))
    return this.db.transaction(async (trx) => {
      const rows = await trx('lookups').where('group', selected).forUpdate().select('*')
      const known = new Set(rows.map((row) => Number(row.id)))
      if (
        !rows.length ||
        new Set(order).size !== order.length ||
        order.length !== rows.length ||
        order.some((id) => !known.has(id))
      )
        throw new AdulaError(
          422,
          'E_LOOKUP_ORDER',
          'الترتيب يجب أن يذكر كل قيم القائمة مرة واحدة فقط'
        )
      for (const [position, id] of order.entries()) {
        const row = rows.find((entry) => Number(entry.id) === id)!
        if (row.sort === position) continue
        await trx('lookups').where('id', id).update({ sort: position })
        await logActivity(trx, {
          resource: RESOURCE,
          recordId: id,
          actorId,
          action: 'reorder',
          changes: { group: selected, key: row.key, sort: { from: row.sort, to: position } },
        })
      }
      return new LookupsAdmin(trx, this.registry).values(selected)
    })
  }

  async disable(actorId: number, id: unknown): Promise<LookupValue> {
    return this.setActive(actorId, lookupId(id), false)
  }

  async enable(actorId: number, id: unknown): Promise<LookupValue> {
    return this.setActive(actorId, lookupId(id), true)
  }

  async delete(actorId: number, id: unknown) {
    const recordId = lookupId(id)
    return this.db.transaction(async (trx) => {
      const row = await this.lock(trx, recordId)
      if (this.declared().has(`${row.group}\u0000${row.key}`))
        throw new AdulaError(
          409,
          'E_LOOKUP_DECLARED',
          'هذه القيمة معرّفة في أحد التطبيقات وتعود عند التثبيت؛ عطّلها بدلاً من حذفها'
        )
      await this.refuseInUse(trx, row, 'حذفها')
      await trx('lookups').where('id', recordId).delete()
      await logActivity(trx, {
        resource: RESOURCE,
        recordId,
        actorId,
        action: 'delete',
        changes: { group: row.group, key: row.key, labelAr: row.label_ar },
      })
    })
  }

  private async setActive(actorId: number, id: number, active: boolean) {
    return this.db.transaction(async (trx) => {
      const row = await this.lock(trx, id)
      if (row.active === active) return this.withUsage(trx, row)
      if (!active) await this.refuseInUse(trx, row, 'تعطيلها')
      const [updated] = await trx('lookups').where('id', id).update({ active }).returning('*')
      await logActivity(trx, {
        resource: RESOURCE,
        recordId: id,
        actorId,
        action: active ? 'enable' : 'disable',
        changes: { group: row.group, key: row.key },
      })
      return this.withUsage(trx, updated)
    })
  }

  private async refuseInUse(db: Knex, row: Record<string, any>, verb: string) {
    const usage = await this.usageByKey(db, row.group, [row.key])
    if (!usage)
      throw new AdulaError(
        409,
        'E_LOOKUP_USAGE_UNKNOWN',
        `تعذّر التحقق من استخدام القيمة، لذلك لا يمكن ${verb}`
      )
    const count = usage.get(row.key) ?? 0
    if (count > 0)
      throw new AdulaError(
        409,
        'E_LOOKUP_IN_USE',
        `لا يمكن ${verb}: القيمة «${row.label_ar}» محفوظة في ${count} سجل. غيّر قيمة هذه السجلات أولاً.`
      )
  }

  private async lock(trx: Knex, id: number) {
    const row = await trx('lookups').where('id', id).forUpdate().first()
    if (!row) throw new AdulaError(404, 'E_LOOKUP_NOT_FOUND', 'القيمة غير موجودة')
    return row
  }

  private async withUsage(db: Knex, row: Record<string, any>): Promise<LookupValue> {
    const usage = await this.usageByKey(db, row.group, [row.key])
    return {
      ...this.toValue(row, this.declared()),
      usage: usage ? (usage.get(row.key) ?? 0) : null,
    }
  }

  /** Records holding each key, over every registered field of the group; null without a registry. */
  private async usageByKey(db: Knex, name: string, keys: string[]) {
    if (!this.registry) return null
    const counts = new Map<string, number>()
    if (!keys.length) return counts
    for (const field of this.fields(name)) {
      const exists = await db.raw('SELECT to_regclass(?) AS name', [field.table])
      if (!exists.rows[0]?.name) continue
      const rows = await db(field.table)
        .whereIn(field.column, keys)
        .groupBy(field.column)
        .select(`${field.column} as key`)
        .count('* as count')
      for (const row of rows)
        counts.set(String(row.key), (counts.get(String(row.key)) ?? 0) + Number(row.count))
    }
    return counts
  }

  private toValue(row: Record<string, any>, declared: Set<string>): Omit<LookupValue, 'usage'> {
    return {
      id: Number(row.id),
      group: String(row.group),
      key: String(row.key),
      labelAr: String(row.label_ar),
      labelEn: String(row.label_en),
      sort: Number(row.sort),
      active: Boolean(row.active),
      declared: declared.has(`${row.group}\u0000${row.key}`),
    }
  }
}
