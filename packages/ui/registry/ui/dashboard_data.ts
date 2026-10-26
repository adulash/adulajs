export type DashboardFormat = 'count' | 'integer' | 'money' | 'decimal' | 'percent'
/*
 * The DashboardResult of ADR 046 as the indicators page reads it. Every number was computed
 * by the server as the viewer; this module only normalizes and ranks it, and drops what it
 * cannot read instead of showing an invented value. Pure and import-free so the registry
 * tests run it directly.
 */
/** Values stay canonical decimal strings: money sums are minor units and may exceed 2^53. */
export type DashboardGroup = { key: string; label: string; value: string }
export type DashboardTile =
  | {
      kind: 'total'
      key: string
      label: string
      href: string | null
      format: DashboardFormat
      value: string | null
    }
  | {
      kind: 'grouped'
      key: string
      label: string
      href: string | null
      format: DashboardFormat
      groups: DashboardGroup[]
      truncated: boolean
    }
export type DashboardView = {
  name: string
  label: string
  description: string | null
  widgets: DashboardTile[]
}

const DECIMAL = /^-?\d+(\.\d+)?$/
/**
 * count is an integer; integer, decimal and percent sums are decimal strings; money sums are
 * minor-unit strings.
 * Strings are kept as they are (never through Number), so large sums lose no digits.
 */
export function decimal(value: unknown): string | null {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return DECIMAL.test(trimmed) ? trimmed : null
}

/** Exact comparison of two canonical decimal strings. */
export function compareDecimal(a: string, b: string) {
  const parse = (value: string) => {
    const negative = value.startsWith('-')
    const [whole, fraction = ''] = value.replace('-', '').split('.')
    return { negative, whole: BigInt(whole), fraction }
  }
  const left = parse(a)
  const right = parse(b)
  const width = Math.max(left.fraction.length, right.fraction.length)
  const scaled = (part: ReturnType<typeof parse>) =>
    (part.whole * 10n ** BigInt(width) + BigInt(part.fraction.padEnd(width, '0') || '0')) *
    (part.negative ? -1n : 1n)
  const difference = scaled(left) - scaled(right)
  return difference === 0n ? 0 : difference > 0n ? 1 : -1
}

const grouping = new Intl.NumberFormat('ar-u-nu-latn')
const groupDigits = (whole: string) => grouping.format(BigInt(whole))

/**
 * The digits of an indicator: grouped thousands; money as major units with two decimals
 * (minor units in, string math only); decimal and percent sums keep the fraction the server
 * returned. The caller adds the currency or percent label.
 */
export function formatDecimal(value: string, format: DashboardFormat) {
  const negative = value.startsWith('-')
  const [whole, fraction] = value.replace('-', '').split('.')
  const sign = negative && /[1-9]/.test(value) ? '-' : ''
  if (format === 'money') {
    // Minor units are integers; a fractional part (not expected) is dropped, never rounded up.
    const minor = whole.padStart(3, '0')
    return `${sign}${groupDigits(minor.slice(0, -2))}.${minor.slice(-2)}`
  }
  return `${sign}${groupDigits(whole)}${fraction ? `.${fraction}` : ''}`
}
const text = (value: unknown) => (typeof value === 'string' ? value : null)
const formats = new Set<unknown>(['count', 'integer', 'money', 'decimal', 'percent'])

/** Reads one DashboardWidgetResult; a widget without a key is dropped. */
export function normalizeWidget(input: unknown): DashboardTile | null {
  if (!input || typeof input !== 'object') return null
  const widget = input as Record<string, unknown>
  const key = text(widget.key)
  if (!key) return null
  const base = {
    key,
    label: text(widget.label) ?? key,
    href: text(widget.href),
    format: (formats.has(widget.format) ? widget.format : 'count') as DashboardFormat,
  }
  if (widget.kind === 'grouped') {
    const groups: DashboardGroup[] = []
    const rows = Array.isArray(widget.rows) ? widget.rows : []
    for (const [index, row] of rows.entries()) {
      if (!row || typeof row !== 'object') continue
      const entry = row as Record<string, unknown>
      // `value` is the group's key; `measure` its count or sum (null when nothing to sum).
      const measure = decimal(entry.measure)
      if (measure === null) continue
      const group = entry.value
      groups.push({
        key:
          group === null || group === undefined ? `__none_${index}` : `${index}:${String(group)}`,
        label: text(entry.label) ?? (group === null || group === undefined ? '' : String(group)),
        value: measure,
      })
    }
    groups.sort((a, b) => compareDecimal(b.value, a.value))
    return { ...base, kind: 'grouped', groups, truncated: widget.truncated === true }
  }
  if (widget.kind !== undefined && widget.kind !== 'total') return null
  return { ...base, kind: 'total', value: decimal(widget.value) }
}

export function normalizeDashboard(input: unknown): DashboardView {
  const dashboard = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const widgets = Array.isArray(dashboard.widgets) ? dashboard.widgets : []
  return {
    name: text(dashboard.name) ?? '',
    label: text(dashboard.label) ?? '',
    description: text(dashboard.description),
    widgets: widgets
      .map(normalizeWidget)
      .filter((widget): widget is DashboardTile => widget !== null),
  }
}

/**
 * Share of the largest value, 0–100, for the proportional bars of grouped indicators. A bar
 * is a picture of proportion, so converting to Number here loses nothing visible.
 */
export function shares(input: (number | string)[]) {
  const values = input.map(Number)
  const max = Math.max(0, ...values)
  return values.map((value) =>
    max > 0 && value > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0
  )
}
