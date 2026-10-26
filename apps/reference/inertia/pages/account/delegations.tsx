import { useState, type ReactElement } from 'react'
import { Head } from '@inertiajs/react'
import { Plus, UserRoundCheck } from 'lucide-react'
import type { WorkflowDelegation } from 'adula'
import Workspace from '~/layouts/workspace'
import { Alert, AlertDescription } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { formatDate } from '~/components/ui/resource-value'
import { useUiPreferences } from '~/components/ui/ui-preferences'
import { DelegationDialog, DelegationTable } from '~/components/delegations'

type Props = { delegations: { given: WorkflowDelegation[]; received: WorkflowDelegation[] } }

/** Out-of-office delegation of the user's workflow approvals (ADR 044). */
export default function AccountDelegations({ delegations }: Props) {
  const { calendar } = useUiPreferences()
  const [creating, setCreating] = useState(false)
  const active = delegations.given.find((item) => item.status === 'active')
  const current = delegations.given.filter(
    (item) => item.status === 'active' || item.status === 'scheduled'
  )
  const past = delegations.given.filter(
    (item) => item.status === 'ended' || item.status === 'revoked'
  )
  const received = delegations.received.filter((item) => item.status !== 'ended')
  return (
    <>
      <Head title="التفويض أثناء الغياب" />
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
            <UserRoundCheck size={15} />
            <span>حسابي</span>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">التفويض أثناء الغياب</h1>
          <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
            فوّض موافقاتك إلى زميل خلال إجازتك أو غيابك. يقرر المفوَّض إليه نيابة عنك ويُسجَّل
            ذلك في سجل التدفق، ولا يحصل على صلاحيات إضافية على السجلات.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus size={16} />
          تفويض جديد
        </Button>
      </div>
      {active && (
        <Alert className="mb-6">
          <AlertDescription>
            موافقاتك مفوّضة الآن إلى <strong>{active.delegateName ?? `#${active.delegateId}`}</strong>{' '}
            حتى <bdi className="tabular-nums">{formatDate(active.endsOn, calendar)}</bdi>.
          </AlertDescription>
        </Alert>
      )}
      <section aria-labelledby="given-heading" className="mb-10 space-y-3">
        <h2 id="given-heading" className="text-base font-semibold">
          تفويضاتي الحالية والقادمة
        </h2>
        <DelegationTable
          caption="تفويضاتي الحالية والقادمة"
          delegations={current}
          columns={['delegate']}
          revokeUrl={(id) => `/account/delegations/${id}`}
          empty="لا تفويض حالي أو مجدول. موافقاتك تصلك مباشرة."
        />
      </section>
      <section aria-labelledby="received-heading" className="mb-10 space-y-3">
        <h2 id="received-heading" className="text-base font-semibold">
          تفويضات إليّ
        </h2>
        <DelegationTable
          caption="تفويضات إليّ"
          delegations={received}
          columns={['delegator']}
          empty="لم يفوّض إليك أحد موافقاته."
        />
      </section>
      {past.length > 0 && (
        <section aria-labelledby="past-heading" className="space-y-3">
          <h2 id="past-heading" className="text-base font-semibold text-muted-foreground">
            تفويضات سابقة
          </h2>
          <DelegationTable
            caption="تفويضات سابقة"
            delegations={past}
            columns={['delegate']}
            empty=""
          />
        </section>
      )}
      <DelegationDialog
        open={creating}
        onOpenChange={setCreating}
        endpoint="/account/delegations"
        candidatesUrl="/account/delegations/candidates"
      />
    </>
  )
}
AccountDelegations.layout = (page: ReactElement) => <Workspace>{page}</Workspace>
