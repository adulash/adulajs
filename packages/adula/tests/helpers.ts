import { readFile } from 'node:fs/promises'
import knex from 'knex'
import { BaseModel } from '@adonisjs/lucid/orm'
import {
  defineResource,
  ResourceRegistry,
  createCoreSchema,
  createAttachmentsSchema,
  createSavedViewsSchema,
  createCollaborationSchema,
  createAssignmentsSchema,
  createMessagingSchema,
  createWebhooksSchema,
  createImportsSchema,
  createWorkflowSchema,
  createManagedAssignmentsSchema,
  createRoleKeysSchema,
  createNotificationTargetsSchema,
  createUploadGrantsSchema,
  createInboundWebhooksSchema,
  createTwoFactorSchema,
  createResourceTable,
} from '../index.js'
import type { Actor, RecordData } from '../index.js'
import { createImportModesSchema, createImportLeasesSchema } from '../index.js'
import { createSyncJobsSchema } from '../index.js'
import { createNotificationChannelsSchema, createChannelConfirmationsSchema } from '../index.js'

export const customer = defineResource({
  name: 'customers',
  label: { ar: 'العملاء', en: 'Customers' },
  model: BaseModel,
  scoped: false,
  fields: {
    name: {
      type: 'string',
      required: true,
      label: { ar: 'الاسم', en: 'Name' },
      unique: true,
      searchable: true,
    },
  },
  list: ['name'],
  form: ['name'],
  show: ['name'],
  actions: ['view', 'create', 'update', 'delete'],
  validator: { validate: async (data) => data as RecordData },
})
export const order = defineResource({
  name: 'orders',
  label: { ar: 'الطلبات', en: 'Orders' },
  model: BaseModel,
  scoped: true,
  submittable: true,
  fields: {
    number: { type: 'string', sequence: 'ORD', unique: true, label: { ar: 'الرقم', en: 'Number' } },
    customerId: {
      type: 'belongsTo',
      resource: 'customers',
      label: { ar: 'العميل', en: 'Customer' },
    },
    total: {
      type: 'money',
      sortable: true,
      permissionLevel: 1,
      label: { ar: 'الإجمالي', en: 'Total' },
    },
    status: {
      type: 'lookup',
      group: 'order_status',
      filterable: true,
      label: { ar: 'الحالة', en: 'Status' },
    },
    notes: {
      type: 'text',
      searchable: true,
      sortable: true,
      label: { ar: 'ملاحظات', en: 'Notes' },
    },
    internalNote: { type: 'text', label: { ar: 'ملاحظة داخلية', en: 'Internal note' } },
    lines: {
      type: 'hasMany',
      resource: 'order_lines',
      foreignKey: 'orderId',
      inline: true,
      label: { ar: 'البنود', en: 'Lines' },
    },
  },
  list: ['number', 'notes', 'total', 'customerId', 'status'],
  form: ['notes', 'total', 'customerId', 'status', 'internalNote', 'lines'],
  show: ['number', 'notes', 'total', 'customerId', 'internalNote'],
  hidden: ['internalNote'],
  actions: ['view', 'create', 'update', 'delete', 'submit', 'cancel', 'amend'],
  validator: { validate: async (data) => data as RecordData },
})
export const line = defineResource({
  name: 'order_lines',
  label: { ar: 'البنود', en: 'Lines' },
  model: BaseModel,
  scoped: true,
  version: true,
  fields: {
    orderId: {
      type: 'belongsTo',
      resource: 'orders',
      required: true,
      label: { ar: 'الطلب', en: 'Order' },
    },
    name: { type: 'string', required: true, label: { ar: 'الاسم', en: 'Name' } },
  },
  list: ['orderId', 'name'],
  form: ['orderId', 'name'],
  show: ['orderId', 'name'],
  actions: ['view', 'create', 'update', 'delete'],
  validator: { validate: async (data) => data as RecordData },
})
export const registry = new ResourceRegistry().register([
  { name: 'customers', label: customer.label, dependsOn: [], resources: [customer] },
  { name: 'orders', label: order.label, dependsOn: ['customers'], resources: [order, line] },
])
const local = process.env.TEST_DATABASE_URL
  ? process.env.TEST_DATABASE_URL
  : {
      ...JSON.parse(
        await readFile(new URL('../../../.work/test-database.json', import.meta.url), 'utf8')
      ),
      // Parallel local runs isolate themselves with ADULA_TEST_DATABASE (a *_test name).
      ...(process.env.ADULA_TEST_DATABASE ? { database: process.env.ADULA_TEST_DATABASE } : {}),
    }
export const db = knex({
  client: 'pg',
  connection: local,
  pool: { min: 0, max: 8 },
  searchPath: ['adula_test', 'public'],
})
export const admin: Actor = {
  id: 1,
  orgPaths: ['1'],
  permissionLevel: 1,
  rules: [{ subject: 'all', action: 'manage' }],
}
export const reader: Actor = {
  id: 2,
  orgPaths: ['1.2'],
  permissionLevel: 0,
  rules: [
    { subject: 'orders', action: ['view', 'create', 'update', 'delete', 'submit'] },
    { subject: 'customers', action: 'view' },
  ],
}
export async function setup() {
  if (process.env.NODE_ENV === 'production') throw new Error('Tests cannot run in production')
  const databaseInfo = await db.raw(
    "SELECT current_database() AS name, current_setting('server_version_num')::integer AS version"
  )
  const identity = databaseInfo.rows[0]
  if (!identity.name.endsWith('_test') || Math.floor(identity.version / 10000) !== 17)
    throw new Error('Core tests require PostgreSQL 17 and a dedicated *_test database')
  await db.raw('DROP SCHEMA IF EXISTS adula_test CASCADE')
  await db.raw('CREATE SCHEMA adula_test')
  await db.schema.createTable('users', (t) => {
    t.increments('id')
    t.string('email')
  })
  await db('users').insert([
    { id: 1, email: 'admin@example.test' },
    { id: 2, email: 'reader@example.test' },
  ])
  await createCoreSchema(db)
  await createAttachmentsSchema(db)
  await createSavedViewsSchema(db)
  await createCollaborationSchema(db)
  await createAssignmentsSchema(db)
  await createMessagingSchema(db)
  await createWebhooksSchema(db)
  await createImportsSchema(db)
  await createWorkflowSchema(db)
  await createManagedAssignmentsSchema(db)
  await createRoleKeysSchema(db)
  await createNotificationTargetsSchema(db)
  await createUploadGrantsSchema(db)
  await createInboundWebhooksSchema(db)
  await createTwoFactorSchema(db)
  await createImportModesSchema(db)
  await createImportLeasesSchema(db)
  await createSyncJobsSchema(db)
  await createNotificationChannelsSchema(db)
  await createChannelConfirmationsSchema(db)
  await db('org_units').insert([
    { id: 1, name: 'Root', type: 'root', path: '1' },
    { id: 2, parent_id: 1, name: 'A', type: 'unit', path: '1.2' },
    { id: 3, parent_id: 1, name: 'B', type: 'unit', path: '1.3' },
    { id: 4, parent_id: 2, name: 'Child', type: 'unit', path: '1.2.4' },
  ])
  for (const resource of registry.all()) await createResourceTable(db, resource)
  await db('lookups').insert([
    { group: 'order_status', key: 'open', label_ar: 'مفتوح', label_en: 'Open' },
    { group: 'order_status', key: 'closed', label_ar: 'مغلق', label_en: 'Closed' },
  ])
}
