import { defineResource } from 'adula'
import Model from '#tests/fixtures/modules/orders/models/orders'
import { validator } from '#tests/fixtures/modules/orders/validators/orders'

export default defineResource({
  ...{
    name: 'orders',
    label: {
      ar: 'الطلبات',
      en: 'Orders',
    },
    scoped: true,
    submittable: true,
    version: true,
    fields: {
      number: {
        type: 'string',
        label: {
          ar: 'رقم الطلب',
          en: 'Number',
        },
        sequence: 'ORD',
        unique: true,
      },
      customerId: {
        type: 'belongsTo',
        resource: 'customers',
        label: {
          ar: 'العميل',
          en: 'Customer',
        },
      },
      total: {
        type: 'money',
        label: {
          ar: 'الإجمالي',
          en: 'Total',
        },
        permissionLevel: 1,
        sortable: true,
      },
      status: {
        type: 'lookup',
        group: 'order_status',
        label: {
          ar: 'الحالة',
          en: 'Status',
        },
        filterable: true,
      },
      notes: {
        type: 'text',
        label: {
          ar: 'ملاحظات',
          en: 'Notes',
        },
        searchable: true,
      },
      issuedAt: {
        type: 'date',
        label: {
          ar: 'تاريخ الإصدار',
          en: 'Issued at',
        },
        sortable: true,
      },
      internalNote: {
        type: 'text',
        label: {
          ar: 'ملاحظة داخلية',
          en: 'Internal note',
        },
      },
      contract: {
        type: 'attachment',
        label: {
          ar: 'العقد',
          en: 'Contract',
        },
      },
      lines: {
        type: 'hasMany',
        resource: 'order_lines',
        foreignKey: 'orderId',
        inline: true,
        label: {
          ar: 'البنود',
          en: 'Lines',
        },
      },
    },
    list: ['number', 'customerId', 'status', 'total', 'issuedAt'],
    form: [
      'customerId',
      'total',
      'status',
      'notes',
      'issuedAt',
      'internalNote',
      'contract',
      'lines',
    ],
    show: [
      'number',
      'customerId',
      'status',
      'total',
      'notes',
      'issuedAt',
      'internalNote',
      'contract',
    ],
    hidden: ['internalNote'],
    actions: ['view', 'create', 'update', 'delete', 'submit', 'cancel', 'amend'],
    // The code template consumer of ADR 048; internalNote is printed only to readers of it.
    printTemplates: [
      {
        key: 'invoice',
        label: { ar: 'فاتورة الطلب', en: 'Order invoice' },
        paper: 'A4',
        orientation: 'portrait',
        header: 'فاتورة الطلب {{field.number}}',
        footer: 'شكرًا لتعاملكم مع {{company}}',
        fields: ['number', 'customerId', 'issuedAt', 'status', 'notes', 'internalNote'],
        lines: { lines: ['description', 'quantity'] },
        totals: [
          {
            label: { ar: 'إجمالي الكميات', en: 'Total quantity' },
            lines: 'lines',
            column: 'quantity',
          },
          { label: { ar: 'إجمالي الطلب', en: 'Order total' }, field: 'total' },
        ],
      },
    ],
  },
  model: Model,
  validator,
})
