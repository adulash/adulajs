import type { Knex } from 'knex'
import type { Field, Resource, Scalar } from '../resource/types.js'
import { identifier, columnName, joinTable } from '../resource/define_resource.js'
import { decimalShape, TEXT_LIMITS } from '../resource/values.js'

export async function createCoreSchema(db: Knex) {
  await db.raw('CREATE EXTENSION IF NOT EXISTS ltree WITH SCHEMA public')
  await db.schema.createTable('org_units', (t) => {
    t.increments('id')
    t.integer('parent_id').references('id').inTable('org_units').onDelete('RESTRICT')
    t.string('name').notNullable()
    t.string('type').notNullable()
    t.specificType('path', 'ltree').notNullable().unique()
  })
  await db.raw('CREATE INDEX org_units_path_gist ON org_units USING gist(path)')
  await db.schema.createTable('roles', (t) => {
    t.increments('id')
    t.string('name').notNullable().unique()
    t.integer('permission_level').notNullable().defaultTo(0)
  })
  await db.schema.createTable('role_rules', (t) => {
    t.increments('id')
    t.integer('role_id').notNullable().references('id').inTable('roles').onDelete('CASCADE').index()
    t.string('subject').notNullable()
    t.string('action').notNullable()
    t.jsonb('conditions')
    t.jsonb('fields')
    t.boolean('inverted').notNullable().defaultTo(false)
  })
  for (const name of ['user_roles', 'user_org_units']) {
    await db.schema.createTable(name, (t) => {
      t.increments('id')
      t.integer('user_id')
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('RESTRICT')
        .index()
      t.integer('org_unit_id').references('id').inTable('org_units').onDelete('RESTRICT').index()
      if (name === 'user_roles')
        t.integer('role_id')
          .notNullable()
          .references('id')
          .inTable('roles')
          .onDelete('RESTRICT')
          .index()
      else t.unique(['user_id', 'org_unit_id'])
    })
  }
  await db.schema.createTable('authorization_revision', (t) => {
    t.integer('id').primary()
    t.bigInteger('version').notNullable()
  })
  await db('authorization_revision').insert({ id: 1, version: 1 })
  await db.raw(
    `CREATE FUNCTION adula_bump_auth_revision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN UPDATE authorization_revision SET version=version+1 WHERE id=1; RETURN NULL; END $$`
  )
  for (const table of ['roles', 'role_rules', 'user_roles', 'user_org_units', 'org_units'])
    await db.raw(
      `CREATE TRIGGER adula_invalidate_auth AFTER INSERT OR UPDATE OR DELETE ON ${table} FOR EACH STATEMENT EXECUTE FUNCTION adula_bump_auth_revision()`
    )
  await db.schema.createTable('settings', (t) => {
    t.increments('id')
    t.string('key').notNullable()
    t.string('scope').notNullable().defaultTo('system')
    t.string('scope_id').notNullable().defaultTo('0')
    t.jsonb('value').notNullable()
    t.unique(['key', 'scope', 'scope_id'])
  })
  await db.schema.createTable('lookups', (t) => {
    t.increments('id')
    t.string('group').notNullable()
    t.string('key').notNullable()
    t.string('label_ar').notNullable()
    t.string('label_en').notNullable()
    t.integer('sort').defaultTo(0)
    t.boolean('active').defaultTo(true)
    t.unique(['group', 'key'])
  })
  await db.schema.createTable('sequences', (t) => {
    t.string('key').primary()
    t.bigInteger('value').notNullable().defaultTo(0)
  })
  await db.schema.createTable('activities', (t) => {
    t.bigIncrements('id')
    t.string('resource').notNullable()
    t.integer('record_id').notNullable()
    t.integer('actor_id').notNullable().references('id').inTable('users')
    t.string('action').notNullable()
    t.jsonb('changes').notNullable()
    t.timestamp('created_at', { useTz: true }).defaultTo(db.fn.now())
    t.index(['resource', 'record_id'])
  })
  await db.schema.createTable('outbox', (t) => {
    t.uuid('id').primary()
    t.string('event').notNullable()
    t.jsonb('payload').notNullable()
    t.timestamp('created_at', { useTz: true }).defaultTo(db.fn.now())
    t.timestamp('published_at', { useTz: true })
    t.integer('attempts').notNullable().defaultTo(0)
    t.text('last_error')
    t.index(['published_at', 'created_at'])
  })
  await db.schema.createTable('processed_events', (t) => {
    t.uuid('event_id').notNullable()
    t.string('listener').notNullable()
    t.timestamp('processed_at', { useTz: true }).defaultTo(db.fn.now())
    t.primary(['event_id', 'listener'])
  })
  await db.schema.createTable('notifications', (t) => {
    t.increments('id')
    t.integer('user_id').notNullable().references('id').inTable('users').index()
    t.string('title').notNullable()
    t.text('body').notNullable()
    t.timestamp('read_at', { useTz: true })
    t.timestamp('created_at', { useTz: true }).defaultTo(db.fn.now())
  })
  await db.schema.createTable('workflow_runs', (t) => {
    t.uuid('id').primary()
    t.string('resource').notNullable()
    t.integer('record_id').notNullable()
    t.string('definition').notNullable()
    t.integer('definition_version').notNullable()
    t.jsonb('snapshot').notNullable()
    t.string('status').notNullable()
    t.timestamp('created_at', { useTz: true }).defaultTo(db.fn.now())
  })
}

/** Attachment metadata lives in one table so ownership, restore drills and disk moves see every file. */
export async function createAttachmentsSchema(db: Knex) {
  await db.schema.createTable('attachments', (t) => {
    t.increments('id')
    t.string('disk').notNullable()
    t.string('path', 1024).notNullable()
    t.string('name').notNullable()
    t.string('original_name').notNullable()
    t.bigInteger('size').notNullable()
    t.string('mime_type').notNullable()
    t.string('extname').notNullable()
    t.jsonb('data').notNullable()
    t.integer('uploaded_by')
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('RESTRICT')
      .index()
    t.integer('org_unit_id').references('id').inTable('org_units').onDelete('RESTRICT').index()
    t.string('resource')
    t.integer('record_id')
    t.string('field')
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(db.fn.now())
    t.timestamp('deleted_at', { useTz: true })
    t.index(['resource', 'record_id', 'field'])
    t.index(['disk', 'deleted_at'])
  })
}

export async function createSavedViewsSchema(db: Knex) {
  await db.schema.createTable('saved_views', (t) => {
    t.increments('id')
    t.string('resource').notNullable()
    t.string('name').notNullable()
    t.jsonb('query').notNullable()
    t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
    t.boolean('shared').notNullable().defaultTo(false)
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(db.fn.now())
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(db.fn.now())
    t.unique(['user_id', 'resource', 'name'])
    t.index(['resource', 'shared'])
  })
}

/** The definition parts that decide a resource table (what create-migrations embed). */
export type ResourceTableDefinition = Pick<
  Resource,
  'name' | 'scoped' | 'version' | 'submittable' | 'fields'
> & {
  unique?: readonly (readonly string[])[]
}
/** One column of a resource table; `type` is PostgreSQL's format_type() spelling. */
export type ResourceColumn = {
  name: string
  type: string
  nullable: boolean
  /** The column default of a field `default` (scalar types only). */
  default?: Scalar
  /** The referenced table of a foreign key. */
  references?: string
  /** The field key, or null for a standard column. */
  field: string | null
}
/**
 * A partial unique index over these columns: over live rows (`WHERE deleted_at IS NULL`)
 * and, on a submittable resource, also excluding cancelled documents
 * (`AND doc_status <> 2`) so an amended copy may keep the values of its original.
 */
export type ResourceUniqueIndex = {
  name: string
  columns: string[]
  fields: string[]
  /** The predicate also excludes cancelled documents (submittable resources). */
  excludeCancelled: boolean
}
/** The join table of one manyToMany field. */
export type ResourceJoinTable = {
  table: string
  field: string
  /** Column referencing the owner table. */
  owner: string
  /** Column referencing the target table. */
  target: string
  resource: string
}
/** The table shape a definition expects; see resourceSchema(). */
export type ResourceSchema = {
  table: string
  columns: ResourceColumn[]
  unique: ResourceUniqueIndex[]
  joinTables: ResourceJoinTable[]
  /** Columns of the generated search_vector, in order. */
  searchable: string[]
}

/** PostgreSQL limits identifiers to 63 bytes and silently truncates longer index names. */
const indexName = (name: string) => name.slice(0, 63)

/** The column type of one stored field (format_type() spelling), or null when it has none. */
export function fieldColumnType(field: Field): string | null {
  switch (field.type) {
    case 'hasMany':
    case 'manyToMany':
      return null
    case 'belongsTo':
    case 'attachment':
    case 'user':
    case 'integer':
      return 'integer'
    case 'money':
      return 'bigint'
    case 'boolean':
      return 'boolean'
    case 'date':
      return 'date'
    case 'datetime':
      return 'timestamp with time zone'
    case 'json':
    case 'multiSelect':
      return 'jsonb'
    case 'text':
      return 'text'
    case 'decimal':
    case 'percent': {
      const { precision, scale } = decimalShape(field)
      return `numeric(${precision},${scale})`
    }
    default:
      return `character varying(${TEXT_LIMITS[field.type] ?? 255})`
  }
}

/** NOT NULL: required or sequence fields, unless visibleWhen may hide (and clear) them. */
function notNull(field: Field) {
  return Boolean(field.sequence || (field.required && field.visibleWhen === undefined))
}

/** Whether a field `default` becomes the column default (scalars only, not multiSelect). */
function columnDefault(field: Field): Scalar | undefined {
  if (field.default === undefined || field.default === null || Array.isArray(field.default))
    return undefined
  return field.default as Scalar
}

/**
 * The table a definition expects: standard and field columns with their types,
 * nullability and defaults, the partial unique indexes (single fields and the
 * resource's composite `unique`) and the join tables of manyToMany fields.
 * createResourceTable builds it and the `resources.schema` doctor check compares it
 * with the live database.
 */
export function resourceSchema(resource: ResourceTableDefinition): ResourceSchema {
  const table = identifier(resource.name)
  const standard = (name: string, type: string, nullable = false, references?: string) => ({
    name,
    type,
    nullable,
    field: null,
    ...(references ? { references } : {}),
  })
  const columns: ResourceColumn[] = [standard('id', 'integer')]
  if (resource.scoped) columns.push(standard('org_unit_id', 'integer', false, 'org_units'))
  columns.push(
    standard('created_by', 'integer', false, 'users'),
    standard('updated_by', 'integer', false, 'users'),
    standard('created_at', 'timestamp with time zone'),
    standard('updated_at', 'timestamp with time zone'),
    standard('deleted_at', 'timestamp with time zone', true)
  )
  if (resource.version) columns.push(standard('version', 'integer'))
  if (resource.submittable)
    columns.push(
      standard('doc_status', 'smallint'),
      standard('amended_from_id', 'integer', true, table)
    )
  const unique: ResourceUniqueIndex[] = []
  const joinTables: ResourceJoinTable[] = []
  const columnOf = (key: string) =>
    key === 'orgUnitId' ? 'org_unit_id' : (resource.fields[key]?.column ?? columnName(key))
  for (const [key, field] of Object.entries(resource.fields)) {
    if (field.type === 'manyToMany') {
      joinTables.push({ ...joinTable(table, key, field), field: key, resource: field.resource })
      continue
    }
    const type = fieldColumnType(field)
    if (!type) continue
    const name = identifier(field.column ?? columnName(key))
    const fallback = columnDefault(field)
    columns.push({
      name,
      type,
      nullable: !notNull(field),
      field: key,
      ...(fallback === undefined ? {} : { default: fallback }),
      ...(field.type === 'belongsTo'
        ? { references: identifier(field.resource) }
        : field.type === 'attachment'
          ? { references: 'attachments' }
          : field.type === 'user'
            ? { references: 'users' }
            : {}),
    })
    if (field.unique)
      unique.push({
        name: indexName(`${table}_${columnName(key)}_active_unique`),
        columns: [name],
        fields: [key],
        excludeCancelled: Boolean(resource.submittable),
      })
  }
  for (const keys of resource.unique ?? []) {
    const names = keys.map((key) => identifier(columnOf(key)))
    unique.push({
      name: indexName(`${table}_${names.join('_')}_active_unique`),
      columns: names,
      fields: [...keys],
      excludeCancelled: Boolean(resource.submittable),
    })
  }
  return {
    table,
    columns,
    unique,
    joinTables,
    searchable: Object.entries(resource.fields)
      .filter(([, field]) => field.searchable)
      .map(([key, field]) => identifier(field.column ?? columnName(key))),
  }
}

/** Adds one field column to a table builder, as createResourceTable and alterResourceTable do. */
function addFieldColumn(
  t: Knex.CreateTableBuilder | Knex.AlterTableBuilder,
  key: string,
  field: Field,
  options: { alter: boolean }
) {
  const name = field.column ?? columnName(key)
  let column: Knex.ColumnBuilder
  switch (field.type) {
    case 'belongsTo':
      column = t.integer(name)
      column.references('id').inTable(identifier(field.resource)).onDelete('RESTRICT').index()
      break
    case 'attachment':
      column = t.integer(name)
      column.references('id').inTable('attachments').onDelete('RESTRICT').index()
      break
    case 'user':
      column = t.integer(name)
      column.references('id').inTable('users').onDelete('RESTRICT').index()
      break
    case 'integer':
      column = t.integer(name)
      break
    case 'money':
      column = t.bigInteger(name)
      break
    case 'decimal':
    case 'percent': {
      const { precision, scale } = decimalShape(field)
      column = t.decimal(name, precision, scale)
      break
    }
    case 'boolean':
      column = t.boolean(name)
      break
    case 'date':
      column = t.date(name)
      break
    case 'datetime':
      column = t.timestamp(name, { useTz: true })
      break
    case 'json':
    case 'multiSelect':
      column = t.jsonb(name)
      break
    case 'text':
      column = t.text(name)
      break
    case 'email':
    case 'phone':
    case 'url':
    case 'enum':
      column = t.string(name, TEXT_LIMITS[field.type])
      break
    default:
      column = t.string(name)
  }
  const fallback = columnDefault(field)
  if (fallback !== undefined) column.defaultTo(fallback)
  // A column added to a table that may hold rows is NOT NULL only when it has a default.
  if (notNull(field) && (!options.alter || fallback !== undefined)) column.notNullable()
}

/** The predicate of a resource unique index (see ResourceUniqueIndex). */
function uniquePredicate(excludeCancelled: boolean) {
  return excludeCancelled ? 'deleted_at IS NULL AND doc_status <> 2' : 'deleted_at IS NULL'
}

/**
 * Partial unique indexes over live rows and, on submittable tables, documents that are not
 * cancelled (a cancelled original must not block its amended copy). A composite index
 * treats NULLs as equal (PostgreSQL 15+ NULLS NOT DISTINCT): ("A", null) twice is a
 * duplicate, since a combination with an empty member still names one record. A
 * single-field index keeps allowing many NULLs.
 */
async function createUniqueIndexes(
  db: Knex,
  table: string,
  indexes: ResourceUniqueIndex[],
  ifNotExists = false
) {
  for (const index of indexes)
    await db.raw(
      `CREATE UNIQUE INDEX ${ifNotExists ? 'IF NOT EXISTS ' : ''}?? ON ?? (${index.columns
        .map(() => '??')
        .join(
          ', '
        )})${index.columns.length > 1 ? ' NULLS NOT DISTINCT' : ''} WHERE ${uniquePredicate(
        index.excludeCancelled
      )}`,
      [index.name, table, ...index.columns]
    )
}

async function createJoinTables(db: Knex, owner: string, joins: ResourceJoinTable[]) {
  for (const join of joins)
    await db.schema.createTable(join.table, (t) => {
      // Owner rows are soft-deleted, so neither side cascades.
      t.integer(join.owner).notNullable().references('id').inTable(owner).onDelete('RESTRICT')
      t.integer(join.target)
        .notNullable()
        .references('id')
        .inTable(identifier(join.resource))
        .onDelete('RESTRICT')
        .index()
      t.primary([join.owner, join.target])
    })
}

export async function createResourceTable(
  db: Knex,
  resource: ResourceTableDefinition & {
    /**
     * @deprecated The `customFields` resource flag was removed. Kept only so create-migrations
     * generated before the removal still compile and replay unchanged on a new database
     * (migrations are immutable); new definitions cannot set it (`defineResource` refuses it).
     */
    customFields?: boolean
  }
) {
  const shape = resourceSchema(resource)
  const table = shape.table
  await db.schema.createTable(table, (t) => {
    t.increments('id')
    if (resource.scoped)
      t.integer('org_unit_id')
        .notNullable()
        .references('id')
        .inTable('org_units')
        .onDelete('RESTRICT')
        .index()
    for (const name of ['created_by', 'updated_by'])
      t.integer(name).notNullable().references('id').inTable('users').onDelete('RESTRICT').index()
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(db.fn.now())
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(db.fn.now())
    t.timestamp('deleted_at', { useTz: true })
    if (resource.version) t.integer('version').notNullable().defaultTo(1)
    if (resource.submittable) {
      t.smallint('doc_status').notNullable().defaultTo(0)
      t.integer('amended_from_id').references('id').inTable(table).onDelete('RESTRICT').index()
    }
    // Legacy replay only: see the customFields note on the parameter.
    if (resource.customFields) t.jsonb('custom_fields').notNullable().defaultTo('{}')
    for (const [key, field] of Object.entries(resource.fields))
      if (fieldColumnType(field)) addFieldColumn(t, key, field, { alter: false })
    if (resource.scoped) t.index(['org_unit_id', 'deleted_at'])
  })
  await createUniqueIndexes(db, table, shape.unique)
  if (shape.searchable.length) {
    const expression = shape.searchable
      .map((column) => `coalesce("${column}", '')`)
      .join(` || ' ' || `)
    await db.raw(
      `ALTER TABLE "${table}" ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', ${expression})) STORED`
    )
    await db.raw('CREATE INDEX ?? ON ?? USING gin(search_vector)', [`${table}_search_gin`, table])
  }
  await createJoinTables(db, table, shape.joinTables)
}

/**
 * What an additive resource migration changes on an existing table: new field columns
 * (and the join tables of new manyToMany fields), embedded as definition snapshots,
 * partial unique indexes by column name, and two relaxing changes: NOT NULL dropped from
 * columns the definition now lets be empty, and unique indexes recreated so cancelled
 * documents no longer count. Generated by `node ace adula:resource:migration`.
 */
export type ResourceAddition = {
  fields?: Record<string, Field>
  /** Unique indexes over live rows, each a list of column names. */
  unique?: readonly (readonly string[])[]
  /**
   * Columns whose NOT NULL constraint is dropped, for example after `visibleWhen` was
   * added to a required field (a hidden field stores null). Only relaxes: NOT NULL is
   * never added automatically.
   */
  dropNotNull?: readonly string[]
  /**
   * Unique indexes of a submittable table that still count cancelled documents: each is
   * dropped by name and created again over live rows that are not cancelled, so an
   * amended copy can keep the values of its cancelled original. Only relaxes.
   */
  recreateUnique?: readonly { index: string; columns: readonly string[] }[]
}

/** Whether a live table holds submittable documents (it has a doc_status column). */
async function hasDocStatus(db: Knex, table: string) {
  const result = await db.raw(
    `SELECT EXISTS (SELECT 1 FROM pg_attribute
       WHERE attrelid = to_regclass(?) AND attname = 'doc_status' AND NOT attisdropped) AS present`,
    [table]
  )
  return Boolean(result.rows[0]?.present)
}

/**
 * Applies a ResourceAddition: drops NOT NULL from the named columns, adds the columns
 * (NOT NULL only with a default, since the table may hold rows), creates join tables,
 * recreates the named unique indexes with the cancelled-document predicate and creates
 * the new unique indexes (excluding cancelled documents on a submittable table). It never
 * tightens a constraint or drops data, so released migrations replay unchanged. The
 * generated search_vector is not changed: making a field searchable needs a hand-written
 * migration.
 */
export async function alterResourceTable(db: Knex, name: string, addition: ResourceAddition) {
  const table = identifier(name)
  const fields = Object.entries(addition.fields ?? {})
  const columns = fields.filter(([, field]) => fieldColumnType(field))
  const excludeCancelled = await hasDocStatus(db, table)
  for (const column of addition.dropNotNull ?? [])
    await db.raw('ALTER TABLE ?? ALTER COLUMN ?? DROP NOT NULL', [table, identifier(column)])
  if (columns.length)
    await db.schema.alterTable(table, (t) => {
      for (const [key, field] of columns) addFieldColumn(t, key, field, { alter: true })
    })
  await createJoinTables(
    db,
    table,
    fields.flatMap(([key, field]) =>
      field.type === 'manyToMany'
        ? [{ ...joinTable(table, key, field), field: key, resource: field.resource }]
        : []
    )
  )
  const named = (names: readonly string[]): ResourceUniqueIndex => ({
    name: indexName(`${table}_${names.map(identifier).join('_')}_active_unique`),
    columns: [...names],
    fields: [],
    excludeCancelled,
  })
  // Dropped and created in the same migration transaction: the values stay unique among
  // live, non-cancelled rows throughout, and the new predicate only admits more rows.
  for (const stale of addition.recreateUnique ?? []) {
    await db.raw('DROP INDEX IF EXISTS ??', [identifier(stale.index)])
    await createUniqueIndexes(db, table, [named(stale.columns)], true)
  }
  await createUniqueIndexes(db, table, [
    // Added unique fields get the index createResourceTable would have created.
    ...resourceSchema({
      name: table,
      scoped: false,
      submittable: excludeCancelled,
      fields: Object.fromEntries(columns),
    }).unique,
    ...(addition.unique ?? []).map(named),
  ])
}

/** Record collaboration (phase 3): comments with mentions, followers, tags and field history. */
export async function createCollaborationSchema(db: Knex) {
  await db.schema.createTable('comments', (t) => {
    t.bigIncrements('id')
    t.string('resource').notNullable()
    t.integer('record_id').notNullable()
    t.integer('author_id').notNullable().references('id').inTable('users').onDelete('RESTRICT')
    t.text('body').notNullable()
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(db.fn.now())
    t.timestamp('edited_at', { useTz: true })
    t.timestamp('deleted_at', { useTz: true })
    t.index(['resource', 'record_id', 'id'])
  })
  await db.schema.createTable('comment_mentions', (t) => {
    t.bigInteger('comment_id')
      .notNullable()
      .references('id')
      .inTable('comments')
      .onDelete('CASCADE')
    t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
    t.primary(['comment_id', 'user_id'])
    t.index(['user_id'])
  })
  await db.schema.createTable('followers', (t) => {
    t.string('resource').notNullable()
    t.integer('record_id').notNullable()
    t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(db.fn.now())
    t.primary(['resource', 'record_id', 'user_id'])
    t.index(['user_id'])
  })
  await db.schema.createTable('tags', (t) => {
    t.increments('id')
    t.string('name', 60).notNullable().unique()
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(db.fn.now())
  })
  await db.schema.createTable('taggables', (t) => {
    t.integer('tag_id').notNullable().references('id').inTable('tags').onDelete('CASCADE')
    t.string('resource').notNullable()
    t.integer('record_id').notNullable()
    t.primary(['tag_id', 'resource', 'record_id'])
    t.index(['resource', 'record_id'])
  })
  await db.schema.createTable('field_changes', (t) => {
    t.bigIncrements('id')
    t.bigInteger('activity_id')
      .notNullable()
      .references('id')
      .inTable('activities')
      .onDelete('CASCADE')
      .index()
    t.string('resource').notNullable()
    t.integer('record_id').notNullable()
    t.string('field').notNullable()
    t.jsonb('before')
    t.jsonb('after')
    t.index(['resource', 'record_id', 'id'])
  })
}

/** Work assigned to a user on a record; approval steps of workflows reuse it (phase 4). */
export async function createAssignmentsSchema(db: Knex) {
  await db.schema.createTable('assignments', (t) => {
    t.bigIncrements('id')
    t.string('resource').notNullable()
    t.integer('record_id').notNullable()
    t.integer('assignee_id').notNullable().references('id').inTable('users').onDelete('RESTRICT')
    t.integer('assigned_by').references('id').inTable('users').onDelete('RESTRICT')
    t.string('kind', 20).notNullable().defaultTo('task')
    t.string('title', 200).notNullable()
    t.text('note')
    t.date('due_on')
    t.string('status', 20).notNullable().defaultTo('open')
    t.uuid('workflow_run_id')
    t.string('workflow_step', 100)
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(db.fn.now())
    t.timestamp('completed_at', { useTz: true })
    t.integer('completed_by').references('id').inTable('users').onDelete('RESTRICT')
    t.string('outcome', 20)
    t.index(['assignee_id', 'status', 'id'])
    t.index(['resource', 'record_id'])
    t.index(['workflow_run_id'])
  })
}

/**
 * Managed assignments (1.1): opened and closed by module code with the record's state,
 * never completed by hand. The close reason is shown with the closed task.
 */
export async function createManagedAssignmentsSchema(db: Knex) {
  await db.schema.alterTable('assignments', (t) => {
    t.boolean('managed').notNullable().defaultTo(false)
    t.string('close_reason', 500)
  })
}

/**
 * Message templates, notification e-mail delivery state and the realtime signal.
 * The trigger's NOTIFY is delivered only when the inserting transaction commits.
 */
export async function createMessagingSchema(db: Knex) {
  await db.schema.createTable('message_templates', (t) => {
    t.string('key', 100).primary()
    t.string('subject', 255).notNullable()
    t.text('body').notNullable()
    t.boolean('mail').notNullable().defaultTo(false)
    t.integer('updated_by').references('id').inTable('users').onDelete('SET NULL')
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(db.fn.now())
  })
  await db.schema.alterTable('notifications', (t) => {
    t.string('template_key', 100)
    t.string('mail_state', 20)
    t.integer('mail_attempts').notNullable().defaultTo(0)
    t.string('mail_error', 500)
    t.timestamp('mailed_at', { useTz: true })
  })
  await db.raw(
    "CREATE INDEX notifications_mail_pending ON notifications (id) WHERE mail_state = 'pending'"
  )
  await db.raw(
    `CREATE FUNCTION adula_notification_signal() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_notify('adula_notifications', json_build_object('userId', NEW.user_id, 'id', NEW.id)::text); RETURN NULL; END $$`
  )
  await db.raw(
    'CREATE TRIGGER adula_notification_signal AFTER INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION adula_notification_signal()'
  )
}

/** Outgoing webhooks and their delivery log (exactly one row per webhook and event). */
export async function createWebhooksSchema(db: Knex) {
  await db.schema.createTable('webhooks', (t) => {
    t.increments('id')
    t.string('name', 100).notNullable()
    t.string('url', 2000).notNullable()
    t.text('secret').notNullable()
    t.jsonb('events').notNullable()
    t.boolean('active').notNullable().defaultTo(true)
    t.integer('failing').notNullable().defaultTo(0)
    t.integer('created_by').references('id').inTable('users').onDelete('SET NULL')
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(db.fn.now())
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(db.fn.now())
    t.timestamp('last_delivery_at', { useTz: true })
  })
  await db.raw('CREATE INDEX webhooks_events_gin ON webhooks USING gin(events)')
  await db.schema.createTable('webhook_deliveries', (t) => {
    t.uuid('id').primary()
    t.integer('webhook_id').notNullable().references('id').inTable('webhooks').onDelete('CASCADE')
    t.uuid('event_id').notNullable()
    t.string('event').notNullable()
    t.jsonb('payload').notNullable()
    t.string('status', 20).notNullable().defaultTo('pending')
    t.integer('attempts').notNullable().defaultTo(0)
    t.integer('last_status')
    t.string('last_error', 500)
    t.timestamp('next_attempt_at', { useTz: true }).notNullable().defaultTo(db.fn.now())
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(db.fn.now())
    t.timestamp('delivered_at', { useTz: true })
    t.unique(['webhook_id', 'event_id'])
    t.index(['webhook_id', 'created_at'])
  })
  await db.raw(
    "CREATE INDEX webhook_deliveries_due ON webhook_deliveries (next_attempt_at) WHERE status = 'pending'"
  )
}

/** CSV import batches: parsed rows, column mapping, progress and per-row errors. */
export async function createImportsSchema(db: Knex) {
  await db.schema.createTable('import_batches', (t) => {
    t.increments('id')
    t.string('resource').notNullable()
    t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
    t.string('file_name', 200).notNullable()
    t.string('status', 20).notNullable()
    t.jsonb('headers').notNullable()
    t.jsonb('mapping').notNullable()
    t.jsonb('rows').notNullable()
    t.integer('total').notNullable()
    t.integer('processed').notNullable().defaultTo(0)
    t.integer('created').notNullable().defaultTo(0)
    t.integer('failed').notNullable().defaultTo(0)
    t.jsonb('errors').notNullable().defaultTo('[]')
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(db.fn.now())
    t.timestamp('started_at', { useTz: true })
    t.timestamp('finished_at', { useTz: true })
    t.index(['user_id', 'id'])
    t.index(['status'])
  })
}

/**
 * Workflow engine state (phase 4): the submission envelope rows gain execution
 * columns, and every transition is appended to workflow_events.
 */
export async function createWorkflowSchema(db: Knex) {
  await db.schema.alterTable('workflow_runs', (t) => {
    t.string('current_step', 100)
    t.timestamp('wake_at', { useTz: true })
    t.integer('attempts').notNullable().defaultTo(0)
    t.string('last_error', 1000)
    t.string('outcome', 30)
    t.integer('started_by').references('id').inTable('users').onDelete('SET NULL')
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(db.fn.now())
    t.timestamp('completed_at', { useTz: true })
    t.index(['resource', 'record_id'])
  })
  await db.raw("CREATE INDEX workflow_runs_due ON workflow_runs (wake_at) WHERE status = 'running'")
  await db.schema.createTable('workflow_events', (t) => {
    t.bigIncrements('id')
    t.uuid('run_id').notNullable().references('id').inTable('workflow_runs').onDelete('CASCADE')
    t.string('step', 100)
    t.string('event', 50).notNullable()
    t.integer('actor_id').references('id').inTable('users').onDelete('SET NULL')
    t.jsonb('detail').notNullable().defaultTo('{}')
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(db.fn.now())
    t.index(['run_id', 'id'])
  })
}

/**
 * Roles gain a stable key (1.1) that workflows and module defaults address, so an
 * administrator can rename the display name freely. Existing identifier-like names
 * (such as the bootstrap "administrator") become their key.
 */
export async function createRoleKeysSchema(db: Knex) {
  await db.schema.alterTable('roles', (t) => {
    t.string('key', 100).unique()
  })
  await db.raw("UPDATE roles SET key = name WHERE name ~ '^[a-z][a-z0-9_]*$'")
}

/**
 * Notifications may name the record they are about (1.1). Links are authorized when
 * opened, by the record page itself, never when the notification is written.
 */
export async function createNotificationTargetsSchema(db: Knex) {
  await db.schema.alterTable('notifications', (t) => {
    t.string('resource', 100)
    t.integer('record_id')
  })
}

/**
 * Short-lived upload grants (1.1): module code lets one user upload to one attachment field
 * of one record without a role rule. Only the SHA-256 hash of the token is stored.
 */
export async function createUploadGrantsSchema(db: Knex) {
  await db.schema.createTable('upload_grants', (t) => {
    t.increments('id')
    t.string('token_hash', 64).notNullable().unique()
    t.integer('user_id').notNullable().references('users.id').onDelete('CASCADE')
    t.string('resource', 100).notNullable()
    t.integer('record_id').notNullable()
    t.string('field', 100).notNullable()
    t.integer('org_unit_id')
    t.timestamp('expires_at', { useTz: true }).notNullable()
    t.integer('created_by').notNullable()
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(db.fn.now())
    t.index(['expires_at'])
  })
}

/**
 * Signed inbound webhooks (1.2): administrator-managed sources with sealed secrets,
 * and a delivery log deduplicated by the sender's delivery id. Accepted deliveries are
 * dispatched as domain events through the outbox.
 */
export async function createInboundWebhooksSchema(db: Knex) {
  await db.schema.createTable('inbound_sources', (t) => {
    t.increments('id')
    t.string('key', 60).notNullable().unique()
    t.string('name', 100).notNullable()
    t.text('secret').notNullable()
    t.string('algorithm', 10).notNullable().defaultTo('sha256')
    t.string('signature_header', 100).notNullable().defaultTo('x-hub-signature-256')
    t.string('signature_prefix', 20).notNullable().defaultTo('sha256=')
    t.string('event_header', 100).notNullable().defaultTo('x-github-event')
    t.string('delivery_header', 100).notNullable().defaultTo('x-github-delivery')
    t.boolean('dedupe_body').notNullable().defaultTo(true)
    t.boolean('active').notNullable().defaultTo(true)
    t.integer('created_by').references('id').inTable('users').onDelete('SET NULL')
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(db.fn.now())
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(db.fn.now())
    t.timestamp('last_received_at', { useTz: true })
  })
  await db.schema.createTable('inbound_deliveries', (t) => {
    t.uuid('id').primary()
    t.integer('source_id')
      .notNullable()
      .references('id')
      .inTable('inbound_sources')
      .onDelete('CASCADE')
    t.string('delivery_id', 200).notNullable()
    /** SHA-256 of the raw body while the source deduplicates bodies; null otherwise. */
    t.string('body_key', 64)
    t.string('event', 100).notNullable()
    t.jsonb('payload').notNullable()
    t.uuid('event_id').notNullable()
    t.integer('dispatches').notNullable().defaultTo(1)
    t.timestamp('received_at', { useTz: true }).notNullable().defaultTo(db.fn.now())
    t.unique(['source_id', 'delivery_id'])
    t.unique(['source_id', 'body_key'])
    t.index(['source_id', 'received_at'])
    t.index(['received_at'])
  })
}

/**
 * TOTP two-factor authentication (2.2): one row per user with the sealed secret and
 * the last accepted time step (replay guard), and one row per recovery code so a
 * code is consumed atomically. Codes are stored as SHA-256 over a per-code salt.
 */
export async function createTwoFactorSchema(db: Knex) {
  await db.schema.createTable('user_two_factor', (t) => {
    t.integer('user_id').primary().references('id').inTable('users').onDelete('CASCADE')
    t.text('secret').notNullable()
    t.bigInteger('last_used_step')
    t.timestamp('enabled_at', { useTz: true })
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(db.fn.now())
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(db.fn.now())
  })
  await db.schema.createTable('user_two_factor_recovery_codes', (t) => {
    t.increments('id')
    t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
    t.string('salt', 32).notNullable()
    t.string('code_hash', 64).notNullable()
    t.timestamp('used_at', { useTz: true })
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(db.fn.now())
    t.index(['user_id'])
  })
}

/**
 * Import modes: upsert by a unique field, dry-run validation and its per-row report.
 * `updated` counts rows an upsert changed; `report` holds the dry run's row outcomes.
 */
export async function createImportModesSchema(db: Knex) {
  await db.schema.alterTable('import_batches', (t) => {
    t.string('mode', 20).notNullable().defaultTo('create')
    t.string('match_field', 100)
    t.boolean('dry_run').notNullable().defaultTo(false)
    t.integer('updated').notNullable().defaultTo(0)
    t.jsonb('report').notNullable().defaultTo('[]')
  })
}

/**
 * Background synchronization runs (sync_jobs.ts): one row per queued, running or
 * finished run. The partial unique index allows one open (queued or running) run per job.
 */
export async function createSyncJobsSchema(db: Knex) {
  await db.schema.createTable('sync_job_runs', (t) => {
    t.bigIncrements('id')
    t.string('job', 100).notNullable()
    t.string('trigger', 20).notNullable()
    t.string('status', 20).notNullable().defaultTo('queued')
    t.integer('requested_by').references('id').inTable('users').onDelete('SET NULL')
    t.timestamp('queued_at', { useTz: true }).notNullable().defaultTo(db.fn.now())
    t.timestamp('started_at', { useTz: true })
    t.timestamp('finished_at', { useTz: true })
    t.integer('duration_ms')
    t.string('error_category', 64)
    t.string('error_message', 500)
    t.jsonb('stats').notNullable().defaultTo('{}')
    t.index(['job', 'id'])
  })
  await db.raw(
    "ALTER TABLE sync_job_runs ADD CONSTRAINT sync_job_runs_trigger_check CHECK (trigger IN ('schedule', 'manual'))"
  )
  await db.raw(
    "ALTER TABLE sync_job_runs ADD CONSTRAINT sync_job_runs_status_check CHECK (status IN ('queued', 'running', 'succeeded', 'failed'))"
  )
  await db.raw(
    "CREATE UNIQUE INDEX sync_job_runs_open_unique ON sync_job_runs (job) WHERE status IN ('queued', 'running')"
  )
  await db.raw(
    "CREATE INDEX sync_job_runs_queued_idx ON sync_job_runs (queued_at, id) WHERE status = 'queued'"
  )
}

/**
 * Notification channels (2.x): per-user channel preferences (e-mail opt-out, the
 * address of an HTTP provider channel such as SMS or WhatsApp) and the delivery state
 * of channels other than in-app and e-mail, which keeps its notifications.mail_state.
 * Only error categories are stored, never provider response bodies.
 */
export async function createNotificationChannelsSchema(db: Knex) {
  await db.schema.createTable('user_notification_channels', (t) => {
    t.increments('id')
    t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
    t.string('channel', 40).notNullable()
    t.boolean('enabled').notNullable()
    /** The channel address (a phone number); null for e-mail, which uses users.email. */
    t.string('address', 40)
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(db.fn.now())
    t.unique(['user_id', 'channel'])
  })
  await db.schema.createTable('notification_deliveries', (t) => {
    t.uuid('id').primary()
    t.integer('notification_id')
      .notNullable()
      .references('id')
      .inTable('notifications')
      .onDelete('CASCADE')
    t.string('channel', 40).notNullable()
    t.string('state', 10).notNullable().defaultTo('pending')
    t.integer('attempts').notNullable().defaultTo(0)
    t.string('error_category', 40)
    t.timestamp('next_attempt_at', { useTz: true }).notNullable().defaultTo(db.fn.now())
    t.timestamp('sent_at', { useTz: true })
    /** The claim that may write this row; a worker whose lease was taken over writes nothing. */
    t.uuid('lease_id')
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(db.fn.now())
    t.unique(['notification_id', 'channel'])
  })
  await db.raw(
    "ALTER TABLE notification_deliveries ADD CONSTRAINT notification_deliveries_state_check CHECK (state IN ('pending','sent','failed','skipped'))"
  )
  await db.raw(
    "CREATE INDEX notification_deliveries_pending ON notification_deliveries (next_attempt_at) WHERE state = 'pending'"
  )
}

/**
 * Confirmation of a notification channel address (2.x): a one-time code sent to the
 * number before the channel can be enabled with it. One row per user and channel, the
 * code stored as SHA-256 over a per-code salt and void after five wrong attempts; the
 * row also counts codes sent in a 24-hour window. Preferences record when their number
 * was confirmed; a number without confirmed_at never receives messages.
 */
export async function createChannelConfirmationsSchema(db: Knex) {
  await db.schema.alterTable('user_notification_channels', (t) => {
    t.timestamp('confirmed_at', { useTz: true })
  })
  await db.schema.createTable('notification_channel_confirmations', (t) => {
    t.increments('id')
    t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
    t.string('channel', 40).notNullable()
    t.string('address', 40).notNullable()
    t.string('salt', 32).notNullable()
    t.string('code_hash', 64).notNullable()
    t.integer('attempts').notNullable().defaultTo(0)
    t.timestamp('expires_at', { useTz: true }).notNullable()
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(db.fn.now())
    t.integer('sent_count').notNullable().defaultTo(0)
    t.timestamp('window_started_at', { useTz: true }).notNullable().defaultTo(db.fn.now())
    t.unique(['user_id', 'channel'])
    t.index(['expires_at'])
  })
}

/**
 * Import worker leases: a claimed batch belongs to one worker until lease_expires_at;
 * every progress write names lease_id, so a worker whose lease was taken over writes nothing.
 */
export async function createImportLeasesSchema(db: Knex) {
  await db.schema.alterTable('import_batches', (t) => {
    t.uuid('lease_id')
    t.timestamp('lease_expires_at', { useTz: true })
  })
}

/**
 * Approval delegation and SLA deadlines (ADR 044). A delegation routes a user's new
 * approvals to a delegate for a date range and lets the delegate act on the user's
 * pending ones; overlap is refused by WorkflowDelegations under a row lock. Approval
 * assignments gain a deadline, the delegation they were routed through and the SLA
 * markers; workflow_escalations records each reminder and escalation once.
 */
export async function createWorkflowDelegationSlaSchema(db: Knex) {
  await db.schema.createTable('workflow_delegations', (t) => {
    t.increments('id')
    t.integer('delegator_id').notNullable().references('id').inTable('users').onDelete('RESTRICT')
    t.integer('delegate_id').notNullable().references('id').inTable('users').onDelete('RESTRICT')
    t.date('starts_on').notNullable()
    t.date('ends_on').notNullable()
    t.string('note', 500)
    t.integer('created_by').references('id').inTable('users').onDelete('SET NULL')
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(db.fn.now())
    t.timestamp('revoked_at', { useTz: true })
    t.integer('revoked_by').references('id').inTable('users').onDelete('SET NULL')
    t.index(['delegator_id', 'ends_on'])
    t.index(['delegate_id', 'ends_on'])
  })
  await db.raw(
    'ALTER TABLE workflow_delegations ADD CONSTRAINT workflow_delegations_distinct CHECK (delegator_id <> delegate_id), ADD CONSTRAINT workflow_delegations_range CHECK (ends_on >= starts_on)'
  )
  await db.schema.alterTable('assignments', (t) => {
    t.integer('on_behalf_of').references('id').inTable('users').onDelete('RESTRICT')
    t.integer('delegation_id').references('id').inTable('workflow_delegations').onDelete('RESTRICT')
    t.timestamp('due_at', { useTz: true })
    t.timestamp('due_soon_at', { useTz: true })
    t.timestamp('reminded_at', { useTz: true })
    t.timestamp('escalated_at', { useTz: true })
  })
  await db.raw(
    "CREATE INDEX assignments_sla_due ON assignments (due_at) WHERE status = 'open' AND due_at IS NOT NULL"
  )
  // Inboxes and My tasks filter open approvals by the approver they were routed for.
  await db.raw(
    "CREATE INDEX assignments_on_behalf_of ON assignments (on_behalf_of) WHERE status = 'open' AND on_behalf_of IS NOT NULL"
  )
  await db.raw(
    'CREATE INDEX assignments_delegation ON assignments (delegation_id) WHERE delegation_id IS NOT NULL'
  )
  await db.schema.createTable('workflow_escalations', (t) => {
    t.bigIncrements('id')
    t.uuid('run_id').notNullable().references('id').inTable('workflow_runs').onDelete('CASCADE')
    t.string('step', 100).notNullable()
    t.bigInteger('assignment_id')
      .notNullable()
      .references('id')
      .inTable('assignments')
      .onDelete('CASCADE')
    t.string('level', 20).notNullable()
    t.string('action', 20).notNullable()
    t.jsonb('targets').notNullable().defaultTo('[]')
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(db.fn.now())
    t.unique(['assignment_id', 'level'])
    t.index(['run_id', 'id'])
  })
}

/**
 * Administrator print templates (ADR 048). A template row points to its current
 * version; versions are immutable (a trigger refuses UPDATE and DELETE, except clearing
 * created_by when the author is deleted), so a printed
 * document's recorded version always resolves to the markup that produced it.
 * Templates are deployment-wide, like message_templates.
 */
export async function createPrintTemplatesSchema(db: Knex) {
  await db.schema.createTable('print_templates', (t) => {
    t.increments('id')
    t.string('resource', 63).notNullable()
    t.string('key', 64).notNullable()
    t.string('label', 200).notNullable()
    t.integer('current_version').notNullable().defaultTo(0)
    t.boolean('active').notNullable().defaultTo(true)
    t.integer('created_by').references('id').inTable('users').onDelete('SET NULL')
    t.integer('updated_by').references('id').inTable('users').onDelete('SET NULL')
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(db.fn.now())
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(db.fn.now())
    t.unique(['resource', 'key'])
  })
  await db.schema.createTable('print_template_versions', (t) => {
    t.bigIncrements('id')
    t.integer('template_id')
      .notNullable()
      .references('id')
      .inTable('print_templates')
      .onDelete('RESTRICT')
    t.integer('version').notNullable()
    t.string('label', 200).notNullable()
    t.text('body').notNullable()
    t.string('paper', 10).notNullable()
    t.string('orientation', 10).notNullable()
    t.string('header', 500).notNullable().defaultTo('')
    t.string('footer', 500).notNullable().defaultTo('')
    t.integer('created_by').references('id').inTable('users').onDelete('SET NULL')
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(db.fn.now())
    t.unique(['template_id', 'version'])
  })
  await db.raw(
    "ALTER TABLE print_template_versions ADD CONSTRAINT print_template_versions_paper CHECK (paper IN ('A4', 'A5', 'Letter')), ADD CONSTRAINT print_template_versions_orientation CHECK (orientation IN ('portrait', 'landscape')), ADD CONSTRAINT print_template_versions_positive CHECK (version > 0)"
  )
  await db.raw(`CREATE FUNCTION adula_print_template_versions_immutable() RETURNS trigger AS $$
BEGIN
  -- Deleting the author only clears created_by (ON DELETE SET NULL); nothing else changes.
  IF TG_OP = 'UPDATE' AND NEW.created_by IS NULL
    AND (NEW.id, NEW.template_id, NEW.version, NEW.label, NEW.body, NEW.paper, NEW.orientation, NEW.header, NEW.footer, NEW.created_at)
      IS NOT DISTINCT FROM (OLD.id, OLD.template_id, OLD.version, OLD.label, OLD.body, OLD.paper, OLD.orientation, OLD.header, OLD.footer, OLD.created_at)
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'print_template_versions rows are immutable';
END
$$ LANGUAGE plpgsql`)
  await db.raw(
    'CREATE TRIGGER print_template_versions_immutable BEFORE UPDATE OR DELETE ON print_template_versions FOR EACH ROW EXECUTE FUNCTION adula_print_template_versions_immutable()'
  )
}
