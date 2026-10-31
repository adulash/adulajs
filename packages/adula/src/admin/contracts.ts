import { subject } from '@casl/ability'
import type { AdulaAbility, Actor } from '../auth/ability.js'
import { conditionFields } from '../auth/ability.js'
import type { RecordData, Resource, JsonValue, SerializedRecord } from '../resource/types.js'
import { columnName } from '../resource/define_resource.js'
import { AdulaError } from './errors.js'

const standard = ['id', 'createdBy', 'updatedBy', 'createdAt', 'updatedAt', 'deletedAt']
export function selectedFields(
  resource: Resource,
  ability: AdulaAbility,
  options: { write?: boolean; extra?: string[] } = {}
) {
  return [
    ...new Set([
      ...standard,
      ...(resource.scoped ? ['orgUnitId'] : []),
      ...(resource.version ? ['version'] : []),
      ...(resource.submittable ? ['docStatus', 'amendedFromId'] : []),
      ...(options.write
        ? Object.keys(resource.fields)
        : (resource.serialize ?? [...resource.list, ...resource.show])),
      ...Object.keys(resource.fields).filter((k) =>
        ['belongsTo', 'user'].includes(resource.fields[k].type)
      ),
      ...(options.extra ?? []),
      ...conditionFields(ability, resource),
    ]),
  ].filter(
    (key) =>
      key !== 'orgPath' && !['hasMany', 'manyToMany'].includes(resource.fields[key]?.type ?? '')
  )
}
const rowKeys = new WeakMap<Resource, [key: string, column: string][]>()
/** Record keys and their columns for a resource, computed once per definition. */
function keysOf(resource: Resource) {
  let keys = rowKeys.get(resource)
  if (!keys) {
    keys = [
      ...standard,
      'orgUnitId',
      'version',
      'docStatus',
      'amendedFromId',
      'orgPath',
      ...Object.keys(resource.fields),
    ].map((key) => [key, resource.fields[key]?.column ?? columnName(key)])
    rowKeys.set(resource, keys)
  }
  return keys
}
export function fromRow(row: RecordData, resource: Resource) {
  const result: RecordData = {}
  for (const [key, column] of keysOf(resource)) {
    if (column in row) {
      const value = row[column]
      result[key] =
        value instanceof Date
          ? resource.fields[key]?.type === 'date'
            ? // pg parses DATE as local midnight. Preserve its calendar day;
              // converting to UTC first shifts it in positive-offset time zones.
              `${String(value.getFullYear()).padStart(4, '0')}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
            : value.toISOString()
          : value
    }
  }
  return result
}
export function jsonValue(value: unknown): JsonValue {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(jsonValue)
  if (typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, jsonValue(entry)]))
  throw new Error('Non-serializable resource value')
}
export function serialize(
  resource: Resource,
  record: RecordData,
  ability: AdulaAbility,
  actor: Actor
): SerializedRecord {
  const result: SerializedRecord = { id: jsonValue(record.id) }
  const fields = resource.serialize ?? [...new Set([...resource.list, ...resource.show])]
  for (const key of fields) {
    const minimum = Math.max(
      resource.fields[key]?.permissionLevel ?? 0,
      resource.hidden?.includes(key) ? 1 : 0
    )
    if (
      actor.permissionLevel >= minimum &&
      ability.can('view', subject(resource.name, record), key) &&
      key in record
    )
      result[key] = jsonValue(record[key])
  }
  if (resource.version) result.version = jsonValue(record.version)
  if (resource.submittable) result.docStatus = jsonValue(record.docStatus)
  if (resource.scoped) result.orgUnitId = jsonValue(record.orgUnitId)
  return result
}
export function writableInput(resource: Resource, input: RecordData) {
  const allowed = new Set([
    ...resource.form,
    ...(resource.scoped && !resource.scope ? ['orgUnitId'] : []),
    ...(resource.version ? ['version'] : []),
  ])
  for (const key of Object.keys(input))
    if (!allowed.has(key))
      throw new AdulaError(422, 'E_FIELD_NOT_WRITABLE', `Field is not writable: ${key}`)
  return Object.fromEntries(Object.entries(input).filter(([key]) => resource.form.includes(key)))
}

/**
 * Values module code may write through ResourceService.systemSave: every stored field
 * except sequences and inline children, plus the organization unit when it is not inherited.
 */
export function systemInput(resource: Resource, input: RecordData) {
  for (const key of Object.keys(input)) {
    const field = resource.fields[key]
    const unit = key === 'orgUnitId' && resource.scoped && !resource.scope
    if (!unit && (!field || field.type === 'hasMany' || field.sequence))
      throw new AdulaError(422, 'E_FIELD_NOT_WRITABLE', `Field is not writable: ${key}`)
  }
  return Object.fromEntries(Object.entries(input).filter(([key]) => key in resource.fields))
}
