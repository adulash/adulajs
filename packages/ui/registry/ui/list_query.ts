export const FILTER_IN_LIMIT = 50
export const BULK_LIMIT = 100
/*
 * List query helpers shared by the data table (ADR 046): operator filters in the URL,
 * saved-view round trips, the server export link and server error messages. Pure and
 * import-free so the registry tests run it directly.
 */

/** One active filter of a field; `eq` is the scalar equality the list always accepted. */
export type FieldFilter =
  | { op: 'eq'; value: string }
  | { op: 'in'; values: string[] }
  | { op: 'range'; gte?: string; lte?: string }
  | { op: 'empty'; empty: boolean }

/** The shape a saved view stores for one field: a scalar or one operator object. */
export type SavedFilterValue =
  | string
  | number
  | boolean
  | null
  | { in: (string | number)[] }
  | { gte?: string | number; lte?: string | number }
  | { empty: boolean }

/** How the filter control of a field type behaves. */
export type FilterMode = 'choice' | 'range' | 'boolean' | 'text'

const CHOICE = new Set([
  'lookup',
  'enum',
  'belongsTo',
  'user',
  'string',
  'text',
  'email',
  'phone',
  'url',
  'multiSelect',
  'manyToMany',
])
const RANGE = new Set(['integer', 'money', 'decimal', 'percent', 'date', 'datetime'])
/** Several values per record: the server matches one member (equality) or emptiness only. */
const MEMBER = new Set(['multiSelect', 'manyToMany'])

export function filterMode(type: string): FilterMode {
  if (type === 'boolean') return 'boolean'
  if (RANGE.has(type)) return 'range'
  if (CHOICE.has(type)) return 'choice'
  return 'text'
}

/** Whether a choice filter picks one member (multiSelect, manyToMany) instead of «أيٌّ من». */
export function singleChoice(type: string) {
  return MEMBER.has(type)
}

/**
 * The draft of a choice control: «أيٌّ من» is `in`; a member filter keeps only the latest
 * choice as equality, since the server accepts no `in` for several-valued fields.
 */
export function choiceFilter(type: string, values: string[]): FieldFilter | null {
  const chosen = values.filter(Boolean)
  if (!singleChoice(type)) return { op: 'in', values: chosen }
  const last = chosen.at(-1)
  return last ? { op: 'eq', value: last } : null
}

/**
 * Whether the filter controls emit this operator for the field type, each one the server
 * accepts (ADR 046): `in` for choices except member fields, ranges for numbers and dates,
 * equality and emptiness for every type.
 */
export function filterAllowed(type: string, filter: FieldFilter) {
  switch (filter.op) {
    case 'eq':
    case 'empty':
      return true
    case 'in':
      return filterMode(type) === 'choice' && !singleChoice(type)
    case 'range':
      return filterMode(type) === 'range'
  }
}

const prefix = (key: string) => `filters[${key}]`

/** Reads the filters of the given field keys from the list URL. */
export function readFilters(params: URLSearchParams, keys: string[]) {
  const filters: Record<string, FieldFilter> = {}
  for (const key of keys) {
    const base = prefix(key)
    const empty = params.get(`${base}[empty]`)
    const list = params.getAll(`${base}[in][]`)
    const joined = params.get(`${base}[in]`)
    const gte = params.get(`${base}[gte]`)
    const lte = params.get(`${base}[lte]`)
    const value = params.get(base)
    if (empty === 'true' || empty === 'false')
      filters[key] = { op: 'empty', empty: empty === 'true' }
    else if (list.length || joined) {
      const values = (list.length ? list : joined!.split(','))
        .map((entry) => entry.trim())
        .filter(Boolean)
      if (values.length) filters[key] = { op: 'in', values }
    } else if (gte || lte)
      filters[key] = {
        op: 'range',
        ...(gte ? { gte } : {}),
        ...(lte ? { lte } : {}),
      }
    else if (value) filters[key] = { op: 'eq', value }
  }
  return filters
}

/** Removes every parameter of one field's filter, whatever its operator. */
export function clearFilter(params: URLSearchParams, key: string) {
  const base = prefix(key)
  for (const name of [...params.keys()])
    if (name === base || name.startsWith(`${base}[`)) params.delete(name)
}

/**
 * Writes one field's filter. A single choice stays plain equality; several are
 * `[in]=a,b`, or repeated `[in][]` when a value itself contains a comma.
 */
export function writeFilter(params: URLSearchParams, key: string, filter: FieldFilter | null) {
  clearFilter(params, key)
  if (!filter) return
  const base = prefix(key)
  switch (filter.op) {
    case 'eq':
      if (filter.value) params.set(base, filter.value)
      return
    case 'in': {
      const values = [...new Set(filter.values.filter(Boolean))]
      if (values.length === 1) params.set(base, values[0])
      else if (values.some((value) => value.includes(',')))
        for (const value of values) params.append(`${base}[in][]`, value)
      else if (values.length) params.set(`${base}[in]`, values.join(','))
      return
    }
    case 'range':
      if (filter.gte) params.set(`${base}[gte]`, filter.gte)
      if (filter.lte) params.set(`${base}[lte]`, filter.lte)
      return
    case 'empty':
      params.set(`${base}[empty]`, String(filter.empty))
  }
}

/** A filter with nothing to apply (no values, no bounds) is no filter. */
export function normalizeFilter(filter: FieldFilter | null): FieldFilter | null {
  if (!filter) return null
  if (filter.op === 'eq') return filter.value ? filter : null
  if (filter.op === 'in') {
    const values = [...new Set(filter.values.filter(Boolean))]
    if (!values.length) return null
    return values.length === 1 ? { op: 'eq', value: values[0] } : { op: 'in', values }
  }
  if (filter.op === 'range') {
    if (!filter.gte && !filter.lte) return null
    return {
      op: 'range',
      ...(filter.gte ? { gte: filter.gte } : {}),
      ...(filter.lte ? { lte: filter.lte } : {}),
    }
  }
  return filter
}

/** The values a choice control shows as selected. */
export function chosenValues(filter: FieldFilter | undefined) {
  if (!filter) return []
  if (filter.op === 'eq') return [filter.value]
  if (filter.op === 'in') return filter.values
  return []
}

export function toSavedFilter(filter: FieldFilter): SavedFilterValue {
  switch (filter.op) {
    case 'eq':
      return filter.value
    case 'in':
      return { in: filter.values }
    case 'range':
      return {
        ...(filter.gte ? { gte: filter.gte } : {}),
        ...(filter.lte ? { lte: filter.lte } : {}),
      }
    case 'empty':
      return { empty: filter.empty }
  }
}

/** Reads a stored saved-view value; anything unrecognised is dropped (null). */
export function fromSavedFilter(value: unknown): FieldFilter | null {
  if (value === null || value === undefined || value === '') return null
  if (['string', 'number', 'boolean'].includes(typeof value))
    return { op: 'eq', value: String(value) }
  if (typeof value !== 'object' || Array.isArray(value)) return null
  const entry = value as Record<string, unknown>
  if ('empty' in entry) {
    const empty = entry.empty
    if (empty === true || empty === 'true') return { op: 'empty', empty: true }
    if (empty === false || empty === 'false') return { op: 'empty', empty: false }
    return null
  }
  if ('in' in entry) {
    const list = Array.isArray(entry.in)
      ? entry.in
      : typeof entry.in === 'string'
        ? entry.in.split(',')
        : []
    return normalizeFilter({
      op: 'in',
      values: list.map((item) => String(item).trim()),
    })
  }
  if ('gte' in entry || 'lte' in entry) {
    const bound = (operand: unknown) =>
      operand === null || operand === undefined || operand === '' ? undefined : String(operand)
    return normalizeFilter({
      op: 'range',
      gte: bound(entry.gte),
      lte: bound(entry.lte),
    })
  }
  return null
}

/** `GET /resources/:name/export` with the list's query (search, filters, tag, sort) but no cursor. */
export function exportHref(resource: string, params: URLSearchParams) {
  const query = new URLSearchParams(params)
  query.delete('cursor')
  query.delete('limit')
  const suffix = query.toString()
  return `/resources/${resource}/export${suffix ? `?${suffix}` : ''}`
}

/** The `error.message` of an AdulaJS JSON error body (object, JSON text or nothing). */
export function serverMessage(data: unknown): string | null {
  let body = data
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body)
    } catch {
      return null
    }
  }
  const message = (body as { error?: { message?: unknown } } | null)?.error?.message
  return typeof message === 'string' && message ? message : null
}

/** Selection helpers for bulk actions; ids are the string keys the table uses. */
export function toggleSelection(selected: Set<string>, id: string, on: boolean) {
  const next = new Set(selected)
  if (on) next.add(id)
  else next.delete(id)
  return next
}

export function selectionState(selected: Set<string>, ids: string[]): boolean | 'indeterminate' {
  const count = ids.filter((id) => selected.has(id)).length
  if (!count) return false
  return count === ids.length ? true : 'indeterminate'
}

/** The bulk request body: numeric ids and the loaded rows' versions keyed by id. */
export function bulkPayload(
  action: string,
  ids: string[],
  rows: { id?: unknown; version?: unknown }[]
) {
  const versions: Record<string, unknown> = {}
  const wanted = new Set(ids)
  for (const row of rows)
    if (wanted.has(String(row.id)) && row.version !== undefined && row.version !== null)
      versions[String(row.id)] = row.version
  return { action, ids: ids.map(Number), versions }
}

/**
 * A datetime range bound as typed (`YYYY-MM-DD` or `YYYY-MM-DDTHH:mm`, optionally `hijri:`)
 * made inclusive: «من» starts at the beginning of the chosen day or minute, «إلى» ends at
 * its last millisecond, so filtering «إلى ١ أكتوبر» keeps records of 1 October.
 */
export function inclusiveDatetime(raw: string, side: 'gte' | 'lte') {
  const value = raw.trim()
  if (!value) return value
  const [day, time] = value.split('T')
  if (!time) return `${day}T${side === 'gte' ? '00:00:00.000' : '23:59:59.999'}`
  if (/^\d{2}:\d{2}$/.test(time)) return `${day}T${time}${side === 'gte' ? ':00.000' : ':59.999'}`
  return value
}
