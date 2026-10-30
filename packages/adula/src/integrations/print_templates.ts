import { createHash } from 'node:crypto'
import type { Knex } from 'knex'
import type { Actor } from '../auth/ability.js'
import type { ResourceService } from '../admin/resource_service.js'
import type { ResourceDescription, ResourceField } from '../admin/presentation.js'
import type { ResourceRegistry } from '../resource/registry.js'
import type {
  Field,
  JsonValue,
  Label,
  PrintOrientation,
  PrintPaper,
  PrintTemplate,
  Resource,
  SerializedRecord,
} from '../resource/types.js'
import { AdulaError } from '../admin/errors.js'
import { logActivity } from '../core/activity.js'
import { sanitizePrintHtml } from '../core/html_sanitizer.js'
import {
  parseTemplate,
  templateError,
  walkTemplate,
  type TemplateNode,
  type TemplateRef,
} from '../core/template_language.js'
import {
  uiPreferences,
  type CalendarPreference,
  type DigitsPreference,
} from '../core/ui_preferences.js'
import {
  escapeHtml,
  printLogoHtml,
  relationTitle,
  renderPrintHtml,
  type PrintIdentity,
} from './print.js'

/** The implicit template of every resource: the generic layout of renderPrintHtml. */
export const DEFAULT_PRINT_TEMPLATE = 'default'
export const PRINT_PAPERS: readonly PrintPaper[] = ['A4', 'A5', 'Letter']
export const PRINT_ORIENTATIONS: readonly PrintOrientation[] = ['portrait', 'landscape']
/** Helpers a template may call; nothing else is callable. */
export const PRINT_HELPERS = ['date', 'money', 'number', 'digits', 'label', 'total'] as const
/** Document values addressable by bare name. */
export const PRINT_VALUES = [
  'id',
  'resource',
  'template',
  'company',
  'status',
  'printedBy',
  'printedAt',
  'rowNumber',
  'logo',
] as const
const KEY = /^[a-z][a-z0-9_]{0,63}$/
const LABEL_LIMIT = 200
const TEXT_LIMIT = 500
const NUMERIC = ['money', 'integer', 'decimal', 'percent']
const DATES = ['date', 'datetime']

/** What a template may name: the resource's stored fields and its line groups' columns. */
export type PrintSchema = {
  fields: Record<string, Field>
  groups: Record<string, Record<string, Field>>
}
export type PrintTemplateSource = 'generic' | 'code' | 'custom'
export type PrintTemplateOption = { key: string; label: Label; source: PrintTemplateSource }
export type PrintTemplateSummary = {
  resource: string
  resourceLabel: string
  key: string
  label: string
  source: 'code' | 'custom'
  /** The current version: an integer for custom templates, `code:<hash>` for code ones. */
  version: string
  active: boolean
  paper: PrintPaper
  orientation: PrintOrientation
  updatedAt: string | null
}
export type PrintTemplateDraft = {
  label: string
  body: string
  paper: PrintPaper
  orientation: PrintOrientation
  header: string
  footer: string
}
export type PrintTemplateDetail = PrintTemplateSummary & PrintTemplateDraft
export type PrintTemplateVersion = PrintTemplateDraft & {
  version: number
  createdBy: string | null
  createdAt: string
}
export type PrintTemplateInput = {
  key?: unknown
  label?: unknown
  body?: unknown
  paper?: unknown
  orientation?: unknown
  header?: unknown
  footer?: unknown
  active?: unknown
}
export type PrintOptions = {
  identity: PrintIdentity
  printedBy: string
  printedAt?: Date
  /** Defaults to the stored ui.preferences (calendar and digits). */
  calendar?: CalendarPreference
  digits?: DigitsPreference
  /** IANA zone of printed date-times and the print time; defaults to UTC. */
  timeZone?: string
}
export type PrintedDocument = {
  html: string
  template: { key: string; version: string; source: PrintTemplateSource }
}

type Formatting = { calendar: CalendarPreference; digits: DigitsPreference; timeZone: string }
/** Display rows of relations and lookup labels, of the record or of one line group. */
type Labels = {
  related: Record<string, SerializedRecord[]>
  lookups: Record<string, { value: string; label: string }[]>
}
type PrintGroup = Labels & {
  label: Label
  fields: Map<string, ResourceField>
  rows: SerializedRecord[]
}
/** The record as the actor may read it; nothing outside these maps can be printed. */
type PrintData = Labels & {
  resource: ResourceDescription
  record: SerializedRecord
  fields: Map<string, ResourceField>
  groups: Record<string, PrintGroup>
  values: Record<string, string>
  logo: string
}
type Page = {
  title: string
  paper: PrintPaper
  orientation: PrintOrientation
  header: string
  footer: string
  body: string
}

const lineLimit = () =>
  new AdulaError(422, 'E_PRINT_LINE_LIMIT', 'عدد البنود يتجاوز حد الطباعة (1000 بند)')
const duplicateKey = () =>
  new AdulaError(409, 'E_PRINT_TEMPLATE_EXISTS', 'يوجد قالب طباعة بهذا المفتاح لهذا الكيان')
const notFound = () => new AdulaError(404, 'E_PRINT_TEMPLATE_NOT_FOUND', 'قالب الطباعة غير موجود')
const labelOf = (label: Label) => label.ar

// ---------------------------------------------------------------------------------------
// Definition-time checks of code templates (defineResource and ResourceRegistry.register)
// ---------------------------------------------------------------------------------------

function definitionSchema(resource: Pick<Resource, 'fields'>): PrintSchema {
  const fields: Record<string, Field> = {}
  const groups: Record<string, Record<string, Field>> = {}
  for (const [key, field] of Object.entries(resource.fields))
    if (field.type === 'hasMany') groups[key] = {}
    else fields[key] = field
  return { fields, groups }
}

/** Checks the printTemplates of one resource definition; called by defineResource. */
export function assertPrintTemplates(
  resource: Pick<Resource, 'name' | 'fields' | 'printTemplates'>
) {
  const templates = resource.printTemplates
  if (templates === undefined) return
  if (!Array.isArray(templates)) throw new Error(`${resource.name}: printTemplates must be a list`)
  const keys = new Set<string>()
  const schema = definitionSchema(resource)
  for (const template of templates) {
    const context = `${resource.name}: print template ${String(template?.key)}`
    if (typeof template?.key !== 'string' || !KEY.test(template.key))
      throw new Error(`${context}: key must match ${KEY.source}`)
    if (template.key === DEFAULT_PRINT_TEMPLATE)
      throw new Error(`${context}: «default» is the generic layout`)
    if (keys.has(template.key)) throw new Error(`${context}: duplicate key`)
    keys.add(template.key)
    if (!template.label || typeof template.label.ar !== 'string' || !template.label.ar.trim())
      throw new Error(`${context}: label needs Arabic text`)
    if (template.paper !== undefined && !PRINT_PAPERS.includes(template.paper))
      throw new Error(`${context}: paper must be A4, A5 or Letter`)
    if (template.orientation !== undefined && !PRINT_ORIENTATIONS.includes(template.orientation))
      throw new Error(`${context}: orientation must be portrait or landscape`)
    for (const text of [template.header, template.footer])
      if (text !== undefined) {
        if (typeof text !== 'string' || text.length > TEXT_LIMIT)
          throw new Error(
            `${context}: header and footer are strings of ${TEXT_LIMIT} characters at most`
          )
        try {
          checkTemplate(parseTemplate(text), schema, 'text')
        } catch (error) {
          throw new Error(`${context}: ${(error as Error).message}`)
        }
      }
    if (!Array.isArray(template.fields)) throw new Error(`${context}: fields must be a list`)
    for (const key of template.fields)
      if (!(key in schema.fields))
        throw new Error(`${context}: unknown or line field ${String(key)}`)
    for (const [group, columns] of Object.entries(template.lines ?? {})) {
      if (!(group in schema.groups)) throw new Error(`${context}: ${group} is not a hasMany field`)
      if (!Array.isArray(columns) || !columns.length || columns.some((c) => typeof c !== 'string'))
        throw new Error(`${context}: lines.${group} must list child columns`)
    }
    for (const total of template.totals ?? []) {
      if (!total?.label?.ar?.trim())
        throw new Error(`${context}: every total needs an Arabic label`)
      if ('field' in total) {
        const field = schema.fields[total.field]
        if (!field || !NUMERIC.includes(field.type))
          throw new Error(`${context}: total field ${total.field} must be a money or number field`)
      } else if (!template.lines?.[total.lines]?.includes(total.column))
        throw new Error(
          `${context}: total ${total.lines}.${total.column} must sum a printed line column`
        )
    }
  }
}

/** Checks line columns of code templates against the child resources; called on register. */
export function assertPrintTemplateColumns(resource: Resource, registry: ResourceRegistry) {
  for (const template of resource.printTemplates ?? [])
    for (const [group, columns] of Object.entries(template.lines ?? {})) {
      const field = resource.fields[group]
      if (field.type !== 'hasMany') continue
      const child = registry.get(field.resource)
      for (const column of columns) {
        const definition = child.fields[column]
        if (!definition || definition.type === 'hasMany')
          throw new Error(
            `${resource.name}: print template ${template.key}: unknown column ${group}.${column}`
          )
      }
      for (const total of template.totals ?? [])
        if ('lines' in total && total.lines === group) {
          const type = child.fields[total.column].type
          if (!NUMERIC.includes(type))
            throw new Error(
              `${resource.name}: print template ${template.key}: total ${group}.${total.column} must be a money or number column`
            )
        }
    }
}

// ---------------------------------------------------------------------------------------
// Template language: checking names against a schema
// ---------------------------------------------------------------------------------------

/** Most lines one printed group holds; a longer document is refused, never truncated. */
export const PRINT_LINE_LIMIT = 1000

/**
 * The hasMany fields a print may read: those the record exposes (`serialize`, or `list`
 * and `show`) and those the resource's own code print templates declare. The resource
 * author decides both; an administrator template cannot reach any other line group.
 */
export function printableGroups(resource: Resource) {
  const exposed = new Set([
    ...(resource.serialize ?? [...resource.list, ...resource.show]),
    ...(resource.printTemplates ?? []).flatMap((template) => Object.keys(template.lines ?? {})),
  ])
  return Object.keys(resource.fields).filter(
    (key) => resource.fields[key].type === 'hasMany' && exposed.has(key)
  )
}

/** The names a template of this registered resource may use. */
export function printSchema(registry: ResourceRegistry, name: string): PrintSchema {
  const resource = registry.get(name)
  const schema = definitionSchema(resource)
  const printable = new Set(printableGroups(resource))
  for (const key of Object.keys(schema.groups)) {
    const field = resource.fields[key]
    if (field.type !== 'hasMany' || !printable.has(key)) {
      delete schema.groups[key]
      continue
    }
    schema.groups[key] = Object.fromEntries(
      Object.entries(registry.get(field.resource).fields).filter(([, f]) => f.type !== 'hasMany')
    )
  }
  return schema
}

function unknownName(name: string): never {
  return templateError(`اسم غير معروف في القالب: ${name}`)
}

function refField(ref: TemplateRef, schema: PrintSchema, group: string | null): Field | null {
  switch (ref.kind) {
    case 'field':
      return schema.fields[ref.key] ?? unknownName(`field.${ref.key}`)
    case 'row':
      if (!group) return templateError(`row.${ref.key} يُستخدم داخل {{#each}} فقط`)
      return schema.groups[group]?.[ref.key] ?? unknownName(`row.${ref.key}`)
    case 'meta':
      if (!(PRINT_VALUES as readonly string[]).includes(ref.key)) unknownName(ref.key)
      return null
    case 'lines':
      if (!(ref.key in schema.groups)) unknownName(`lines.${ref.key}`)
      if (ref.column !== undefined && !(ref.column in schema.groups[ref.key]))
        unknownName(`lines.${ref.key}.${ref.column}`)
      return ref.column === undefined ? null : schema.groups[ref.key][ref.column]
    case 'string':
      return null
  }
}

/**
 * Refuses unknown names and helpers and misplaced values with a 422 E_PRINT_TEMPLATE.
 * `text` mode (header and footer) allows only document values and record fields.
 */
export function checkTemplate(
  nodes: TemplateNode[],
  schema: PrintSchema,
  mode: 'html' | 'text' = 'html'
) {
  walkTemplate(nodes, (node, group) => {
    if (mode === 'text' && node.type !== 'output')
      templateError('الترويسة والتذييل نص فقط: لا تُستخدم فيهما {{#if}} أو {{#each}}')
    if (node.type === 'each') {
      if (!(node.group in schema.groups)) unknownName(`lines.${node.group}`)
      return
    }
    if (node.type === 'if') {
      if (node.test.kind === 'string' || (node.test.kind === 'lines' && node.test.column))
        templateError(`شرط غير مسموح في القالب: {{${node.source}}}`)
      refField(node.test, schema, group)
      return
    }
    const { helper, arg } = node
    if (mode === 'text' && (arg.kind === 'row' || arg.kind === 'lines' || helper === 'total'))
      templateError('الترويسة والتذييل نص فقط: لا تُستخدم فيهما البنود')
    if (helper === null) {
      if (arg.kind === 'string' || arg.kind === 'lines')
        templateError(`قيمة غير مسموحة في القالب: {{${node.source}}}`)
      if (mode === 'text' && arg.kind === 'meta' && arg.key === 'logo')
        templateError('الشعار {{logo}} يُستخدم في متن القالب فقط')
      refField(arg, schema, group)
      return
    }
    if (!(PRINT_HELPERS as readonly string[]).includes(helper))
      templateError(`دالة غير مسموحة في القالب: ${helper}`)
    if (helper === 'label') {
      if (arg.kind !== 'string')
        templateError('label يقبل اسم حقل بين علامتي تنصيص مثل label "total"')
      const [key, column] = arg.value.split('.')
      if (
        column === undefined
          ? !(key in schema.fields) && !(key in schema.groups)
          : !schema.groups[key]?.[column]
      )
        unknownName(arg.value)
      return
    }
    if (helper === 'total') {
      if (arg.kind !== 'lines' || !arg.column)
        templateError('total يقبل عمود بنود مثل total lines.items.quantity')
      const field = refField(arg, schema, group)
      if (!field || !NUMERIC.includes(field.type))
        templateError(`total يجمع عمودًا ماليًا أو رقميًا فقط: ${node.source}`)
      return
    }
    if (arg.kind === 'string' || arg.kind === 'lines')
      templateError(`قيمة غير مسموحة في القالب: {{${node.source}}}`)
    const field = refField(arg, schema, group)
    if (helper === 'digits') return
    if (arg.kind === 'meta' && !(helper === 'date' && arg.key === 'printedAt'))
      templateError(`${helper} يقبل حقلًا من السجل أو البنود: {{${node.source}}}`)
    if (helper === 'date' && field && !DATES.includes(field.type))
      templateError(`date يقبل حقل تاريخ فقط: {{${node.source}}}`)
    if (helper === 'money' && field?.type !== 'money')
      templateError(`money يقبل حقلًا ماليًا فقط: {{${node.source}}}`)
    if (helper === 'number' && (!field || !NUMERIC.includes(field.type)))
      templateError(`number يقبل حقلًا رقميًا فقط: {{${node.source}}}`)
  })
}

// ---------------------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------------------

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩'
function withDigits(text: string, digits: DigitsPreference) {
  return digits === 'arab' ? text.replace(/[0-9]/g, (d) => ARABIC_DIGITS[Number(d)]) : text
}

/** Groups an integer or decimal string; Arabic-Indic digits use ٬ and ٫ separators. */
function groupNumber(value: string, digits: DigitsPreference) {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value)
  if (!match) return withDigits(value, digits)
  const [group, point] = digits === 'arab' ? ['٬', '٫'] : [',', '.']
  const whole = match[2].replace(/\B(?=(\d{3})+(?!\d))/g, group)
  return withDigits(`${match[1]}${whole}${match[3] === undefined ? '' : point + match[3]}`, digits)
}

function formatMoney(value: JsonValue, digits: DigitsPreference) {
  // Same presentation as the UI: grouped major units and two minor digits.
  if (!/^-?\d+$/.test(String(value))) return withDigits(String(value), digits)
  const minor = BigInt(String(value))
  const abs = minor < 0n ? -minor : minor
  return groupNumber(
    `${minor < 0n ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`,
    digits
  )
}

function formatDate(value: JsonValue, type: string, format: Formatting) {
  const raw = String(value)
  const date = new Date(
    type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00Z` : raw
  )
  if (Number.isNaN(date.getTime())) return withDigits(raw, format.digits)
  const options: Intl.DateTimeFormatOptions = {
    // A date has no time of day; a date-time is shown in the application time zone.
    timeZone: type === 'date' ? 'UTC' : format.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(type === 'date' ? {} : { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
  }
  const one = (calendar: string) =>
    new Intl.DateTimeFormat(`ar-u-ca-${calendar}-nu-${format.digits}`, options).format(date)
  return format.calendar === 'both'
    ? `${one('gregory')} · ${one('islamic-umalqura')}`
    : one(format.calendar)
}

function formatNumber(field: Field, value: JsonValue, format: Formatting) {
  if (field.type === 'money') return formatMoney(value, format.digits)
  const text = groupNumber(String(value), format.digits)
  return field.type === 'percent' ? `${text}%` : text
}

/** The display text of one readable value ('' when there is none). */
function display(
  field: Field,
  value: JsonValue | undefined,
  labels: Labels,
  key: string,
  format: Formatting
): string {
  if (value === null || value === undefined || value === '') return ''
  switch (field.type) {
    case 'boolean':
      return value ? 'نعم' : 'لا'
    case 'money':
    case 'integer':
    case 'decimal':
    case 'percent':
      return formatNumber(field, value, format)
    case 'date':
    case 'datetime':
      return formatDate(value, field.type, format)
    case 'lookup':
      return labels.lookups[key]?.find((option) => option.value === value)?.label ?? String(value)
    case 'enum':
      return field.options.find((option) => option.value === value)?.label.ar ?? String(value)
    case 'multiSelect':
      return (Array.isArray(value) ? value : [value])
        .map(
          (item) => field.options.find((option) => option.value === item)?.label.ar ?? String(item)
        )
        .join('، ')
    case 'user':
    case 'belongsTo':
      return relationTitle(labels.related[key], value)
    case 'manyToMany':
      return (Array.isArray(value) ? value : [])
        .map((id) => relationTitle(labels.related[key], id))
        .join('، ')
    case 'attachment':
      return typeof value === 'object' && !Array.isArray(value) && value.name
        ? String(value.name)
        : 'مرفق'
    case 'json':
      return JSON.stringify(value)
    default:
      return String(value)
  }
}

/** Fixed-point value of a decimal string with `scale` fractional digits, or null. */
function scaled(value: JsonValue, scale: number) {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(value))
  if (!match) return null
  const fraction = (match[3] ?? '').padEnd(scale, '0').slice(0, scale)
  const amount = BigInt(match[2] + fraction)
  return match[1] ? -amount : amount
}

function sum(field: Field, rows: SerializedRecord[], key: string): JsonValue {
  const scale = field.type === 'decimal' || field.type === 'percent' ? (field.scale ?? 2) : 0
  let total = 0n
  for (const row of rows) {
    const value = row[key]
    if (value === null || value === undefined || value === '') continue
    const amount = scaled(value, scale)
    if (amount !== null) total += amount
  }
  if (field.type === 'money' || scale === 0) return total.toString()
  const negative = total < 0n
  const digits = (negative ? -total : total).toString().padStart(scale + 1, '0')
  return `${negative ? '-' : ''}${digits.slice(0, -scale)}.${digits.slice(-scale)}`
}

// ---------------------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------------------

type Scope = { group: string | null; row: SerializedRecord | null; index: number }

function lookup(
  ref: TemplateRef,
  data: PrintData,
  scope: Scope
): { field: Field; value: JsonValue | undefined; key: string; labels: Labels } | null {
  // Only fields in the reader's description are printable, whatever the record holds.
  if (ref.kind === 'field') {
    const field = data.fields.get(ref.key)
    return field && ref.key in data.record
      ? { field, value: data.record[ref.key], key: ref.key, labels: data }
      : null
  }
  if (ref.kind === 'row' && scope.group && scope.row) {
    const group = data.groups[scope.group]
    const field = group?.fields.get(ref.key)
    // Relations and lookups of a line come from the line resource, not the record.
    return field && ref.key in scope.row
      ? { field, value: scope.row[ref.key], key: ref.key, labels: group }
      : null
  }
  return null
}

/** Document values; id, rowNumber and the print time follow the digits preference. */
function metaValue(key: string, data: PrintData, scope: Scope, format: Formatting) {
  if (key === 'rowNumber')
    return scope.row ? withDigits(String(scope.index + 1), format.digits) : ''
  if (key === 'id') return withDigits(data.values.id, format.digits)
  if (key === 'printedAt') return formatDate(data.values.printedIso, 'datetime', format)
  return data.values[key] ?? ''
}

function truthy(ref: TemplateRef, data: PrintData, scope: Scope, format: Formatting) {
  if (ref.kind === 'lines') return Boolean(data.groups[ref.key]?.rows.length)
  if (ref.kind === 'meta') return metaValue(ref.key, data, scope, format) !== ''
  const found = lookup(ref, data, scope)
  if (!found) return false
  const value = found.value
  return !(
    value === null ||
    value === undefined ||
    value === '' ||
    value === false ||
    (Array.isArray(value) && !value.length)
  )
}

function output(
  node: TemplateNode & { type: 'output' },
  data: PrintData,
  scope: Scope,
  format: Formatting
): string {
  const { helper, arg } = node
  if (helper === 'label') {
    if (arg.kind !== 'string') return ''
    const [key, column] = arg.value.split('.')
    if (column !== undefined) {
      const field = data.groups[key]?.fields.get(column)
      return field ? escapeHtml(labelOf(field.label)) : ''
    }
    const field = data.fields.get(key)
    if (field) return escapeHtml(labelOf(field.label))
    return data.groups[key] ? escapeHtml(labelOf(data.groups[key].label)) : ''
  }
  if (helper === 'total') {
    if (arg.kind !== 'lines' || !arg.column) return ''
    const group = data.groups[arg.key]
    const field = group?.fields.get(arg.column)
    return field ? escapeHtml(formatNumber(field, sum(field, group.rows, arg.column), format)) : ''
  }
  if (arg.kind === 'meta') {
    if (arg.key === 'logo') return helper === null ? data.logo : ''
    const value = metaValue(arg.key, data, scope, format)
    return escapeHtml(helper === 'digits' ? withDigits(value, format.digits) : value)
  }
  const found = lookup(arg, data, scope)
  if (!found || found.value === null || found.value === undefined || found.value === '') return ''
  const { field, value, key, labels } = found
  switch (helper) {
    case 'date':
      return escapeHtml(DATES.includes(field.type) ? formatDate(value, field.type, format) : '')
    case 'money':
      return escapeHtml(field.type === 'money' ? formatMoney(value, format.digits) : '')
    case 'number':
      return escapeHtml(NUMERIC.includes(field.type) ? formatNumber(field, value, format) : '')
    case 'digits':
      return escapeHtml(withDigits(display(field, value, labels, key, format), format.digits))
    default:
      return escapeHtml(display(field, value, labels, key, format))
  }
}

function render(
  nodes: TemplateNode[],
  data: PrintData,
  format: Formatting,
  plain: boolean,
  scope: Scope
): string {
  let html = ''
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        html += plain ? escapeHtml(node.value) : node.value
        break
      case 'output':
        html += output(node, data, scope, format)
        break
      case 'if':
        html += render(
          truthy(node.test, data, scope, format) ? node.then : node.else,
          data,
          format,
          plain,
          scope
        )
        break
      case 'each': {
        const group = data.groups[node.group]
        if (!group) break
        group.rows.forEach((row, index) => {
          html += render(node.body, data, format, plain, { group: node.group, row, index })
        })
        break
      }
    }
  }
  return html
}

const PAGE_SIZES: Record<PrintPaper, string> = { A4: 'A4', A5: 'A5', Letter: 'letter' }
const SCREEN_WIDTH: Record<PrintPaper, Record<PrintOrientation, string>> = {
  A4: { portrait: '210mm', landscape: '297mm' },
  A5: { portrait: '148mm', landscape: '210mm' },
  Letter: { portrait: '216mm', landscape: '279mm' },
}

function page(input: Page, printed: string) {
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:">
<title>${escapeHtml(input.title)}</title>
<style>
@page { size: ${PAGE_SIZES[input.paper]} ${input.orientation}; margin: 16mm 14mm; }
* { box-sizing: border-box; }
body { font-family: "Noto Sans Arabic", "Segoe UI", Tahoma, sans-serif; color: #1c1917; font-size: 11pt; margin: 0; }
header.doc { display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #1c1917; padding-bottom: 6mm; margin-bottom: 6mm; }
h1 { font-size: 17pt; margin: 0; } h2 { font-size: 12.5pt; margin: 7mm 0 3mm; } h3, h4 { margin: 4mm 0 2mm; }
p { margin: 1.5mm 0; }
.logo { max-height: 18mm; max-width: 50mm; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: start; padding: 2mm 3mm; border-bottom: 1px solid #e7e5e4; vertical-align: top; }
.fields th { width: 35%; color: #57534e; font-weight: 600; }
.lines thead th { background: #f5f5f4; font-size: 9.5pt; }
.totals { width: 55%; margin-inline-start: auto; margin-top: 4mm; }
.totals th { color: #57534e; } .totals td { font-weight: 700; }
.num, .totals td { font-variant-numeric: tabular-nums; }
.muted { color: #57534e; } .small { font-size: 9pt; } .center { text-align: center; } .end { text-align: end; }
.running-header { color: #57534e; font-size: 9.5pt; margin-bottom: 4mm; }
.running-footer { margin-top: 8mm; color: #57534e; font-size: 9.5pt; }
footer.printed { margin-top: 8mm; color: #78716c; font-size: 8.5pt; }
@media screen { body { max-width: ${SCREEN_WIDTH[input.paper][input.orientation]}; margin: 10mm auto; padding: 0 10mm; } }
</style>
</head>
<body>
${input.header ? `<div class="running-header">${input.header}</div>\n` : ''}${input.body}
${input.footer ? `<div class="running-footer">${input.footer}</div>\n` : ''}<footer class="printed">${printed}</footer>
</body>
</html>`
}

const STATUS = ['مسودة', 'معتمد', 'ملغي']

/** Escapes static text placed in generated template markup (braces included). */
const literal = (text: string) =>
  escapeHtml(text).replaceAll('{', '&#123;').replaceAll('}', '&#125;')

/**
 * The markup of a code template, limited to what this reader may read: fields and
 * columns the reader cannot read are left out rather than printed empty.
 */
function codeTemplateSource(template: PrintTemplate, data: PrintData) {
  const fields = template.fields.filter((key) => data.fields.has(key))
  const rows = fields
    .map((key) => `<tr><th>{{label "${key}"}}</th><td>{{field.${key}}}</td></tr>`)
    .join('')
  const groups = Object.entries(template.lines ?? {})
    .filter(([group]) => data.groups[group])
    .map(([group, columns]) => {
      const visible = columns.filter((column) => data.groups[group].fields.has(column))
      const numeric = (column: string) =>
        NUMERIC.includes(data.groups[group].fields.get(column)!.type) ? ' class="num"' : ''
      return `<section><h2>{{label "${group}"}}</h2><table class="lines"><thead><tr><th>#</th>${visible
        .map((column) => `<th>{{label "${group}.${column}"}}</th>`)
        .join('')}</tr></thead><tbody>{{#each lines.${group}}}<tr><td>{{rowNumber}}</td>${visible
        .map((column) => `<td${numeric(column)}>{{row.${column}}}</td>`)
        .join('')}</tr>{{/each}}</tbody></table></section>`
    })
    .join('')
  const totals = (template.totals ?? [])
    .filter((total) =>
      'field' in total
        ? data.fields.has(total.field)
        : Boolean(data.groups[total.lines]?.fields.has(total.column))
    )
    .map(
      (total) =>
        `<tr><th>${literal(labelOf(total.label))}</th><td>${
          'field' in total
            ? `{{field.${total.field}}}`
            : `{{total lines.${total.lines}.${total.column}}}`
        }</td></tr>`
    )
    .join('')
  return `<header class="doc"><div><h1>${literal(labelOf(template.label))}</h1><p>{{company}}</p><p class="muted">{{resource}} #{{id}}{{#if status}} · {{status}}{{/if}}</p></div><div>{{logo}}</div></header>${
    rows ? `<table class="fields"><tbody>${rows}</tbody></table>` : ''
  }${groups}${totals ? `<table class="totals"><tbody>${totals}</tbody></table>` : ''}`
}

/** A version label of a code template: a hash of its declaration, so a change is visible. */
export function codeTemplateVersion(template: PrintTemplate) {
  return `code:${createHash('sha256').update(JSON.stringify(template)).digest('hex').slice(0, 12)}`
}

function draftOf(input: PrintTemplateInput): PrintTemplateDraft {
  const string = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
  const label = string(input.label)
  if (!label || label.length > LABEL_LIMIT)
    throw new AdulaError(422, 'E_PRINT_TEMPLATE_LABEL', 'اسم القالب مطلوب ولا يتجاوز 200 حرف')
  const body = string(input.body)
  if (!body) throw new AdulaError(422, 'E_PRINT_TEMPLATE_BODY', 'متن القالب مطلوب')
  const paper = (input.paper ?? 'A4') as PrintPaper
  const orientation = (input.orientation ?? 'portrait') as PrintOrientation
  if (!PRINT_PAPERS.includes(paper) || !PRINT_ORIENTATIONS.includes(orientation))
    throw new AdulaError(422, 'E_PRINT_TEMPLATE_PAPER', 'اختر مقاس ورق واتجاهًا صالحين')
  const header = string(input.header)
  const footer = string(input.footer)
  if (header.length > TEXT_LIMIT || footer.length > TEXT_LIMIT)
    throw new AdulaError(
      422,
      'E_PRINT_TEMPLATE_TEXT',
      'الترويسة والتذييل لا يتجاوز كل منهما 500 حرف'
    )
  return { label, body, paper, orientation, header, footer }
}

/** A record as one reader may read it: the input of renderTemplateDocument. */
export type PrintSource = {
  /** The reader's description: only its fields are printable. */
  resource: ResourceDescription
  record: SerializedRecord
  related?: Record<string, SerializedRecord[]>
  lookups?: Record<string, { value: string; label: string }[]>
  /** Line groups with the reader's description of the line resource. */
  lines?: Record<
    string,
    {
      label: Label
      fields: ResourceField[]
      rows: SerializedRecord[]
      related?: Record<string, SerializedRecord[]>
      lookups?: Record<string, { value: string; label: string }[]>
    }
  >
}
/** What to print: administrator markup (`body`) or a code template (`code`). */
export type PrintLayout = {
  title: string
  paper: PrintPaper
  orientation: PrintOrientation
  header?: string
  footer?: string
} & ({ body: string } | { code: PrintTemplate })

/**
 * Renders a print template for one reader (ADR 048). A value prints only when its field
 * is in the reader's description (`source.resource.fields`, `lines[*].fields`), even if
 * the record object holds more; the markup is sanitized again and every value escaped.
 */
export function renderTemplateDocument(
  source: PrintSource,
  layout: PrintLayout,
  options: PrintOptions
): string {
  const format: Formatting = {
    calendar: options.calendar ?? 'gregory',
    digits: options.digits ?? 'latn',
    timeZone: options.timeZone ?? 'UTC',
  }
  const readable = (fields: ResourceField[]) =>
    new Map(fields.filter((f) => f.type !== 'hasMany').map((f) => [f.key, f]))
  const printedAt = options.printedAt ?? new Date()
  const data: PrintData = {
    resource: source.resource,
    record: source.record,
    fields: readable(source.resource.fields),
    related: source.related ?? {},
    lookups: source.lookups ?? {},
    groups: Object.fromEntries(
      Object.entries(source.lines ?? {}).map(([key, group]) => [
        key,
        {
          label: group.label,
          fields: readable(group.fields),
          rows: group.rows,
          related: group.related ?? {},
          lookups: group.lookups ?? {},
        },
      ])
    ),
    logo: printLogoHtml(options.identity),
    values: {
      id: String(source.record.id),
      resource: source.resource.label,
      template: layout.title,
      company: options.identity.name,
      status:
        source.resource.submittable && typeof source.record.docStatus === 'number'
          ? (STATUS[source.record.docStatus] ?? '')
          : '',
      printedBy: options.printedBy,
      printedIso: printedAt.toISOString(),
    },
  }
  const scope: Scope = { group: null, row: null, index: 0 }
  const markup = 'code' in layout ? codeTemplateSource(layout.code, data) : layout.body
  // Sanitized again at render (defense in depth), then rendered with escaped values.
  const body = render(parseTemplate(sanitizePrintHtml(markup)), data, format, false, scope)
  const text = (value: string) => render(parseTemplate(value), data, format, true, scope)
  return page(
    {
      title: `${layout.title} — ${data.resource.label} #${withDigits(data.values.id, format.digits)}`,
      paper: layout.paper,
      orientation: layout.orientation,
      header: text(layout.header ?? ''),
      footer: text(layout.footer ?? ''),
      body,
    },
    `طُبع بواسطة ${escapeHtml(options.printedBy)} في ${escapeHtml(
      `${formatDate(data.values.printedIso, 'datetime', format)} (${format.timeZone})`
    )}`
  )
}

/**
 * Print templates (ADR 048): code templates declared on resources, administrator
 * templates stored with immutable versions in print_templates / print_template_versions,
 * and the generic layout as the implicit `default`. Every print reads the record through
 * ResourceService as the actor, so the printed values are those the record page shows.
 */
export class PrintTemplates {
  constructor(
    private db: Knex,
    private registry: ResourceRegistry
  ) {}

  private resource(name: string) {
    try {
      return this.registry.get(name)
    } catch {
      throw new AdulaError(404, 'E_NOT_FOUND', 'الكيان غير موجود')
    }
  }

  /** Every template of every registered resource, for the administration screen. */
  async list(): Promise<PrintTemplateSummary[]> {
    const rows = await this.db('print_templates as t')
      .join('print_template_versions as v', (join) =>
        join.on('v.template_id', 't.id').andOn('v.version', 't.current_version')
      )
      .select('t.*', 'v.paper', 'v.orientation')
      .orderBy(['t.resource', 't.key'])
    const custom = new Map<string, Record<string, any>[]>()
    for (const row of rows) custom.set(row.resource, [...(custom.get(row.resource) ?? []), row])
    return this.registry.all().flatMap((resource) => [
      ...(resource.printTemplates ?? []).map((template): PrintTemplateSummary => ({
        resource: resource.name,
        resourceLabel: resource.label.ar,
        key: template.key,
        label: template.label.ar,
        source: 'code',
        version: codeTemplateVersion(template),
        active: true,
        paper: template.paper ?? 'A4',
        orientation: template.orientation ?? 'portrait',
        updatedAt: null,
      })),
      ...(custom.get(resource.name) ?? []).map((row) => this.summary(resource, row)),
    ])
  }

  private summary(resource: Resource, row: Record<string, any>): PrintTemplateSummary {
    return {
      resource: resource.name,
      resourceLabel: resource.label.ar,
      key: String(row.key),
      label: String(row.label),
      source: 'custom',
      version: String(row.current_version),
      active: Boolean(row.active),
      paper: row.paper,
      orientation: row.orientation,
      updatedAt: new Date(row.updated_at).toISOString(),
    }
  }

  /** One administrator template with the content of its current version. */
  async get(name: string, key: string): Promise<PrintTemplateDetail> {
    const resource = this.resource(name)
    const row = await this.db('print_templates as t')
      .join('print_template_versions as v', (join) =>
        join.on('v.template_id', 't.id').andOn('v.version', 't.current_version')
      )
      .where({ 't.resource': name, 't.key': key })
      .select('t.*', 'v.body', 'v.paper', 'v.orientation', 'v.header', 'v.footer')
      .first()
    if (!row) throw notFound()
    return {
      ...this.summary(resource, row),
      body: String(row.body),
      header: String(row.header ?? ''),
      footer: String(row.footer ?? ''),
    }
  }

  /** The version history of an administrator template, newest first. */
  async versions(name: string, key: string): Promise<PrintTemplateVersion[]> {
    this.resource(name)
    const template = await this.db('print_templates').where({ resource: name, key }).first()
    if (!template) throw notFound()
    // Core deployments may keep users without a full_name column.
    const named = await this.db.schema.hasColumn('users', 'full_name')
    const rows = await this.db('print_template_versions as v')
      .leftJoin('users as u', 'u.id', 'v.created_by')
      .where('v.template_id', template.id)
      .orderBy('v.version', 'desc')
      .select('v.*', 'u.email as creator_email', ...(named ? ['u.full_name as creator_name'] : []))
    return rows.map((row: Record<string, any>) => ({
      version: Number(row.version),
      label: String(row.label),
      body: String(row.body),
      paper: row.paper,
      orientation: row.orientation,
      header: String(row.header ?? ''),
      footer: String(row.footer ?? ''),
      createdBy: row.creator_name ?? row.creator_email ?? null,
      createdAt: new Date(row.created_at).toISOString(),
    }))
  }

  /**
   * Checks and sanitizes a draft: the markup goes through sanitizePrintHtml, then every
   * name and helper is checked against the resource. Returns the stored form.
   */
  validate(name: string, input: PrintTemplateInput): PrintTemplateDraft {
    this.resource(name)
    const draft = draftOf(input)
    const schema = printSchema(this.registry, name)
    const body = sanitizePrintHtml(draft.body)
    if (!body.trim())
      throw new AdulaError(
        422,
        'E_PRINT_TEMPLATE_BODY',
        'لم يبقَ من متن القالب شيء بعد إزالة الوسوم غير المسموحة'
      )
    checkTemplate(parseTemplate(body), schema, 'html')
    checkTemplate(parseTemplate(draft.header), schema, 'text')
    checkTemplate(parseTemplate(draft.footer), schema, 'text')
    return { ...draft, body }
  }

  /** Creates an administrator template at version 1; 409 when the key already exists. */
  async create(name: string, input: PrintTemplateInput, actorId: number) {
    return this.save(name, input, actorId, 'create')
  }

  /**
   * Saves a new version of an existing administrator template (404 when there is none).
   * `active` keeps its stored value when the input leaves it out.
   */
  async update(name: string, key: string, input: PrintTemplateInput, actorId: number) {
    return this.save(name, { ...input, key }, actorId, 'update')
  }

  /** Versions are never changed; the template row points to the current one. */
  private async save(
    name: string,
    input: PrintTemplateInput,
    actorId: number,
    mode: 'create' | 'update'
  ) {
    const resource = this.resource(name)
    const key = typeof input.key === 'string' ? input.key.trim() : ''
    if (mode === 'create') {
      if (!KEY.test(key))
        throw new AdulaError(
          422,
          'E_PRINT_TEMPLATE_KEY',
          'مفتاح القالب حروف إنجليزية صغيرة وأرقام وشرطة سفلية، ويبدأ بحرف'
        )
      if (key === DEFAULT_PRINT_TEMPLATE || resource.printTemplates?.some((t) => t.key === key))
        throw new AdulaError(
          422,
          'E_PRINT_TEMPLATE_KEY_TAKEN',
          'هذا المفتاح مستخدم لقالب معرّف في النظام'
        )
    }
    const draft = this.validate(name, input)
    return this.db.transaction(async (trx) => {
      let template = await trx('print_templates').where({ resource: name, key }).forUpdate().first()
      if (mode === 'update' && !template) throw notFound()
      if (mode === 'create') {
        if (template) throw duplicateKey()
        ;[template] = await trx('print_templates')
          .insert({
            resource: name,
            key,
            label: draft.label,
            current_version: 0,
            active: input.active === undefined ? true : input.active === true,
            created_by: actorId,
            updated_by: actorId,
          })
          .onConflict(['resource', 'key'])
          .ignore()
          .returning('*')
        // A concurrent create of the same key won the insert.
        if (!template) throw duplicateKey()
      }
      const version = Number(template.current_version) + 1
      await trx('print_template_versions').insert({
        template_id: template.id,
        version,
        label: draft.label,
        body: draft.body,
        paper: draft.paper,
        orientation: draft.orientation,
        header: draft.header,
        footer: draft.footer,
        created_by: actorId,
      })
      await trx('print_templates')
        .where('id', template.id)
        .update({
          label: draft.label,
          current_version: version,
          active: input.active === undefined ? Boolean(template.active) : input.active === true,
          updated_by: actorId,
          updated_at: trx.fn.now(),
        })
      return { resource: name, key, version }
    })
  }

  /** Templates the actor may print a record of this resource with (403 without view). */
  async available(
    resources: ResourceService,
    name: string,
    actor: Actor
  ): Promise<PrintTemplateOption[]> {
    const resource = this.resource(name)
    resources.describe(name, actor)
    const custom = await this.db('print_templates')
      .where({ resource: name, active: true })
      .orderBy('label')
      .select('key', 'label')
    return [
      {
        key: DEFAULT_PRINT_TEMPLATE,
        label: { ar: 'الطباعة العامة', en: 'Standard print' },
        source: 'generic',
      },
      ...(resource.printTemplates ?? []).map((template) => ({
        key: template.key,
        label: template.label,
        source: 'code' as const,
      })),
      ...custom.map((row) => ({
        key: String(row.key),
        label: { ar: String(row.label) },
        source: 'custom' as const,
      })),
    ]
  }

  /** The record as the actor may read it, with its lines and display maps. */
  /** The record, its lines and display maps as the actor may read them. */
  private async source(
    resources: ResourceService,
    name: string,
    id: number,
    actor: Actor
  ): Promise<PrintSource> {
    const shown = await resources.show(name, id, actor)
    const resource = resources.describe(name, actor)
    // Only the line groups a template may name (printableGroups) are read; documentLines
    // applies the hasMany field's rules and level, the child's view permission and each
    // line's scope, like the record page.
    const definition = this.resource(name)
    const lines = await resources.documentLines(name, id, actor, {
      fields: printableGroups(definition),
      limit: PRINT_LINE_LIMIT,
    })
    const groups: NonNullable<PrintSource['lines']> = {}
    for (const [key, group] of Object.entries(lines)) {
      const field = definition.fields[key]
      if (field?.type !== 'hasMany') continue
      // Never print a truncated table or total.
      if (group.hasMore) throw lineLimit()
      groups[key] = {
        label: field.label,
        fields: resources.describe(field.resource, actor).fields,
        rows: group.rows,
        related: group.related ?? {},
        lookups: await resources.lookups(field.resource, actor),
      }
    }
    return {
      resource,
      record: shown.data,
      related: (shown.related ?? {}) as Record<string, SerializedRecord[]>,
      lookups: await resources.lookups(name, actor),
      lines: groups,
    }
  }

  private async formatting(options: PrintOptions): Promise<PrintOptions> {
    const stored = options.calendar && options.digits ? null : await uiPreferences(this.db)
    return {
      ...options,
      calendar: options.calendar ?? stored?.calendar ?? 'gregory',
      digits: options.digits ?? stored?.digits ?? 'latn',
    }
  }

  /**
   * Renders one record with a template (`default` for the generic layout). Call
   * recordPrinted once the document was delivered (after a PDF conversion succeeded).
   */
  async print(
    resources: ResourceService,
    name: string,
    id: number,
    actor: Actor,
    options: PrintOptions & { template?: string }
  ): Promise<PrintedDocument> {
    const resource = this.resource(name)
    const key = options.template || DEFAULT_PRINT_TEMPLATE
    let html: string
    let template: PrintedDocument['template']
    if (key === DEFAULT_PRINT_TEMPLATE) {
      const shown = await resources.show(name, id, actor)
      const description = resources.describe(name, actor)
      // The generic layout prints the line groups of the detail view, complete.
      const childData = await resources.documentLines(name, id, actor, {
        fields: resource.show.filter((entry) => resource.fields[entry]?.type === 'hasMany'),
        limit: PRINT_LINE_LIMIT,
      })
      if (Object.values(childData).some((group) => group.hasMore)) throw lineLimit()
      const children: Record<
        string,
        { rows: SerializedRecord[]; fields: ResourceDescription['fields'] }
      > = {}
      for (const [childKey, group] of Object.entries(childData)) {
        const field = description.fields.find((entry) => entry.key === childKey)
        if (!field || field.type !== 'hasMany') continue
        const child = resources.describe(field.resource, actor)
        children[childKey] = {
          rows: group.rows,
          fields: child.fields.filter((entry) => child.list.includes(entry.key)),
        }
      }
      html = renderPrintHtml({
        identity: options.identity,
        resource: description,
        record: shown.data,
        related: shown.related,
        lookups: await resources.lookups(name, actor),
        children,
        printedBy: options.printedBy,
        printedAt: options.printedAt,
      })
      template = { key, version: 'generic', source: 'generic' }
    } else {
      const code = resource.printTemplates?.find((entry) => entry.key === key)
      const stored = code
        ? null
        : await this.db('print_templates as t')
            .join('print_template_versions as v', (join) =>
              join.on('v.template_id', 't.id').andOn('v.version', 't.current_version')
            )
            .where({ 't.resource': name, 't.key': key, 't.active': true })
            .select('v.*')
            .first()
      if (!code && !stored) {
        // Authorize the record first so an unknown template never reveals a hidden record.
        await resources.show(name, id, actor)
        throw notFound()
      }
      const title = code ? code.label.ar : String(stored.label)
      html = renderTemplateDocument(
        await this.source(resources, name, id, actor),
        code
          ? {
              title,
              code,
              paper: code.paper ?? 'A4',
              orientation: code.orientation ?? 'portrait',
              header: code.header ?? '',
              footer: code.footer ?? '',
            }
          : {
              title,
              body: String(stored.body),
              paper: stored.paper,
              orientation: stored.orientation,
              header: String(stored.header ?? ''),
              footer: String(stored.footer ?? ''),
            },
        await this.formatting(options)
      )
      template = code
        ? { key, version: codeTemplateVersion(code), source: 'code' }
        : { key, version: String(stored.version), source: 'custom' }
    }
    return { html, template }
  }

  /**
   * Records a `printed` activity on the record with the template key, version and format.
   * Call it after the document was produced (HTML rendered, or PDF converted).
   */
  async recordPrinted(
    name: string,
    id: number,
    actor: Actor,
    template: PrintedDocument['template'],
    format: 'html' | 'pdf'
  ) {
    await logActivity(this.db, {
      resource: name,
      recordId: id,
      actorId: actor.id,
      impersonatorId: actor.impersonatorId,
      action: 'printed',
      changes: { template: template.key, version: template.version, format },
    })
  }

  /**
   * Renders an unsaved draft against a record the actor may read: `recordId`, or the
   * newest record of the actor's list. Nothing is stored or audited.
   */
  async preview(
    resources: ResourceService,
    name: string,
    input: PrintTemplateInput,
    actor: Actor,
    options: PrintOptions & { recordId?: number | null }
  ) {
    const draft = this.validate(name, input)
    let id = options.recordId ?? null
    if (id === null) {
      const listed = await resources.list(name, actor, {
        limit: 1,
        estimate: false,
        sort: 'id',
        direction: 'desc',
      })
      const first = listed.data[0]
      if (!first)
        throw new AdulaError(404, 'E_PRINT_PREVIEW_EMPTY', 'لا يوجد سجل متاح لك لمعاينة القالب')
      id = Number(first.id)
    }
    const html = renderTemplateDocument(
      await this.source(resources, name, id, actor),
      { ...draft, title: draft.label },
      await this.formatting(options)
    )
    return { html, recordId: id }
  }
}
