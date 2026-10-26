import type { Knex } from 'knex'
import type { AdulaAbility, Actor } from './ability.js'
import { abilitySchemas } from './ability.js'
import { predicates, usesActor, type Conditions } from './conditions.js'
import type { Resource } from '../resource/types.js'
import { columnName } from '../resource/define_resource.js'
import {
  canonicalDate,
  canonicalDecimal,
  canonicalMoney,
  decimalShape,
} from '../resource/values.js'

export type Sql = { text: string; bindings: Knex.RawBinding[] }
export function conditionSql(conditions: Conditions | undefined, resource: Resource): Sql {
  const allowed = new Set([
    ...Object.keys(resource.fields),
    'id',
    'orgUnitId',
    'createdBy',
    'updatedBy',
    'docStatus',
    'version',
    'orgPath',
  ])
  const parts = predicates(conditions, allowed)
  // The current user is bound as an integer; an unresolved placeholder must not reach SQL.
  if (usesActor(conditions))
    throw new Error('Rule conditions use $actor.id; resolve them with resolveActorConditions')
  const bindings: Knex.RawBinding[] = []
  const text = parts
    .map(({ field, operator, value }) => {
      const column =
        field === 'orgPath' ? 'ou.path' : `r.${resource.fields[field]?.column ?? columnName(field)}`
      if (['hasMany', 'manyToMany', 'multiSelect'].includes(resource.fields[field]?.type ?? ''))
        throw new Error('Conditions on collections are unsupported')
      const type = resource.fields[field]?.type
      if (type === 'json' || type === 'attachment')
        throw new Error(`Conditions on ${type} fields require a typed adapter`)
      const expected =
        ['id', 'orgUnitId', 'createdBy', 'updatedBy', 'version', 'docStatus'].includes(field) ||
        type === 'integer' ||
        type === 'belongsTo' ||
        type === 'user'
          ? 'number'
          : type === 'boolean'
            ? 'boolean'
            : 'string'
      for (const operand of Array.isArray(value) ? value : [value]) {
        const operandType = typeof operand
        if (operand !== null && operandType !== expected)
          throw new Error(`Condition type mismatch for ${field}: expected ${expected}`)
        if (typeof operand === 'number' && !Number.isSafeInteger(operand))
          throw new Error('Integer conditions require safe integers')
        if (type === 'money' && operand !== null && !canonicalMoney(operand))
          throw new Error('Money conditions require canonical integer strings')
        if ((type === 'decimal' || type === 'percent') && operand !== null) {
          const { precision, scale } = decimalShape(resource.fields[field] as never)
          let canonical: string | undefined
          try {
            canonical = canonicalDecimal(operand, precision, scale)
          } catch {}
          // The stored form ("12.50"), so in-memory equality agrees with PostgreSQL.
          if (canonical !== operand)
            throw new Error(
              `Decimal conditions require canonical decimal strings with ${scale} decimals`
            )
        }
        if ((type === 'date' || type === 'datetime') && operand !== null) {
          if (!canonicalDate(operand, type))
            throw new Error('Date conditions require a valid ISO date or canonical UTC timestamp')
          if (operator === '$like') throw new Error('LIKE is supported on text fields only')
        }
      }
      if (operator === '$in') {
        const values = value as (string | number | boolean | null)[]
        if (!values.length) return 'FALSE'
        bindings.push(column, ...values.filter((v) => v !== null))
        const nonNull = values.filter((v) => v !== null)
        let clause = nonNull.length
          ? `COALESCE(?? IN (${nonNull.map(() => '?').join(',')}), FALSE)`
          : '?? IS NULL'
        if (nonNull.length && values.includes(null)) {
          bindings.push(column)
          clause = `(${clause} OR ?? IS NULL)`
        }
        return clause
      }
      bindings.push(column)
      if (operator === '$eq' || operator === '$ne') {
        bindings.push(value as Knex.RawBinding)
        return operator === '$eq' ? '?? IS NOT DISTINCT FROM ?' : '?? IS DISTINCT FROM ?'
      }
      bindings.push(value as Knex.RawBinding)
      if (operator === '$like') return "COALESCE(CAST(?? AS text) LIKE ? ESCAPE '', FALSE)"
      const collation = ['string', 'text', 'lookup'].includes(type ?? '') ? ' COLLATE "C"' : ''
      return `COALESCE(??${collation} ${operator === '$lt' ? '<' : '>'} ?, FALSE)`
    })
    .join(' AND ')
  return { text: text || 'TRUE', bindings }
}

export function authorizationSql(
  ability: AdulaAbility,
  action: string,
  resource: Resource,
  field?: string
): Sql {
  // CASL rulesFor returns highest-priority rules first. CASE preserves last-rule-wins.
  const rules = ability
    .rulesFor(action, resource.name, field)
    .filter((rule) => !(field === undefined && rule.inverted && rule.fields))
  const bindings: Knex.RawBinding[] = []
  const branches = rules.map((rule) => {
    for (const predicate of predicates(rule.conditions)) {
      if (
        ['money', 'decimal', 'percent'].includes(resource.fields[predicate.field]?.type ?? '') &&
        ['$lt', '$gt'].includes(predicate.operator) &&
        !abilitySchemas
          .get(ability)
          ?.some(
            (schema) =>
              schema.name === resource.name &&
              schema.fields[predicate.field]?.type === resource.fields[predicate.field]?.type
          )
      )
        throw new Error(
          'Ordered money and decimal rules require buildAbility(rules, resourceSchemas)'
        )
    }
    const where = conditionSql(rule.conditions, resource)
    bindings.push(...where.bindings)
    return `WHEN (${where.text}) THEN ${rule.inverted ? 'FALSE' : 'TRUE'}`
  })
  return {
    text: branches.length ? `(CASE ${branches.join(' ')} ELSE FALSE END)` : 'FALSE',
    bindings,
  }
}

export function accessibleBy(
  query: Knex.QueryBuilder,
  ability: AdulaAbility,
  actor: Actor,
  action: string,
  resource: Resource
) {
  const sql = authorizationSql(ability, action, resource)
  query.whereRaw(sql.text, sql.bindings)
  if (resource.scoped) {
    query.join('org_units as ou', 'ou.id', 'r.org_unit_id')
    query.where((scope) => {
      if (!actor.orgPaths.length) scope.whereRaw('FALSE')
      for (const path of actor.orgPaths) scope.orWhereRaw('ou.path <@ ?::ltree', [path])
    })
  }
  return query
}
