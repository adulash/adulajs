import type { Scalar, RecordData, Resource } from '../resource/types.js'
import { columnName } from '../resource/define_resource.js'

export type Operator = '$eq' | '$ne' | '$in' | '$lt' | '$gt' | '$like'
export type Conditions = Record<string, Scalar | Partial<Record<Operator, Scalar | Scalar[]>>>
export type Predicate = { field: string; operator: Operator; value: Scalar | Scalar[] }
/**
 * Role rule operand replaced by the signed-in user's id when the actor is loaded
 * (for example `{ createdBy: '$actor.id' }`). It is bound as a query parameter.
 */
export const ACTOR_ID = '$actor.id'

/**
 * Replaces ACTOR_ID operands with the actor's id; other values are returned unchanged.
 * With `accepts`, only the fields it accepts are resolved: a placeholder left on another
 * field makes buildAbility refuse the rule instead of comparing an id with text.
 */
export function resolveActorConditions(
  conditions: Conditions | undefined,
  actorId: number,
  accepts?: (field: string) => boolean
): Conditions | undefined {
  if (!conditions || typeof conditions !== 'object' || Array.isArray(conditions)) return conditions
  const resolve = (value: unknown): unknown =>
    value === ACTOR_ID ? actorId : Array.isArray(value) ? value.map(resolve) : value
  return Object.fromEntries(
    Object.entries(conditions).map(([field, condition]) => [
      field,
      accepts && !accepts(field)
        ? condition
        : condition !== null && typeof condition === 'object' && !Array.isArray(condition)
          ? Object.fromEntries(
              Object.entries(condition).map(([operator, value]) => [operator, resolve(value)])
            )
          : resolve(condition),
    ])
  ) as Conditions
}

/** Fields whose conditions may name the current user: user fields, createdBy and updatedBy. */
export function actorConditionField(
  resource: Pick<Resource, 'fields'> | undefined,
  field: string
): boolean {
  return (
    resource !== undefined &&
    (field === 'createdBy' || field === 'updatedBy' || resource.fields[field]?.type === 'user')
  )
}

/** Whether a condition object uses the ACTOR_ID placeholder as an operand. */
export function usesActor(conditions: Conditions | undefined | null): boolean {
  const found = (value: unknown): boolean =>
    value === ACTOR_ID ||
    (Array.isArray(value)
      ? value.some(found)
      : value !== null && typeof value === 'object' && Object.values(value).some(found))
  return found(conditions ?? {})
}
const operators = new Set(['$eq', '$ne', '$in', '$lt', '$gt', '$like'])
const scalar = (v: unknown): v is Scalar =>
  v === null ||
  ['string', 'boolean'].includes(typeof v) ||
  (typeof v === 'number' && Number.isFinite(v))

export function predicates(conditions: Conditions = {}, fields?: Set<string>): Predicate[] {
  if (!conditions || Array.isArray(conditions) || typeof conditions !== 'object')
    throw new Error('Conditions must be an object')
  return Object.entries(conditions).flatMap(([field, condition]) => {
    columnName(field)
    if (fields && !fields.has(field)) throw new Error(`Unknown condition field: ${field}`)
    const ops = scalar(condition) ? { $eq: condition } : condition
    if (!ops || Array.isArray(ops) || typeof ops !== 'object' || !Object.keys(ops).length)
      throw new Error(`Invalid condition: ${field}`)
    return Object.entries(ops).map(([operator, value]) => {
      if (!operators.has(operator)) throw new Error(`Unsupported condition operator: ${operator}`)
      if (operator === '$in' ? !Array.isArray(value) || !value.every(scalar) : !scalar(value))
        throw new Error(`Invalid operand: ${operator}`)
      if (operator === '$like' && typeof value !== 'string')
        throw new Error('$like requires a string')
      if (['$lt', '$gt'].includes(operator) && !['string', 'number'].includes(typeof value))
        throw new Error(`${operator} requires a number or string`)
      return { field, operator: operator as Operator, value: value as Scalar | Scalar[] }
    })
  })
}

// SQL LIKE semantics: % and _ are wildcards, backslash is a literal character.
export function likePattern(value: string) {
  return new RegExp(
    `^${[...value].map((c) => (c === '%' ? '[\\s\\S]*' : c === '_' ? '[\\s\\S]' : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('')}$`,
    'u'
  )
}

/**
 * Compares two decimal strings by value (-1, 0, 1), or undefined when either is not a
 * plain decimal string. Fractions are aligned, so '12.5' equals '12.50'.
 */
export function decimalCompare(left: unknown, right: unknown): -1 | 0 | 1 | undefined {
  const pattern = /^(-?)(\d+)(?:\.(\d+))?$/
  const a = typeof left === 'string' ? pattern.exec(left) : null
  const b = typeof right === 'string' ? pattern.exec(right) : null
  if (!a || !b) return undefined
  const digits = Math.max(a[3]?.length ?? 0, b[3]?.length ?? 0)
  const scaled = (match: RegExpExecArray) =>
    BigInt(`${match[1]}${match[2]}${(match[3] ?? '').padEnd(digits, '0')}`)
  const x = scaled(a)
  const y = scaled(b)
  return x < y ? -1 : x > y ? 1 : 0
}

// This matcher is used exclusively by CASL. SQL compilation shares the validated AST.
export function conditionsMatcher(
  conditions: Conditions,
  schemas: readonly Pick<Resource, 'name' | 'fields'>[] = []
) {
  const parts = predicates(conditions)
  return (record: RecordData) =>
    parts.every(({ field, operator, value }) => {
      const actual = record[field] ?? null
      const type = schemas.find((schema) => schema.name === record.__caslSubjectType__)?.fields[
        field
      ]?.type
      const compare = () => {
        // Decimals compare by value like PostgreSQL numeric, never as text ('9.5' < '10').
        if (type === 'decimal' || type === 'percent') return decimalCompare(actual, value)
        if (type === 'money') {
          if (
            typeof actual !== 'string' ||
            typeof value !== 'string' ||
            !/^(0|-?[1-9]\d*)$/.test(actual) ||
            !/^(0|-?[1-9]\d*)$/.test(value)
          )
            return undefined
          const left = BigInt(actual)
          const right = BigInt(value)
          return left < right ? -1 : left > right ? 1 : 0
        }
        if (typeof actual !== typeof value || actual === null) return undefined
        if (typeof actual === 'string' && typeof value === 'string') {
          const left = [...actual].map((point) => point.codePointAt(0)!)
          const right = [...value].map((point) => point.codePointAt(0)!)
          for (let index = 0; index < Math.min(left.length, right.length); index++)
            if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1
          return Math.sign(left.length - right.length)
        }
        return (actual as number) < (value as number)
          ? -1
          : (actual as number) > (value as number)
            ? 1
            : 0
      }
      const decimal = type === 'decimal' || type === 'percent'
      const same = (operand: unknown) =>
        decimal && actual !== null && operand !== null
          ? decimalCompare(actual, operand) === 0
          : actual === operand
      switch (operator) {
        case '$eq':
          return same(value)
        case '$ne':
          return !same(value)
        case '$in':
          return (value as Scalar[]).some(same)
        case '$lt':
          return compare() === -1
        case '$gt':
          return compare() === 1
        case '$like':
          return typeof actual === 'string' && likePattern(value as string).test(actual)
      }
    })
}
