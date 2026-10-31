import { test } from '@japa/runner'
import User from '#models/user'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import { adula } from '#services/adula'
import { randomUUID } from 'node:crypto'
import { attachmentPolicy, columnName, isMultipleAttachment, joinTable } from 'adula'
import type { Action, Field, RecordData, Resource, SerializedRecord } from 'adula'

export type FixtureContext = { userId: number; orgUnitId: number; unique: string }
export type ContractFixture = {
  input: RecordData
  /** Expected public values after validation; relations have separate tests. */
  expected: SerializedRecord
  /** Normalized database values for writable fields excluded from the response. */
  stored?: RecordData
  /** All live child rows after creation, ordered by ID, using public field names. */
  inline?: Record<string, RecordData[]>
  /**
   * A valid update for this same record, including required validator fields. Required
   * when the resource declares the `update` action.
   */
  update?: RecordData
  updated?: SerializedRecord
  updatedStored?: RecordData
  updatedInline?: Record<string, RecordData[]>
}
export type ResourceFixture = (
  context: FixtureContext
) => Promise<ContractFixture> | ContractFixture

function storedValue(field: Field, value: unknown) {
  if (!(value instanceof Date)) return value
  return field.type === 'date'
    ? [
        value.getFullYear(),
        String(value.getMonth() + 1).padStart(2, '0'),
        String(value.getDate()).padStart(2, '0'),
      ].join('-')
    : value.toISOString()
}

// Small files whose content matches their extension, so uploads pass type detection.
const SAMPLE_FILES: Record<string, { content: () => Buffer; contentType: string }> = {
  txt: { content: () => Buffer.from(`foreign ${randomUUID()}`), contentType: 'text/plain' },
  pdf: {
    content: () => Buffer.from(`%PDF-1.4\n% ${randomUUID()}\n%%EOF\n`),
    contentType: 'application/pdf',
  },
  png: {
    content: () =>
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
        'base64'
      ),
    contentType: 'image/png',
  },
  gif: {
    content: () => Buffer.from('R0lGODlhAQABAAAAACwAAAAAAQABAAACAkQBADs=', 'base64'),
    contentType: 'image/gif',
  },
}

/** An upload the field accepts: its first accepted type with a known sample, else text. */
function sampleUpload(field: Field) {
  const accepted = attachmentPolicy(field).extnames
  const extname = accepted
    ? (Object.keys(SAMPLE_FILES).find((entry) => accepted.includes(entry)) ?? accepted[0])
    : 'txt'
  const sample = SAMPLE_FILES[extname] ?? SAMPLE_FILES.txt
  return {
    content: sample.content(),
    filename: `foreign.${extname}`,
    contentType: sample.contentType,
  }
}

/** Fixtures belong to the application and exercise its real validators and HTTP routes. */
export function resourceContract(name: string, fixture: ResourceFixture) {
  test.group(`HTTP security contract: ${name}`, (group) => {
    let denied: User
    let writer: User
    let reader: User
    let outsider: User
    let orgUnitId: number
    let resource: Resource
    const base = `/resources/${name}`
    const fresh = () => fixture({ userId: writer.id, orgUnitId, unique: randomUUID() })
    const input = (values: RecordData) => ({
      ...values,
      ...(resource.scoped && !resource.scope ? { orgUnitId } : {}),
    })
    const version = (row: SerializedRecord) => (resource.version ? { version: row.version } : {})
    // Actions the resource does not declare are refused even to a role that manages all.
    const allows = (action: Action) => resource.actions.includes(action)

    group.setup(async () => {
      const knex = db.connection().getWriteClient()
      const databaseInfo = await knex.raw('SELECT current_database() AS name')
      const database = databaseInfo.rows[0].name
      if (!app.inTest || !database.endsWith('_test'))
        throw new Error('Resource contracts require a dedicated *_test database')
      resource = adula().registry.get(name)
      const suffix = randomUUID()
      const users = []
      for (const label of ['denied', 'writer', 'reader', 'outside']) {
        users.push(
          await User.create({
            fullName: 'مستخدم الاختبار',
            email: `${label}-${suffix}@example.test`,
            password: 'a-long-test-password-123',
          })
        )
      }
      ;[denied, writer, reader, outsider] = users
      const [org, outside] = await knex('org_units')
        .insert([
          { name: 'نطاق الاختبار', type: 'root', path: `contract_${suffix.replaceAll('-', '_')}` },
          { name: 'نطاق آخر', type: 'root', path: `outside_${suffix.replaceAll('-', '_')}` },
        ])
        .returning('id')
      orgUnitId = org.id
      const [writeRole, readRole] = await knex('roles')
        .insert([
          { name: `writer-${suffix}`, permission_level: 1 },
          { name: `reader-${suffix}`, permission_level: 0 },
        ])
        .returning('id')
      await knex('role_rules').insert([
        { role_id: writeRole.id, subject: 'all', action: 'manage' },
        { role_id: readRole.id, subject: 'all', action: 'view' },
      ])
      await knex('user_roles').insert([
        { user_id: writer.id, role_id: writeRole.id },
        { user_id: outsider.id, role_id: writeRole.id },
        { user_id: reader.id, role_id: readRole.id },
      ])
      await knex('user_org_units').insert([
        { user_id: writer.id, org_unit_id: orgUnitId },
        { user_id: reader.id, org_unit_id: orgUnitId },
        { user_id: outsider.id, org_unit_id: outside.id },
      ])
    })

    for (const [method, suffix] of [
      ['get', ''],
      ['get', '/create'],
      ['get', '/999999/edit'],
      ['get', '/999999'],
      ['post', ''],
      ['patch', '/999999'],
      ['delete', '/999999'],
      ['post', '/999999/submit'],
      ['post', '/999999/cancel'],
    ] as const) {
      test(`${method.toUpperCase()} ${suffix || '/'} returns 403 without roles`, async ({
        client,
      }) => {
        const response = await client[method](`${base}${suffix}`)
          .loginAs(denied)
          .withCsrfToken()
          .header('Accept', 'application/json')
        response.assertStatus(403)
      })
    }
    test('resource route is protected from anonymous access', async ({ client }) => {
      const response = await client.get(base).header('Accept', 'application/json')
      response.assertStatus(401)
    })
    test('undeclared actions are refused to a role that manages all resources', async ({
      client,
    }) => {
      for (const [action, method, suffix] of [
        ['create', 'post', ''],
        ['update', 'patch', '/999999'],
        ['delete', 'delete', '/999999'],
      ] as const) {
        if (allows(action)) continue
        const response = await client[method](`${base}${suffix}`)
          .loginAs(writer)
          .withCsrfToken()
          .header('Accept', 'application/json')
        response.assertStatus(403)
      }
    })
    test('existing records enforce scope on reads and writes; central resources stay shared', async ({
      client,
      assert,
    }) => {
      if (!allows('create')) return
      const values = await fresh()
      const created = await client
        .post(base)
        .loginAs(writer)
        .withCsrfToken()
        .header('Accept', 'application/json')
        .json(input(values.input))
      created.assertStatus(201)
      const row = created.body().data
      const visible = await client
        .get(`${base}/${row.id}`)
        .loginAs(writer)
        .header('Accept', 'application/json')
      visible.assertStatus(200)
      assert.equal(visible.body().data.id, row.id)
      const outside = await client
        .get(`${base}/${row.id}`)
        .loginAs(outsider)
        .header('Accept', 'application/json')
      outside.assertStatus(resource.scoped ? 404 : 200)
      if (!resource.scoped) return
      const listing = await client.get(base).loginAs(outsider).header('Accept', 'application/json')
      listing.assertStatus(200)
      assert.notInclude(
        listing.body().data.map((entry: SerializedRecord) => entry.id),
        row.id
      )
      const edit = await client
        .get(`${base}/${row.id}/edit`)
        .loginAs(outsider)
        .header('Accept', 'application/json')
      edit.assertStatus(allows('update') ? 404 : 403)
      const changed = await client
        .patch(`${base}/${row.id}`)
        .loginAs(outsider)
        .withCsrfToken()
        .header('Accept', 'application/json')
        .json({ ...(values.update ?? values.input), ...version(row) })
      changed.assertStatus(allows('update') ? 404 : 403)
      const deleted = await client
        .delete(`${base}/${row.id}`)
        .loginAs(outsider)
        .withCsrfToken()
        .header('Accept', 'application/json')
        .json(version(row))
      deleted.assertStatus(allows('delete') ? 404 : 403)
      const after = await client
        .get(`${base}/${row.id}`)
        .loginAs(writer)
        .header('Accept', 'application/json')
      after.assertStatus(200)
      assert.deepEqual(after.body().data, row)
    })
    test('fixture fields round-trip, private values stay hidden, updates and soft deletion persist', async ({
      client,
      assert,
    }) => {
      if (!allows('create')) return
      const values = await fresh()
      for (const key of resource.form)
        assert.property(values.input, key, `Missing ${name}.${key} fixture`)
      const created = await client
        .post(base)
        .loginAs(writer)
        .withCsrfToken()
        .header('Accept', 'application/json')
        .json(input(values.input))
      created.assertStatus(201)
      const row = created.body().data
      assert.isNumber(row.id)
      for (const [key, value] of Object.entries(values.expected))
        assert.deepEqual(row[key], value, key)
      const exposed = new Set([
        'id',
        ...(resource.serialize ?? [...resource.list, ...resource.show]),
        ...(resource.scoped ? ['orgUnitId'] : []),
        ...(resource.version ? ['version'] : []),
        ...(resource.submittable ? ['docStatus'] : []),
      ])
      for (const key of Object.keys(row))
        assert.isTrue(exposed.has(key), `Unexpected serialized field ${key}`)
      const assertStored = async (
        submitted: RecordData,
        expected: SerializedRecord,
        stored: RecordData = {},
        inline: Record<string, RecordData[]> = {}
      ) => {
        const persistedRow = await db
          .connection()
          .getWriteClient()(name)
          .where('id', row.id)
          .first()
        const expectations = { ...expected, ...stored }
        for (const key of Object.keys(submitted)) {
          if (!resource.form.includes(key)) continue
          const field = resource.fields[key]
          if (field.type === 'hasMany') {
            assert.property(inline, key, `Missing expected ${name}.${key} child rows`)
            const child = adula().registry.get(field.resource)
            const foreignKey = child.fields[field.foreignKey].column ?? columnName(field.foreignKey)
            const rows = await db
              .connection()
              .getWriteClient()(child.name)
              .where(foreignKey, row.id)
              .whereNull('deleted_at')
              .orderBy('id')
            assert.lengthOf(rows, inline[key].length)
            for (const [index, entry] of inline[key].entries()) {
              for (const childKey of child.form.filter((entryKey) => entryKey !== field.foreignKey))
                assert.property(entry, childKey, `Missing expected ${field.resource}.${childKey}`)
              for (const [childKey, value] of Object.entries(entry)) {
                const childField = child.fields[childKey]
                assert.exists(childField, `Unknown expected child field ${childKey}`)
                assert.deepEqual(
                  storedValue(childField, rows[index][childField.column ?? columnName(childKey)]),
                  value
                )
              }
            }
          } else if (field.type === 'manyToMany') {
            // Linked ids live in the join table, ascending (ADR 045).
            assert.property(expectations, key, `Missing stored ${name}.${key} expectation`)
            const join = joinTable(name, key, field)
            const linked = await db
              .connection()
              .getWriteClient()(join.table)
              .where(join.owner, row.id)
              .orderBy(join.target)
              .pluck(join.target)
            assert.deepEqual(linked.map(Number), expectations[key], key)
          } else {
            assert.property(expectations, key, `Missing stored ${name}.${key} expectation`)
            if (exposed.has(key))
              assert.property(expected, key, `Missing public ${name}.${key} expectation`)
            assert.deepEqual(
              storedValue(field, persistedRow[field.column ?? columnName(key)]),
              expectations[key],
              key
            )
          }
        }
      }
      await assertStored(values.input, values.expected, values.stored, values.inline)
      const shown = await client
        .get(`${base}/${row.id}`)
        .loginAs(reader)
        .header('Accept', 'application/json')
      shown.assertStatus(200)
      for (const [key, field] of Object.entries(resource.fields)) {
        if (field.permissionLevel || resource.hidden?.includes(key))
          assert.notProperty(shown.body().data, key)
      }
      const stored = async () => db.connection().getWriteClient()(name).where('id', row.id).first()
      const inserted = await stored()
      assert.equal(inserted.created_by, writer.id)
      if (!allows('update')) {
        const refused = await client
          .patch(`${base}/${row.id}`)
          .loginAs(writer)
          .withCsrfToken()
          .header('Accept', 'application/json')
          .json({ ...values.input, ...version(row) })
        refused.assertStatus(403)
      }
      const current = allows('update') ? await updateRecord() : row
      if (!allows('delete')) {
        const refused = await client
          .delete(`${base}/${row.id}`)
          .loginAs(writer)
          .withCsrfToken()
          .header('Accept', 'application/json')
          .json(version(current))
        refused.assertStatus(403)
        const kept = await client
          .get(`${base}/${row.id}`)
          .loginAs(writer)
          .header('Accept', 'application/json')
        kept.assertStatus(200)
        assert.deepEqual(kept.body().data, current)
        return
      }
      const removed = await client
        .delete(`${base}/${row.id}`)
        .loginAs(writer)
        .withCsrfToken()
        .header('Accept', 'application/json')
        .json(version(current))
      removed.assertStatus(200)
      const deleted = await stored()
      assert.exists(deleted.deleted_at)
      const missing = await client
        .get(`${base}/${row.id}`)
        .loginAs(writer)
        .header('Accept', 'application/json')
      missing.assertStatus(404)

      async function updateRecord() {
        assert.exists(values.update, `Missing ${name} update fixture`)
        assert.exists(values.updated, `Missing ${name} updated fixture`)
        const update = values.update!
        for (const key of ['createdBy', 'updatedBy', 'deletedAt', 'orgPath', 'searchVector']) {
          const invalid = await client
            .patch(`${base}/${row.id}`)
            .loginAs(writer)
            .withCsrfToken()
            .header('Accept', 'application/json')
            .json({ ...update, ...version(row), [key]: writer.id })
          invalid.assertStatus(422)
          assert.equal(invalid.body().error.code, 'E_FIELD_NOT_WRITABLE')
        }
        const updated = await client
          .patch(`${base}/${row.id}`)
          .loginAs(writer)
          .withCsrfToken()
          .header('Accept', 'application/json')
          .json({ ...update, ...version(row) })
        updated.assertStatus(200)
        for (const [key, value] of Object.entries(values.updated!))
          assert.deepEqual(updated.body().data[key], value, key)
        await assertStored(update, values.updated!, values.updatedStored, values.updatedInline)
        if (resource.version) {
          assert.equal(updated.body().data.version, Number(row.version) + 1)
          const stale = await client
            .patch(`${base}/${row.id}`)
            .loginAs(writer)
            .withCsrfToken()
            .header('Accept', 'application/json')
            .json({ ...update, ...version(row) })
          stale.assertStatus(409)
        }
        const persisted = await client
          .get(`${base}/${row.id}`)
          .loginAs(writer)
          .header('Accept', 'application/json')
        persisted.assertStatus(200)
        assert.deepEqual(persisted.body().data, updated.body().data)
        return updated.body().data as SerializedRecord
      }
    })
    test('attachment fields reject uploads owned by another user and never serve them', async ({
      client,
      assert,
    }) => {
      const keys = resource.form.filter((key) => resource.fields[key].type === 'attachment')
      if (!keys.length || !allows('create')) return
      const values = await fresh()
      for (const key of keys) {
        const upload = sampleUpload(resource.fields[key])
        const foreign = await client
          .post('/attachments')
          .loginAs(outsider)
          .withCsrfToken()
          .header('Accept', 'application/json')
          .fields({ resource: name, field: key })
          .file('file', upload.content, {
            filename: upload.filename,
            contentType: upload.contentType,
          })
        foreign.assertStatus(201)
        const rejected = await client
          .post(base)
          .loginAs(writer)
          .withCsrfToken()
          .header('Accept', 'application/json')
          // A multiple field (ADR 047) takes the foreign upload as one of its files.
          .json(
            input({
              ...values.input,
              [key]: isMultipleAttachment(resource.fields[key])
                ? [foreign.body().data.id]
                : foreign.body().data.id,
            })
          )
        rejected.assertStatus(422)
        assert.equal(rejected.body().error.code, 'E_ATTACHMENT')
        const download = await client
          .get(foreign.body().data.url)
          .loginAs(writer)
          .header('Accept', 'application/json')
        download.assertStatus(404)
      }
    })
    test('unique constraints reject duplicates and allow reuse after soft deletion', async ({
      client,
      assert,
    }) => {
      const keys = Object.entries(resource.fields).filter(([, field]) => field.unique)
      if (!keys.length || !allows('create')) return
      const values = await fresh()
      const created = await client
        .post(base)
        .loginAs(writer)
        .withCsrfToken()
        .header('Accept', 'application/json')
        .json(input(values.input))
      created.assertStatus(201)
      const row = created.body().data
      const knex = db.connection().getWriteClient()
      const stored = await knex(name).where('id', row.id).first()
      const distinct = await fresh()
      const second = await client
        .post(base)
        .loginAs(writer)
        .withCsrfToken()
        .header('Accept', 'application/json')
        .json(input(distinct.input))
      second.assertStatus(201)
      // Read-only sequence values also require real PostgreSQL uniqueness assertions.
      for (const [key, field] of keys) {
        const column = field.column ?? columnName(key)
        assert.isNotNull(stored[column], `Missing unique fixture ${key}`)
        await assert.rejects(
          () =>
            knex(name)
              .where('id', second.body().data.id)
              .update({ [column]: stored[column] }),
          /duplicate key/
        )
      }
      for (const [key, field] of keys) {
        if (field.sequence || !resource.form.includes(key)) continue
        const other = await fresh()
        const rejected = await client
          .post(base)
          .loginAs(writer)
          .withCsrfToken()
          .header('Accept', 'application/json')
          .json(input({ ...other.input, [key]: values.input[key] }))
        rejected.assertStatus(409)
        assert.equal(rejected.body().error.code, 'E_DUPLICATE')
      }
      if (!allows('delete')) return
      const removed = await client
        .delete(`${base}/${row.id}`)
        .loginAs(writer)
        .withCsrfToken()
        .header('Accept', 'application/json')
        .json(version(row))
      removed.assertStatus(200)
      for (const [key, field] of keys) {
        const column = field.column ?? columnName(key)
        assert.equal(
          await knex(name)
            .where('id', second.body().data.id)
            .update({ [column]: stored[column] }),
          1
        )
      }
    })
  })
}
