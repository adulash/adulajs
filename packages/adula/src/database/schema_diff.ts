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
  /**
   * Field columns that are NOT NULL while the definition lets them be empty (for example
   * a required field that gained `visibleWhen`). Only this relaxing direction is reported:
   * NOT NULL is never added automatically.
   */
  notNullColumns: string[]
  missingUnique: ResourceUniqueIndex[]
  /**
   * Unique indexes of a submittable table whose predicate still counts cancelled
   * documents (created before cancelled documents were excluded): `index` is the live
   * index name, `expected` the index the definition wants instead.
   */
  staleUnique: { index: string; expected: ResourceUniqueIndex }[]
  missingJoinTables: ResourceJoinTable[]
}

/** varchar(n) lengths may be widened by hand; only the base type is compared. */
const comparable = (type: string) => type.replace(/^character varying\(\d+\)$/, 'character varying')

async function liveColumns(db: Knex, table: string) {
  const result = await db.raw(
    `SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type,
            a.attnotnull AS not_null
       FROM pg_attribute a
      WHERE a.attrelid = to_regclass(?) AND a.attnum > 0 AND NOT a.attisdropped`,
    [table]
  )
  return new Map<string, { type: string; notNull: boolean }>(
    result.rows.map((row: { name: string; type: string; not_null: boolean }) => [
      row.name,
      { type: row.type, notNull: row.not_null },
    ])
  )
}

type LiveUniqueIndex = { name: string; predicate: string; key: string }

async function liveUniqueIndexes(db: Knex, table: string): Promise<LiveUniqueIndex[]> {
  const result = await db.raw(
    `SELECT i.relname AS name, pg_get_expr(x.indpred, x.indrelid) AS predicate,
            array_agg(a.attname::text ORDER BY k.ord) AS columns
       FROM pg_index x
       JOIN pg_class i ON i.oid = x.indexrelid
       CROSS JOIN LATERAL unnest(x.indkey) WITH ORDINALITY AS k(attnum, ord)
       JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = k.attnum
      WHERE x.indrelid = to_regclass(?) AND x.indisunique
      GROUP BY x.indexrelid, i.relname, x.indpred, x.indrelid`,
    [table]
  )
  return result.rows.map((row: { name: string; predicate: string | null; columns: string[] }) => ({
    name: row.name,
    predicate: row.predicate ?? '',
    key: [...row.columns].sort().join(','),
  }))
}

async function exists(db: Knex, table: string) {
  const result = await db.raw('SELECT to_regclass(?) IS NOT NULL AS present', [table])
  return Boolean(result.rows[0]?.present)
}

/**
 * Compares the live table (resolved through the connection's search_path) with what the
 * definition expects: missing columns, different types, NOT NULL columns the definition
 * lets be empty, missing unique indexes (by column set, whatever their name), unique
 * indexes that still count cancelled documents and missing join tables. Nothing is changed.
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
    notNullColumns: [],
    missingUnique: [],
    staleUnique: [],
    missingJoinTables: [],
  }
  if (!(await exists(db, expected.table))) return { ...drift, missingTable: true }
  const columns = await liveColumns(db, expected.table)
  for (const column of expected.columns) {
    const actual = columns.get(column.name)
    if (actual === undefined) {
      drift.missingColumns.push(column)
      continue
    }
    if (comparable(actual.type) !== comparable(column.type))
      drift.wrongTypes.push({ column: column.name, expected: column.type, actual: actual.type })
    if (column.field !== null && column.nullable && actual.notNull)
      drift.notNullColumns.push(column.name)
  }
  const unique = await liveUniqueIndexes(db, expected.table)
  for (const index of expected.unique) {
    const key = [...index.columns].sort().join(',')
    const matches = unique.filter((live) => live.key === key)
    if (!matches.length) drift.missingUnique.push(index)
    else if (index.excludeCancelled)
      // Only AdulaJS's own partial indexes over live rows are recreated; a hand-made
      // index or constraint without that predicate is left to its author.
      for (const live of matches)
        if (/\bdeleted_at IS NULL\b/.test(live.predicate) && !/\bdoc_status\b/.test(live.predicate))
          drift.staleUnique.push({ index: live.name, expected: index })
  }
  for (const join of expected.joinTables)
    if (!(await exists(db, join.table))) drift.missingJoinTables.push(join)
  return drift
}

/** Whether a drift needs nothing. */
export function inSync(drift: SchemaDrift) {
  return !drift.wrongTypes.length && !migratable(drift) && !drift.missingTable
}

/** Whether adula:resource:migration has something to write for a drift. */
export function migratable(drift: SchemaDrift) {
  return (
    !drift.missingTable &&
    Boolean(
      drift.missingColumns.length ||
      drift.notNullColumns.length ||
      drift.missingUnique.length ||
      drift.staleUnique.length ||
      drift.missingJoinTables.length
    )
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
    ...drift.notNullColumns.map(
      (column) =>
        `${drift.table}.${column}: column is NOT NULL, but the definition lets it be empty (optional or visibleWhen)`
    ),
    ...drift.missingUnique.map(
      (index) => `${drift.table}: unique index on (${index.columns.join(', ')}) is missing`
    ),
    ...drift.staleUnique.map(
      (entry) =>
        `${drift.table}: unique index ${entry.index} on (${entry.expected.columns.join(', ')}) still counts cancelled documents`
    ),
    ...drift.missingJoinTables.map(
      (join) => `${join.table}: join table of ${drift.table}.${join.field} is missing`
    ),
  ]
}

/**
 * The migration content for a drift: snapshots of the fields whose column or join table
 * is missing, the missing unique indexes not created with those fields, and the relaxing
 * changes (NOT NULL dropped, unique indexes recreated without cancelled documents). Wrong
 * types are never changed and NOT NULL is never added automatically; they need a
 * hand-written migration.
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
  const recreateUnique = drift.staleUnique.map((entry) => ({
    index: entry.index,
    columns: entry.expected.columns,
  }))
  return {
    ...(drift.notNullColumns.length ? { dropNotNull: [...drift.notNullColumns] } : {}),
    ...(Object.keys(fields).length ? { fields } : {}),
    ...(unique.length ? { unique } : {}),
    ...(recreateUnique.length ? { recreateUnique } : {}),
  }
}

/** The source of a migration that applies `addition` with alterResourceTable. */
export function additionMigrationSource(name: string, addition: ResourceAddition) {
  return `import { BaseSchema } from '@adonisjs/lucid/schema'
import { alterResourceTable } from 'adula'

// Generated by \`node ace adula:resource:migration ${name}\`: what the database lacked and
// relaxing changes only (NOT NULL dropped, unique indexes no longer counting cancelled documents).
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
