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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'

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
      <div className="overflow-hidden rounded-xl border bg-card">
        <Table className="min-w-[720px]">
          <TableHeader>
            <TableRow>
              <TableHead scope="col">التدفق</TableHead>
              <TableHead scope="col">السجل</TableHead>
              <TableHead scope="col">الخطوة</TableHead>
              <TableHead scope="col">الخطأ</TableHead>
              <TableHead scope="col">
                <span className="sr-only">إجراء</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((run) => (
              <TableRow key={run.id}>
                <TableCell>
                  {run.label} <span className="text-xs text-muted-foreground">v{run.version}</span>
                </TableCell>
                <TableCell>
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
                </TableCell>
                <TableCell>{run.stepLabel}</TableCell>
                <TableCell className="text-xs whitespace-normal text-destructive">
                  {run.lastError}
                  <span className="block text-muted-foreground">
                    {run.attempts} محاولة ·{' '}
                    {formatDateTime(run.history.at(-1)?.at ?? run.createdAt)}
                  </span>
                </TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    variant="ghost"
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
                </TableCell>
              </TableRow>
            ))}
            {runs.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  لا تدفقات فاشلة.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <RecordOverlayDialog />
    </>
  )
}
FailedWorkflows.layout = (page: ReactElement) => <Workspace>{page}</Workspace>
