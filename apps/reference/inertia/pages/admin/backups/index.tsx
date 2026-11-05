import { useEffect, useState, type ReactElement } from 'react'
import { Head, router } from '@inertiajs/react'
import { CloudUpload, Download, HardDriveDownload, KeyRound, Link2, Unlink } from 'lucide-react'
import type { BackupKind, BackupRun, BackupSchedule, CloudBackupStatus } from 'adula'
import Workspace from '~/layouts/workspace'
import { AdminHeader, useDateTimeFormatter } from '~/components/admin-nav'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { useConfirmAction } from '~/components/ui/confirm-action'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'

type Props = { backups: CloudBackupStatus; failures: Record<string, string> }
type Destination = CloudBackupStatus['destinations'][number]

const NAMES: Record<BackupKind, string> = {
  download: 'التنزيل إلى هذا الجهاز',
  google: 'Google Drive',
  onedrive: 'OneDrive',
}
const SCOPES: Record<'google' | 'onedrive', string> = {
  google: 'يطلب النظام الوصول إلى الملفات التي ينشئها فقط (drive.file)، ولا يرى بقية ملفاتك.',
  onedrive: 'يطلب النظام الوصول إلى مجلد التطبيق الخاص به فقط (Files.ReadWrite.AppFolder).',
}
const SCHEDULES: Record<BackupSchedule, string> = {
  off: 'يدوي فقط',
  daily: 'يوميًا الساعة 02:00 بتوقيت UTC',
  weekly: 'أسبوعيًا يوم الجمعة الساعة 02:00 بتوقيت UTC',
}
const STATUS: Record<BackupRun['status'], string> = {
  queued: 'بانتظار التنفيذ',
  running: 'قيد التنفيذ',
  succeeded: 'نجحت',
  failed: 'فشلت',
  expired: 'انتهت صلاحية التنزيل',
}

function formatSize(bytes: number | null) {
  if (bytes === null) return '—'
  const units = ['بايت', 'ك.ب', 'م.ب', 'غ.ب']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toLocaleString('ar', { maximumFractionDigits: unit ? 1 : 0 })} ${units[unit]}`
}

function ConnectionState({ destination }: { destination: Destination }) {
  if (destination.kind === 'download') return <Badge variant="secondary">متاح</Badge>
  if (!destination.configured) return <Badge variant="outline">غير مهيأ في بيئة التشغيل</Badge>
  const connection = destination.connection
  if (!connection) return <Badge variant="outline">غير متصل</Badge>
  if (connection.status === 'revoked')
    return <Badge variant="destructive">انتهى الإذن، أعد الربط</Badge>
  return <Badge>متصل</Badge>
}

function LastResult({
  run,
  failures,
}: {
  run: BackupRun | null
  failures: Record<string, string>
}) {
  const formatDateTime = useDateTimeFormatter()
  if (!run) return <span className="text-muted-foreground">لم تُنشأ نسخة بعد</span>
  const failed = run.status === 'failed'
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Badge
          variant={failed ? 'destructive' : run.status === 'succeeded' ? 'default' : 'secondary'}
        >
          {STATUS[run.status]}
        </Badge>
        <span className="tabular-nums text-muted-foreground">
          {formatDateTime(run.finishedAt ?? run.createdAt)}
        </span>
      </div>
      {failed ? (
        <p className="text-xs text-destructive">
          {(run.errorCategory && failures[run.errorCategory]) ??
            run.error ??
            'تعذر إكمال النسخ الاحتياطي'}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground tabular-nums">{formatSize(run.size)}</p>
      )}
    </div>
  )
}

function ScheduleDialog({
  destination,
  onClose,
}: {
  destination: Destination | null
  onClose: () => void
}) {
  const [value, setValue] = useState<BackupSchedule>('off')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (destination?.connection) setValue(destination.connection.schedule)
  }, [destination])
  const kind = destination?.kind
  return (
    <Dialog mode="edit" open={Boolean(destination)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (!kind) return
            setSaving(true)
            router.put(
              `/admin/backups/connections/${kind}/schedule`,
              { schedule: value },
              { preserveScroll: true, onFinish: () => setSaving(false), onSuccess: onClose }
            )
          }}
          data-dirty={
            destination?.connection ? String(value !== destination.connection.schedule) : undefined
          }
        >
          <DialogHeader>
            <DialogTitle>جدولة النسخ إلى {kind ? NAMES[kind] : ''}</DialogTitle>
            <DialogDescription>
              ينشئ العامل الخلفي نسخة مشفرة ويرفعها في الموعد المحدد باسم من ربط الوجهة، ما دام
              مديرًا للنظام.
            </DialogDescription>
          </DialogHeader>
          <div className="my-6">
            <Select value={value} onValueChange={(next) => setValue(next as BackupSchedule)}>
              <SelectTrigger aria-label="موعد النسخ" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(SCHEDULES) as BackupSchedule[]).map((schedule) => (
                  <SelectItem key={schedule} value={schedule}>
                    {SCHEDULES[schedule]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                إلغاء
              </Button>
            </DialogClose>
            <Button type="submit" disabled={saving}>
              حفظ الجدولة
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ConnectDialog({
  kind,
  onClose,
}: {
  kind: 'google' | 'onedrive' | null
  onClose: () => void
}) {
  return (
    <Dialog mode="confirm" open={Boolean(kind)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>ربط {kind ? NAMES[kind] : ''}</DialogTitle>
          <DialogDescription>
            ستنتقل إلى صفحة مزود الخدمة لتوافق على الإذن، ثم تعود إلى هذه الصفحة.
          </DialogDescription>
        </DialogHeader>
        <ul className="my-4 space-y-2 text-sm text-muted-foreground">
          <li>{kind ? SCOPES[kind] : ''}</li>
          <li>يحفظ النظام إذن الوصول مشفرًا، ولا يعرضه في أي صفحة.</li>
          <li>كل نسخة مشفرة قبل رفعها، ولا تُقرأ إلا بمفتاح التشفير الخاص بهذا النظام.</li>
        </ul>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button
            type="button"
            onClick={() => kind && router.post(`/admin/backups/connect/${kind}`)}
          >
            <Link2 size={16} />
            متابعة إلى مزود الخدمة
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function BackupsIndex({ backups, failures }: Props) {
  const formatDateTime = useDateTimeFormatter()
  const { confirm, confirmation } = useConfirmAction()
  const [scheduling, setScheduling] = useState<Destination | null>(null)
  const [connecting, setConnecting] = useState<'google' | 'onedrive' | null>(null)
  const busy = new Set(backups.active.map((run) => run.kind))

  // Refresh while a run is queued or running, so its result appears without a reload.
  useEffect(() => {
    if (!backups.active.length) return
    const timer = setInterval(
      () => router.reload({ only: ['backups'], preserveScroll: true } as never),
      5000
    )
    return () => clearInterval(timer)
  }, [backups.active.length])

  const start = (kind: BackupKind) =>
    confirm({
      title: `إنشاء نسخة احتياطية: ${NAMES[kind]}`,
      description:
        kind === 'download'
          ? 'ينشئ العامل الخلفي نسخة مشفرة من قاعدة البيانات والمرفقات، وتبقى متاحة للتنزيل 24 ساعة ثم تُحذف.'
          : 'ينشئ العامل الخلفي نسخة مشفرة من قاعدة البيانات والمرفقات ويرفعها، ثم يحذف النسخة المحلية.',
      label: 'إنشاء النسخة',
      action: () => router.post('/admin/backups/runs', { kind }, { preserveScroll: true }),
    })
  const disconnect = (kind: 'google' | 'onedrive') =>
    confirm({
      title: `فصل ${NAMES[kind]}`,
      description:
        kind === 'google'
          ? 'يحذف النظام إذن الوصول ويلغيه لدى Google. تبقى النسخ المرفوعة في حسابك.'
          : 'يحذف النظام إذن الوصول المحفوظ لديه. تبقى النسخ المرفوعة في حسابك، ويمكنك سحب الإذن أيضًا من إعدادات حساب Microsoft.',
      label: 'فصل الوجهة',
      destructive: true,
      action: () => router.delete(`/admin/backups/connections/${kind}`, { preserveScroll: true }),
    })

  return (
    <>
      <Head title="النسخ الاحتياطي" />
      <AdminHeader
        title="النسخ الاحتياطي"
        description="نسخ مشفرة من قاعدة البيانات والمرفقات للتنزيل أو الرفع إلى Google Drive أو OneDrive. لا تغني عن النسخة الخارجية الإلزامية في بيئة الإنتاج."
      />

      {backups.configured ? (
        <Alert className="mb-6">
          <KeyRound size={16} />
          <AlertTitle>التشفير مفعّل</AlertTitle>
          <AlertDescription>
            تُشفّر كل نسخة بالمفتاح BACKUP_ENCRYPTION_KEY. احتفظ بنسخة منه خارج الخادم: لا يمكن فتح
            أي نسخة احتياطية دونه.
          </AlertDescription>
        </Alert>
      ) : (
        <Alert variant="destructive" className="mb-6">
          <KeyRound size={16} />
          <AlertTitle>مفتاح تشفير النسخ الاحتياطية غير مضبوط</AlertTitle>
          <AlertDescription>
            أضف المتغير BACKUP_ENCRYPTION_KEY إلى بيئة التشغيل (32 بايتًا عشوائيًا بترميز base64) ثم
            أعد التشغيل. احفظ نسخة منه خارج الخادم، فالنسخ لا تُفتح دونه.
          </AlertDescription>
        </Alert>
      )}

      <Card className="mb-8">
        <CardHeader>
          <CardTitle>الوجهات</CardTitle>
          <CardDescription>حالة الربط وآخر نتيجة لكل وجهة.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الوجهة</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>آخر نتيجة</TableHead>
                <TableHead>الجدولة</TableHead>
                <TableHead className="text-end">الإجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {backups.destinations.map((destination) => {
                const { kind, connection } = destination
                const provider = kind === 'download' ? null : kind
                const usable =
                  backups.configured && (kind === 'download' || connection?.status === 'connected')
                // Actions stay visible when they cannot run yet, with the reason beside them.
                const blocked =
                  provider && !destination.configured
                    ? 'يتطلب الربط إعداد بيئة التشغيل.'
                    : !backups.configured &&
                        (kind === 'download' || connection?.status === 'connected')
                      ? 'يتطلب النسخ مفتاح التشفير.'
                      : null
                return (
                  <TableRow key={kind}>
                    <TableCell>
                      <div className="flex items-center gap-2 font-medium">
                        {kind === 'download' ? (
                          <HardDriveDownload size={16} />
                        ) : (
                          <CloudUpload size={16} />
                        )}
                        {NAMES[kind]}
                      </div>
                      {connection?.accountLabel && (
                        <div className="mt-1 text-xs text-muted-foreground" dir="auto">
                          {connection.accountLabel}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <ConnectionState destination={destination} />
                    </TableCell>
                    <TableCell>
                      <LastResult run={destination.lastRun} failures={failures} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {connection
                        ? SCHEDULES[connection.schedule]
                        : kind === 'download'
                          ? 'يدوي'
                          : '—'}
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <div className="flex flex-wrap justify-end gap-2">
                        {busy.has(kind) ? (
                          <Badge variant="secondary">جارٍ الإنشاء…</Badge>
                        ) : (
                          (kind === 'download' || connection?.status === 'connected') && (
                            <Button
                              size="sm"
                              disabled={!usable}
                              aria-describedby={blocked ? `${kind}-blocked` : undefined}
                              onClick={() => start(kind)}
                            >
                              نسخ الآن
                            </Button>
                          )
                        )}
                        {provider && connection?.status === 'connected' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setScheduling(destination)}
                          >
                            جدولة
                          </Button>
                        )}
                        {provider && connection?.status !== 'connected' && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!destination.configured}
                            aria-describedby={blocked ? `${kind}-blocked` : undefined}
                            onClick={() => setConnecting(provider)}
                          >
                            <Link2 size={16} />
                            {connection ? 'إعادة الربط' : 'ربط'}
                          </Button>
                        )}
                        {provider && connection && (
                          <Button size="sm" variant="ghost" onClick={() => disconnect(provider)}>
                            <Unlink size={16} />
                            فصل
                          </Button>
                        )}
                      </div>
                      {blocked && (
                        <p
                          id={`${kind}-blocked`}
                          className="mt-1 text-end text-xs text-muted-foreground"
                        >
                          {blocked}
                        </p>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>نسخ جاهزة للتنزيل</CardTitle>
          <CardDescription>
            ملفات بصيغة .adulabackup تُحذف تلقائيًا بعد 24 ساعة. افتحها عند الاستعادة بالأمر
            backup:open.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {backups.downloads.length === 0 ? (
            <p className="text-sm text-muted-foreground">لا توجد نسخ جاهزة للتنزيل.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>أنشئت</TableHead>
                  <TableHead>الحجم</TableHead>
                  <TableHead>تنتهي صلاحيتها</TableHead>
                  <TableHead>بصمة SHA-256</TableHead>
                  <TableHead className="text-end">تنزيل</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {backups.downloads.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell className="tabular-nums">{formatDateTime(run.finishedAt)}</TableCell>
                    <TableCell className="tabular-nums">{formatSize(run.size)}</TableCell>
                    <TableCell className="tabular-nums">{formatDateTime(run.expiresAt)}</TableCell>
                    <TableCell className="font-mono text-xs" dir="ltr" title={run.sha256 ?? ''}>
                      {run.sha256?.slice(0, 16)}…
                    </TableCell>
                    <TableCell className="text-end">
                      <Button size="sm" variant="outline" asChild>
                        <a
                          href={`/admin/backups/runs/${run.id}/download`}
                          download={run.fileName ?? undefined}
                        >
                          <Download size={16} />
                          تنزيل
                        </a>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ScheduleDialog destination={scheduling} onClose={() => setScheduling(null)} />
      <ConnectDialog kind={connecting} onClose={() => setConnecting(null)} />
      {confirmation}
    </>
  )
}

BackupsIndex.layout = (page: ReactElement) => <Workspace>{page}</Workspace>
