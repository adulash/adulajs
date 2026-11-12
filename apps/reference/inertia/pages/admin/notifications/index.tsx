import { useEffect, useState, type ReactElement } from 'react'
import { Head, router } from '@inertiajs/react'
import { Link } from '@adonisjs/inertia/react'
import axios from 'axios'
import { BellOff, CheckCheck } from 'lucide-react'
import type { NotificationPage } from 'adula'
import Workspace from '~/layouts/workspace'
import { useDateTimeFormatter } from '~/components/admin-nav'
import { Button } from '~/components/ui/button'
import { openRecord, plainClick } from '~/components/ui/resource-surface'
import { RecordOverlayDialog } from '~/components/ui/resource-page'

type Props = { notifications: NotificationPage }

export default function NotificationsIndex({ notifications }: Props) {
  const formatDateTime = useDateTimeFormatter()
  const [rows, setRows] = useState(notifications.data)
  const [cursor, setCursor] = useState(notifications.nextCursor)
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    setRows(notifications.data)
    setCursor(notifications.nextCursor)
  }, [notifications])
  // A notification about a record opens it in a dialog over this list, which stays mounted;
  // it is marked read meanwhile. A modified click follows the link, which marks it read and
  // opens the record page.
  const open = (event: React.MouseEvent, item: NotificationPage['data'][number]) => {
    const target = item.target
    if (!target || !plainClick(event)) return
    if (target.href !== `/resources/${target.resource}/${target.recordId}`) return
    event.preventDefault()
    if (!item.readAt) {
      const readAt = new Date().toISOString()
      setRows((current) => current.map((row) => (row.id === item.id ? { ...row, readAt } : row)))
      void axios
        .post(
          `/notifications/${item.id}/read`,
          {},
          {
            headers: { Accept: 'application/json' },
            withXSRFToken: true,
          }
        )
        .catch(() => {})
    }
    void openRecord(target.resource, target.recordId, 'show')
  }
  const more = async () => {
    if (!cursor) return
    setLoading(true)
    try {
      const response = await axios.get<NotificationPage>('/notifications', {
        params: { cursor },
        headers: { Accept: 'application/json' },
      })
      setRows((current) => [...current, ...response.data.data])
      setCursor(response.data.nextCursor)
    } finally {
      setLoading(false)
    }
  }
  return (
    <>
      <Head title="الإشعارات" />
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">الإشعارات</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            {notifications.unread
              ? `${notifications.unread} إشعار غير مقروء`
              : 'لا إشعارات غير مقروءة'}
          </p>
        </div>
        <Button
          variant="outline"
          disabled={notifications.unread === 0}
          onClick={() => router.post('/notifications/read-all', {}, { preserveScroll: true })}
        >
          <CheckCheck size={16} />
          تعيين الكل كمقروء
        </Button>
      </div>
      <ul className="space-y-3">
        {rows.map((item) => (
          <li
            key={item.id}
            className={`flex flex-wrap items-start justify-between gap-3 rounded-xl border bg-card px-5 py-4 ${item.readAt ? 'border-border' : 'border-primary/40 shadow-[0_2px_10px_color-mix(in_oklab,var(--foreground)_3%,transparent)]'}`}
          >
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 font-semibold">
                {!item.readAt && <span className="size-2 rounded-full bg-primary" />}
                {item.target ? (
                  // Opening marks it read; the record page decides whether the reader may see it.
                  <Link
                    href={`/notifications/${item.id}/open`}
                    onClick={(event) => open(event, item)}
                    className="underline-offset-4 hover:text-primary hover:underline"
                  >
                    {item.title}
                  </Link>
                ) : (
                  item.title
                )}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{item.body}</p>
              <p className="mt-2 text-xs text-muted-foreground">{formatDateTime(item.createdAt)}</p>
            </div>
            {!item.readAt && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  router.post(`/notifications/${item.id}/read`, {}, { preserveScroll: true })
                }
              >
                تعيين كمقروء
              </Button>
            )}
          </li>
        ))}
        {rows.length === 0 && (
          <li className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border p-12 text-muted-foreground">
            <BellOff size={26} />
            لا إشعارات بعد.
          </li>
        )}
      </ul>
      {cursor && (
        <div className="mt-6 text-center">
          <Button variant="outline" onClick={more} disabled={loading}>
            {loading ? 'جارٍ التحميل…' : 'تحميل المزيد'}
          </Button>
        </div>
      )}
      <RecordOverlayDialog />
    </>
  )
}
NotificationsIndex.layout = (page: ReactElement) => <Workspace>{page}</Workspace>
