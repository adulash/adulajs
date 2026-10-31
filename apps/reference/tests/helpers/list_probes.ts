import { BaseModel } from '@adonisjs/lucid/orm'
import db from '@adonisjs/lucid/services/db'
import { createResourceTable, defineResource } from 'adula'
import type { Module, RecordData } from 'adula'
import { modules, registry } from '#start/modules'

/**
 * A scoped, versioned test resource with one filterable field of every comparable type,
 * for the list layer HTTP specs (ADR 046). `secret` needs permission level 1 and
 * `internal` is hidden (level 1 too).
 */
export const probes = defineResource({
  name: 'list_probes',
  label: { ar: 'عينات القائمة', en: 'List probes' },
  recordLabel: { ar: 'عينة', en: 'Probe' },
  model: BaseModel,
  scoped: true,
  version: true,
  fields: {
    title: {
      type: 'string',
      required: true,
      searchable: true,
      sortable: true,
      filterable: true,
      label: { ar: 'العنوان', en: 'Title' },
    },
    note: { type: 'text', filterable: true, label: { ar: 'ملاحظة', en: 'Note' } },
    status: {
      type: 'lookup',
      group: 'probe_status',
      filterable: true,
      label: { ar: 'الحالة', en: 'Status' },
    },
    qty: {
      type: 'integer',
      sortable: true,
      filterable: true,
      label: { ar: 'الكمية', en: 'Quantity' },
    },
    amount: { type: 'money', filterable: true, label: { ar: 'المبلغ', en: 'Amount' } },
    due: { type: 'date', filterable: true, label: { ar: 'الاستحقاق', en: 'Due' } },
    secret: {
      type: 'integer',
      filterable: true,
      permissionLevel: 1,
      label: { ar: 'سري', en: 'Secret' },
    },
    internal: { type: 'text', label: { ar: 'داخلي', en: 'Internal' } },
  },
  list: ['title', 'note', 'status', 'qty', 'amount', 'due', 'secret', 'internal'],
  form: ['title', 'note', 'status', 'qty', 'amount', 'due', 'secret', 'internal'],
  show: ['title', 'note', 'status', 'qty', 'amount', 'due', 'secret', 'internal'],
  hidden: ['internal'],
  actions: ['view', 'create', 'update', 'delete'],
  validator: { validate: async (data: unknown) => data as RecordData },
})

const probeModule: Module = {
  name: 'list_probes',
  label: { ar: 'عينات القائمة', en: 'List probes' },
  dependsOn: [],
  resources: [probes],
}

export async function installProbes() {
  const knex = db.connection().getWriteClient()
  await knex.raw('DROP TABLE IF EXISTS list_probes CASCADE')
  await createResourceTable(knex, probes)
  await knex('lookups')
    .insert([
      { group: 'probe_status', key: 'open', label_ar: 'مفتوحة', label_en: 'Open' },
      { group: 'probe_status', key: 'closed', label_ar: 'مغلقة', label_en: 'Closed' },
    ])
    .onConflict(['group', 'key'])
    .ignore()
  registry.register([...modules, probeModule])
  return async () => {
    registry.register(modules)
    await knex.raw('DROP TABLE IF EXISTS list_probes CASCADE')
    await knex('activities').where('resource', 'list_probes').del()
  }
}

export type ProbeRow = Partial<{
  title: string
  note: string | null
  status: string | null
  qty: number | null
  amount: string | number | null
  due: string | null
  secret: number | null
  internal: string | null
  org_unit_id: number
  deleted_at: Date | null
  version: number
}>

/** Inserts rows directly (fast fixtures); returns their ids in order. */
export async function insertProbes(userId: number, rows: ProbeRow[]) {
  const knex = db.connection().getWriteClient()
  const inserted = await knex('list_probes')
    .insert(rows.map((row) => ({ created_by: userId, updated_by: userId, ...row })))
    .returning('id')
  return inserted.map((row: { id: number }) => Number(row.id))
}

/** Clears the probes and their activity between tests. */
export async function resetProbes() {
  const knex = db.connection().getWriteClient()
  await knex.raw('TRUNCATE list_probes RESTART IDENTITY CASCADE')
  await knex('activities').where('resource', 'list_probes').del()
}
