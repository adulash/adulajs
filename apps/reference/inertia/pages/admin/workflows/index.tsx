import { useState, type ReactElement } from 'react'
import { Head, router } from '@inertiajs/react'
import { Link } from '@adonisjs/inertia/react'
import axios from 'axios'
import { RotateCcw } from 'lucide-react'
import type { WorkflowRun } from 'adula'
import Workspace from '~/layouts/workspace'
import { useDateTimeFormatter } from '~/components/admin-nav'
import { Button } from '~/components/ui/button'
import { openRecord, plainClick } from '~/components/ui/resource-surface'
import { RecordOverlayDialog } from '~/components/ui/resource-page'

type Props = { runs: WorkflowRun[] }

export default function FailedWorkflows({ runs }: Props) {
  const formatDateTime = useDateTimeFormatter()
  const [busy, setBusy] = useState<string | null>(null)
  return (
    <>
      <Head title="تدفقات فاشلة" />
      <div className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">تدفقات فاشلة</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          خطوات استنفدت محاولاتها. أصلح السبب ثم أعد التشغيل من الخطوة نفسها.
        </p>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-muted text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-5 py-3 text-start font-medium">
                التدفق
              </th>
              <th scope="col" className="px-5 py-3 text-start font-medium">
                السجل
              </th>
              <th scope="col" className="px-5 py-3 text-start font-medium">
                الخطوة
              </th>
              <th scope="col" className="px-5 py-3 text-start font-medium">
                الخطأ
              </th>
              <th scope="col" className="px-5 py-3">
                <span className="sr-only">إجراء</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id} className="border-b last:border-0">
                <td className="px-5 py-3">
                  {run.label} <span className="text-xs text-muted-foreground">v{run.version}</span>
                </td>
                <td className="px-5 py-3">
                  <Link
                    href={`/resources/${run.resource}/${run.recordId}`}
                    // The record opens in a dialog over this list, which stays mounted.
                    onClick={(event) => {
                      if (!plainClick(event)) return
                      event.preventDefault()
                      void openRecord(run.resource, run.recordId, 'show', {
                        label: run.resourceLabel,
                      })
                    }}
                    className="text-primary"
                  >
                    {run.resourceLabel} #{run.recordId}
                  </Link>
                </td>
                <td className="px-5 py-3">{run.stepLabel}</td>
                <td className="px-5 py-3 text-xs text-destructive">
                  {run.lastError}
                  <span className="block text-muted-foreground">
                    {run.attempts} محاولة ·{' '}
                    {formatDateTime(run.history.at(-1)?.at ?? run.createdAt)}
                  </span>
                </td>
                <td className="px-5 py-3">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === run.id}
                    onClick={async () => {
                      setBusy(run.id)
                      try {
                        await axios.post(
                          `/admin/workflows/${run.id}/retry`,
                          {},
                          { headers: { Accept: 'application/json' }, withXSRFToken: true }
                        )
                        router.reload({ only: ['runs'] })
                      } finally {
                        setBusy(null)
                      }
                    }}
                  >
                    <RotateCcw size={14} />
                    إعادة التشغيل
                  </Button>
                </td>
              </tr>
            ))}
            {runs.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-muted-foreground">
                  لا تدفقات فاشلة.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <RecordOverlayDialog />
    </>
  )
}
FailedWorkflows.layout = (page: ReactElement) => <Workspace>{page}</Workspace>
