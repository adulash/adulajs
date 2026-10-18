import type { Knex } from 'knex'
import type { Resource } from '../resource/types.js'
import { identifier, columnName } from '../resource/define_resource.js'

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

export async function createResourceTable(
  db: Knex,
  resource: Pick<
    Resource,
    'name' | 'scoped' | 'version' | 'submittable' | 'customFields' | 'fields'
  >
) {
  const table = identifier(resource.name)
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
    if (resource.customFields) t.jsonb('custom_fields').notNullable().defaultTo('{}')
    for (const [key, field] of Object.entries(resource.fields)) {
      if (field.type === 'hasMany') continue
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
          column = t.jsonb(name)
          break
        case 'text':
          column = t.text(name)
          break
        default:
          column = t.string(name)
      }
      if (field.required || field.sequence) column.notNullable()
    }
    if (resource.scoped) t.index(['org_unit_id', 'deleted_at'])
  })
  for (const [key, field] of Object.entries(resource.fields)) {
    if (field.unique)
      await db.raw('CREATE UNIQUE INDEX ?? ON ?? (??) WHERE deleted_at IS NULL', [
        `${table}_${columnName(key)}_active_unique`,
        table,
        field.column ?? columnName(key),
      ])
  }
  const searchable = Object.entries(resource.fields).filter(([, f]) => f.searchable)
  if (searchable.length) {
    const expression = searchable
      .map(([key, field]) => `coalesce("${identifier(field.column ?? columnName(key))}", '')`)
      .join(` || ' ' || `)
    await db.raw(
      `ALTER TABLE "${table}" ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', ${expression})) STORED`
    )
    await db.raw('CREATE INDEX ?? ON ?? USING gin(search_vector)', [`${table}_search_gin`, table])
  }
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
