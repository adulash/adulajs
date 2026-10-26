import vine from '@vinejs/vine'
import type { FieldContext, SchemaTypes, Validation } from '@vinejs/vine/types'

/** The chain every base schema of baseSchema() offers (their concrete types differ). */
type Chainable = SchemaTypes & {
  use(rule: Validation<{ field: Field }>): Chainable
  nullable(): { optional(): SchemaTypes }
}
import type { Field, RecordData, Resource, Scalar } from './types.js'
import { FieldValueError, fieldValue } from './values.js'
import { currentLanguage, translate } from '../languages/catalog.js'

/**
 * Runs fieldValue as a VineJS rule: the value becomes its stored representation and a
 * constraint violation is reported under its catalog rule, so messages follow the
 * application's messages provider (see installCatalogMessages).
 */
/** Types whose blank string means "no value". */
export const TEXT_LIKE = ['string', 'text', 'email', 'url', 'phone']

const definitionRule = vine.createRule<{ field: Field }>(
  (value, { field: definition }, field: FieldContext) => {
    if (!field.isValid) return
    // A blank text-like value is no value: required fields refuse it, others store null.
    if (TEXT_LIKE.includes(definition.type) && typeof value === 'string' && !value.trim()) {
      if (definition.required && definition.visibleWhen === undefined)
        field.report(translate('validation.required', currentLanguage()), 'required', field)
      else field.mutate(null, field)
      return
    }
    try {
      field.mutate(fieldValue(definition, value), field)
    } catch (error) {
      if (error instanceof FieldValueError)
        field.report(error.message, error.rule, field, error.params)
      else field.report(translate('validation.invalid', currentLanguage()), 'invalid', field)
    }
  },
  { name: 'adulaField' }
)

/** The base VineJS type of one stored field; constraints are applied by definitionRule. */
function baseSchema(field: Field) {
  switch (field.type) {
    case 'string':
    case 'email':
    case 'url':
    case 'phone':
      // Length, pattern and format follow in definitionRule (TEXT_LIMITS included).
      return vine.string().trim()
    case 'text':
    case 'lookup':
    case 'enum':
    case 'date':
      return vine.string()
    case 'integer':
    case 'belongsTo':
    case 'user':
    case 'attachment':
      return vine.number().withoutDecimals()
    case 'boolean':
      return vine.boolean()
    case 'multiSelect':
      return vine.array(vine.string())
    case 'manyToMany':
      return vine.array(vine.number().withoutDecimals())
    default:
      // money, decimal, percent (numbers or numeric strings), datetime (string or Date), json.
      return vine.any()
  }
}

/**
 * The VineJS object properties derived from a resource's form fields (inline children
 * and sequences excluded). Applications extend it instead of restating the fields:
 * `vine.create(vine.object({ ...definitionSchema(resource), extra: vine.string() }))`.
 * A required field is optional while it has a default or depends on `visibleWhen`:
 * the server applies the default and enforces `required` once visibility is known.
 */
export function definitionSchema(resource: Pick<Resource, 'fields' | 'form'>) {
  const properties: Record<string, SchemaTypes> = {}
  for (const key of resource.form) {
    const field = resource.fields[key]
    if (!field || field.type === 'hasMany' || field.sequence) continue
    const schema = (baseSchema(field) as unknown as Chainable).use(definitionRule({ field }))
    properties[key] =
      field.required && field.visibleWhen === undefined && field.default === undefined
        ? schema
        : schema.nullable().optional()
  }
  return properties
}

const validators = new WeakMap<object, { validate(data: unknown): Promise<RecordData> }>()

/**
 * The validator persist() uses for a resource without its own `validator`, compiled
 * once per definition. It picks up the VineJS messages provider installed when it is
 * first used, so catalog messages apply.
 */
export function definitionValidator(resource: Pick<Resource, 'fields' | 'form'>) {
  let validator = validators.get(resource)
  if (!validator) {
    const compiled = vine.compile(vine.object(definitionSchema(resource)))
    validator = { validate: (data: unknown) => compiled.validate(data) as Promise<RecordData> }
    validators.set(resource, validator)
  }
  return validator
}

/** The validator of a write: the resource's own, or the derived one. */
export function resourceValidator(resource: Resource) {
  return resource.validator ?? definitionValidator(resource)
}

/**
 * The canonical (stored) form of a controlling field's value, so a raw input such as
 * 12.5 or ' 12.5' compares equal to the canonical rule value '12.50'. A value the field
 * refuses stays as it is (and so matches no canonical rule value).
 */
function canonical(field: Field | undefined, value: unknown) {
  if (!field || value === undefined || value === null) return value ?? null
  try {
    return fieldValue({ ...field, min: undefined, max: undefined } as Field, value)
  } catch {
    return value
  }
}

function matches(field: Field | undefined, actual: unknown, expected: Scalar) {
  // A multiSelect controller contains the value; `null` matches no selection (null or []).
  if (field?.type === 'multiSelect')
    return expected === null
      ? actual === null || actual === undefined || (Array.isArray(actual) && !actual.length)
      : Array.isArray(actual) && actual.includes(expected)
  // Rule values are canonical (checked by defineResource); the record value is made canonical.
  return canonical(field, actual) === expected
}

/** Whether a field applies to a (prospective) record; see Field.visibleWhen. */
export function isVisible(resource: Pick<Resource, 'fields'>, key: string, record: RecordData) {
  const rule = resource.fields[key]?.visibleWhen
  if (!rule) return true
  return Object.entries(rule).every(([sibling, expected]) =>
    (Array.isArray(expected) ? expected : [expected]).some((value: Scalar) =>
      matches(resource.fields[sibling], record[sibling], value)
    )
  )
}

/**
 * Clears every field that does not apply to the record (null, or an empty list for
 * manyToMany), repeating until stable so a field depending on a hidden field is hidden
 * too. Returns the hidden keys.
 */
export function applyVisibility(
  resource: Pick<Resource, 'fields'>,
  record: RecordData,
  options: {
    /** The stored record of an update. */
    existing?: RecordData
    /** Whether the writer may write a field; a hidden field it may not write keeps `existing`. */
    writable?: (key: string) => boolean
  } = {}
) {
  const hidden = new Set<string>()
  const cleared = (key: string) =>
    options.existing && options.writable && !options.writable(key) && key in options.existing
      ? options.existing[key]
      : resource.fields[key].type === 'manyToMany'
        ? []
        : null
  for (let pass = 0; pass <= Object.keys(resource.fields).length; pass++) {
    let changed = false
    for (const key of Object.keys(resource.fields)) {
      if (hidden.has(key) || isVisible(resource, key, record)) continue
      hidden.add(key)
      changed = true
      if (resource.fields[key].type === 'hasMany') continue
      record[key] = cleared(key)
    }
    if (!changed) break
  }
  return hidden
}

/** Declared defaults for the stored fields a create input leaves out. */
export function missingDefaults(resource: Pick<Resource, 'fields'>, input: RecordData) {
  const defaults: RecordData = {}
  for (const [key, field] of Object.entries(resource.fields))
    if (field.default !== undefined && !(key in input))
      defaults[key] = Array.isArray(field.default) ? [...field.default] : field.default
  return defaults
}
