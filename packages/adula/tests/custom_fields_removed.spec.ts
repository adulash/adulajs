import { test } from '@japa/runner'
import { createResourceTable, defineResource } from '../index.js'
import type { RecordData } from '../index.js'
import type { ResourceInput } from '../src/resource/types.js'
import { customer, db, setup } from './helpers.js'

const base = {
  name: 'notes',
  label: { ar: 'الملاحظات', en: 'Notes' },
  model: customer.model,
  scoped: false,
  fields: { title: { type: 'string', label: { ar: 'العنوان', en: 'Title' } } },
  list: ['title'],
  form: ['title'],
  show: ['title'],
  actions: ['view'],
  validator: { validate: async (data: unknown) => data as RecordData },
} as const

async function hasColumn(table: string, column: string) {
  const result = await db.raw(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = ? AND column_name = ?`,
    [table, column]
  )
  return result.rows.length > 0
}

test.group('Removed customFields flag', (group) => {
  group.each.setup(async () => {
    await setup()
  })

  test('defineResource refuses a definition that still sets customFields', ({ assert }) => {
    const legacy = { ...base, customFields: true } as unknown as ResourceInput<typeof base.fields>
    assert.throws(
      () => defineResource(legacy),
      'notes: the customFields option was removed (nothing read or wrote the column). ' +
        'Delete it from the definition; an existing custom_fields column is left untouched.'
    )
    // Even `customFields: false` is refused, so an upgrade never passes it silently.
    assert.throws(
      () =>
        defineResource({ ...base, customFields: false } as unknown as ResourceInput<
          typeof base.fields
        >),
      /customFields option was removed/
    )
  })

  test('new tables have no custom_fields column; old create-migrations replay unchanged', async ({
    assert,
  }) => {
    const notes = defineResource(base)
    await createResourceTable(db, notes)
    assert.isFalse(await hasColumn('notes', 'custom_fields'))

    // A create-migration generated before the removal embeds `customFields: true`; replaying
    // it on a new database still creates the column it always created (migrations are immutable).
    await createResourceTable(db, { ...notes, name: 'legacy_notes', customFields: true })
    assert.isTrue(await hasColumn('legacy_notes', 'custom_fields'))
  })
})
