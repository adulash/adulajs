import type { Field, FieldOption, JsonValue, SerializedRecord } from '../../resource/types.js'
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

/**
 * The currently filtered list as CSV; see ResourceService.export. Rows are read page by
 * page through list(), so the actor's rules, organization scope, field redaction and the
 * soft-delete filter are exactly the list's. More than EXPORT_ROW_LIMIT matching rows is
 * 422 E_EXPORT_LIMIT and nothing is produced.
 */
export async function exportCsv(
  ctx: ResourceContext,
  name: string,
  actor: Actor,
  options: ExportOptions = {}
): Promise<CsvExport> {
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
  const lines = [
    keys.map((key) => csvCell(labelText(resource.fields[key].label), true)).join(','),
    ...records.map((record) =>
      keys
        .map((key) => {
          const field = resource.fields[key]
          return csvCell(display(key, field, record[key]), textual(field))
        })
        .join(',')
    ),
  ]
  await logActivity(ctx.db, {
    resource: ACTIVITY_RESOURCE,
    recordId: 0,
    actorId: actor.id,
    impersonatorId: actor.impersonatorId,
    action: 'exported',
    changes: {
      resource: name,
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
  const day = new Date().toISOString().slice(0, 10)
  return {
    content: `\uFEFF${lines.join('\r\n')}\r\n`,
    filename: `${labelText(resource.label)}-${day}.csv`,
    asciiFilename: `${name}-${day}.csv`,
    rows: records.length,
  }
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
      return resolve.title(Number(value)) ?? `#${value}`
    case 'enum':
      return optionText(field.options, value)
    case 'multiSelect':
      return Array.isArray(value)
        ? value.map((entry) => optionText(field.options, entry)).join('، ')
        : optionText(field.options, value)
    case 'manyToMany':
      return Array.isArray(value)
        ? value.map((id) => resolve.title(Number(id)) ?? `#${id}`).join('، ')
        : String(value)
    case 'money':
      return moneyText(String(value))
    case 'attachment':
      return value && typeof value === 'object' && !Array.isArray(value)
        ? String((value as Record<string, JsonValue>).name ?? '')
        : String(value)
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

/**
 * One quoted CSV cell. User text starting with = + - @, a tab or a carriage return is
 * prefixed with an apostrophe so spreadsheets do not evaluate it as a formula.
 */
export function csvCell(text: string, guard: boolean) {
  const safe = guard && /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return `"${safe.replaceAll('"', '""')}"`
}
