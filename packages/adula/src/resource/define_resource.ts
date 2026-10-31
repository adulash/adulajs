import type { Field, Label, Resource, ResourceInput } from './types.js'
import { assertTitle } from '../admin/record_title.js'
import {
  MULTIPLE_ATTACHMENT_MAX,
  decimalShape,
  fieldValue,
  isMultipleAttachment,
} from './values.js'
import { assertPrintTemplates } from '../integrations/print_templates.js'

export function identifier(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error(`Unsafe SQL identifier: ${value}`)
  // PostgreSQL silently truncates longer names, so two distinct names could collide.
  if (value.length > 63)
    throw new Error(`SQL identifier longer than 63 bytes (PostgreSQL limit): ${value}`)
  return value
}
const columns = new Map<string, string>()
/** camelCase field key → snake_case column; validated once and memoized (hot in row mapping). */
export function columnName(name: string): string {
  const cached = columns.get(name)
  if (cached !== undefined) return cached
  const column = identifier(name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`))
  if (columns.size < 10000) columns.set(name, column)
  return column
}

/**
 * The join table of a manyToMany field: `table`, or `<owner>_<key in snake_case>`. Its
 * columns are `<owner>_id` and `<target>_id` (`related_id` when a resource links itself).
 */
export function joinTable(owner: string, key: string, field: { resource: string; table?: string }) {
  return {
    table: identifier(field.table ?? `${owner}_${columnName(key)}`),
    owner: identifier(`${owner}_id`),
    target: field.resource === owner ? 'related_id' : identifier(`${field.resource}_id`),
  }
}

/**
 * Arabic is required; every other language is optional, but a language a label
 * names must have text (an empty `en: ''` is a mistake, not an omission).
 */
export function assertLabel(label: Label | undefined, context: string) {
  if (!label || typeof label.ar !== 'string' || !label.ar.trim())
    throw new Error(`${context} needs Arabic text`)
  for (const [language, text] of Object.entries(label))
    if (typeof text !== 'string' || !text.trim())
      throw new Error(`${context} needs Arabic text; ${language} is optional but cannot be empty`)
}

const RESERVED = [
  'id',
  'orgUnitId',
  'createdBy',
  'updatedBy',
  'createdAt',
  'updatedAt',
  'deletedAt',
  'version',
  'docStatus',
  'amendedFromId',
]
/** Types whose value is not a single column: they cannot be sorted, searched or unique. */
const COLLECTIONS = ['hasMany', 'manyToMany', 'multiSelect']
const TEXT_TYPES = ['string', 'text', 'email', 'url', 'phone']
const NUMBER_TYPES = ['integer', 'money', 'decimal', 'percent']
/** Types that cannot declare a default: ids differ between deployments, files are uploads. */
const NO_DEFAULT = ['hasMany', 'manyToMany', 'belongsTo', 'user', 'attachment', 'json']

const isCount = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0

/** Constraint, option, default and visibility props of one field, checked at definition time. */
function assertFieldProps(name: string, key: string, field: Field, fields: Record<string, Field>) {
  const context = `${name}.${key}`
  const raw = field as Field & Record<string, unknown>
  if (TEXT_TYPES.includes(field.type)) {
    for (const bound of ['min', 'max'] as const)
      if (raw[bound] !== undefined && !isCount(raw[bound]))
        throw new Error(`${context}: ${bound} must be a non-negative integer length`)
    if (raw.pattern !== undefined) {
      if (typeof raw.pattern !== 'string') throw new Error(`${context}: pattern must be a string`)
      try {
        new RegExp(raw.pattern)
      } catch {
        throw new Error(`${context}: pattern is not a valid regular expression`)
      }
    }
    if (raw.format !== undefined && !['email', 'url', 'phone'].includes(String(raw.format)))
      throw new Error(`${context}: format must be email, url or phone`)
  }
  if (field.type === 'decimal' || field.type === 'percent') {
    const { precision, scale } = decimalShape(field)
    if (!Number.isSafeInteger(precision) || precision < 1 || precision > 1000)
      throw new Error(`${context}: precision must be an integer from 1 to 1000`)
    if (!Number.isSafeInteger(scale) || scale < 0 || scale > precision)
      throw new Error(`${context}: scale must be an integer from 0 to precision`)
  }
  if (NUMBER_TYPES.includes(field.type))
    for (const bound of ['min', 'max'] as const)
      if (raw[bound] !== undefined)
        try {
          fieldValue({ ...field, min: undefined, max: undefined } as Field, raw[bound])
        } catch {
          throw new Error(`${context}: ${bound} must be a valid ${field.type} value`)
        }
  if (field.type === 'enum' || field.type === 'multiSelect') {
    if (!Array.isArray(field.options) || !field.options.length)
      throw new Error(`${context}: options must list at least one choice`)
    const values = new Set<string>()
    for (const option of field.options) {
      if (typeof option?.value !== 'string' || !option.value || option.value.length > 255)
        throw new Error(`${context}: option values must be non-empty strings (255 at most)`)
      if (values.has(option.value)) throw new Error(`${context}: duplicate option ${option.value}`)
      values.add(option.value)
      assertLabel(option.label, `${context}: option ${option.value}`)
    }
    if (field.type === 'multiSelect')
      for (const bound of ['min', 'max'] as const)
        if (field[bound] !== undefined && !isCount(field[bound]))
          throw new Error(`${context}: ${bound} must be a non-negative integer count`)
  }
  if (field.type === 'manyToMany') {
    identifier(field.resource)
    // Required means at least one linked record; persist() checks it.
    joinTable(name, key, field)
  }
  if (field.type === 'attachment') {
    if (raw.multiple !== undefined && typeof raw.multiple !== 'boolean')
      throw new Error(`${context}: multiple must be true or false`)
    if (raw.max !== undefined) {
      if (!field.multiple) throw new Error(`${context}: max needs multiple: true`)
      if (
        !Number.isSafeInteger(raw.max) ||
        Number(raw.max) < 1 ||
        Number(raw.max) > MULTIPLE_ATTACHMENT_MAX
      )
        throw new Error(
          `${context}: max must be an integer from 1 to ${MULTIPLE_ATTACHMENT_MAX} files`
        )
    }
  }
  if (COLLECTIONS.includes(field.type) || isMultipleAttachment(field))
    for (const flag of ['sortable', 'searchable', 'unique'] as const)
      if (field[flag]) throw new Error(`${context}: ${field.type} fields cannot be ${flag}`)
  if (
    field.searchable &&
    !['string', 'text', 'email', 'url', 'phone', 'enum', 'lookup'].includes(field.type)
  )
    throw new Error(`${context}: only text fields can be searchable`)
  if (field.default !== undefined) {
    if (NO_DEFAULT.includes(field.type) || field.sequence)
      throw new Error(`${context}: ${field.type} fields cannot declare a default`)
    if (Array.isArray(field.default) !== (field.type === 'multiSelect'))
      throw new Error(`${context}: only multiSelect defaults are arrays`)
    if (field.default !== null)
      try {
        const stored = fieldValue(field, field.default)
        if (field.type !== 'multiSelect' && stored !== field.default)
          throw new Error('not canonical')
      } catch {
        throw new Error(`${context}: the default is not a valid canonical ${field.type} value`)
      }
  }
  if (field.visibleWhen !== undefined) {
    if (
      !field.visibleWhen ||
      typeof field.visibleWhen !== 'object' ||
      Array.isArray(field.visibleWhen)
    )
      throw new Error(`${context}: visibleWhen must map sibling fields to values`)
    for (const [sibling, expected] of Object.entries(field.visibleWhen)) {
      const controller = fields[sibling]
      if (!controller || sibling === key)
        throw new Error(`${context}: visibleWhen names unknown field ${sibling}`)
      if (['hasMany', 'manyToMany', 'json', 'attachment'].includes(controller.type))
        throw new Error(`${context}: visibleWhen cannot depend on ${controller.type} ${sibling}`)
      for (const value of Array.isArray(expected) ? expected : [expected]) {
        if (value === null) continue
        if (!['string', 'number', 'boolean'].includes(typeof value))
          throw new Error(`${context}: visibleWhen values must be scalars`)
        // Each value is a canonical value of the controlling field (an option of an
        // enum or multiSelect), so the rule compares stored values exactly.
        let stored: unknown
        try {
          stored =
            controller.type === 'multiSelect'
              ? (
                  fieldValue({ ...controller, min: undefined, max: undefined }, [
                    value,
                  ]) as unknown[]
                )[0]
              : fieldValue({ ...controller, min: undefined, max: undefined } as Field, value)
        } catch {
          throw new Error(
            `${context}: visibleWhen ${sibling} = ${JSON.stringify(value)} is not a valid ${controller.type} value`
          )
        }
        if (stored !== value)
          throw new Error(
            `${context}: visibleWhen ${sibling} must use the canonical value ${JSON.stringify(stored)}`
          )
      }
    }
  }
}

export function defineResource<const F extends Record<string, Field>>(
  input: ResourceInput<F>
): ResourceInput<F> & Resource {
  identifier(input.name)
  if ('customFields' in input)
    throw new Error(
      `${input.name}: the customFields option was removed (nothing read or wrote the column). ` +
        'Delete it from the definition; an existing custom_fields column is left untouched.'
    )
  if (typeof input.scoped !== 'boolean') throw new Error(`${input.name}: scoped must be explicit`)
  assertLabel(input.label, `${input.name}: label`)
  for (const optional of [input.recordLabel, input.createLabel])
    if (optional) assertLabel(optional, `${input.name}: recordLabel and createLabel`)
  for (const [key, field] of Object.entries(input.fields)) {
    columnName(key)
    identifier(field.column ?? columnName(key))
    if (RESERVED.includes(key)) throw new Error(`Reserved field: ${key}`)
    assertLabel(field.label, `${key}: label`)
    assertFieldProps(input.name, key, field, input.fields)
  }
  for (const keys of [
    input.list,
    input.form,
    input.show,
    input.hidden ?? [],
    input.serialize ?? [],
  ]) {
    for (const key of keys) if (!(key in input.fields)) throw new Error(`Unknown field: ${key}`)
  }
  for (const keys of input.unique ?? []) {
    if (!Array.isArray(keys) || keys.length < 2 || new Set(keys).size !== keys.length)
      throw new Error(`${input.name}: each unique combination needs two or more distinct fields`)
    for (const key of keys) {
      if (key === 'orgUnitId' && input.scoped) continue
      const field = (input.fields as Record<string, Field>)[key]
      if (
        !field ||
        COLLECTIONS.includes(field.type) ||
        field.type === 'json' ||
        isMultipleAttachment(field)
      )
        throw new Error(`${input.name}: unique combination names unknown or unstored field ${key}`)
    }
    const columnsOf = keys.map((key) =>
      key === 'orgUnitId'
        ? 'org_unit_id'
        : ((input.fields as Record<string, Field>)[key].column ?? columnName(key))
    )
    const index = `${input.name}_${columnsOf.join('_')}_active_unique`
    if (index.length > 63)
      throw new Error(
        `${input.name}: the unique index name ${index} is longer than 63 bytes (PostgreSQL limit); shorten the resource name or the field columns`
      )
  }
  if (input.scope) {
    const parent = input.fields[input.scope.from]
    if (!input.scoped) throw new Error(`${input.name}: scope.from requires scoped: true`)
    if (parent?.type !== 'belongsTo' || !parent.required)
      throw new Error(`${input.name}: scope.from must name a required belongsTo field`)
  }
  assertTitle(input)
  assertPrintTemplates(input)
  if (!input.submittable && input.actions.some((a) => ['submit', 'cancel', 'amend'].includes(a)))
    throw new Error('Document actions require submittable')
  return Object.freeze({ ...input, version: input.version ?? input.submittable ?? false })
}
