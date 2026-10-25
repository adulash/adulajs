import { useState } from 'react'
import { router } from '@inertiajs/react'
import axios from 'axios'
import { History, Play } from 'lucide-react'
import type { SyncJobSummary, SyncRun } from 'adula'
import { useDateTimeFormatter } from '~/components/admin-nav'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'

const json = { headers: { Accept: 'application/json' } }
const runStatus: Record<SyncRun['status'], string> = {
  queued: 'بانتظار التشغيل',
  running: 'قيد التشغيل',
  succeeded: 'نجح',
  failed: 'فشل',
}
const runTrigger: Record<SyncRun['trigger'], string> = { schedule: 'مجدول', manual: 'يدوي' }
const errorCategory: Record<string, string> = {
  'timeout': 'انتهت المهلة',
  'validation': 'بيانات غير صالحة',
  'authorization': 'لا صلاحية أو لا مستخدم منفّذ',
  'conflict': 'تعارض مع تعديل آخر',
  'handler': 'خطأ في المهمة',
  'dns': 'تعذّر العثور على العنوان',
  'connect': 'تعذّر الاتصال',
  'tls': 'خطأ في شهادة الاتصال الآمن',
  'blocked-target': 'العنوان غير مسموح',
  'secret': 'تعذّر فتح المفتاح السري',
}

/** Stored categories are stable keys; the page shows their Arabic meaning. */
function categoryLabel(category: string | null) {
  if (!category) return '—'
  const status = category.match(/^http-status:(\d+)$/)
  if (status) return `استجابة HTTP ${status[1]}`
  return errorCategory[category] ?? category
}

function StatusBadge({ status }: { status: SyncRun['status'] }) {
  const variant =
    status === 'failed' ? 'destructive' : status === 'succeeded' ? 'default' : 'secondary'
  return <Badge variant={variant}>{runStatus[status]}</Badge>
}

const duration = (ms: number | null) =>
  ms === null ? '—' : ms < 1000 ? `${ms} ملّي ثانية` : `${(ms / 1000).toFixed(1)} ثانية`
const syncPath = (name: string) => `/admin/jobs/sync/${encodeURIComponent(name)}`

/** The "مهام المزامنة" section of the jobs screen: status, run now and run history. */
export function SyncJobsSection({ jobs }: { jobs: SyncJobSummary[] }) {
  const formatDateTime = useDateTimeFormatter()
  const [history, setHistory] = useState<{ job: SyncJobSummary; runs: SyncRun[] } | null>(null)
  const [error, setError] = useState('')
  const showHistory = async (job: SyncJobSummary) => {
    setError('')
    try {
      const response = await axios.get<{ data: SyncRun[] }>(`${syncPath(job.name)}/runs`, json)
      setHistory({ job, runs: response.data.data })
    } catch {
      setHistory({ job, runs: [] })
      setError('تعذّر تحميل سجل التشغيل.')
    }
  }
  return (
    <section className="mb-8 overflow-hidden rounded-xl border border-border bg-white">
      <div className="border-b border-border px-5 py-4">
        <h2 className="font-semibold">مهام المزامنة</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          مهام تعمل وفق جدول زمني لمزامنة البيانات مع الأنظمة الأخرى، ولا يعمل تشغيلان للمهمة
          نفسها في الوقت ذاته.
        </p>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>المهمة</TableHead>
            <TableHead>الجدول</TableHead>
            <TableHead>آخر تشغيل</TableHead>
            <TableHead>آخر نجاح</TableHead>
            <TableHead>آخر خطأ</TableHead>
            <TableHead>التشغيل التالي</TableHead>
            <TableHead className="w-56">
              <span className="sr-only">إجراءات</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {jobs.map((job) => (
            <TableRow key={job.name}>
              <TableCell>
                <div className="font-medium">{job.label.ar}</div>
                <div className="text-xs text-muted-foreground" dir="ltr">
                  {job.name}
                </div>
              </TableCell>
              <TableCell>
                <code className="text-xs" dir="ltr">
                  {job.cron}
                </code>
              </TableCell>
              <TableCell className="text-xs">
                {job.lastRun ? (
                  <div className="flex flex-col items-start gap-1">
                    <StatusBadge status={job.lastRun.status} />
                    <span>{formatDateTime(job.lastRun.finishedAt ?? job.lastRun.queuedAt)}</span>
                  </div>
                ) : (
                  <span className="text-muted-foreground">لم تعمل بعد</span>
                )}
              </TableCell>
              <TableCell className="text-xs">{formatDateTime(job.lastSuccessAt)}</TableCell>
              <TableCell className="text-xs">{categoryLabel(job.lastErrorCategory)}</TableCell>
              <TableCell className="text-xs">{formatDateTime(job.nextRunAt)}</TableCell>
              <TableCell>
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={job.busy}
                    aria-label={`تشغيل ${job.label.ar} الآن`}
                    onClick={() =>
                      router.post(`${syncPath(job.name)}/run`, {}, { preserveScroll: true })
                    }
                  >
                    <Play size={14} />
                    {job.busy ? 'قيد الانتظار' : 'تشغيل الآن'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`سجل تشغيل ${job.label.ar}`}
                    onClick={() => showHistory(job)}
                  >
                    <History size={14} />
                    السجل
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
          {jobs.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                لا توجد مهام مزامنة معرّفة في هذا النظام.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <Dialog open={history !== null} onOpenChange={(value) => !value && setHistory(null)}>
        <DialogContent dir="rtl" className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>سجل التشغيل</DialogTitle>
            <DialogDescription>
              {history?.job.label.ar}: آخر 20 تشغيلاً، الأحدث أولاً.
            </DialogDescription>
          </DialogHeader>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="max-h-[60vh] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الحالة</TableHead>
                  <TableHead>المصدر</TableHead>
                  <TableHead>البدء</TableHead>
                  <TableHead>المدة</TableHead>
                  <TableHead>النتيجة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history?.runs.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell>
                      <StatusBadge status={run.status} />
                    </TableCell>
                    <TableCell className="text-xs">{runTrigger[run.trigger]}</TableCell>
                    <TableCell className="text-xs">
                      {formatDateTime(run.startedAt ?? run.queuedAt)}
                    </TableCell>
                    <TableCell className="text-xs tabular-nums">
                      {duration(run.durationMs)}
                    </TableCell>
                    <TableCell className="text-xs">
                      {run.status === 'failed' ? (
                        <div className="flex flex-col gap-1">
                          <span className="font-medium">{categoryLabel(run.errorCategory)}</span>
                          {run.errorMessage && (
                            <code className="line-clamp-2 max-w-md text-muted-foreground">
                              {run.errorMessage}
                            </code>
                          )}
                        </div>
                      ) : Object.keys(run.stats).length ? (
                        <span className="tabular-nums" dir="ltr">
                          {Object.entries(run.stats)
                            .map(([key, value]) => `${key}: ${value}`)
                            .join(' · ')}
                        </span>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {history?.runs.length === 0 && !error && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                      لم تعمل هذه المهمة بعد.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}
