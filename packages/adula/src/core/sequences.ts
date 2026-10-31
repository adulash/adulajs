import type { Knex } from 'knex'
import type { ResourceRegistry } from '../resource/registry.js'
import { AdulaError } from '../admin/errors.js'
import { formatSequence } from '../services/settings.js'
import { logActivity } from './activity.js'

export type SequenceRow = {
  key: string
  /** The last issued value (0 before the first number); digits, since the column is bigint. */
  value: string
  /** The number the next record receives, formatted exactly like `sequence()`. */
  next: string
  /** Registered resource fields numbered by this sequence. */
  fields: { resource: string; field: string; label: string }[]
}

const RESOURCE = 'core.sequences'
const KEY = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/

function sequenceKey(value: unknown) {
  if (typeof value !== 'string' || !KEY.test(value))
    throw new AdulaError(404, 'E_SEQUENCE_NOT_FOUND', 'التسلسل غير موجود')
  return value
}
function nextValue(value: unknown) {
  const text = typeof value === 'number' ? String(value) : value
  if (typeof text !== 'string' || !/^\d{1,18}$/.test(text.trim()) || BigInt(text.trim()) < 1n)
    throw new AdulaError(422, 'E_SEQUENCE_VALUE', 'الرقم التالي يجب أن يكون عدداً صحيحاً موجباً')
  return BigInt(text.trim())
}

/**
 * Administration of document numbering (sequences table). A sequence can only move forward:
 * moving it back would issue numbers that records already carry. The key and its format are
 * fixed by the resource field (`sequence: 'ORD'` issues ORD-000001), so only the next value
 * changes. Changes are audited as core.sequences with record id 0 and the key in the changes.
 */
export class SequencesAdmin {
  constructor(
    private db: Knex,
    private registry?: ResourceRegistry
  ) {}

  private fields() {
    return (this.registry?.all() ?? []).flatMap((resource) =>
      Object.entries(resource.fields).flatMap(([field, definition]) =>
        definition.sequence
          ? [
              {
                key: definition.sequence,
                resource: resource.name,
                field,
                label: definition.label.ar,
              },
            ]
          : []
      )
    )
  }

  /** Stored sequences and those declared by registered fields that have not issued a number yet. */
  async list(): Promise<SequenceRow[]> {
    const rows = await this.db('sequences').select('key', 'value')
    const values = new Map(rows.map((row) => [String(row.key), BigInt(row.value)]))
    const fields = this.fields()
    for (const field of fields) if (!values.has(field.key)) values.set(field.key, 0n)
    return [...values.keys()].sort().map((key) => this.toRow(key, values.get(key)!, fields))
  }

  /** Sets the value the next record receives; it must be ahead of the last issued value. */
  async setNext(actorId: number, key: unknown, next: unknown): Promise<SequenceRow> {
    const name = sequenceKey(key)
    const target = nextValue(next)
    const fields = this.fields()
    return this.db.transaction(async (trx) => {
      let row = await trx('sequences').where('key', name).forUpdate().first('value')
      if (!row) {
        if (!fields.some((field) => field.key === name))
          throw new AdulaError(404, 'E_SEQUENCE_NOT_FOUND', 'التسلسل غير موجود')
        await trx('sequences').insert({ key: name, value: 0 }).onConflict('key').ignore()
        row = await trx('sequences').where('key', name).forUpdate().first('value')
      }
      const current = BigInt(row.value)
      if (target <= current)
        throw new AdulaError(
          422,
          'E_SEQUENCE_BACKWARD',
          `لا يمكن إرجاع الترقيم: آخر رقم صدر هو ${formatSequence(name, current)}، والرجوع يكرر أرقاماً تحملها سجلات قائمة. اختر رقماً أكبر من ${current}.`
        )
      if (target === current + 1n) return this.toRow(name, current, fields)
      await trx('sequences')
        .where('key', name)
        .update({ value: (target - 1n).toString() })
      await logActivity(trx, {
        resource: RESOURCE,
        recordId: 0,
        actorId,
        action: 'adjust',
        changes: {
          key: name,
          from: formatSequence(name, current + 1n),
          to: formatSequence(name, target),
        },
      })
      return this.toRow(name, target - 1n, fields)
    })
  }

  private toRow(
    key: string,
    value: bigint,
    fields: { key: string; resource: string; field: string; label: string }[]
  ): SequenceRow {
    return {
      key,
      value: value.toString(),
      next: formatSequence(key, value + 1n),
      fields: fields
        .filter((field) => field.key === key)
        .map(({ resource, field, label }) => ({ resource, field, label })),
    }
  }
}
