import { defineBulkActions } from 'adula'

/** Test-only consumer of resource-defined bulk actions (ADR 017). */
export const fixtureBulkActions = [
  defineBulkActions('tasks', [
    {
      key: 'markDone',
      label: { ar: 'تعليم كمنجزة', en: 'Mark as done' },
      values: { done: true },
      confirm: { ar: 'تعليم المهام المحددة كمنجزة؟', en: 'Mark the selected tasks as done?' },
    },
  ]),
]
