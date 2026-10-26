import type { Knex } from 'knex'
import type { Field, Resource } from '../resource/types.js'
import {
  resourceSchema,
  type ResourceAddition,
  type ResourceColumn,
  type ResourceJoinTable,
  type ResourceTableDefinition,
  type ResourceUniqueIndex,
} from './schema.js'
import { fieldSnapshot } from '../commands/snapshot.js'

/** What the live database lacks or holds differently from a definition's resourceSchema. */
export type SchemaDrift = {
  table: string
  /** The table itself does not exist (its create-migration has not run). */
  missingTable: boolean
  missingColumns: ResourceColumn[]
  /** Columns whose PostgreSQL type differs (varchar lengths are not compared). */
  wrongTypes: { column: string; expected: string; actual: string }[]
  missingUnique: ResourceUniqueIndex[]
  missingJoinTables: ResourceJoinTable[]
}

/** varchar(n) lengths may be widened by hand; only the base type is compared. */
const comparable = (type: string) => type.replace(/^character varying\(\d+\)$/, 'character varying')

async function liveColumns(db: Knex, table: string) {
  const result = await db.raw(
    `SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type
       FROM pg_attribute a
      WHERE a.attrelid = to_regclass(?) AND a.attnum > 0 AND NOT a.attisdropped`,
    [table]
  )
  return new Map<string, string>(
    result.rows.map((row: { name: string; type: string }) => [row.name, row.type])
  )
}

async function liveUniqueIndexes(db: Knex, table: string) {
  const result = await db.raw(
    `SELECT array_agg(a.attname::text ORDER BY k.ord) AS columns
       FROM pg_index x
       CROSS JOIN LATERAL unnest(x.indkey) WITH ORDINALITY AS k(attnum, ord)
       JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = k.attnum
      WHERE x.indrelid = to_regclass(?) AND x.indisunique
      GROUP BY x.indexrelid`,
    [table]
  )
  return result.rows.map((row: { columns: string[] }) => [...row.columns].sort().join(','))
}

async function exists(db: Knex, table: string) {
  const result = await db.raw('SELECT to_regclass(?) IS NOT NULL AS present', [table])
  return Boolean(result.rows[0]?.present)
}

/**
 * Compares the live table (resolved through the connection's search_path) with what the
 * definition expects: missing columns, different types, missing unique indexes (by
 * column set, whatever their name) and missing join tables. Nothing is changed.
 */
export async function schemaDrift(
  db: Knex,
  resource: ResourceTableDefinition
): Promise<SchemaDrift> {
  const expected = resourceSchema(resource)
  const drift: SchemaDrift = {
    table: expected.table,
    missingTable: false,
    missingColumns: [],
    wrongTypes: [],
    missingUnique: [],
    missingJoinTables: [],
  }
  if (!(await exists(db, expected.table))) return { ...drift, missingTable: true }
  const columns = await liveColumns(db, expected.table)
  for (const column of expected.columns) {
    const actual = columns.get(column.name)
    if (actual === undefined) drift.missingColumns.push(column)
    else if (comparable(actual) !== comparable(column.type))
      drift.wrongTypes.push({ column: column.name, expected: column.type, actual })
  }
  const unique = new Set(await liveUniqueIndexes(db, expected.table))
  drift.missingUnique = expected.unique.filter(
    (index) => !unique.has([...index.columns].sort().join(','))
  )
  for (const join of expected.joinTables)
    if (!(await exists(db, join.table))) drift.missingJoinTables.push(join)
  return drift
}

/** Whether a drift needs nothing. */
export function inSync(drift: SchemaDrift) {
  return (
    !drift.missingTable &&
    !drift.missingColumns.length &&
    !drift.wrongTypes.length &&
    !drift.missingUnique.length &&
    !drift.missingJoinTables.length
  )
}

/** One line per difference, for adula:doctor and adula:resource:migration. */
export function describeDrift(drift: SchemaDrift): string[] {
  if (drift.missingTable) return [`${drift.table}: table is missing`]
  return [
    ...drift.missingColumns.map((column) => `${drift.table}.${column.name}: column is missing`),
    ...drift.wrongTypes.map(
      (entry) =>
        `${drift.table}.${entry.column}: type is ${entry.actual}, expected ${entry.expected}`
    ),
    ...drift.missingUnique.map(
      (index) => `${drift.table}: unique index on (${index.columns.join(', ')}) is missing`
    ),
    ...drift.missingJoinTables.map(
      (join) => `${join.table}: join table of ${drift.table}.${join.field} is missing`
    ),
  ]
}

/**
 * The additive migration content for a drift: snapshots of the fields whose column or
 * join table is missing, and the missing unique indexes not created with those fields.
 * Wrong types are never changed automatically; they need a hand-written migration.
 */
export function resourceAddition(
  resource: Pick<Resource, 'fields'>,
  drift: SchemaDrift
): ResourceAddition {
  const fields: Record<string, Field> = {}
  for (const column of drift.missingColumns)
    if (column.field) fields[column.field] = fieldSnapshot(resource.fields[column.field])
  for (const join of drift.missingJoinTables)
    fields[join.field] = fieldSnapshot(resource.fields[join.field])
  const unique = drift.missingUnique
    .filter((index) => !(index.fields.length === 1 && index.fields[0] in fields))
    .map((index) => index.columns)
  return {
    ...(Object.keys(fields).length ? { fields } : {}),
    ...(unique.length ? { unique } : {}),
  }
}

/** The source of a migration that applies `addition` with alterResourceTable. */
export function additionMigrationSource(name: string, addition: ResourceAddition) {
  return `import { BaseSchema } from '@adonisjs/lucid/schema'
import { alterResourceTable } from 'adula'

// Generated by \`node ace adula:resource:migration ${name}\`: only what the database lacked.
// Immutable once it has run; later definition changes get a new migration.
export default class extends BaseSchema {
  async up() {
    await alterResourceTable(this.db.getWriteClient(), '${name}', ${JSON.stringify(
      addition,
      null,
      2
    )
      .split('\n')
      .join('\n    ')})
  }
  async down() {
    throw new Error('Use an expand/contract migration or restore a backup')
  }
}
`
}
