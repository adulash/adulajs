import type { Field } from './types.js'
import { currentLanguage, translate, type MessageParams } from '../languages/catalog.js'

/**
 * A value the field definition forbids. `rule` names the catalog message
 * (`validation.<rule>`), so the derived VineJS validator reports it like its own rules.
 */
export class FieldValueError extends Error {
  constructor(
    readonly rule: string,
    readonly params: MessageParams = {}
  ) {
    super(translate(`validation.${rule}`, currentLanguage(), params))
    this.name = 'FieldValueError'
  }
}

/** Column length of each text-like type (string and enum are varchar(255)). */
export const TEXT_LIMITS: Readonly<Record<string, number>> = {
  string: 255,
  enum: 255,
  email: 254,
  phone: 32,
  url: 2048,
}
/** The most ids one manyToMany write may link. */
export const MANY_TO_MANY_LIMIT = 500

/** numeric(precision, scale) of a decimal or percent field, with the documented defaults. */
export function decimalShape(field: { type: string; precision?: number; scale?: number }) {
  return {
    precision: field.precision ?? (field.type === 'percent' ? 7 : 18),
    scale: field.scale ?? 2,
  }
}

/**
 * Refuses a JSON number that cannot carry a decimal exactly: its magnitude reaches
 * Number.MAX_SAFE_INTEGER or it has more than 15 significant digits, so String(value)
 * may already be a rounded neighbour of what the client meant (12345678901234567 arrives
 * as 12345678901234568). Such values must be sent as strings.
 */
function unsafeNumber(value: number) {
  const significant = String(Math.abs(value)).replace('.', '').replace(/^0+/, '').replace(/0+$/, '')
  if (Math.abs(value) >= Number.MAX_SAFE_INTEGER || significant.length > 15)
    throw new FieldValueError('unsafeNumber')
}

/**
 * The canonical decimal string of a number or numeric string: an optional minus, the
 * integer digits without leading zeros and exactly `scale` fractional digits ("12.50").
 * Rejects more fractional digits than `scale` (trailing zeros excepted), more than
 * `precision - scale` integer digits and JSON numbers beyond exact precision (see
 * unsafeNumber); strings keep every digit.
 */
export function canonicalDecimal(value: unknown, precision: number, scale: number): string {
  if (typeof value === 'number' && Number.isFinite(value)) unsafeNumber(value)
  const text =
    typeof value === 'number' && Number.isFinite(value)
      ? String(value)
      : typeof value === 'string'
        ? value.trim()
        : undefined
  const match = text === undefined ? null : /^([+-])?(\d+)(?:\.(\d+))?$/.exec(text)
  if (!match) throw new FieldValueError('number')
  const [, sign, whole, fraction = ''] = match
  if (/[^0]/.test(fraction.slice(scale))) throw new FieldValueError('decimalScale', { scale })
  const integer = whole.replace(/^0+(?=\d)/, '')
  if (integer.replace(/^0$/, '').length > precision - scale)
    throw new FieldValueError('decimalPrecision', { digits: precision - scale })
  const digits = fraction.slice(0, scale).padEnd(scale, '0')
  const body = scale ? `${integer}.${digits}` : integer
  return sign === '-' && /[1-9]/.test(body) ? `-${body}` : body
}

/** A canonical decimal string as an integer count of 10^-scale units, for comparisons. */
function scaled(value: string) {
  return BigInt(value.replace('.', ''))
}

/** Arabic-Indic and Extended Arabic-Indic digits as ASCII digits. */
export function latinDigits(value: string) {
  return value
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
}

/** `+?digits` (7 to 15 digits) from input with spaces, dashes, dots, parentheses or Arabic digits. */
export function normalizePhone(value: string) {
  const phone = latinDigits(value.trim()).replace(/[\s\-().]/g, '')
  if (!/^\+?\d{7,15}$/.test(phone)) throw new FieldValueError('phone')
  return phone
}

const EMAIL =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/

/** A trimmed, lower-cased e-mail address. */
export function normalizeEmail(value: string) {
  const email = value.trim().toLowerCase()
  if (email.length > 254 || !EMAIL.test(email)) throw new FieldValueError('email')
  return email
}

/** A trimmed absolute http(s) URL; javascript:, data: and relative URLs are refused. */
export function normalizeUrl(value: string) {
  const url = value.trim()
  let parsed: URL | undefined
  try {
    parsed = new URL(url)
  } catch {}
  if (
    !parsed ||
    !/^https?:\/\/[^\s/?#]/i.test(url) ||
    /\s/.test(url) ||
    !['http:', 'https:'].includes(parsed.protocol) ||
    !parsed.hostname
  )
    throw new FieldValueError('url')
  return url
}

function normalizeFormat(format: 'email' | 'url' | 'phone', value: string) {
  return format === 'email'
    ? normalizeEmail(value)
    : format === 'url'
      ? normalizeUrl(value)
      : normalizePhone(value)
}

const patterns = new Map<string, RegExp>()
/** The anchored RegExp of a field pattern (`^(?:source)$`), compiled once. */
export function fieldPattern(source: string) {
  let pattern = patterns.get(source)
  if (!pattern) {
    pattern = new RegExp(`^(?:${source})$`)
    if (patterns.size < 1000) patterns.set(source, pattern)
  }
  return pattern
}

type Constrained = { type: string; min?: number | string; max?: number | string; pattern?: string }

function checkText(field: Constrained, value: string) {
  const max = Math.min(Number(field.max ?? Infinity), TEXT_LIMITS[field.type] ?? Infinity)
  if (field.min !== undefined && value.length < Number(field.min))
    throw new FieldValueError('minLength', { min: Number(field.min) })
  if (value.length > max) throw new FieldValueError('maxLength', { max })
  if (field.pattern !== undefined && !fieldPattern(field.pattern).test(value))
    throw new FieldValueError('regex')
  return value
}

/** Checks numeric limits; `compare` returns a negative, zero or positive number. */
function checkRange<T>(
  field: Constrained,
  value: T,
  limit: (bound: number | string) => T,
  compare: (a: T, b: T) => number
) {
  if (field.min !== undefined && compare(value, limit(field.min)) < 0)
    throw new FieldValueError('min', { min: String(field.min) })
  if (field.max !== undefined && compare(value, limit(field.max)) > 0)
    throw new FieldValueError('max', { max: String(field.max) })
  return value
}
const bigCompare = (a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0)

export function canonicalDate(value: unknown, type: 'date' | 'datetime') {
  if (typeof value !== 'string') return false
  const normalized = type === 'date' ? `${value}T00:00:00.000Z` : value
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(normalized) &&
    !normalized.startsWith('0000') &&
    Number.isFinite(Date.parse(normalized)) &&
    new Date(normalized).toISOString() === normalized
  )
}
export function canonicalMoney(value: unknown): value is string {
  if (typeof value !== 'string' || !/^(0|-?[1-9]\d*)$/.test(value) || value.length > 20)
    return false
  const integer = BigInt(value)
  return integer >= -9223372036854775808n && integer <= 9223372036854775807n
}
function isJson(value: unknown, ancestors = new Set<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object' || ancestors.has(value)) return false
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  )
    return false
  // JSON.stringify changes holes into null; never silently alter a submitted value.
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++)
      if (!Object.hasOwn(value, index)) return false
  }
  ancestors.add(value)
  const valid = Object.values(value).every((entry) => isJson(entry, ancestors))
  ancestors.delete(value)
  return valid
}

/**
 * Normalize before CASL evaluates a prospective record, using its stored representation.
 * It is also the hard guarantee of the definition: every stored value passes here, so
 * hooks, custom validators and system writes cannot store what a field forbids (length,
 * pattern, format, options, numeric limits, decimal scale). Constraint violations of
 * the field types and options added in 2.2 throw FieldValueError with a catalog message.
 */
export function fieldValue(field: Field, value: unknown): unknown {
  if (value === undefined || value === null) return value
  switch (field.type) {
    case 'money': {
      const amount =
        typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value
      if (!canonicalMoney(amount))
        throw new Error(
          'Money requires canonical integer minor units within PostgreSQL bigint range'
        )
      checkRange(field, BigInt(amount), (bound) => BigInt(bound), bigCompare)
      return amount
    }
    case 'decimal':
    case 'percent': {
      const { precision, scale } = decimalShape(field)
      return checkRange(
        field,
        canonicalDecimal(value, precision, scale),
        (bound) => canonicalDecimal(bound, precision, scale),
        (a, b) => bigCompare(scaled(a), scaled(b))
      )
    }
    case 'integer':
    case 'belongsTo':
    case 'user':
      if (
        !Number.isInteger(value) ||
        Number(value) < (field.type === 'integer' ? -2147483648 : 1) ||
        Number(value) > 2147483647
      )
        throw new Error('Expected a PostgreSQL integer')
      if (field.type === 'integer') checkRange(field, Number(value), Number, (a, b) => a - b)
      return value
    case 'boolean':
      if (typeof value !== 'boolean') throw new Error('Expected a boolean')
      return value
    case 'string':
    case 'text':
    case 'lookup':
      if (typeof value !== 'string') throw new Error('Expected a string')
      if (field.type === 'lookup') return value
      if (field.type === 'string' && field.format)
        return checkText(field, normalizeFormat(field.format, value))
      return checkText(field, value)
    case 'email':
    case 'phone':
    case 'url':
      if (typeof value !== 'string') throw new FieldValueError('string')
      return checkText(field, normalizeFormat(field.type, value))
    case 'enum':
      if (typeof value !== 'string' || !field.options.some((option) => option.value === value))
        throw new FieldValueError('in')
      return value
    case 'multiSelect': {
      if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string'))
        throw new FieldValueError('array')
      const chosen = new Set(value as string[])
      const known = field.options.map((option) => option.value)
      if ([...chosen].some((entry) => !known.includes(entry))) throw new FieldValueError('in')
      const ordered = known.filter((entry) => chosen.has(entry))
      if (field.min !== undefined && ordered.length < field.min)
        throw new FieldValueError('array.minLength', { min: field.min })
      if (field.max !== undefined && ordered.length > field.max)
        throw new FieldValueError('array.maxLength', { max: field.max })
      return ordered
    }
    case 'manyToMany': {
      // Form posts send ids as strings: decimal digit strings are accepted as ids.
      const ids = Array.isArray(value)
        ? value.map((id) => (typeof id === 'string' && /^\d{1,10}$/.test(id) ? Number(id) : id))
        : null
      if (
        !ids ||
        ids.length > MANY_TO_MANY_LIMIT ||
        ids.some((id) => !Number.isSafeInteger(id) || id < 1 || id > 2147483647)
      )
        throw new FieldValueError('relation')
      return [...new Set(ids as number[])].sort((a, b) => a - b)
    }
    case 'date':
    case 'datetime': {
      const normalized =
        field.type === 'datetime' && value instanceof Date && Number.isFinite(value.getTime())
          ? value.toISOString()
          : value
      if (!canonicalDate(normalized, field.type))
        throw new Error('Expected a valid ISO date or canonical UTC timestamp')
      return normalized
    }
    case 'json':
      if (!isJson(value)) throw new Error('Expected a JSON value without cycles or non-JSON values')
      return value
    case 'attachment':
      // Writes carry the id of an owned upload; reads are hydrated into summaries later.
      if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 2147483647)
        throw new Error('Expected the identifier of an uploaded attachment')
      return value
    default:
      return value
  }
}
