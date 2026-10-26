import '@adonisjs/inertia/types'

import type React from 'react'
import type { Prettify } from '@adonisjs/core/types/common'

type ExtractProps<T> =
  T extends React.FC<infer Props>
    ? Prettify<Omit<Props, 'children'>>
    : T extends React.Component<infer Props>
      ? Prettify<Omit<Props, 'children'>>
      : never

declare module '@adonisjs/inertia/types' {
  export interface InertiaPages {
    'account/delegations': ExtractProps<(typeof import('../../inertia/pages/account/delegations.tsx'))['default']>
    'account/profile': ExtractProps<(typeof import('../../inertia/pages/account/profile.tsx'))['default']>
    'account/sessions': ExtractProps<(typeof import('../../inertia/pages/account/sessions.tsx'))['default']>
    'account/tokens': ExtractProps<(typeof import('../../inertia/pages/account/tokens.tsx'))['default']>
    'admin/activity/index': ExtractProps<(typeof import('../../inertia/pages/admin/activity/index.tsx'))['default']>
    'admin/delegations/index': ExtractProps<(typeof import('../../inertia/pages/admin/delegations/index.tsx'))['default']>
    'admin/forbidden': ExtractProps<(typeof import('../../inertia/pages/admin/forbidden.tsx'))['default']>
    'admin/jobs/index': ExtractProps<(typeof import('../../inertia/pages/admin/jobs/index.tsx'))['default']>
    'admin/lookups/index': ExtractProps<(typeof import('../../inertia/pages/admin/lookups/index.tsx'))['default']>
    'admin/notifications/index': ExtractProps<(typeof import('../../inertia/pages/admin/notifications/index.tsx'))['default']>
    'admin/org_units/index': ExtractProps<(typeof import('../../inertia/pages/admin/org_units/index.tsx'))['default']>
    'admin/roles/index': ExtractProps<(typeof import('../../inertia/pages/admin/roles/index.tsx'))['default']>
    'admin/roles/show': ExtractProps<(typeof import('../../inertia/pages/admin/roles/show.tsx'))['default']>
    'admin/sequences/index': ExtractProps<(typeof import('../../inertia/pages/admin/sequences/index.tsx'))['default']>
    'admin/sessions/index': ExtractProps<(typeof import('../../inertia/pages/admin/sessions/index.tsx'))['default']>
    'admin/settings/index': ExtractProps<(typeof import('../../inertia/pages/admin/settings/index.tsx'))['default']>
    'admin/setup/index': ExtractProps<(typeof import('../../inertia/pages/admin/setup/index.tsx'))['default']>
    'admin/templates/index': ExtractProps<(typeof import('../../inertia/pages/admin/templates/index.tsx'))['default']>
    'admin/users/index': ExtractProps<(typeof import('../../inertia/pages/admin/users/index.tsx'))['default']>
    'admin/users/show': ExtractProps<(typeof import('../../inertia/pages/admin/users/show.tsx'))['default']>
    'admin/webhooks/index': ExtractProps<(typeof import('../../inertia/pages/admin/webhooks/index.tsx'))['default']>
    'admin/workflows/index': ExtractProps<(typeof import('../../inertia/pages/admin/workflows/index.tsx'))['default']>
    'auth/forgot': ExtractProps<(typeof import('../../inertia/pages/auth/forgot.tsx'))['default']>
    'auth/invitation': ExtractProps<(typeof import('../../inertia/pages/auth/invitation.tsx'))['default']>
    'auth/login': ExtractProps<(typeof import('../../inertia/pages/auth/login.tsx'))['default']>
    'auth/reset': ExtractProps<(typeof import('../../inertia/pages/auth/reset.tsx'))['default']>
    'auth/signup': ExtractProps<(typeof import('../../inertia/pages/auth/signup.tsx'))['default']>
    'auth/two_factor': ExtractProps<(typeof import('../../inertia/pages/auth/two_factor.tsx'))['default']>
    'errors/not_found': ExtractProps<(typeof import('../../inertia/pages/errors/not_found.tsx'))['default']>
    'errors/server_error': ExtractProps<(typeof import('../../inertia/pages/errors/server_error.tsx'))['default']>
    'home': ExtractProps<(typeof import('../../inertia/pages/home.tsx'))['default']>
    'resources/page': ExtractProps<(typeof import('../../inertia/pages/resources/page.tsx'))['default']>
    'users/invite': ExtractProps<(typeof import('../../inertia/pages/users/invite.tsx'))['default']>
    'work/imports': ExtractProps<(typeof import('../../inertia/pages/work/imports.tsx'))['default']>
    'work/my_tasks': ExtractProps<(typeof import('../../inertia/pages/work/my_tasks.tsx'))['default']>
  }
}
