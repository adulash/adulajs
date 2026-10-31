import { BaseSchema } from '@adonisjs/lucid/schema'
import { createResourceTable } from 'adula'
// Immutable initial schema snapshot. Later changes require a new migration.
export default class extends BaseSchema {
  async up() {
    await createResourceTable(this.db.getWriteClient(), {
      name: 'leave_requests',
      scoped: true,
      fields: {
        employee: { type: 'user', required: true, label: { ar: 'الموظف', en: 'Employee' } },
        startDate: {
          type: 'date',
          required: true,
          label: { ar: 'تاريخ البداية', en: 'Start date' },
        },
        endDate: { type: 'date', required: true, label: { ar: 'تاريخ النهاية', en: 'End date' } },
        reason: { type: 'text', searchable: true, label: { ar: 'السبب', en: 'Reason' } },
        status: {
          type: 'lookup',
          group: 'leave_request_status',
          label: { ar: 'الحالة', en: 'Status' },
        },
      },
    })
  }
  async down() {
    throw new Error('Use an expand/contract migration or restore a backup')
  }
}
