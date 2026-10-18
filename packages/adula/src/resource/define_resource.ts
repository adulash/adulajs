import type { Field, Label, Resource, ResourceInput } from './types.js'
import { assertTitle } from '../admin/record_title.js'

export function identifier(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error(`Unsafe SQL identifier: ${value}`)
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
export function defineResource<const F extends Record<string, Field>>(
  input: ResourceInput<F>
): ResourceInput<F> & Resource {
  identifier(input.name)
  if (typeof input.scoped !== 'boolean') throw new Error(`${input.name}: scoped must be explicit`)
  assertLabel(input.label, `${input.name}: label`)
  for (const optional of [input.recordLabel, input.createLabel])
    if (optional) assertLabel(optional, `${input.name}: recordLabel and createLabel`)
  for (const [key, field] of Object.entries(input.fields)) {
    columnName(key)
    identifier(field.column ?? columnName(key))
    if (
      [
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
      ].includes(key)
    )
      throw new Error(`Reserved field: ${key}`)
    assertLabel(field.label, `${key}: label`)
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
  if (input.scope) {
    const parent = input.fields[input.scope.from]
    if (!input.scoped) throw new Error(`${input.name}: scope.from requires scoped: true`)
    if (parent?.type !== 'belongsTo' || !parent.required)
      throw new Error(`${input.name}: scope.from must name a required belongsTo field`)
  }
  assertTitle(input)
  if (!input.submittable && input.actions.some((a) => ['submit', 'cancel', 'amend'].includes(a)))
    throw new Error('Document actions require submittable')
  return Object.freeze({ ...input, version: input.version ?? input.submittable ?? false })
}
