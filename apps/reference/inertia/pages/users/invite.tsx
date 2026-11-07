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
      <InviteUserDialog open onClose={() => router.visit('/')} />
    </>
  )
}
Invite.layout = (page: ReactElement) => <Workspace>{page}</Workspace>
