import type { Module } from 'adula'
import orders from './resources/orders.js'
import order_lines from './resources/order_lines.js'
import order_receipts from './resources/order_receipts.js'
import order_deliveries from './resources/order_deliveries.js'
import order_inspections from './resources/order_inspections.js'
import order_documents from './resources/order_documents.js'
import orderApproval from './workflows/order_approval.js'
// adula:imports
export default {
  name: 'orders',
  reference: true,
  label: { ar: 'الطلبات', en: 'Orders' },
  dependsOn: ['customers'],
  resources: [
    orders,
    order_lines,
    order_receipts,
    order_deliveries,
    order_inspections,
    order_documents /* adula:resources */,
  ],
  workflows: [orderApproval],
  lookups: {
    order_status: [
      { key: 'open', label: { ar: 'مفتوح', en: 'Open' } },
      { key: 'closed', label: { ar: 'مغلق', en: 'Closed' } },
      { key: 'approved', label: { ar: 'معتمد', en: 'Approved' } },
    ],
  },
  // Addressed by key from the approval workflow; administrators may rename them.
  defaultRoles: [
    {
      key: 'department_manager',
      name: 'مدير القسم',
      permissionLevel: 1,
      rules: [{ subject: 'orders', action: 'view' }],
    },
    {
      key: 'general_manager',
      name: 'المدير العام',
      permissionLevel: 1,
      rules: [{ subject: 'orders', action: 'view' }],
    },
  ],
} satisfies Module
