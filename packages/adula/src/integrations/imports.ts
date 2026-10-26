import Papa from 'papaparse'
import type { Knex } from 'knex'
import { subject } from '@casl/ability'
import type { Actor } from '../auth/ability.js'
import { buildAbility } from '../auth/ability.js'
import type { ResourceService } from '../admin/resource_service.js'
import type { ResourceRegistry } from '../resource/registry.js'
import type { Field, RecordData } from '../resource/types.js'
import { AdulaError } from '../admin/errors.js'
import { notifyWithTemplate } from '../core/message_templates.js'

export type ImportStatus = 'mapping' | 'queued' | 'running' | 'done' | 'failed'
export type ImportTarget = { key: string; label: string; type: string; required: boolean }
export type ImportBatch = {
  id: number
  resource: string
  resourceLabel: string
  fileName: string
  status: ImportStatus
  headers: string[]
  mapping: Record<string, string>
  sample: string[][]
  total: number
  processed: number
  created: number
  failed: number
  errors: { row: number; message: string }[]
  createdAt: string
  finishedAt: string | null
  targets: ImportTarget[]
}
export type ActorSource = { load(id: number): Promise<Actor> }

export const IMPORT_ROW_LIMIT = 5000
const COLUMN_LIMIT = 100
const ERROR_LIMIT = 200
const FILE_LIMIT = 5 * 1024 * 1024
// Lists (multiSelect, manyToMany) have no single-cell CSV form yet.
const UNSUPPORTED = new Set(['hasMany', 'attachment', 'json', 'multiSelect', 'manyToMany'])

const normalize = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '')

/** Converts one CSV cell to the field's stored representation, or throws a readable error. */
export function importCell(field: Field, raw: string, lookups: Map<string, string>): unknown {
  const value = raw.trim()
  if (value === '') return null
  const latin = value.replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
  switch (field.type) {
    case 'integer':
    case 'belongsTo':
    case 'user': {
      if (!/^-?\d+$/.test(latin)) throw new Error('رقم صحيح مطلوب')
      return Number(latin)
    }
    case 'money': {
      const plain = latin.replace(/[,٬\s]/g, '').replace('٫', '.')
      if (!/^-?\d+(\.\d{1,2})?$/.test(plain)) throw new Error('مبلغ غير صالح')
      const [whole, fraction = ''] = plain.replace('-', '').split('.')
      const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0') || '0')
      return String(plain.startsWith('-') ? -minor : minor)
    }
    case 'boolean': {
      const truthy = ['1', 'true', 'yes', 'نعم', 'صح']
      const falsy = ['0', 'false', 'no', 'لا', 'خطأ']
      if (truthy.includes(value.toLowerCase())) return true
      if (falsy.includes(value.toLowerCase())) return false
      throw new Error('قيمة نعم/لا غير صالحة')
    }
    case 'date': {
      const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(latin)
      const local = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(latin)
      const [y, m, d] = iso
        ? [iso[1], iso[2], iso[3]]
        : local
          ? [local[3], local[2].padStart(2, '0'), local[1].padStart(2, '0')]
          : []
      const date = y ? new Date(`${y}-${m}-${d}T00:00:00Z`) : null
      if (!date || Number.isNaN(date.getTime()) || date.getUTCDate() !== Number(d))
        throw new Error('تاريخ غير صالح (YYYY-MM-DD أو DD/MM/YYYY)')
      return `${y}-${m}-${d}`
    }
    case 'datetime': {
      const date = new Date(latin)
      if (Number.isNaN(date.getTime())) throw new Error('تاريخ ووقت غير صالحين')
      return date.toISOString()
    }
    case 'decimal':
    case 'percent': {
      // "," and "٬" only as thousands grouping (1,234.5); "٫" is the Arabic decimal point.
      const plain = latin.replace(/[\s%]/g, '').replace('٫', '.').replace(/٬/g, ',')
      if (!/^-?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/.test(plain)) throw new Error('رقم عشري غير صالح')
      return plain.replace(/,/g, '')
    }
    case 'lookup': {
      const key = lookups.get(normalize(value))
      if (!key) throw new Error('قيمة غير موجودة في القائمة')
      return key
    }
    default:
      return value
  }
}

/**
 * CSV imports in batches: the upload is parsed and stored, the user maps columns
 * to writable fields, and a worker saves each row through ResourceService with
 * the importing user's current permissions. Row failures never stop the batch.
 */
export class ImportBatches {
  constructor(
    private db: Knex,
    private registry: ResourceRegistry,
    private resources: ResourceService,
    private actors: ActorSource
  ) {}

  /** Writable, importable fields for this actor. */
  targets(name: string, actor: Actor): ImportTarget[] {
    const resource = this.registry.get(name)
    const ability = buildAbility(actor.rules, this.registry.all())
    if (!resource.actions.includes('create') || !ability.can('create', name))
      throw new AdulaError(403, 'E_FORBIDDEN', 'ليس لديك صلاحية الإضافة إلى هذا الكيان')
    const fields: ImportTarget[] = resource.form
      .filter((key) => {
        const field = resource.fields[key]
        return (
          !UNSUPPORTED.has(field.type) &&
          !field.sequence &&
          actor.permissionLevel >=
            Math.max(field.permissionLevel ?? 0, resource.hidden?.includes(key) ? 1 : 0) &&
          ability.can('create', subject(name, {}), key)
        )
      })
      .map((key) => ({
        key,
        label: resource.fields[key].label.ar,
        type: resource.fields[key].type,
        required: Boolean(resource.fields[key].required),
      }))
    // An inherited scope takes the unit from the parent row instead (#45).
    if (resource.scoped && !resource.scope)
      fields.push({
        key: 'orgUnitId',
        label: 'الوحدة التنظيمية (رقم)',
        type: 'integer',
        required: true,
      })
    return fields
  }

  async create(name: string, actor: Actor, input: { fileName: unknown; content: unknown }) {
    const targets = this.targets(name, actor)
    const fileName =
      typeof input.fileName === 'string' ? input.fileName.slice(0, 200) : 'import.csv'
    if (typeof input.content !== 'string' || !input.content.trim())
      throw new AdulaError(422, 'E_IMPORT_FILE', 'الملف فارغ')
    if (Buffer.byteLength(input.content) > FILE_LIMIT)
      throw new AdulaError(422, 'E_IMPORT_FILE', 'حجم الملف يتجاوز 5 ميغابايت')
    const parsed = Papa.parse<string[]>(input.content.replace(/^\uFEFF/, ''), {
      skipEmptyLines: 'greedy',
    })
    if (parsed.errors.some((error) => error.type !== 'Delimiter'))
      throw new AdulaError(422, 'E_IMPORT_FILE', `تعذر قراءة CSV: ${parsed.errors[0].message}`)
    const [headers = [], ...rows] = parsed.data
    if (!headers.length || headers.length > COLUMN_LIMIT)
      throw new AdulaError(422, 'E_IMPORT_FILE', 'يجب أن يحتوي الملف صف عناوين (100 عمود كحد أقصى)')
    if (!rows.length || rows.length > IMPORT_ROW_LIMIT)
      throw new AdulaError(422, 'E_IMPORT_ROWS', `عدد الصفوف بين 1 و${IMPORT_ROW_LIMIT}`)
    const mapping: Record<string, string> = {}
    headers.forEach((header, index) => {
      const target = targets.find((field) =>
        [field.key, field.label].some((alias) => normalize(alias) === normalize(header))
      )
      if (target && !Object.values(mapping).includes(target.key))
        mapping[String(index)] = target.key
    })
    const [row] = await this.db('import_batches')
      .insert({
        resource: name,
        user_id: actor.id,
        file_name: fileName,
        status: 'mapping',
        headers: JSON.stringify(headers),
        mapping: JSON.stringify(mapping),
        rows: JSON.stringify(rows.map((cells) => cells.slice(0, headers.length))),
        total: rows.length,
      })
      .returning('*')
    return this.present(row, targets)
  }

  async show(id: unknown, actor: Actor) {
    const row = await this.owned(id, actor)
    return this.present(row, this.safeTargets(row.resource, actor))
  }

  async list(actor: Actor) {
    const rows = await this.db('import_batches')
      .where('user_id', actor.id)
      .orderBy('id', 'desc')
      .limit(50)
      .select(
        'id',
        'resource',
        'file_name',
        'status',
        'headers',
        'mapping',
        'total',
        'processed',
        'created',
        'failed',
        'errors',
        'created_at',
        'finished_at'
      )
    return rows.map((row) => this.present({ ...row, rows: [] }, []))
  }

  /** Stores the column mapping and queues the batch for the worker. */
  async start(id: unknown, actor: Actor, mapping: unknown) {
    const row = await this.owned(id, actor)
    if (row.status !== 'mapping')
      throw new AdulaError(409, 'E_IMPORT_STATE', 'بدأت معالجة هذه الدفعة بالفعل')
    const targets = this.targets(row.resource, actor)
    if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping))
      throw new AdulaError(422, 'E_IMPORT_MAPPING', 'مطابقة الأعمدة غير صالحة')
    const clean: Record<string, string> = {}
    const used = new Set<string>()
    for (const [column, key] of Object.entries(mapping as Record<string, unknown>)) {
      if (key === '' || key === null || key === undefined) continue
      const index = Number(column)
      if (!Number.isInteger(index) || index < 0 || index >= row.headers.length)
        throw new AdulaError(422, 'E_IMPORT_MAPPING', 'عمود غير موجود')
      if (typeof key !== 'string' || !targets.some((target) => target.key === key) || used.has(key))
        throw new AdulaError(
          422,
          'E_IMPORT_MAPPING',
          `حقل غير قابل للاستيراد أو مكرر: ${String(key)}`
        )
      used.add(key)
      clean[String(index)] = key
    }
    const missing = targets.filter((target) => target.required && !used.has(target.key))
    if (missing.length)
      throw new AdulaError(
        422,
        'E_IMPORT_MAPPING',
        `حقول مطلوبة بلا عمود: ${missing.map((target) => target.label).join('، ')}`
      )
    await this.db('import_batches')
      .where('id', row.id)
      .update({ mapping: JSON.stringify(clean), status: 'queued' })
    return this.show(row.id, actor)
  }

  /**
   * Worker step: claims one queued or running batch and imports up to `chunk`
   * rows. Progress is committed per row, so a crash resumes after the last one.
   */
  async process(chunk = 200) {
    const batch = await this.db.transaction(async (trx) => {
      const row = await trx('import_batches')
        .whereIn('status', ['queued', 'running'])
        .orderBy('id')
        .forUpdate()
        .skipLocked()
        .first()
      if (!row) return null
      await trx('import_batches')
        .where('id', row.id)
        .update({ status: 'running', started_at: row.started_at ?? trx.fn.now() })
      return row
    })
    if (!batch) return null
    const actor = await this.actors.load(Number(batch.user_id))
    const resource = this.registry.get(batch.resource)
    const lookupGroups = new Map<string, Map<string, string>>()
    for (const [key, field] of Object.entries(resource.fields)) {
      if (field.type !== 'lookup') continue
      const rows = await this.db('lookups')
        .where({ group: field.group, active: true })
        .select('key', 'label_ar', 'label_en')
      const map = new Map<string, string>()
      for (const entry of rows)
        for (const name of [entry.key, entry.label_ar, entry.label_en])
          map.set(normalize(String(name)), entry.key)
      lookupGroups.set(key, map)
    }
    const mapping = batch.mapping as Record<string, string>
    const rows = batch.rows as string[][]
    let { processed, created, failed } = batch as {
      processed: number
      created: number
      failed: number
    }
    const errors = [...(batch.errors as { row: number; message: string }[])]
    const end = Math.min(rows.length, processed + chunk)
    for (let index = processed; index < end; index++) {
      const cells = rows[index]
      const input: RecordData = {}
      try {
        for (const [column, key] of Object.entries(mapping)) {
          const raw = cells[Number(column)] ?? ''
          if (key === 'orgUnitId') {
            input.orgUnitId = raw.trim() === '' ? null : Number(raw.trim())
            continue
          }
          try {
            input[key] = importCell(resource.fields[key], raw, lookupGroups.get(key) ?? new Map())
          } catch (error) {
            throw new Error(`${resource.fields[key].label.ar}: ${(error as Error).message}`)
          }
        }
        await this.resources.save(batch.resource, actor, input)
        created++
      } catch (error) {
        failed++
        if (errors.length < ERROR_LIMIT)
          errors.push({
            row: index + 2,
            message:
              error instanceof AdulaError || error instanceof Error
                ? error.message.slice(0, 300)
                : 'خطأ غير معروف',
          })
      }
      processed = index + 1
      await this.db('import_batches')
        .where('id', batch.id)
        .update({ processed, created, failed, errors: JSON.stringify(errors) })
    }
    if (processed >= rows.length) {
      await this.db.transaction(async (trx) => {
        await trx('import_batches')
          .where('id', batch.id)
          // Row data is only needed while importing; the log keeps counts and errors.
          .update({ status: 'done', finished_at: trx.fn.now(), rows: JSON.stringify([]) })
        await notifyWithTemplate(trx, Number(batch.user_id), 'import.finished', {
          resource: resource.label.ar,
          created,
          failed,
        })
      })
    }
    return { id: Number(batch.id), processed, created, failed }
  }

  private safeTargets(name: string, actor: Actor) {
    try {
      return this.targets(name, actor)
    } catch {
      return []
    }
  }

  private async owned(id: unknown, actor: Actor) {
    const batchId = Number(id)
    if (!Number.isSafeInteger(batchId) || batchId <= 0)
      throw new AdulaError(404, 'E_IMPORT_NOT_FOUND', 'الدفعة غير موجودة')
    const row = await this.db('import_batches').where({ id: batchId, user_id: actor.id }).first()
    if (!row) throw new AdulaError(404, 'E_IMPORT_NOT_FOUND', 'الدفعة غير موجودة')
    return row
  }

  private present(row: Record<string, any>, targets: ImportTarget[]): ImportBatch {
    let label = String(row.resource)
    try {
      label = this.registry.get(row.resource).label.ar
    } catch {}
    return {
      id: Number(row.id),
      resource: String(row.resource),
      resourceLabel: label,
      fileName: String(row.file_name),
      status: row.status,
      headers: row.headers ?? [],
      mapping: row.mapping ?? {},
      sample: (row.rows ?? []).slice(0, 5),
      total: Number(row.total),
      processed: Number(row.processed ?? 0),
      created: Number(row.created ?? 0),
      failed: Number(row.failed ?? 0),
      errors: row.errors ?? [],
      createdAt: new Date(row.created_at).toISOString(),
      finishedAt: row.finished_at ? new Date(row.finished_at).toISOString() : null,
      targets,
    }
  }
}
