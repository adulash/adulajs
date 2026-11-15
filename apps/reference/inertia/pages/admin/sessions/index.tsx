import { Head, usePage } from '@inertiajs/react'
import { Form } from '@adonisjs/inertia/react'
import type { ReactElement } from 'react'
import { CircleCheck, OctagonX, ShieldCheck } from 'lucide-react'
import type { ActiveSession } from '#services/sessions'
import { Button } from '~/components/ui/button'
import { Badge } from '~/components/ui/badge'
import { UserAvatar } from '~/components/ui/user-avatar'
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
import { describeAgent } from '~/pages/account/sessions'
import { useDateTimeFormatter } from '~/components/admin-nav'

type Props = { sessions: ActiveSession[]; currentSessionId: string }

export default function AdminSessions({ sessions, currentSessionId }: Props) {
  const formatWhen = useDateTimeFormatter()
  const { flash } = usePage()
  return (
    <>
      <Head title="الجلسات النشطة" />
      <div className="mb-8">
        <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck size={15} />
          <span>الإدارة</span>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">الجلسات النشطة</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          كل الجلسات المفتوحة لجميع المستخدمين. إنهاء الجلسة يُخرج صاحبها فوراً.
        </p>
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
        aria-label="قائمة الجلسات النشطة"
      >
        <div className="flex items-center gap-3 border-b border-border px-6 py-5">
          <h2 className="text-sm font-semibold">الجلسات</h2>
          <Badge variant="secondary" className="font-normal tabular-nums">
            {sessions.length} نشطة
          </Badge>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>المستخدم</TableHead>
              <TableHead>الجهاز</TableHead>
              <TableHead>العنوان</TableHead>
              <TableHead>آخر نشاط</TableHead>
              <TableHead className="text-start">إجراء</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessions.map((session) => {
              const current = session.id === currentSessionId
              return (
                <TableRow key={session.id}>
                  <TableCell>
                    <span className="flex items-center gap-2">
                      <UserAvatar
                        user={{
                          id: session.userId,
                          name: session.fullName,
                          avatarUrl: session.avatarUrl,
                        }}
                        size="xs"
                      />
                      <span className="min-w-0">
                        <span className="block font-medium">{session.fullName || '—'}</span>
                        <span className="block text-xs text-muted-foreground" dir="ltr">
                          {session.email}
                        </span>
                      </span>
                    </span>
                  </TableCell>
                  <TableCell title={session.userAgent ?? undefined}>
                    <span className="flex flex-wrap items-center gap-2">
                      {describeAgent(session.userAgent)}
                      {current && <Badge>جلستك</Badge>}
                    </span>
                  </TableCell>
                  <TableCell dir="ltr" className="text-start tabular-nums">
                    {session.ip ?? '—'}
                  </TableCell>
                  <TableCell>{formatWhen(session.lastSeenAt)}</TableCell>
                  <TableCell>
                    <Form route="admin_sessions.destroy" routeParams={{ id: session.id }}>
                      {({ processing }) => (
                        <Button
                          type="submit"
                          size="sm"
                          variant="outline"
                          disabled={processing}
                          aria-label={`إنهاء جلسة ${session.email}`}
                        >
                          إنهاء
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
AdminSessions.layout = (page: ReactElement) => <Workspace>{page}</Workspace>
