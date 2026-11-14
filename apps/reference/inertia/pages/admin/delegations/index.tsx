import type { ReactElement } from 'react'
import { Head } from '@inertiajs/react'
import { Plus } from 'lucide-react'
import type { WorkflowDelegation } from 'adula'
import Workspace from '~/layouts/workspace'
import { AdminHeader } from '~/components/admin-nav'
import { Button } from '~/components/ui/button'
import { useDialogParam } from '~/components/ui/dialog_param'
import { DelegationDialog, DelegationTable } from '~/components/delegations'

type Props = { delegations: WorkflowDelegation[]; timeZone: string }

/** Every delegation in force or scheduled; administrators create and revoke for anyone. */
export default function AdminDelegations({ delegations, timeZone }: Props) {
  // `?new=1` opens the create dialog over the list (decision 30).
  const creating = useDialogParam('new', (value) => (value === '1' ? true : undefined))
  return (
    <>
      <Head title="تفويضات الموافقات" />
      <AdminHeader
        title="تفويضات الموافقات"
        description="التفويضات السارية والمجدولة لجميع المستخدمين. أنشئ تفويضاً نيابة عن موظف غائب أو ألغِ تفويضاً قائماً."
      >
        <Button onClick={() => creating.open()}>
          <Plus size={16} />
          تفويض جديد
        </Button>
      </AdminHeader>
      <DelegationTable
        caption="تفويضات الموافقات"
        delegations={delegations}
        columns={['delegator', 'delegate']}
        revokeUrl={(id) => `/admin/delegations/${id}`}
        empty="لا تفويضات سارية أو مجدولة."
      />
      <DelegationDialog
        timeZone={timeZone}
        admin
        open={creating.item !== null}
        onOpenChange={(open) => (open ? creating.open() : creating.close())}
        endpoint="/admin/delegations"
        candidatesUrl="/admin/delegations/candidates"
      />
    </>
  )
}
AdminDelegations.layout = (page: ReactElement) => <Workspace>{page}</Workspace>
