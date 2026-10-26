import { useState, type ReactElement } from 'react'
import { Head } from '@inertiajs/react'
import { Plus } from 'lucide-react'
import type { WorkflowDelegation } from 'adula'
import Workspace from '~/layouts/workspace'
import { AdminHeader } from '~/components/admin-nav'
import { Button } from '~/components/ui/button'
import { DelegationDialog, DelegationTable } from '~/components/delegations'

type Props = { delegations: WorkflowDelegation[] }

/** Every delegation in force or scheduled; administrators create and revoke for anyone. */
export default function AdminDelegations({ delegations }: Props) {
  const [creating, setCreating] = useState(false)
  return (
    <>
      <Head title="تفويضات الموافقات" />
      <AdminHeader
        title="تفويضات الموافقات"
        description="التفويضات السارية والمجدولة لجميع المستخدمين. أنشئ تفويضاً نيابة عن موظف غائب أو ألغِ تفويضاً قائماً."
      >
        <Button onClick={() => setCreating(true)}>
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
        admin
        open={creating}
        onOpenChange={setCreating}
        endpoint="/admin/delegations"
        candidatesUrl="/admin/delegations/candidates"
      />
    </>
  )
}
AdminDelegations.layout = (page: ReactElement) => <Workspace>{page}</Workspace>
