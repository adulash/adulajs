import { defineResource } from 'adula'

// The consumer of multiple attachments and preview (ADR 047): up to three files per record,
// in order. The fields are the source of truth: no validator or model (ADR 045). SVG and
// HTML are accepted on purpose so tests prove they are never served inline.
export default defineResource({
  name: 'order_documents',
  label: { ar: 'مستندات الطلبات', en: 'Order documents' },
  recordLabel: { ar: 'مستند', en: 'Document' },
  scoped: true,
  fields: {
    title: {
      type: 'string',
      required: true,
      searchable: true,
      label: { ar: 'العنوان', en: 'Title' },
    },
    files: {
      type: 'attachment',
      multiple: true,
      max: 3,
      accept: ['pdf', 'png', 'jpg', 'jpeg', 'txt', 'svg', 'html'],
      maxSize: '2mb',
      filterable: true,
      label: { ar: 'الملفات', en: 'Files' },
    },
  },
  list: ['title', 'files'],
  form: ['title', 'files'],
  show: ['title', 'files'],
  actions: ['view', 'create', 'update', 'delete'],
})
