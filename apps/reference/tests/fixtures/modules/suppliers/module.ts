import type { Module } from 'adula'
import supplyCategories from './resources/supply_categories.js'
import suppliers from './resources/suppliers.js'

// The consumer of the 2.2 field types (ADR 045). A test fixture like the other example
// modules (ADR 017): the normal runtime registers no example module.
export default {
  name: 'suppliers',
  reference: true,
  label: { ar: 'الموردون', en: 'Suppliers' },
  dependsOn: [],
  resources: [supplyCategories, suppliers],
  defaultRoles: [
    {
      key: 'suppliers_manager',
      name: 'مدير الموردين',
      permissionLevel: 1,
      rules: [
        { subject: 'suppliers', action: 'view' },
        { subject: 'suppliers', action: 'create' },
        { subject: 'suppliers', action: 'update' },
        { subject: 'suppliers', action: 'delete' },
        { subject: 'supply_categories', action: 'view' },
        { subject: 'supply_categories', action: 'create' },
      ],
    },
  ],
} satisfies Module
