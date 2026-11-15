import type { ReactElement } from 'react'
import { Head, router } from '@inertiajs/react'
import Workspace from '~/layouts/workspace'
import { InviteUserDialog } from '~/components/invite-user-dialog'

/**
 * The invitation for someone who may invite without administering users; administrators are
 * sent to the same dialog over the users list.
 */
export default function Invite() {
  return (
    <>
      <Head title="دعوة مستخدم" />
      <InviteUserDialog
        open
        // Closing a dialog never shows the top progress bar (owner decision 29).
        onClose={() => router.visit('/', { showProgress: false })}
      />
    </>
  )
}
Invite.layout = (page: ReactElement) => <Workspace>{page}</Workspace>
