import { defineDashboard } from 'adula'

/** Test-only consumer of dashboards (ADR 017: never part of the normal runtime). */
export const fixtureDashboards = [
  defineDashboard({
    name: 'orders_overview',
    label: { ar: 'لوحة الطلبات', en: 'Orders overview' },
    description: { ar: 'مؤشرات الطلبات والمهام المتاحة لك', en: 'Orders and tasks you can see' },
    widgets: [
      {
        key: 'orders',
        label: { ar: 'عدد الطلبات', en: 'Orders' },
        resource: 'orders',
        measure: 'count',
        // Offered on the personal overview (ADR 050); every orders viewer may add it.
        overview: true,
      },
      {
        key: 'ordersTotal',
        label: { ar: 'إجمالي الطلبات', en: 'Orders total' },
        resource: 'orders',
        measure: { sum: 'total' },
        // Also offered there, but only viewers who may read the total ever see it.
        overview: true,
      },
      {
        key: 'ordersByStatus',
        label: { ar: 'الطلبات حسب الحالة', en: 'Orders by status' },
        resource: 'orders',
        measure: 'count',
        groupBy: 'status',
      },
      {
        key: 'tasksByDone',
        label: { ar: 'المهام حسب الإنجاز', en: 'Tasks by completion' },
        resource: 'tasks',
        measure: 'count',
        groupBy: 'done',
      },
    ],
  }),
]
