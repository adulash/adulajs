import writeXlsxFile, { type Cell, type SheetData } from 'write-excel-file/node'
import type {
  Field,
  FieldOption,
  JsonValue,
  Resource,
  SerializedRecord,
} from '../../resource/types.js'
import type { Actor } from '../../auth/ability.js'
import { AdulaError } from '../errors.js'
import { labelText, translate } from '../../languages/catalog.js'
import { logActivity } from '../../core/activity.js'
import { countUpTo, list, type ListOptions } from './query.js'
import { describe } from './read.js'
import type { ResourceContext } from './shared.js'

/** Most rows one synchronous export may contain (ADR 046). */
export const EXPORT_ROW_LIMIT = 5000
const PAGE_SIZE = 100
const ACTIVITY_RESOURCE = 'core.exports'

export type ExportOptions = Omit<ListOptions, 'limit' | 'cursor' | 'estimate'>
export type CsvExport = {
  /** UTF-8 text with a byte order mark and CRLF line endings. */
  content: string
  /** Display file name (may contain Arabic); send it as an RFC 5987 filename*. */
  filename: string
  /** ASCII-only fallback file name for the plain filename parameter. */
  asciiFilename: string
  rows: number
}
/** An xlsx export; the same file names as CsvExport with the .xlsx extension. */
export type XlsxExport = {
  content: Uint8Array
  filename: string
  asciiFilename: string
  rows: number
}

/** The rows of one export, before they are written as CSV or xlsx. */
type ExportCell = { field: Field; text: string; raw: JsonValue | undefined }
type CollectedExport = {
  resource: Resource
  keys: string[]
  /** One entry per record: the field, its display text and its stored value per column. */
  rows: ExportCell[][]
  /** Records the export in the activity log with its format. */
  audit(format: 'csv' | 'xlsx'): Promise<void>
}

/**
 * The currently filtered list, read page by page through list(), so the actor's rules,
 * organization scope, field redaction and the soft-delete filter are exactly the list's.
 * More than EXPORT_ROW_LIMIT matching rows is 422 E_EXPORT_LIMIT and nothing is produced.
 */
async function collectExport(
  ctx: ResourceContext,
  name: string,
  actor: Actor,
  options: ExportOptions
): Promise<CollectedExport> {
  const resource = ctx.registry.get(name)
  const description = describe(ctx, name, actor)
  const readable = new Map(description.fields.map((field) => [field.key, field]))
  // Hidden fields are left out, not blanked; inline children have no single value.
  const keys = description.list.filter(
    (key) => readable.has(key) && resource.fields[key].type !== 'hasMany'
  )
  const query: ListOptions = {
    search: options.search,
    sort: options.sort,
    direction: options.direction,
    filters: options.filters,
    tag: options.tag,
    trashed: options.trashed,
  }
  // One bounded count first: an oversized export costs a single query, not 50 pages.
  if ((await countUpTo(ctx, name, actor, query, EXPORT_ROW_LIMIT)) > EXPORT_ROW_LIMIT)
    throw exportLimit()
  const records: SerializedRecord[] = []
  const titles = new Map<string, Map<number, string>>()
  let cursor: string | undefined
  do {
    const page = await list(ctx, name, actor, {
      ...query,
      limit: PAGE_SIZE,
      cursor,
      estimate: false,
    })
    records.push(...page.data)
    // Rows added while paging still cannot push the export past the limit.
    if (records.length > EXPORT_ROW_LIMIT) throw exportLimit()
    for (const [key, rows] of Object.entries(page.related)) {
      const known = titles.get(key) ?? new Map<number, string>()
      for (const row of rows) {
        const title = typeof row._title === 'string' ? row._title : row.fullName
        if (typeof title === 'string' && title) known.set(Number(row.id), title)
      }
      titles.set(key, known)
    }
    cursor = page.meta.nextCursor ?? undefined
  } while (cursor)

  const groups = keys.flatMap((key) => {
    const field = resource.fields[key]
    return field.type === 'lookup' ? [field.group] : []
  })
  const lookupLabels = new Map<string, string>()
  if (groups.length)
    for (const row of await ctx
      .db('lookups')
      .whereIn('group', groups)
      .select('group', 'key', 'label_ar'))
      lookupLabels.set(`${row.group}\u0000${row.key}`, String(row.label_ar))

  const display = (key: string, field: Field, value: JsonValue | undefined) =>
    cellText(field, value, {
      lookup: (group, entry) => lookupLabels.get(`${group}\u0000${entry}`),
      title: (id) => titles.get(key)?.get(id),
    })
  const rows = records.map((record) =>
    keys.map((key) => {
      const field = resource.fields[key]
      return { field, text: display(key, field, record[key]), raw: record[key] }
    })
  )
  const audit = async (format: 'csv' | 'xlsx') => {
    await logActivity(ctx.db, {
      resource: ACTIVITY_RESOURCE,
      recordId: 0,
      actorId: actor.id,
      impersonatorId: actor.impersonatorId,
      action: 'exported',
      changes: {
        resource: name,
        format,
        query: {
          ...(options.search ? { search: options.search } : {}),
          ...(options.sort ? { sort: options.sort } : {}),
          ...(options.direction ? { direction: options.direction } : {}),
          ...(options.filters && Object.keys(options.filters).length
            ? { filters: options.filters }
            : {}),
          ...(options.tag ? { tag: options.tag } : {}),
          ...(options.trashed ? { trashed: true } : {}),
        },
        rows: records.length,
      },
    })
  }
  return { resource, keys, rows, audit }
}

/**
 * The currently filtered list as CSV; see ResourceService.export. The rows, limit and audit
 * come from collectExport.
 */
export async function exportCsv(
  ctx: ResourceContext,
  name: string,
  actor: Actor,
  options: ExportOptions = {}
): Promise<CsvExport> {
  const { resource, keys, rows, audit } = await collectExport(ctx, name, actor, options)
  const lines = [
    keys.map((key) => csvCell(labelText(resource.fields[key].label), true)).join(','),
    ...rows.map((row) => row.map((cell) => csvCell(cell.text, textual(cell.field))).join(',')),
  ]
  await audit('csv')
  const day = new Date().toISOString().slice(0, 10)
  return {
    content: `\uFEFF${lines.join('\r\n')}\r\n`,
    filename: `${labelText(resource.label)}-${day}.csv`,
    asciiFilename: `${name}-${day}.csv`,
    rows: rows.length,
  }
}

/**
 * The currently filtered list as an Excel workbook (one right-to-left sheet, bold header),
 * with the same rows, columns, limit and audit as exportCsv. Numbers, amounts and dates are
 * typed cells; other values are text, guarded like CSV against formula evaluation.
 */
export async function exportXlsx(
  ctx: ResourceContext,
  name: string,
  actor: Actor,
  options: ExportOptions = {}
): Promise<XlsxExport> {
  const { resource, keys, rows, audit } = await collectExport(ctx, name, actor, options)
  const header: Cell[] = keys.map((key) => ({
    value: guardFormula(labelText(resource.fields[key].label)),
    fontWeight: 'bold',
  }))
  const data: SheetData = [header, ...rows.map((row) => row.map(xlsxCell))]
  const content = await writeXlsxFile(data, {
    sheet: sheetName(labelText(resource.label)),
    rightToLeft: true,
    stickyRowsCount: 1,
  }).toBuffer()
  await audit('xlsx')
  const day = new Date().toISOString().slice(0, 10)
  return {
    content: new Uint8Array(content.buffer, content.byteOffset, content.byteLength),
    filename: `${labelText(resource.label)}-${day}.xlsx`,
    asciiFilename: `${name}-${day}.xlsx`,
    rows: rows.length,
  }
}

/** Excel sheet names: at most 31 characters, none of [ ] : * ? / \, not quoted. */
function sheetName(label: string) {
  const clean = label
    .replace(/[[\]:*?/\\]/g, ' ')
    .trim()
    .replace(/^'+|'+$/g, '')
    .slice(0, 31)
    .trim()
  return clean || 'Sheet1'
}

const NUMERIC = new Set(['integer', 'decimal', 'percent'])

/** One typed xlsx cell; anything that is not a safe number or date stays guarded text. */
function xlsxCell({ field, text, raw }: ExportCell): Cell {
  if (raw === null || raw === undefined || raw === '') return null
  if (NUMERIC.has(field.type)) {
    const value = typeof raw === 'number' ? raw : Number(raw)
    if (Number.isFinite(value) && String(raw).trim() !== '') return value
  }
  if (field.type === 'money' && /^-?\d+$/.test(String(raw))) {
    const minor = BigInt(String(raw))
    const limit = BigInt(Number.MAX_SAFE_INTEGER)
    if (minor <= limit && minor >= -limit)
      return { value: Number(minor) / 100, type: Number, format: '#,##0.00' }
  }
  if (field.type === 'date' && typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const date = new Date(`${raw}T00:00:00.000Z`)
    if (!Number.isNaN(date.getTime())) return { value: date, type: Date, format: 'yyyy-mm-dd' }
  }
  return text === '' ? null : guardFormula(text)
}

function exportLimit() {
  return new AdulaError(
    422,
    'E_EXPORT_LIMIT',
    'عدد السجلات المطابقة يتجاوز حد التصدير (5000 سجل). ضيّق التصفية ثم أعد المحاولة.'
  )
}

/** Fields whose text comes from users, and so may carry a spreadsheet formula. */
function textual(field: Field) {
  return !['integer', 'money', 'decimal', 'percent', 'boolean', 'date', 'datetime'].includes(
    field.type
  )
}

/**
 * The display text of one stored value: lookup and option labels, titles, names, «نعم/لا»,
 * ISO dates. Several values (multiSelect, manyToMany) are joined with «، » as lists show them.
 */
export function cellText(
  field: Field,
  value: JsonValue | undefined,
  resolve: {
    lookup: (group: string, key: string) => string | undefined
    title: (id: number) => string | undefined
  }
): string {
  if (value === null || value === undefined || value === '') return ''
  switch (field.type) {
    case 'boolean':
      return translate(value === true ? 'list.value.yes' : 'list.value.no')
    case 'lookup':
      return resolve.lookup(field.group, String(value)) ?? String(value)
    case 'belongsTo':
    case 'user':
      // A record the reader may not view is never named, not even by its id.
      return resolve.title(Number(value)) ?? translate('list.value.unavailable')
    case 'enum':
      return optionText(field.options, value)
    case 'multiSelect':
      return Array.isArray(value)
        ? value.map((entry) => optionText(field.options, entry)).join('، ')
        : optionText(field.options, value)
    case 'manyToMany':
      return Array.isArray(value)
        ? value
            .map((id) => resolve.title(Number(id)) ?? translate('list.value.unavailable'))
            .join('، ')
        : String(value)
    case 'money':
      return moneyText(String(value))
    case 'attachment': {
      // A multiple field lists its file names in order, joined like other lists.
      const name = (entry: JsonValue) =>
        entry && typeof entry === 'object' && !Array.isArray(entry)
          ? String((entry as Record<string, JsonValue>).name ?? '')
          : String(entry)
      return Array.isArray(value) ? value.map(name).join('، ') : name(value)
    }
    case 'json':
      return JSON.stringify(value)
    default:
      return typeof value === 'object' ? JSON.stringify(value) : String(value)
  }
}

/** The label of an enum or multiSelect option in the interface language; unknown keys stay. */
function optionText(options: readonly FieldOption[], value: JsonValue) {
  const option = options.find((entry) => entry.value === String(value))
  return option ? labelText(option.label) : String(value)
}

/** Canonical minor units as a plain decimal amount (150000 → 1500.00), as forms show it. */
function moneyText(minor: string) {
  if (!/^-?\d+$/.test(minor)) return minor
  const amount = BigInt(minor)
  const abs = amount < 0n ? -amount : amount
  return `${amount < 0n ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`
}

/** Text a spreadsheet may evaluate: a leading tab or CR, or = + - @ (also full width) after spaces. */
const FORMULA_START = /^(?:[\t\r]|\s*[=+\-@\uFF1D\uFF0B\uFF0D\uFF20])/

/**
 * One quoted CSV cell. User text starting with a tab or a carriage return, or whose first
 * non-whitespace character is = + - @ or a full-width ＝ ＋ － ＠, is prefixed with an
 * apostrophe so spreadsheets do not evaluate it as a formula.
 */
export function csvCell(text: string, guard: boolean) {
  const safe = guard ? guardFormula(text) : text
  return `"${safe.replaceAll('"', '""')}"`
}

/**
 * Prefixes an apostrophe to text a spreadsheet would evaluate as a formula: a leading tab or
 * carriage return, or = + - @ (also full width) as the first non-whitespace character. CSV
 * export, xlsx export and xlsx templates share this one rule.
 */
export function guardFormula(text: string) {
  return FORMULA_START.test(text) ? `'${text}` : text
}
