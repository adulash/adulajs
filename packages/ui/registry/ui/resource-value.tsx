import type { ReactNode } from 'react'
import { Paperclip } from 'lucide-react'
import type { CalendarPreference, ResourceField, SerializedRecord } from 'adula'
import { calendarDisplay, calendarIso } from '~/components/ui/calendar_date'
import { useUiPreferences } from '~/components/ui/ui-preferences'
import { arabicText, useMessages, type Translate } from '~/components/ui/messages'
import { Badge } from '~/components/ui/badge'
import { AttachmentPreviewButton } from '~/components/ui/attachment-preview'
import {
  decimalDisplay,
  decimalInput,
  decimalScale,
  emailHref,
  listInput,
  listValue,
  orderedSelection,
  parseDecimal,
  phoneHref,
  safeUrl,
  toLatinDigits,
} from '~/components/ui/field_values'

export { toLatinDigits } from '~/components/ui/field_values'

export type Option = { value: string; label: string }
export type LookupOptions = Record<string, Option[]>
export type AttachmentValue = {
  id: number
  name: string
  size: number
  mimeType: string
  url: string
  /** Inline preview kind for allow-listed images, PDF and text (ADR 047); others download. */
  preview?: 'image' | 'pdf' | 'text' | null
}

/**
 * Project-owned copy: change the label once here for another currency. It is shown through
 * `t()`, so a translated interface can map it (ui.value.currency).
 */
export const CURRENCY_LABEL = 'ر.س'
const locale = 'ar-u-nu-latn'
const integerFormat = new Intl.NumberFormat(locale)
const sizeFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 })
const meta = new Set(['id', 'version', 'docStatus', 'orgUnitId'])

/** The percent sign after a percent value; translated interfaces map it (ui.value.percent). */
export const PERCENT_LABEL = '٪'
const multiValued = new Set(['multiSelect', 'manyToMany'])

/** Option label of an enum or multiSelect value in the interface language. */
export function optionLabel(field: ResourceField, value: string, language = 'ar') {
  if (field.type !== 'enum' && field.type !== 'multiSelect') return value
  const option = field.options.find((entry) => entry.value === value)
  return option ? option.label[language] || option.label.ar : value
}

/** Localized options of an enum or multiSelect field, in definition order. */
export function fieldOptions(field: ResourceField, language = 'ar'): Option[] {
  if (field.type !== 'enum' && field.type !== 'multiSelect') return []
  return field.options.map((option) => ({
    value: option.value,
    label: option.label[language] || option.label.ar,
  }))
}

/** Linked records of a manyToMany value: id and title, #id when the reader cannot view it. */
export function linkedTitles(
  field: ResourceField,
  value: unknown,
  related: Record<string, SerializedRecord[]> = {}
) {
  if (!Array.isArray(value)) return []
  return value.map((id) => ({
    id: String(id),
    title: relationLabel(
      related[field.key]?.find((item) => String(item.id) === String(id)),
      id
    ),
  }))
}

function minorUnits(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  try {
    return BigInt(String(value))
  } catch {
    return null
  }
}

export function moneyInput(value: unknown) {
  const minor = minorUnits(value)
  if (minor === null) return ''
  const abs = minor < 0n ? -minor : minor
  return `${minor < 0n ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`
}

export function moneyDisplay(value: unknown) {
  const minor = minorUnits(value)
  if (minor === null) return ''
  const abs = minor < 0n ? -minor : minor
  return `${minor < 0n ? '-' : ''}${integerFormat.format(abs / 100n)}.${String(abs % 100n).padStart(2, '0')}`
}

export function parseMoney(raw: string) {
  const value = toLatinDigits(raw)
  if (!/^-?\d+(\.\d{1,2})?$/.test(value)) throw new Error('أدخل مبلغاً بخانتين عشريتين كحد أقصى')
  const [whole, cents = ''] = value.replace('-', '').split('.')
  return String(
    (BigInt(whole) * 100n + BigInt(cents.padEnd(2, '0'))) * (value.startsWith('-') ? -1n : 1n)
  )
}

export function isAttachment(value: unknown): value is AttachmentValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'name' in value &&
    typeof (value as { url?: unknown }).url === 'string'
  )
}

/** Whether an attachment field holds several files (an ordered array of summaries). */
export function isMultipleAttachment(field: ResourceField) {
  return field.type === 'attachment' && field.multiple === true
}

/** The files of a multiple attachment value, in their stored order. */
export function attachmentList(value: unknown): AttachmentValue[] {
  return Array.isArray(value) ? value.filter(isAttachment) : []
}

export function fileSize(bytes: number, t: Translate = arabicText) {
  if (bytes < 1024) return t('{size} بايت', { size: integerFormat.format(bytes) })
  if (bytes < 1024 * 1024) return t('{size} ك.ب', { size: sizeFormat.format(bytes / 1024) })
  return t('{size} م.ب', { size: sizeFormat.format(bytes / (1024 * 1024)) })
}

export function formatDate(value: unknown, calendar: CalendarPreference = 'gregory') {
  return calendarDisplay(value, calendar)
}

export function formatDatetime(value: unknown, calendar: CalendarPreference = 'gregory') {
  return calendarDisplay(value, calendar, true)
}

/**
 * A related record is labelled by the title the server computed from the resource's
 * `title` fields (`_title`, #47). Older servers send none; then the first readable string
 * of the record is used.
 */
export function relationLabel(row: SerializedRecord | undefined, fallback: unknown) {
  if (row && '_title' in row)
    return typeof row._title === 'string' && row._title
      ? row._title
      : fallback === null || fallback === undefined
        ? '—'
        : `#${fallback}`
  const label =
    row &&
    Object.entries(row).find(([key, entry]) => !meta.has(key) && typeof entry === 'string' && entry)
  return label
    ? String(label[1])
    : fallback === null || fallback === undefined
      ? '—'
      : `#${fallback}`
}

export function inputValue(field: ResourceField, value: unknown) {
  if (value === null || value === undefined) return ''
  if (field.type === 'money') return moneyInput(value)
  if (field.type === 'decimal' || field.type === 'percent')
    return decimalInput(value, decimalScale(field))
  if (multiValued.has(field.type)) return listInput(value)
  if (field.type === 'json') return JSON.stringify(value, null, 2)
  // Several files are edited as the JSON array of their ids, in order.
  if (isMultipleAttachment(field))
    return Array.isArray(value)
      ? listInput(value.map((entry) => (isAttachment(entry) ? entry.id : entry)))
      : ''
  if (field.type === 'attachment') return isAttachment(value) ? String(value.id) : String(value)
  if (field.type === 'datetime') {
    const date = new Date(String(value))
    if (Number.isNaN(date.getTime())) return ''
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
  }
  if (field.type === 'date') return String(value).slice(0, 10)
  return String(value)
}

/**
 * Converts a control's string state into the JSON the resource route validates. Errors carry
 * the Arabic interface text; callers show them through `t(error.message)`.
 */
export function parseValue(field: ResourceField, raw: string): unknown {
  // Multi-value fields always submit an array, so clearing them is explicit.
  if (field.type === 'multiSelect') return orderedSelection(field.options, listValue(raw))
  if (field.type === 'manyToMany' || isMultipleAttachment(field)) return listValue(raw).map(Number)
  if (raw === '') return null
  switch (field.type) {
    case 'decimal':
    case 'percent':
      return parseDecimal(raw, decimalScale(field))
    case 'email':
    case 'url':
    case 'phone':
      return raw.trim()
    case 'money':
      return parseMoney(raw)
    case 'boolean':
      return raw === 'true'
    case 'integer': {
      const value = Number(toLatinDigits(raw))
      if (!Number.isInteger(value)) throw new Error('أدخل عدداً صحيحاً')
      return value
    }
    case 'belongsTo':
    case 'user':
    case 'attachment':
      return Number(raw)
    case 'json':
      try {
        return JSON.parse(raw)
      } catch {
        throw new Error('أدخل بيانات JSON صحيحة')
      }
    case 'date': {
      return raw.startsWith('hijri:')
        ? calendarIso(raw.slice(6), 'islamic-umalqura')
        : calendarIso(raw, 'gregory')
    }
    case 'datetime': {
      const [day, time] = raw.split('T')
      const isoDay = day.startsWith('hijri:')
        ? calendarIso(day.slice(6), 'islamic-umalqura')
        : calendarIso(day, 'gregory')
      const date = new Date(`${isoDay}T${time}`)
      if (Number.isNaN(date.getTime())) throw new Error('أدخل تاريخاً ووقتاً صحيحين')
      return date.toISOString()
    }
    default:
      return raw
  }
}

export function displayValue(
  field: ResourceField,
  row: SerializedRecord,
  related: Record<string, SerializedRecord[]> = {},
  lookups: LookupOptions = {},
  calendar: CalendarPreference = 'gregory',
  t: Translate = arabicText,
  language = 'ar'
) {
  const value = row[field.key]
  if (value === null || value === undefined || value === '') return '—'
  if (Array.isArray(value) && !value.length) return '—'
  switch (field.type) {
    case 'decimal':
      return decimalDisplay(value, decimalScale(field), language)
    case 'percent':
      return `${decimalDisplay(value, decimalScale(field), language)}${t(PERCENT_LABEL)}`
    case 'enum':
      return optionLabel(field, String(value), language)
    case 'multiSelect':
      return Array.isArray(value)
        ? value.map((entry) => optionLabel(field, String(entry), language)).join('، ')
        : String(value)
    case 'manyToMany':
      return linkedTitles(field, value, related)
        .map((entry) => entry.title)
        .join('، ')
    case 'money':
      return `${moneyDisplay(value)} ${t(CURRENCY_LABEL)}`
    case 'boolean':
      return value ? t('نعم') : t('لا')
    case 'integer':
      return typeof value === 'number' ? integerFormat.format(value) : String(value)
    case 'belongsTo':
    case 'user':
      return relationLabel(
        related[field.key]?.find((item) => String(item.id) === String(value)),
        value
      )
    case 'lookup':
      return (
        lookups[field.key]?.find((option) => option.value === String(value))?.label ?? String(value)
      )
    case 'json':
      return JSON.stringify(value)
    case 'attachment':
      if (Array.isArray(value))
        return attachmentList(value)
          .map((entry) => entry.name)
          .join('، ')
      return isAttachment(value) ? value.name : t('مرفق')
    case 'date':
      return formatDate(value, calendar)
    case 'datetime':
      return formatDatetime(value, calendar)
    default:
      return String(value)
  }
}

/** Prefix formula-like and leading-control values before quoting CSV cells. */
export function csvCell(value: string) {
  const safe = /^[\s -]*[=+@-]|^[\t\r\n]/.test(value) ? `'${value}` : value
  return `"${safe.replaceAll('"', '""')}"`
}

/** A downloadable file with its size and, for previewable types, a preview button. */
function AttachmentLink({ file }: { file: AttachmentValue }) {
  const { t } = useMessages()
  return (
    <>
      <a
        href={file.url}
        download={file.name}
        className="inline-flex items-center gap-2 text-primary underline-offset-4 hover:underline"
      >
        <Paperclip size={14} />
        {file.name}
        <span className="text-xs text-muted-foreground">({fileSize(file.size, t)})</span>
      </a>
      <AttachmentPreviewButton file={file} />
    </>
  )
}

export function ResourceValue({
  field,
  row,
  related,
  lookups,
}: {
  field: ResourceField
  row: SerializedRecord
  related?: Record<string, SerializedRecord[]>
  lookups?: LookupOptions
}): ReactNode {
  const { calendar } = useUiPreferences()
  const { t, locale } = useMessages()
  const value = row[field.key]
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length))
    return <span className="text-muted-foreground">—</span>
  if (field.type === 'decimal' || field.type === 'percent')
    return (
      <span className="tabular-nums" dir="ltr">
        {decimalDisplay(value, decimalScale(field), locale)}
        {field.type === 'percent' && (
          <span className="text-muted-foreground">{t(PERCENT_LABEL)}</span>
        )}
      </span>
    )
  // A string with `format` renders like the dedicated type.
  const kind = field.type === 'string' ? field.format : field.type
  if (kind === 'email' || kind === 'phone' || kind === 'url') {
    const href =
      kind === 'email' ? emailHref(value) : kind === 'phone' ? phoneHref(value) : safeUrl(value)
    if (!href) return <bdi dir="ltr">{String(value)}</bdi>
    return (
      <a
        href={href}
        dir="ltr"
        className="break-all text-primary underline-offset-4 hover:underline"
        {...(kind === 'url' ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      >
        {String(value)}
      </a>
    )
  }
  if (field.type === 'multiSelect' && Array.isArray(value))
    return (
      <span className="flex flex-wrap gap-1">
        {value.map((entry) => (
          <Badge key={String(entry)} variant="secondary" className="font-normal">
            {optionLabel(field, String(entry), locale)}
          </Badge>
        ))}
      </span>
    )
  if (field.type === 'manyToMany')
    return (
      <span className="flex flex-wrap gap-1">
        {linkedTitles(field, value, related).map((entry) => (
          <Badge key={entry.id} variant="outline" className="font-normal">
            {entry.title}
          </Badge>
        ))}
      </span>
    )
  if (field.type === 'attachment' && Array.isArray(value))
    return (
      <ul className="space-y-1">
        {attachmentList(value).map((file) => (
          <li key={file.id} className="flex flex-wrap items-center gap-1">
            <AttachmentLink file={file} />
          </li>
        ))}
      </ul>
    )
  if (field.type === 'attachment' && isAttachment(value))
    return (
      <span className="inline-flex flex-wrap items-center gap-1">
        <AttachmentLink file={value} />
      </span>
    )
  if (field.type === 'boolean')
    return <Badge variant={value ? 'default' : 'secondary'}>{value ? t('نعم') : t('لا')}</Badge>
  if (field.type === 'money')
    return (
      <span className="tabular-nums" dir="ltr">
        {moneyDisplay(value)}{' '}
        <span className="text-xs text-muted-foreground">{t(CURRENCY_LABEL)}</span>
      </span>
    )
  if (field.type === 'json')
    return (
      <pre dir="ltr" className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">
        {JSON.stringify(value, null, 2)}
      </pre>
    )
  if (field.type === 'integer')
    return (
      <span className="tabular-nums" dir="ltr">
        {displayValue(field, row, related, lookups, calendar, t, locale)}
      </span>
    )
  // Arabic dates carry Arabic month names and time markers; isolate them instead of forcing LTR.
  if (field.type === 'date' || field.type === 'datetime')
    return <bdi className="tabular-nums">{displayValue(field, row, related, lookups, calendar, t, locale)}</bdi>
  return <>{displayValue(field, row, related, lookups, calendar, t, locale)}</>
}
