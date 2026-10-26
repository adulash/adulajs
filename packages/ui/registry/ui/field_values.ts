import type { ResourceField } from 'adula'

/**
 * Pure value helpers of the generated forms and values (decimal, percent, multi-value
 * fields, visibleWhen and safe links). They have no React or alias imports, so they are
 * shared by resource-field, resource-form and resource-value and tested directly.
 */

type Scalar = string | number | boolean | null

/**
 * Arabic-Indic and Persian digits and the Arabic decimal separator to Latin. Commas (and the
 * Arabic thousands mark) are removed only when they group whole thousands, as in «1,234.5»;
 * any other comma, such as «1,5», stays and makes the number invalid instead of 15.
 */
export function toLatinDigits(raw: string) {
  const value = raw
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replaceAll('٫', '.')
    .replaceAll('٬', ',')
    .trim()
  return /^-?\d{1,3}(,\d{3})+(\.\d*)?$/.test(value) ? value.replaceAll(',', '') : value
}

/** Fractional digits of a decimal or percent field (the server default is 2). */
export function decimalScale(field: ResourceField) {
  return (field.type === 'decimal' || field.type === 'percent') && field.scale !== undefined
    ? field.scale
    : 2
}

/**
 * Typed decimal text to the canonical wire string with exactly `scale` digits, for example
 * «١٢٫٥» → "12.50". Errors carry the Arabic interface text.
 */
export function parseDecimal(raw: string, scale: number) {
  const value = toLatinDigits(raw)
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(value)
  if (!match || (match[2] === '' && !match[3])) throw new Error('أدخل رقماً عشرياً صحيحاً')
  const [, sign, whole, fraction = ''] = match
  const significant = fraction.replace(/0+$/, '')
  if (significant.length > scale) throw new Error('عدد المنازل العشرية أكثر من المسموح')
  const integer = whole.replace(/^0+(?=\d)/, '') || '0'
  const digits = scale ? `.${fraction.slice(0, scale).padEnd(scale, '0')}` : ''
  const canonical = `${integer}${digits}`
  return /^0(\.0*)?$/.test(canonical) ? canonical : `${sign}${canonical}`
}

/** The input text of a stored decimal: the canonical string, or '' when empty. */
export function decimalInput(value: unknown, scale: number) {
  if (value === null || value === undefined || value === '') return ''
  try {
    return parseDecimal(String(value), scale)
  } catch {
    return String(value)
  }
}

/**
 * A decimal string formatted with the interface language and Latin digits. The string is
 * formatted exactly (no float rounding), so numeric(18, 2) values keep every digit.
 */
export function decimalDisplay(value: unknown, scale: number, language = 'ar') {
  if (value === null || value === undefined || value === '') return ''
  const format = new Intl.NumberFormat(`${language}-u-nu-latn`, {
    minimumFractionDigits: scale,
    maximumFractionDigits: scale,
  })
  // Intl formats numeric strings as exact decimals; the lib typing only names numbers.
  return format.format(String(value) as unknown as number)
}

/** Multi-value controls keep a JSON array of strings in the string form state. */
export function listValue(raw: string): string[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

export function listInput(values: unknown): string {
  if (!Array.isArray(values) || !values.length) return ''
  return JSON.stringify([...new Set(values.map(String))])
}

/** Selected option values in the definition's option order, as the server stores them. */
export function orderedSelection(options: readonly { value: string }[], selected: string[]) {
  const chosen = new Set(selected)
  return options.map((option) => option.value).filter((value) => chosen.has(value))
}

/**
 * Whether a field applies to the current form values (its `visibleWhen`). Every named
 * sibling must equal the value or one of the listed values; a multiSelect sibling must
 * contain it; `null` matches an empty sibling (no selection for a multiSelect). Both sides
 * compare canonically, as the server does (see canonicalValue). Use hiddenFields() for a
 * whole form: it also hides fields whose sibling is hidden.
 */
export function fieldApplies(
  field: Pick<ResourceField, 'visibleWhen'>,
  values: Record<string, string>,
  siblings: Readonly<Record<string, SiblingShape>> = {}
) {
  if (!field.visibleWhen) return true
  return Object.entries(field.visibleWhen).every(([key, expected]) => {
    const sibling = siblings[key]
    const raw = values[key] ?? ''
    const accepted: Scalar[] = Array.isArray(expected) ? expected : [expected]
    if (sibling?.type === 'multiSelect' || sibling?.type === 'manyToMany') {
      const current = listValue(raw)
      return accepted.some((entry) =>
        entry === null ? current.length === 0 : current.includes(String(entry))
      )
    }
    const current = canonicalValue(raw, sibling)
    return accepted.some((entry) =>
      entry === null ? raw.trim() === '' : canonicalValue(String(entry), sibling) === current
    )
  })
}

/**
 * The fields that do not apply, resolved to a fixed point like the server's
 * applyVisibility: a hidden field counts as empty while its dependants are evaluated, so
 * in a chain C → B → A hiding A also hides B and then C.
 */
export function hiddenFields(
  fields: readonly (Pick<ResourceField, 'key' | 'visibleWhen'> & SiblingShape)[],
  values: Record<string, string>
) {
  const siblings = siblingShapes(fields)
  const hidden = new Set<string>()
  // The same passes as the server: a field is cleared as soon as it is hidden.
  const current = { ...values }
  for (let pass = 0; pass <= fields.length; pass++) {
    let changed = false
    for (const field of fields) {
      if (hidden.has(field.key) || fieldApplies(field, current, siblings)) continue
      hidden.add(field.key)
      current[field.key] = ''
      changed = true
    }
    if (!changed) break
  }
  return hidden
}

/** What fieldApplies needs to know about a sibling field. */
export type SiblingShape = { type: string; scale?: number; format?: string }

/** The comparison shape of every field, by key. */
export function siblingShapes(fields: readonly (SiblingShape & { key: string })[]) {
  return Object.fromEntries(
    fields.map((field) => [
      field.key,
      { type: field.type, scale: field.scale, format: field.format } satisfies SiblingShape,
    ])
  ) as Record<string, SiblingShape>
}

/**
 * The stored form of a sibling value, mirroring the server's normalization: e-mail trimmed
 * and lower-cased, phone with Latin digits and no separators (a leading + kept), URL
 * trimmed, decimal/percent at the sibling's scale («12.5» equals "12.50"), integers without
 * leading zeros. Text is compared as typed (the server does not trim it).
 */
export function canonicalValue(raw: string, sibling?: SiblingShape) {
  if (!sibling || raw.trim() === '') return raw
  const format = sibling.type === 'string' ? sibling.format : sibling.type
  if (format === 'email') return raw.trim().toLowerCase()
  if (format === 'phone') return toLatinDigits(raw.trim()).replace(/[\s\-().]/g, '')
  if (format === 'url') return raw.trim()
  if (sibling.type === 'decimal' || sibling.type === 'percent') {
    try {
      return parseDecimal(raw, sibling.scale ?? 2)
    } catch {
      return raw.trim()
    }
  }
  if (sibling.type === 'integer') {
    const digits = toLatinDigits(raw)
    return /^-?\d+$/.test(digits) ? String(BigInt(digits)) : raw.trim()
  }
  return raw
}

/** An absolute http(s) URL safe to link, or null (javascript:, data: and relative are refused). */
export function safeUrl(value: unknown) {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value.trim())) return null
  try {
    const url = new URL(value.trim())
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

/** A tel: link for a stored `+?digits` phone; other text gets no link. */
export function phoneHref(value: unknown) {
  const text = toLatinDigits(String(value ?? '')).replace(/[\s().-]/g, '')
  return /^\+?\d{3,15}$/.test(text) ? `tel:${text}` : null
}

/** A mailto: link for a plain address; anything with spaces or several @ gets no link. */
export function emailHref(value: unknown) {
  const text = String(value ?? '').trim()
  return /^[^\s@?#]+@[^\s@?#]+$/.test(text) ? `mailto:${text}` : null
}
