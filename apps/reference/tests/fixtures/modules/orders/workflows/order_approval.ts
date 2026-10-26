import { defineWorkflow } from 'adula'

/**
 * Two-level approval: orders from 10,000.00 need the department manager and then
 * the general manager; smaller orders are approved directly. Rejection cancels. The
 * manager step carries an SLA that escalates to the general manager when it is late.
 */
export default defineWorkflow({
  name: 'order_approval',
  version: 1,
  resource: 'orders',
  label: 'اعتماد الطلبات',
  start: 'size',
  steps: {
    size: {
      type: 'condition',
      label: 'فحص قيمة الطلب',
      when: (order) => BigInt(String(order.total ?? '0')) >= 1000000n,
      then: 'manager',
      else: 'approved',
    },
    manager: {
      type: 'approval',
      label: 'موافقة مدير القسم',
      assignees: { role: 'department_manager' },
      dueInDays: 2,
      // 48 hours to decide; a reminder 8 hours before, then the general manager of the
      // approver's unit (or its nearest ancestor) is told (ADR 044).
      sla: {
        hours: 48,
        dueSoonHours: 8,
        escalate: { action: 'notify', to: { manager: 'general_manager' } },
      },
      approve: 'director',
      reject: 'rejected',
    },
    director: {
      type: 'approval',
      label: 'موافقة المدير العام',
      assignees: { role: 'general_manager' },
      dueInDays: 2,
      approve: 'mark',
      reject: 'rejected',
    },
    mark: {
      type: 'update',
      label: 'تعليم الطلب كمعتمد',
      values: { status: 'approved' },
      next: 'tell',
    },
    tell: { type: 'notify', label: 'إبلاغ مقدم الطلب', to: 'submitter', next: 'approved' },
    approved: { type: 'end', label: 'معتمد', outcome: 'approved' },
    rejected: { type: 'end', label: 'مرفوض', outcome: 'rejected', cancelDocument: true },
  },
})
