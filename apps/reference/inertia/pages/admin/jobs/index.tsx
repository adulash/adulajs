import type { ReactElement, ReactNode } from 'react'
import { Head, router } from '@inertiajs/react'
import { RotateCcw } from 'lucide-react'
import type { QueueSnapshot, RuntimeHealth, SyncJobSummary } from 'adula'
import { SyncJobsSection } from '~/components/sync-jobs'
import Workspace from '~/layouts/workspace'
import { AdminHeader, formatAge, useDateTimeFormatter } from '~/components/admin-nav'
import { Button } from '~/components/ui/button'
import { Badge } from '~/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'

type Props = { health: RuntimeHealth; queues: QueueSnapshot[]; syncJobs: SyncJobSummary[] }

function Stat({
  title,
  badge,
  children,
}: {
  title: string
  badge?: ReactNode
  children: ReactNode
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm">{title}</CardTitle>
        {badge}
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">{children}</CardContent>
    </Card>
  )
}
const Health = ({ healthy, ok, bad }: { healthy: boolean; ok: string; bad: string }) => (
  <Badge variant={healthy ? 'default' : 'destructive'}>{healthy ? ok : bad}</Badge>
)

export default function JobsIndex({ health, queues, syncJobs }: Props) {
  const formatDateTime = useDateTimeFormatter()
  const counts: [keyof QueueSnapshot['counts'], string][] = [
    ['waiting', 'بانتظار'],
    ['active', 'قيد التنفيذ'],
    ['delayed', 'مؤجلة'],
    ['failed', 'فاشلة'],
    ['completed', 'مكتملة'],
  ]
  return (
    <>
      <Head title="تشغيل النظام" />
      <AdminHeader
        title="تشغيل النظام"
        description="حالة الخدمات والمهام الخلفية، العمليات المتعثرة والنسخ الاحتياطي."
      />
      <div className="mb-8 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <Stat
          title="المجدول"
          badge={<Health healthy={health.heartbeats.scheduler.healthy} ok="سليم" bad="متوقف" />}
        >
          آخر نبضة: {formatAge(health.heartbeats.scheduler.ageMs)}
        </Stat>
        <Stat
          title="العامل"
          badge={<Health healthy={health.heartbeats.worker.healthy} ok="سليم" bad="متوقف" />}
        >
          آخر نبضة: {formatAge(health.heartbeats.worker.ageMs)}
        </Stat>
        <Stat
          title="صندوق الصادر"
          badge={
            <Health
              healthy={health.outbox.backlog === 0}
              ok="فارغ"
              bad={`${health.outbox.backlog} معلّق`}
            />
          }
        >
          أقدم حدث غير منشور: {formatAge(health.outbox.oldestAgeMs)}
        </Stat>
        <Stat title="الأحداث المعالجة">{health.processedEvents} حدث بلا تكرار</Stat>
        <Stat
          title="النسخ الاحتياطي الخارجي"
          badge={<Health healthy={!health.backup.stale} ok="حديث" bad="متأخر" />}
        >
          آخر نسخة: {formatDateTime(health.backup.lastOffsite)}
          <br />
          آخر اختبار استعادة: {formatDateTime(health.backup.lastRestoreTest)}
        </Stat>
      </div>
      <SyncJobsSection jobs={syncJobs} />
      {queues.map((queue) => (
        <section
          key={queue.name}
          className="mb-8 overflow-hidden rounded-xl border border-border bg-white"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
            <h2 className="font-semibold">
              الطابور <span dir="ltr">{queue.name}</span>
            </h2>
            <span className="flex flex-wrap gap-2 text-xs">
              {counts.map(([key, label]) => (
                <Badge
                  key={key}
                  variant={key === 'failed' && queue.counts[key] > 0 ? 'destructive' : 'secondary'}
                >
                  {label}: {queue.counts[key]}
                </Badge>
              ))}
            </span>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>المعرّف</TableHead>
                <TableHead>الوظيفة</TableHead>
                <TableHead>المحاولات</TableHead>
                <TableHead>سبب الفشل</TableHead>
                <TableHead>وقت الفشل</TableHead>
                <TableHead className="w-32" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {queue.failed.map((job) => (
                <TableRow key={job.id}>
                  <TableCell dir="ltr" className="text-xs">
                    {job.id}
                  </TableCell>
                  <TableCell dir="ltr">{job.name}</TableCell>
                  <TableCell>{job.attemptsMade}</TableCell>
                  <TableCell>
                    <code className="line-clamp-2 max-w-md text-xs" dir="ltr">
                      {job.failedReason}
                    </code>
                  </TableCell>
                  <TableCell className="text-xs">{formatDateTime(job.failedAt)}</TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={`إعادة محاولة ${job.id}`}
                      onClick={() =>
                        router.post(`/admin/jobs/${job.id}/retry`, {}, { preserveScroll: true })
                      }
                    >
                      <RotateCcw size={14} />
                      إعادة المحاولة
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {queue.failed.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    لا وظائف فاشلة.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </section>
      ))}
    </>
  )
}
JobsIndex.layout = (page: ReactElement) => <Workspace>{page}</Workspace>
