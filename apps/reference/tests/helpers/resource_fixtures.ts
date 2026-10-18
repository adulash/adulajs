import db from '@adonisjs/lucid/services/db'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import attachmentManager from '@jrmc/adonis-attachment/services/main'
import env from '#start/env'
import { attachmentUrl, registerUpload } from 'adula'
import { adula } from '#services/adula'
import type { FixtureContext, ResourceFixture } from '#tests/helpers/resource_contract'

/** A real Drive write plus AdulaJS metadata row, exactly what POST /attachments does. */
async function uploadContract(
  userId: number,
  unique: string,
  target = { resource: 'orders', field: 'contract' }
) {
  const directory = await mkdtemp(join(tmpdir(), 'adula-fixture-'))
  const source = join(directory, 'contract.pdf')
  await writeFile(source, `%PDF-1.4\n% عقد ${unique}\n`)
  try {
    const disk = env.get('DRIVE_DISK')
    const attachment = await attachmentManager.createFromPath(source, 'عقد.pdf')
    attachment.name = `${randomUUID()}.pdf`
    attachment.setOptions({ folder: `resources/${target.resource}/${target.field}`, disk })
    await attachmentManager.write(attachment)
    const path = (attachment.path ?? '').replaceAll('\\', '/')
    const row = await registerUpload(db.connection().getWriteClient(), {
      disk,
      path,
      name: attachment.name,
      originalName: 'عقد.pdf',
      size: attachment.size,
      mimeType: 'application/pdf',
      extname: 'pdf',
      data: { ...attachment.toObject(), path },
      uploadedBy: userId,
      ...target,
    })
    return {
      id: row.id,
      summary: {
        id: row.id,
        name: 'عقد.pdf',
        size: row.size,
        mimeType: 'application/pdf',
        url: attachmentUrl(row.id),
      },
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function parentOrder({ userId, orgUnitId, unique }: FixtureContext) {
  const runtime = adula()
  const actor = await runtime.actors.load(userId)
  return runtime.resources.save('orders', actor, { orgUnitId, notes: `طلب مرتبط ${unique}` })
}

export const resourceFixtures: Record<string, ResourceFixture> = {
  customers: ({ unique }) => ({
    input: { name: `عميل ${unique}`, email: 'customer@example.test' },
    expected: { name: `عميل ${unique}`, email: 'customer@example.test' },
    update: { name: `عميل محدث ${unique}`, email: 'updated@example.test' },
    updated: { name: `عميل محدث ${unique}`, email: 'updated@example.test' },
  }),
  orders: async ({ userId, unique }) => {
    const runtime = adula()
    const actor = await runtime.actors.load(userId)
    const customer = await runtime.resources.save('customers', actor, {
      name: `عميل الطلب ${unique}`,
    })
    await db
      .connection()
      .getWriteClient()('lookups')
      .insert({
        group: 'order_status',
        key: 'contract_open',
        label_ar: 'مفتوح للاختبار',
        label_en: 'Contract open',
      })
      .onConflict(['group', 'key'])
      .ignore()
    const values = {
      customerId: customer.id,
      total: '9007199254740993',
      status: 'contract_open',
      notes: `طلب ${unique}`,
      issuedAt: '2026-09-18',
      internalNote: `ملاحظة خاصة ${unique}`,
    }
    const contract = await uploadContract(userId, unique)
    const replacement = await uploadContract(userId, `${unique}-replacement`)
    return {
      input: {
        ...values,
        contract: contract.id,
        lines: [{ description: 'بند اختباري', quantity: 2 }],
      },
      expected: { ...values, contract: contract.summary },
      stored: { contract: contract.id },
      inline: { lines: [{ description: 'بند اختباري', quantity: 2 }] },
      update: { ...values, notes: `طلب محدث ${unique}`, contract: replacement.id, lines: [] },
      updated: { ...values, notes: `طلب محدث ${unique}`, contract: replacement.summary },
      updatedStored: { contract: replacement.id },
      updatedInline: { lines: [{ description: 'بند اختباري', quantity: 2 }] },
    }
  },
  order_lines: async (context) => {
    const order = await parentOrder(context)
    const values = { orderId: order.id, description: `بند ${context.unique}`, quantity: 2 }
    return {
      input: values,
      expected: values,
      update: { ...values, quantity: 3 },
      updated: { ...values, quantity: 3 },
    }
  },
  order_receipts: async ({ userId, unique }) => {
    const scan = await uploadContract(userId, unique, {
      resource: 'order_receipts',
      field: 'scan',
    })
    const values = { reference: `إيصال ${unique}` }
    return {
      input: { ...values, scan: scan.id },
      expected: { ...values, scan: scan.summary },
      stored: { scan: scan.id },
    }
  },
  order_deliveries: async (context) => {
    const order = await parentOrder(context)
    const values = { orderId: order.id, recipient: `مستلم ${context.unique}` }
    return {
      input: values,
      expected: values,
      update: { ...values, recipient: `مستلم محدث ${context.unique}` },
      updated: { ...values, recipient: `مستلم محدث ${context.unique}` },
    }
  },
  order_inspections: async (context) => {
    // The writer is an active member of the record's unit, so it is an eligible inspector.
    const values = { inspector: context.userId, findings: `ملاحظات ${context.unique}` }
    return {
      input: values,
      expected: values,
      update: { ...values, findings: `ملاحظات محدثة ${context.unique}` },
      updated: { ...values, findings: `ملاحظات محدثة ${context.unique}` },
    }
  },
  tasks: async (context) => {
    const order = await parentOrder(context)
    const values = { title: `مهمة ${context.unique}`, orderId: order.id, done: false }
    return {
      input: values,
      expected: values,
      update: { ...values, done: true },
      updated: { ...values, done: true },
    }
  },
  leave_requests: async (context) => {
    // adula:install seeds the module lookups; the contract adds the row it needs itself.
    await db
      .connection()
      .getWriteClient()('lookups')
      .insert({
        group: 'leave_request_status',
        key: 'pending',
        label_ar: 'قيد المراجعة',
        label_en: 'Pending',
      })
      .onConflict(['group', 'key'])
      .ignore()
    const values = {
      employee: context.userId,
      startDate: '2026-11-01',
      endDate: '2026-11-05',
      reason: `إجازة سنوية ${context.unique}`,
      status: 'pending',
    }
    return {
      input: values,
      expected: values,
      update: { ...values, endDate: '2026-11-07' },
      updated: { ...values, endDate: '2026-11-07' },
    }
  },
}
