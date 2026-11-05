import { Head, usePage } from '@inertiajs/react'
import { Form } from '@adonisjs/inertia/react'
import type { ReactElement } from 'react'
import { CircleCheck, MonitorSmartphone, OctagonX } from 'lucide-react'
import type { UserSession } from '#services/sessions'
import { Button } from '~/components/ui/button'
import { Badge } from '~/components/ui/badge'
import { Alert, AlertDescription } from '~/components/ui/alert'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'
import Workspace from '~/layouts/workspace'
import { useDateTimeFormatter } from '~/components/admin-nav'

type Props = { sessions: UserSession[]; currentSessionId: string }

/** A short human label for a user-agent string; the raw value stays in the title. */
export function describeAgent(agent: string | null) {
  if (!agent) return 'جهاز غير معروف'
  const browser = /Edg\//.test(agent)
    ? 'Edge'
    : /OPR\//.test(agent)
      ? 'Opera'
      : /Firefox\//.test(agent)
        ? 'Firefox'
        : /Chrome\//.test(agent)
          ? 'Chrome'
          : /Safari\//.test(agent)
            ? 'Safari'
            : 'متصفح'
  const os = /Windows/.test(agent)
    ? 'Windows'
    : /iPhone|iPad/.test(agent)
      ? 'iOS'
      : /Android/.test(agent)
        ? 'Android'
        : /Mac OS/.test(agent)
          ? 'macOS'
          : /Linux/.test(agent)
            ? 'Linux'
            : 'نظام غير معروف'
  return `${browser} على ${os}`
}

export default function Sessions({ sessions, currentSessionId }: Props) {
  const formatWhen = useDateTimeFormatter()
  const { flash } = usePage()
  const others = sessions.filter((session) => session.id !== currentSessionId)
  return (
    <>
      <Head title="الجلسات" />
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
            <MonitorSmartphone size={15} />
            <span>حسابي</span>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">الجلسات</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            الأجهزة التي سجّلت الدخول منها. أنهِ أي جلسة لا تعرفها فوراً.
          </p>
        </div>
        <Form route="account_sessions.purge" className="pt-3">
          {({ processing }) => (
            <Button type="submit" variant="outline" disabled={processing || !others.length}>
              إنهاء الجلسات الأخرى ({others.length})
            </Button>
          )}
        </Form>
      </div>

      {typeof flash.success === 'string' && (
        <Alert className="mb-6" data-flash-message={flash.success}>
          <CircleCheck />
          <AlertDescription>{flash.success}</AlertDescription>
        </Alert>
      )}
      {typeof flash.error === 'string' && (
        <Alert variant="destructive" className="mb-6" data-flash-message={flash.error}>
          <OctagonX />
          <AlertDescription>{flash.error}</AlertDescription>
        </Alert>
      )}

      <section
        className="overflow-hidden rounded-xl border border-border bg-card shadow-[0_2px_10px_color-mix(in_oklab,var(--foreground)_2%,transparent)]"
        aria-label="قائمة الجلسات"
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>الجهاز</TableHead>
              <TableHead>العنوان</TableHead>
              <TableHead>آخر نشاط</TableHead>
              <TableHead>بدأت</TableHead>
              <TableHead className="text-start">إجراء</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessions.map((session) => {
              const current = session.id === currentSessionId
              return (
                <TableRow key={session.id}>
                  <TableCell title={session.userAgent ?? undefined}>
                    <span className="flex flex-wrap items-center gap-2">
                      {describeAgent(session.userAgent)}
                      {current && <Badge>الجلسة الحالية</Badge>}
                    </span>
                  </TableCell>
                  <TableCell dir="ltr" className="text-start tabular-nums">
                    {session.ip ?? '—'}
                  </TableCell>
                  <TableCell>{formatWhen(session.lastSeenAt)}</TableCell>
                  <TableCell>{formatWhen(session.createdAt)}</TableCell>
                  <TableCell>
                    <Form route="account_sessions.destroy" routeParams={{ id: session.id }}>
                      {({ processing }) => (
                        <Button
                          type="submit"
                          size="sm"
                          variant={current ? 'destructive' : 'outline'}
                          disabled={processing}
                          aria-label={current ? 'إنهاء هذه الجلسة' : 'إنهاء الجلسة'}
                        >
                          {current ? 'إنهاء هذه الجلسة' : 'إنهاء'}
                        </Button>
                      )}
                    </Form>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </section>
    </>
  )
}
Sessions.layout = (page: ReactElement) => <Workspace>{page}</Workspace>
