import type { ReactElement } from 'react'
import { Head, usePage } from '@inertiajs/react'
import type { DashboardResult, DashboardSummary } from 'adula'
import { ResourceDashboard } from '~/components/ui/resource-dashboard'
import Workspace from '~/layouts/workspace'

type Props = {
  /** Computed by the Dashboards service as the viewer (ADR 046). */
  dashboard: DashboardResult
}

export default function DashboardShow({ dashboard }: Props) {
  // The dashboards this viewer may open arrive as the shared `dashboards` prop.
  const { dashboards = [] } = usePage<{ dashboards?: DashboardSummary[] }>().props
  return (
    <>
      <Head title={dashboard.label} />
      <ResourceDashboard dashboard={dashboard} dashboards={dashboards} />
    </>
  )
}
DashboardShow.layout = (page: ReactElement) => <Workspace>{page}</Workspace>
