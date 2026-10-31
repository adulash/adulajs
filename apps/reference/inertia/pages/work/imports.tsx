import { useEffect, useState, type ReactElement } from 'react'
import { Head, router } from '@inertiajs/react'
import axios from 'axios'
import { FileSpreadsheet } from 'lucide-react'
import type { ImportBatchRecord as ImportBatch } from 'adula'
import Workspace from '~/layouts/workspace'
import { useDateTimeFormatter } from '~/components/admin-nav'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { ImportReport, ImportSummary } from '~/components/ui/resource-import'

type Props = { batches: ImportBatch[] }
const json = { headers: { Accept: 'application/json' }, withXSRFToken: true }
const statusLabel: Record<ImportBatch['status'], string> = {
  mapping: 'بانتظار المطابقة',
  queued: 'في الطابور',
  running: 'قيد التنفيذ',
  validated: 'تم التحقق دون حفظ',
  done: 'اكتمل',
  failed: 'فشل',
}

/** The dry-run report of one validated batch, with the action that imports it for real. */
function ValidatedBatch({ id, onClose }: { id: number | null; onClose: () => void }) {
  const [batch, setBatch] = useState<ImportBatch | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    setBatch(null)
    setError('')
    if (id === null) return
    axios
      .get<{ data: ImportBatch }>(`/imports/${id}`, json)
      .then((response) => setBatch(response.data.data))
      .catch(() => setError('تعذر تحميل تقرير التحقق.'))
  }, [id])
  const start = async () => {
    if (!batch) return
    setBusy(true)
    setError('')
    try {
      await axios.post(
        `/imports/${batch.id}/start`,
        { mapping: batch.mapping, dryRun: false },
        json
      )
      onClose()
      router.reload({ only: ['batches'] })
    } catch (caught) {
      setError(
        axios.isAxiosError(caught) && caught.response?.data?.error?.message
          ? String(caught.response.data.error.message)
          : 'تعذر بدء الاستيراد.'
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={id !== null} onOpenChange={(value) => !value && onClose()}>
      <DialogContent dir="rtl" className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>تقرير التحقق {batch ? `— ${batch.fileName}` : ''}</DialogTitle>
          <DialogDescription>
            نتيجة كل صف كما سيُستورد. لم يُحفظ شيء بعد.
          </DialogDescription>
        </DialogHeader>
        {batch ? (
          <div className="space-y-3">
            <ImportSummary batch={batch} />
            <ImportReport batch={batch} />
          </div>
        ) : (
          !error && <p className="text-sm text-muted-foreground">جارٍ تحميل التقرير…</p>
        )}
        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            إغلاق
          </Button>
          <Button type="button" disabled={!batch || busy} onClick={() => void start()}>
            بدء الاستيراد
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function Imports({ batches }: Props) {
  const formatDateTime = useDateTimeFormatter()
  const [reportId, setReportId] = useState<number | null>(null)
  const active = batches.some((batch) => ['queued', 'running'].includes(batch.status))
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => router.reload({ only: ['batches'] }), 2000)
    return () => clearInterval(timer)
  }, [active])
  return (
    <>
      <Head title="الاستيراد" />
      <div className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">الاستيراد</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          دفعات الاستيراد التي رفعتها، وتقدّمها وأخطاء صفوفها.
        </p>
      </div>
      <ul className="space-y-3">
        {batches.map((batch) => (
          <li key={batch.id} className="space-y-2 rounded-xl border bg-white px-5 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <FileSpreadsheet size={16} className="text-muted-foreground" />
              <span className="font-semibold">{batch.fileName}</span>
              <span className="text-sm text-muted-foreground">← {batch.resourceLabel}</span>
              <Badge variant={batch.status === 'done' ? 'default' : 'secondary'}>
                {statusLabel[batch.status]}
              </Badge>
              {batch.mode === 'upsert' && <Badge variant="outline">إضافة أو تحديث</Badge>}
              {batch.dryRun && batch.status !== 'validated' && batch.status !== 'mapping' && (
                <Badge variant="outline">تحقق دون حفظ</Badge>
              )}
              <span className="ms-auto text-xs text-muted-foreground">
                {formatDateTime(batch.createdAt)}
              </span>
            </div>
            <div
              role="progressbar"
              aria-label={`تقدم ${batch.fileName}`}
              aria-valuemin={0}
              aria-valuemax={batch.total}
              aria-valuenow={batch.processed}
              className="h-2 overflow-hidden rounded-full bg-muted"
            >
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${batch.total ? (batch.processed / batch.total) * 100 : 0}%` }}
              />
            </div>
            {batch.status === 'validated' ? (
              <div className="flex flex-wrap items-center gap-3">
                <ImportSummary batch={batch} />
                <Button
                  size="sm"
                  variant="outline"
                  className="ms-auto"
                  onClick={() => setReportId(batch.id)}
                >
                  عرض التقرير
                </Button>
              </div>
            ) : (
              <p className="text-sm tabular-nums">
                {batch.processed} من {batch.total} · نجح {batch.created}
                {batch.mode === 'upsert' && ` · حُدِّث ${batch.updated}`} · فشل {batch.failed}
              </p>
            )}
            {batch.errors.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer text-red-800">
                  أخطاء الصفوف ({batch.errors.length})
                </summary>
                <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs">
                  {batch.errors.map((error) => (
                    <li key={error.row}>
                      الصف {error.row}: {error.message}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </li>
        ))}
        {batches.length === 0 && (
          <li className="rounded-xl border border-dashed p-12 text-center text-muted-foreground">
            لا دفعات استيراد بعد.
          </li>
        )}
      </ul>
      <ValidatedBatch id={reportId} onClose={() => setReportId(null)} />
    </>
  )
}
Imports.layout = (page: ReactElement) => <Workspace>{page}</Workspace>
