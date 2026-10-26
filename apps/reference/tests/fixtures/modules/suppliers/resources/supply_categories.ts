import { defineResource } from 'adula'

// The fields are the source of truth: no validator or model (ADR 045).
export default defineResource({
  name: 'supply_categories',
  label: { ar: 'فئات التوريد', en: 'Supply categories' },
  recordLabel: { ar: 'فئة توريد', en: 'Supply category' },
  scoped: true,
  fields: {
    name: {
      type: 'string',
      required: true,
      max: 100,
      searchable: true,
      sortable: true,
      label: { ar: 'الاسم', en: 'Name' },
    },
  },
  // One name per organization unit among live records.
  unique: [['orgUnitId', 'name']],
  list: ['name'],
  form: ['name'],
  show: ['name'],
  actions: ['view', 'create', 'update', 'delete'],
})
