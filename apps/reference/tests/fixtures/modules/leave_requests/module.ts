import { ACTOR_ID, type Module } from 'adula'
import resource_leave_requests from './resources/leave_requests.js'
// adula:imports
// Scaffolded by `node ace adula:app leave_requests --label-ar="طلبات الإجازة" --label-en="Leave requests"`,
// then marked reference (ADR 017), the resource filled in and a status lookup added; docs/applications.md.
export default {
  name: 'leave_requests',
  reference: true,
  label: {
    ar: 'طلبات الإجازة',
    en: 'Leave requests',
  },
  dependsOn: [],
  resources: [
    resource_leave_requests,
    /* adula:resources */
  ],
  lookups: {
    leave_request_status: [
      { key: 'pending', label: { ar: 'قيد المراجعة', en: 'Pending' } },
      { key: 'approved', label: { ar: 'معتمد', en: 'Approved' } },
      { key: 'rejected', label: { ar: 'مرفوض', en: 'Rejected' } },
    ],
  },
  // Created by `node ace adula:install` when missing; administrators own them afterwards.
  defaultRoles: [
    {
      key: 'leave_requests_manager',
      name: 'مدير طلبات الإجازة',
      permissionLevel: 1,
      rules: [
        { subject: 'leave_requests', action: 'view' },
        { subject: 'leave_requests', action: 'create' },
        { subject: 'leave_requests', action: 'update' },
        { subject: 'leave_requests', action: 'delete' },
      ],
    },
    {
      key: 'leave_requests_user',
      name: 'مستخدم طلبات الإجازة',
      rules: [
        { subject: 'leave_requests', action: 'view' },
        { subject: 'leave_requests', action: 'create' },
        // Each user edits only the records they created.
        {
          subject: 'leave_requests',
          action: 'update',
          conditions: { createdBy: ACTOR_ID },
        },
      ],
    },
  ],
} satisfies Module
