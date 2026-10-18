import { defineResource } from 'adula'
import Model from '#tests/fixtures/modules/leave_requests/models/leave_requests'
import { validator } from '#tests/fixtures/modules/leave_requests/validators/leave_requests'

export default defineResource({
  name: 'leave_requests',
  label: { ar: 'طلبات الإجازة', en: 'Leave requests' },
  recordLabel: { ar: 'طلب إجازة', en: 'Leave request' },
  model: Model,
  scoped: true,
  fields: {
    employee: {
      type: 'user',
      required: true,
      filterable: true,
      sortable: true,
      label: { ar: 'الموظف', en: 'Employee' },
    },
    startDate: {
      type: 'date',
      required: true,
      sortable: true,
      filterable: true,
      label: { ar: 'تاريخ البداية', en: 'Start date' },
    },
    endDate: {
      type: 'date',
      required: true,
      sortable: true,
      label: { ar: 'تاريخ النهاية', en: 'End date' },
    },
    reason: { type: 'text', searchable: true, label: { ar: 'السبب', en: 'Reason' } },
    status: {
      type: 'lookup',
      group: 'leave_request_status',
      filterable: true,
      label: { ar: 'الحالة', en: 'Status' },
    },
  },
  list: ['employee', 'startDate', 'endDate', 'status'],
  form: ['employee', 'startDate', 'endDate', 'reason', 'status'],
  show: ['employee', 'startDate', 'endDate', 'reason', 'status'],
  actions: ['view', 'create', 'update', 'delete'],
  validator,
})
