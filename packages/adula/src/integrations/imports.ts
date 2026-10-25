import { randomUUID } from 'node:crypto'
import Papa from 'papaparse'
import type { Knex } from 'knex'
import { subject } from '@casl/ability'
import type { Actor } from '../auth/ability.js'
import { buildAbility } from '../auth/ability.js'
import type { ResourceService } from '../admin/resource_service.js'
import type { ResourceRegistry } from '../resource/registry.js'
import type { Field, RecordData, Resource } from '../resource/types.js'
import { columnName } from '../resource/define_resource.js'
import { AdulaError } from '../admin/errors.js'
import { notifyWithTemplate } from '../core/message_templates.js'
import { translate } from '../languages/catalog.js'
import {
  csvImportAdapter,
  extensionOf,
  importFile,
  type ImportAdapter,
  type ImportFile,
} from './import_adapters.js'

/** Batch states before dry runs; kept for compatibility. See ImportBatchStatus. */
export type ImportStatus = 'mapping' | 'queued' | 'running' | 'done' | 'failed'
/** Every batch state; 'validated' is a finished dry run waiting for the real import. */
export type ImportBatchStatus = ImportStatus | 'validated'
/** 'create' adds every row; 'upsert' updates the live record whose unique `matchField` matches. */
export type ImportMode = 'create' | 'upsert'
export type ImportTarget = { key: string; label: string; type: string; required: boolean }
/** An importable field as ImportBatches returns it. */
export type ImportTargetField = ImportTarget & {
  /** Marked `unique` in the definition: usable as an upsert match field. */
  unique: boolean
}
/** One row's outcome in a dry run: what the real import would do, or why it would fail. */
export type ImportReportRow = {
  row: number
  ok: boolean
  action?: 'create' | 'update'
  message?: string
}
/**
 * The batch shape before import modes; kept for compatibility.
 * @deprecated Use ImportBatchRecord, which ImportBatches returns.
 */
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
/** An import batch with its mode, dry-run state and per-row report. */
export type ImportBatchRecord = Omit<ImportBatch, 'status' | 'targets'> & {
  status: ImportBatchStatus
  mode: ImportMode
  matchField: string | null
  /** The batch is (or was last) processed as a validation run that saves nothing. */
  dryRun: boolean
  /** Rows an upsert updated (or, in a dry run, would update). */
  updated: number
  /** Per-row dry-run report; empty for list() and for real imports. */
  report: ImportReportRow[]
  targets: ImportTargetField[]
}
export type ActorSource = { load(id: number): Promise<Actor> }
export type ImportBatchesOptions = {
  /** Extra file formats; CSV is always available. See ImportAdapter. */
  adapters?: ImportAdapter[]
}
export type ImportCreateInput = {
  fileName: unknown
  /** UTF-8 text, raw bytes, or base64 text when `encoding` is 'base64'. */
  content: unknown
  /** An adapter name; detected from the file when omitted. */
  format?: unknown
  encoding?: unknown
  mimeType?: unknown
  mode?: unknown
  matchField?: unknown
  dryRun?: unknown
}
export type ImportStartOptions = { mode?: unknown; matchField?: unknown; dryRun?: unknown }

export const IMPORT_ROW_LIMIT = 5000
const COLUMN_LIMIT = 100
const ERROR_LIMIT = 200
const FILE_LIMIT = 5 * 1024 * 1024
const UNSUPPORTED = new Set(['hasMany', 'attachment', 'json'])
const MODES = new Set<ImportMode>(['create', 'upsert'])

const normalize = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
/** Template headers mark required columns with `*`; the mark never blocks matching. */
const headerKey = (value: string) => normalize(value.replace(/\s*\*+\s*$/, ''))

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
    case 'lookup': {
      const key = lookups.get(normalize(value))
      if (!key) throw new Error('قيمة غير موجودة في القائمة')
      return key
    }
    default:
      return value
  }
}

/** How long a claimed batch stays reserved for one worker; renewed after every row. */
const LEASE_SECONDS = 300
const leaseExpiry = (db: Knex) => db.raw(`now() + interval '${LEASE_SECONDS} seconds'`)

/** Raised inside a dry-run transaction so it always rolls back. */
class DryRunRollback extends Error {}

/**
 * File imports in batches: the upload is parsed by a format adapter (CSV built in) and
 * stored, the user maps columns to writable fields, and a worker saves each row through
 * ResourceService with the importing user's current permissions. Row failures never stop
 * the batch. A dry run validates every row exactly like the real import inside a
 * transaction that is rolled back, so nothing (records, activity, outbox events, sequence
 * numbers, notifications) is kept; the batch then waits as 'validated' for the real run.
 * Upsert mode updates the live record matched by a unique field and creates the rest.
 */
export class ImportBatches {
  private formats: ImportAdapter[] = [csvImportAdapter]

  constructor(
    private db: Knex,
    private registry: ResourceRegistry,
    private resources: ResourceService,
    private actors: ActorSource,
    options: ImportBatchesOptions = {}
  ) {
    for (const adapter of options.adapters ?? []) this.registerAdapter(adapter)
  }

  /**
   * Adds a file format, for example an XLSX adapter. A later adapter with the same
   * name replaces the earlier one; CSV stays the fallback for text without an extension.
   */
  registerAdapter(adapter: ImportAdapter) {
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(adapter.name) || !adapter.extensions.length)
      throw new Error('An import adapter needs a lower-case name and at least one extension')
    this.formats = [...this.formats.filter((item) => item.name !== adapter.name), adapter]
    return this
  }

  /** Registered formats, CSV first. */
  adapters(): readonly ImportAdapter[] {
    return this.formats
  }

  /** Every accepted upload extension, for the upload validator and the file picker. */
  extensions() {
    return [...new Set(this.formats.flatMap((adapter) => adapter.extensions))]
  }

  /** Writable, importable fields for this actor; upsert also needs update permission. */
  targets(name: string, actor: Actor, mode: ImportMode = 'create'): ImportTargetField[] {
    const resource = this.registry.get(name)
    const ability = buildAbility(actor.rules, this.registry.all())
    if (!resource.actions.includes('create') || !ability.can('create', name))
      throw new AdulaError(403, 'E_FORBIDDEN', 'ليس لديك صلاحية الإضافة إلى هذا الكيان')
    const upsert = mode === 'upsert'
    if (upsert && (!resource.actions.includes('update') || !ability.can('update', name)))
      throw new AdulaError(403, 'E_FORBIDDEN', 'الإضافة أو التحديث يتطلب صلاحية التعديل أيضاً')
    const fields: ImportTargetField[] = resource.form
      .filter((key) => {
        const field = resource.fields[key]
        return (
          !UNSUPPORTED.has(field.type) &&
          !field.sequence &&
          actor.permissionLevel >=
            Math.max(field.permissionLevel ?? 0, resource.hidden?.includes(key) ? 1 : 0) &&
          ability.can('create', subject(name, {}), key) &&
          (!upsert || ability.can('update', subject(name, {}), key))
        )
      })
      .map((key) => ({
        key,
        label: resource.fields[key].label.ar,
        type: resource.fields[key].type,
        required: Boolean(resource.fields[key].required),
        unique: Boolean(resource.fields[key].unique),
      }))
    // An inherited scope takes the unit from the parent row instead (#45).
    if (resource.scoped && !resource.scope)
      fields.push({
        key: 'orgUnitId',
        label: 'الوحدة التنظيمية (رقم)',
        type: 'integer',
        required: true,
        unique: false,
      })
    return fields
  }

  /**
   * A CSV header row of the actor's importable fields in Arabic, required ones marked
   * with `*`, with a UTF-8 byte-order mark so spreadsheet programs show Arabic. The
   * headers map automatically when the filled template is uploaded.
   */
  template(name: string, actor: Actor, mode: ImportMode = 'create') {
    const targets = this.targets(name, actor, mode)
    const headers = targets.map((target) => `${target.label}${target.required ? ' *' : ''}`)
    return {
      fileName: `${name}-template.csv`,
      content: `\uFEFF${Papa.unparse([headers])}\n`,
    }
  }

  async create(name: string, actor: Actor, input: ImportCreateInput) {
    const mode = this.mode(input.mode ?? 'create')
    const targets = this.targets(name, actor, mode)
    const matchField = input.matchField ? this.matchField(targets, input.matchField) : null
    const fileName =
      typeof input.fileName === 'string' ? input.fileName.slice(0, 200) : 'import.csv'
    let bytes: Uint8Array
    if (typeof input.content === 'string') {
      if (!input.content.trim()) throw new AdulaError(422, 'E_IMPORT_FILE', 'الملف فارغ')
      bytes = Buffer.from(input.content, input.encoding === 'base64' ? 'base64' : 'utf8')
    } else if (input.content instanceof Uint8Array) bytes = input.content
    else throw new AdulaError(422, 'E_IMPORT_FILE', 'الملف فارغ')
    if (!bytes.byteLength) throw new AdulaError(422, 'E_IMPORT_FILE', 'الملف فارغ')
    if (bytes.byteLength > FILE_LIMIT)
      throw new AdulaError(422, 'E_IMPORT_FILE', 'حجم الملف يتجاوز 5 ميغابايت')
    const file = importFile(
      fileName,
      bytes,
      typeof input.mimeType === 'string' ? input.mimeType : undefined
    )
    const adapter = this.adapterFor(file, input.format, typeof input.content === 'string')
    const { headers, rows } = await adapter.parse(file)
    if (!headers.length || headers.length > COLUMN_LIMIT)
      throw new AdulaError(422, 'E_IMPORT_FILE', 'يجب أن يحتوي الملف صف عناوين (100 عمود كحد أقصى)')
    if (!rows.length || rows.length > IMPORT_ROW_LIMIT)
      throw new AdulaError(422, 'E_IMPORT_ROWS', `عدد الصفوف بين 1 و${IMPORT_ROW_LIMIT}`)
    const mapping: Record<string, string> = {}
    headers.forEach((header, index) => {
      const target = targets.find((field) =>
        [field.key, field.label].some((alias) => normalize(alias) === headerKey(String(header)))
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
        mode,
        match_field: matchField,
        dry_run: input.dryRun === true,
        headers: JSON.stringify(headers.map(String)),
        mapping: JSON.stringify(mapping),
        rows: JSON.stringify(
          rows.map((cells) => cells.slice(0, headers.length).map((cell) => String(cell ?? '')))
        ),
        total: rows.length,
      })
      .returning('*')
    return this.present(row, targets)
  }

  async show(id: unknown, actor: Actor) {
    const row = await this.owned(id, actor)
    return this.present(row, this.safeTargets(row.resource, actor, row.mode))
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
        'mode',
        'match_field',
        'dry_run',
        'headers',
        'mapping',
        'total',
        'processed',
        'created',
        'updated',
        'failed',
        'errors',
        'created_at',
        'finished_at'
      )
    return rows.map((row) => this.present({ ...row, rows: [], report: [] }, []))
  }

  /**
   * Stores the column mapping and queues the batch for the worker. A batch in 'mapping'
   * runs as created (dry run or not) unless `dryRun` says otherwise; a 'validated' batch
   * runs for real by default, so the same batch is imported after its dry run.
   */
  async start(id: unknown, actor: Actor, mapping: unknown, options: ImportStartOptions = {}) {
    const row = await this.owned(id, actor)
    if (!['mapping', 'validated'].includes(row.status))
      throw new AdulaError(409, 'E_IMPORT_STATE', 'بدأت معالجة هذه الدفعة بالفعل')
    const mode = this.mode(options.mode ?? row.mode ?? 'create')
    const targets = this.targets(row.resource, actor, mode)
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
    let matchField: string | null = null
    if (mode === 'upsert') {
      matchField = this.matchField(targets, options.matchField ?? row.match_field)
      if (!used.has(matchField))
        throw new AdulaError(422, 'E_IMPORT_MATCH', 'اربط حقل المطابقة بعمود من الملف')
    }
    const dryRun =
      typeof options.dryRun === 'boolean'
        ? options.dryRun
        : row.status === 'validated'
          ? false
          : Boolean(row.dry_run)
    // Conditional on the state read above: of two concurrent starts only one queues the
    // batch, and a batch a worker already claimed is never reset to row 0.
    const queued = await this.db('import_batches')
      .where({ id: row.id, status: row.status })
      .whereIn('status', ['mapping', 'validated'])
      .update({
        mapping: JSON.stringify(clean),
        mode,
        match_field: matchField,
        dry_run: dryRun,
        status: 'queued',
        processed: 0,
        created: 0,
        updated: 0,
        failed: 0,
        errors: JSON.stringify([]),
        report: JSON.stringify([]),
        started_at: null,
        finished_at: null,
        lease_id: null,
        lease_expires_at: null,
      })
    if (!queued) throw new AdulaError(409, 'E_IMPORT_STATE', 'بدأت معالجة هذه الدفعة بالفعل')
    return this.show(row.id, actor)
  }

  /**
   * Worker step: claims one queued or running batch and imports (or, for a dry run,
   * validates) up to `chunk` rows. The claim is a lease (lease_id, lease_expires_at, renewed
   * after every row): concurrent workers never share a batch, and an expired lease is taken
   * over, resuming after the last committed row. Import progress is committed per row in
   * the row's own transaction; a dry run records its progress and report once per chunk.
   * Returns null when no batch is free, or when this worker's lease was taken over (it then
   * writes nothing further).
   */
  async process(chunk = 200) {
    const lease = randomUUID()
    const batch = await this.db.transaction(async (trx) => {
      // A batch is free when no worker holds an unexpired lease on it; an expired lease
      // (a crashed or stalled worker) is taken over and processing resumes after its last row.
      const row = await trx('import_batches')
        .whereIn('status', ['queued', 'running'])
        .where((free) => free.whereNull('lease_id').orWhere('lease_expires_at', '<', trx.fn.now()))
        .orderBy('id')
        .forUpdate()
        .skipLocked()
        .first()
      if (!row) return null
      await trx('import_batches')
        .where('id', row.id)
        .update({
          status: 'running',
          started_at: row.started_at ?? trx.fn.now(),
          lease_id: lease,
          lease_expires_at: leaseExpiry(trx),
        })
      return row
    })
    if (!batch) return null
    // Every later write names this lease; one that affects no row means another worker
    // took the batch over, and this worker stops without writing anything else.
    const owned = (db: Knex) => db('import_batches').where({ id: batch.id, lease_id: lease })
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
    const dryRun = Boolean(batch.dry_run)
    const mode: ImportMode = batch.mode === 'upsert' ? 'upsert' : 'create'
    const matchField = mode === 'upsert' ? (batch.match_field as string) : null
    // A dry run rolls each row back, so it finds duplicates within the file itself.
    const earlier = dryRun ? this.earlierDuplicates(resource, mapping, rows, matchField) : null
    let { processed, created, updated, failed } = batch as {
      processed: number
      created: number
      updated: number
      failed: number
    }
    let errors = [...(batch.errors as { row: number; message: string }[])]
    const report = [...((batch.report ?? []) as ImportReportRow[])]
    const end = Math.min(rows.length, processed + chunk)
    for (let index = processed; index < end; index++) {
      const cells = rows[index]
      // One row: convert, then save (in a savepoint of `trx` for a real import).
      const importRow = async (trx?: Knex.Transaction): Promise<ImportReportRow> => {
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
          const duplicate = earlier?.duplicates.get(index)
          if (duplicate) throw new Error(duplicate)
          let action = await this.saveRow(resource, actor, input, matchField, dryRun, trx)
          // A repeated match value updates the record the earlier row of the file created.
          if (earlier?.repeats.has(index)) action = 'update'
          return { row: index + 2, ok: true, action }
        } catch (error) {
          return { row: index + 2, ok: false, message: rowMessage(error) }
        }
      }
      const count = (outcome: ImportReportRow) => {
        const next = { created, updated, failed, errors }
        if (!outcome.ok) {
          next.failed++
          if (errors.length < ERROR_LIMIT)
            next.errors = [...errors, { row: outcome.row, message: outcome.message ?? '' }]
        } else if (outcome.action === 'create') next.created++
        else next.updated++
        return next
      }
      let next: ReturnType<typeof count> | null
      if (dryRun) {
        const outcome = await importRow()
        next = count(outcome)
        report.push(outcome)
        // A dry run saves nothing: only the lease is renewed per row; progress and the
        // report are written once per chunk, and a crash only validates that chunk again.
        if (!(await owned(this.db).update({ lease_expires_at: leaseExpiry(this.db) }))) return null
      } else {
        // A real import saves the row and its progress in one transaction that first locks
        // the batch under this lease at this row, so every row is imported exactly once
        // even when an expired lease was taken over by another worker meanwhile.
        next = await this.db.transaction(async (trx) => {
          if (!(await owned(trx).where('processed', index).forUpdate().first('id'))) return null
          const counts = count(await importRow(trx))
          await owned(trx).update({
            processed: index + 1,
            created: counts.created,
            updated: counts.updated,
            failed: counts.failed,
            errors: JSON.stringify(counts.errors),
            lease_expires_at: leaseExpiry(trx),
          })
          return counts
        })
        if (!next) return null
      }
      ;({ created, updated, failed, errors } = next)
      processed = index + 1
    }
    const finished = processed >= rows.length
    if (dryRun) {
      const written = await owned(this.db).update({
        processed,
        created,
        updated,
        failed,
        errors: JSON.stringify(errors),
        report: JSON.stringify(report),
        // The rows stay for the real import; a dry run sends no notification.
        ...(finished ? { status: 'validated', finished_at: this.db.fn.now() } : {}),
        lease_id: null,
        lease_expires_at: null,
      })
      if (!written) return null
    } else if (finished) {
      const written = await this.db.transaction(async (trx) => {
        const count = await owned(trx)
          // Row data is only needed while importing; the log keeps counts and errors.
          .update({
            status: 'done',
            finished_at: trx.fn.now(),
            rows: JSON.stringify([]),
            lease_id: null,
            lease_expires_at: null,
          })
        if (count)
          await notifyWithTemplate(trx, Number(batch.user_id), 'import.finished', {
            resource: resource.label.ar,
            created: created + updated,
            failed,
          })
        return count
      })
      if (!written) return null
    } else if (!(await owned(this.db).update({ lease_id: null, lease_expires_at: null })))
      // The chunk is done; release the batch so the next tick (any worker) continues it.
      return null
    return { id: Number(batch.id), processed, created, updated, failed }
  }

  /**
   * Saves one row through ResourceService. Upsert first looks for the live record with
   * the same match value; ResourceService then authorizes the update against the actor's
   * scope and rules and checks the record's current `version`. A real import runs in a
   * savepoint of `trx` (the caller's progress transaction); a dry run does the same inside
   * a transaction that is always rolled back.
   */
  private async saveRow(
    resource: Resource,
    actor: Actor,
    input: RecordData,
    matchField: string | null,
    dryRun: boolean,
    trx?: Knex.Transaction
  ): Promise<'create' | 'update'> {
    const work = async (scope: Knex.Transaction) => {
      let id: number | undefined
      if (matchField) {
        const field = resource.fields[matchField]
        const value = input[matchField]
        if (value === null || value === undefined)
          throw new Error(`${field.label.ar}: قيمة المطابقة مطلوبة`)
        const found = await scope(resource.name)
          .whereNull('deleted_at')
          .where(field.column ?? columnName(matchField), value as string)
          .first(['id', ...(resource.version ? ['version'] : [])])
        if (found) {
          id = Number(found.id)
          if (resource.version) input.version = Number(found.version)
          // An empty cell keeps the stored value of a matched record instead of clearing it.
          for (const key of Object.keys(input)) if (input[key] === null) delete input[key]
        }
      }
      await this.resources.save(resource.name, actor, input, id, scope)
      return id === undefined ? ('create' as const) : ('update' as const)
    }
    if (!dryRun) return (trx ?? this.db).transaction(work)
    let action: 'create' | 'update' = 'create'
    try {
      await this.db.transaction(async (scope) => {
        action = await work(scope)
        throw new DryRunRollback()
      })
    } catch (error) {
      if (!(error instanceof DryRunRollback)) throw error
    }
    return action
  }

  /**
   * Rows whose unique value repeats an earlier row of the same file. In upsert mode a
   * repeated match value is not an error: that row would update the earlier row's record.
   */
  private earlierDuplicates(
    resource: Resource,
    mapping: Record<string, string>,
    rows: string[][],
    matchField: string | null
  ) {
    const duplicates = new Map<number, string>()
    const repeats = new Set<number>()
    for (const [column, key] of Object.entries(mapping)) {
      if (!resource.fields[key]?.unique) continue
      const seen = new Map<string, number>()
      rows.forEach((cells, index) => {
        const value = (cells[Number(column)] ?? '').trim()
        if (!value) return
        const first = seen.get(value)
        if (first === undefined) seen.set(value, index)
        else if (key === matchField) repeats.add(index)
        else if (!duplicates.has(index))
          duplicates.set(
            index,
            `${resource.fields[key].label.ar}: القيمة مكررة في الملف (الصف ${first + 2})`
          )
      })
    }
    return { duplicates, repeats }
  }

  private adapterFor(file: ImportFile, format: unknown, text: boolean) {
    if (format !== undefined && format !== null && format !== '') {
      const named = this.formats.find((adapter) => adapter.name === format)
      if (!named) throw new AdulaError(422, 'E_IMPORT_FORMAT', 'صيغة الملف غير مدعومة')
      return named
    }
    const byExtension = this.formats.filter((adapter) =>
      adapter.extensions.includes(extensionOf(file.fileName))
    )
    const detected =
      [...byExtension].reverse().find((adapter) => adapter.detect(file)) ??
      [...this.formats].reverse().find((adapter) => adapter.detect(file))
    if (detected) return detected
    // Text without a recognizable name keeps the historical CSV behaviour.
    if (text && !extensionOf(file.fileName)) return csvImportAdapter
    throw new AdulaError(422, 'E_IMPORT_FORMAT', 'صيغة الملف غير مدعومة')
  }

  private mode(value: unknown): ImportMode {
    if (typeof value !== 'string' || !MODES.has(value as ImportMode))
      throw new AdulaError(422, 'E_IMPORT_MODE', 'نمط الاستيراد غير صالح')
    return value as ImportMode
  }

  private matchField(targets: ImportTargetField[], value: unknown) {
    const target = targets.find((item) => item.key === value)
    if (!target || !target.unique)
      throw new AdulaError(
        422,
        'E_IMPORT_MATCH',
        'حقل المطابقة يجب أن يكون حقلاً فريداً قابلاً للاستيراد'
      )
    return target.key
  }

  private safeTargets(name: string, actor: Actor, mode?: string) {
    try {
      return this.targets(name, actor, mode === 'upsert' ? 'upsert' : 'create')
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

  private present(row: Record<string, any>, targets: ImportTargetField[]): ImportBatchRecord {
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
      mode: row.mode === 'upsert' ? 'upsert' : 'create',
      matchField: row.match_field ?? null,
      dryRun: Boolean(row.dry_run),
      headers: row.headers ?? [],
      mapping: row.mapping ?? {},
      sample: (row.rows ?? []).slice(0, 5),
      total: Number(row.total),
      processed: Number(row.processed ?? 0),
      created: Number(row.created ?? 0),
      updated: Number(row.updated ?? 0),
      failed: Number(row.failed ?? 0),
      errors: row.errors ?? [],
      report: row.report ?? [],
      createdAt: new Date(row.created_at).toISOString(),
      finishedAt: row.finished_at ? new Date(row.finished_at).toISOString() : null,
      targets,
    }
  }
}

/** A row failure as the user reads it; database constraint errors get their Arabic text. */
function rowMessage(error: unknown) {
  const code = (error as { code?: string })?.code
  if (code === '23505') return translate('errors.E_DUPLICATE', 'ar')
  if (code === '23503') return translate('errors.E_RELATION', 'ar')
  return error instanceof AdulaError || error instanceof Error
    ? error.message.slice(0, 300)
    : 'خطأ غير معروف'
}
