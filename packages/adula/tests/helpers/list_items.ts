import { BaseModel } from '@adonisjs/lucid/orm'
import { ResourceRegistry, createResourceTable, defineResource } from '../../index.js'
import type { Actor, RecordData } from '../../index.js'
import { customer, db, line, order, setup } from '../helpers.js'

/**
 * A scoped, versioned resource with one filterable field of every comparable type, for
 * the list layer specs (ADR 046). `secret` needs permission level 1.
 */
export const item = defineResource({
  name: 'list_items',
  label: { ar: 'عناصر القائمة', en: 'List items' },
  model: BaseModel,
  scoped: true,
  version: true,
  fields: {
    title: {
      type: 'string',
      required: true,
      filterable: true,
      searchable: true,
      sortable: true,
      label: { ar: 'العنوان', en: 'Title' },
    },
    note: { type: 'text', filterable: true, label: { ar: 'ملاحظة', en: 'Note' } },
    status: {
      type: 'lookup',
      group: 'order_status',
      filterable: true,
      label: { ar: 'الحالة', en: 'Status' },
    },
    qty: {
      type: 'integer',
      filterable: true,
      sortable: true,
      label: { ar: 'الكمية', en: 'Quantity' },
    },
    amount: { type: 'money', filterable: true, label: { ar: 'المبلغ', en: 'Amount' } },
    due: { type: 'date', filterable: true, label: { ar: 'الاستحقاق', en: 'Due' } },
    seenAt: { type: 'datetime', filterable: true, label: { ar: 'شوهد', en: 'Seen at' } },
    active: { type: 'boolean', filterable: true, label: { ar: 'نشط', en: 'Active' } },
    ownerId: { type: 'user', filterable: true, label: { ar: 'المالك', en: 'Owner' } },
    customerId: {
      type: 'belongsTo',
      resource: 'customers',
      filterable: true,
      label: { ar: 'العميل', en: 'Customer' },
    },
    secret: {
      type: 'integer',
      filterable: true,
      permissionLevel: 1,
      label: { ar: 'سري', en: 'Secret' },
    },
  },
  list: [
    'title',
    'note',
    'status',
    'qty',
    'amount',
    'due',
    'seenAt',
    'active',
    'ownerId',
    'customerId',
    'secret',
  ],
  form: [
    'title',
    'note',
    'status',
    'qty',
    'amount',
    'due',
    'seenAt',
    'active',
    'ownerId',
    'customerId',
    'secret',
  ],
  show: ['title', 'note', 'status', 'qty', 'amount', 'active', 'ownerId', 'customerId', 'secret'],
  actions: ['view', 'create', 'update', 'delete'],
  validator: { validate: async (data) => data as RecordData },
})

export const listRegistry = new ResourceRegistry().register([
  { name: 'customers', label: customer.label, dependsOn: [], resources: [customer] },
  { name: 'orders', label: order.label, dependsOn: ['customers'], resources: [order, line] },
  { name: 'lists', label: item.label, dependsOn: ['customers'], resources: [item] },
])

/** Manages list items in unit 1.2 (and 1.2.4) at permission level 0. */
export function clerk(overrides: Partial<Actor> = {}): Actor {
  return {
    id: 2,
    orgPaths: ['1.2'],
    permissionLevel: 0,
    rules: [
      { subject: 'list_items', action: ['view', 'create', 'update', 'delete'] },
      { subject: 'customers', action: 'view' },
    ],
    ...overrides,
  }
}

type Row = Partial<{
  title: string
  note: string | null
  status: string | null
  qty: number | null
  amount: string | null
  due: string | null
  seen_at: string | null
  active: boolean | null
  owner_id: number | null
  customer_id: number | null
  secret: number | null
  org_unit_id: number
  deleted_at: unknown
}>

/** The core schema plus the list_items table and the four rows the specs filter. */
export async function setupListItems(extra: Row[] = []) {
  await setup()
  await db.raw('ALTER TABLE users ADD COLUMN full_name varchar, ADD COLUMN disabled_at timestamptz')
  await db('users').where('id', 1).update({ full_name: 'مدير النظام' })
  await db('users').where('id', 2).update({ full_name: 'سارة' })
  await createResourceTable(db, item)
  await db('customers').insert({ id: 1, name: '=HYPERLINK("x")', created_by: 1, updated_by: 1 })
  const base = { created_by: 1, updated_by: 1, version: 1 }
  const rows: Row[] = [
    {
      title: 'Alpha',
      note: null,
      status: 'open',
      qty: 5,
      amount: '1000',
      due: '2026-01-10',
      seen_at: '2026-01-10T08:00:00.000Z',
      active: true,
      owner_id: 1,
      customer_id: 1,
      secret: 7,
      org_unit_id: 2,
    },
    {
      title: 'Beta',
      note: '',
      status: 'closed',
      qty: 10,
      amount: '2500',
      due: '2026-02-01',
      seen_at: '2026-02-01T08:00:00.000Z',
      active: false,
      owner_id: 2,
      org_unit_id: 2,
    },
    { title: 'Gamma', note: 'x', status: 'open', qty: 15, org_unit_id: 4 },
    { title: 'Delta', note: 'y', org_unit_id: 3 },
    ...extra,
  ]
  for (const row of rows) await db('list_items').insert({ ...base, ...row })
}
