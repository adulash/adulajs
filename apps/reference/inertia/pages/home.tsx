import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Head, router, usePage } from '@inertiajs/react'
import { Link } from '@adonisjs/inertia/react'
import { Bell, ListTodo, RotateCcw, Settings2 } from 'lucide-react'
import type { OverviewState, OverviewWidget, ResourceNavigation } from 'adula'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { useMessages } from '~/components/ui/messages'
import { Skeleton } from '~/components/ui/skeleton'
import { DashboardWidgetCard } from '~/components/ui/resource-dashboard'
import { CustomizeOverviewDialog } from '~/components/overview/customize-dialog'
import Workspace from '~/layouts/workspace'
import Layout from '~/layouts/default'

type Props = {
  account?: { email: string }
  isAdmin: boolean
  impersonating?: boolean
  navigation: ResourceNavigation
  /** Deferred; null when the server could not count (see admin_middleware). */
  openTasks?: number | null
  unreadNotifications?: number
}

function Welcome({ isAdmin }: { isAdmin: boolean }) {
  const { t } = useMessages()
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('حسابي والإعدادات')}</CardTitle>
        <CardDescription>{t('وحدات أعمالك وإعدادات حسابك في مكان واحد.')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-3">
        <Button asChild>
          <Link href="/account/profile">{t('حسابي')}</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/notifications">{t('الإشعارات')}</Link>
        </Button>
        {isAdmin && (
          <Button asChild variant="outline">
            <Link href="/admin/setup">{t('بدء الإعداد الأولي')}</Link>
          </Button>
        )}
        {isAdmin && (
          <Button asChild variant="outline">
            <Link href="/admin/users">{t('إدارة النظام')}</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * Whether a deferred prop failed to arrive: the server reported no value (null), or the request
 * that loads it finished without one (a network or server error). Loading looks different.
 */
function useDeferredFailure(prop: string | undefined, value: number | null | undefined) {
  const [failed, setFailed] = useState(false)
  const current = useRef(value)
  current.current = value
  useEffect(() => {
    if (!prop) return
    return router.on('finish', (event) => {
      if (!event.detail.visit.only.includes(prop)) return
      // The props of a successful response are in place by now; wait one tick to be sure.
      setTimeout(() => setFailed(current.current === undefined), 0)
    })
  }, [prop])
  return value === null || (failed && value === undefined)
}

function Counter({
  label,
  value,
  href,
  icon,
  deferred,
}: {
  label: string
  value: number | null | undefined
  href: string
  icon: ReactNode
  /** The deferred prop behind the value, reloaded alone by «إعادة المحاولة». */
  deferred?: string
}) {
  const { t } = useMessages()
  const failed = useDeferredFailure(deferred, value)
  return (
    <Card className="gap-2 py-5">
      <CardHeader className="px-5">
        <CardDescription className="flex items-center gap-2">
          {icon}
          <Link href={href} className="hover:text-foreground hover:underline">
            {label}
          </Link>
        </CardDescription>
      </CardHeader>
      <CardContent className="px-5">
        {failed && deferred ? (
          <div className="flex flex-wrap items-center gap-2" data-testid="overview-counter-value">
            <p role="alert" className="text-sm text-destructive">
              {t('تعذّر تحميل العدد')}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => router.reload({ only: [deferred] })}
            >
              <RotateCcw />
              {t('إعادة المحاولة')}
            </Button>
          </div>
        ) : typeof value === 'number' ? (
          <p
            className="text-3xl font-semibold tabular-nums tracking-tight"
            data-testid="overview-counter-value"
          >
            {value.toLocaleString('ar')}
          </p>
        ) : (
          // A deferred count (the «مهامي» badge, #156) arrives after the page renders; until
          // then the card shows that it is loading, never that the count is unavailable.
          <div role="status" data-testid="overview-counter-value">
            <Skeleton className="h-9 w-12" />
            <span className="sr-only">{t('جارٍ التحميل...')}</span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function Modules({ navigation }: { navigation: ResourceNavigation }) {
  const { t } = useMessages()
  if (!(navigation ?? []).length)
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('وحدات العمل')}</CardTitle>
          <CardDescription>{t('ستظهر هنا وحدات العمل المتاحة لحسابك.')}</CardDescription>
        </CardHeader>
      </Card>
    )
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('وحدات العمل')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {navigation.map((entry) => (
          <Button key={entry.href} asChild variant="outline" size="sm">
            <Link href={entry.href}>{t('فتح {resource}', { resource: entry.label })}</Link>
          </Button>
        ))}
      </CardContent>
    </Card>
  )
}

function Widget({ widget, props }: { widget: OverviewWidget; props: Props }) {
  const { t } = useMessages()
  if (widget.kind === 'dashboard')
    return widget.data ? <DashboardWidgetCard widget={widget.data} /> : null
  switch (widget.id) {
    case 'core.welcome':
      return <Welcome isAdmin={props.isAdmin} />
    case 'core.tasks':
      return (
        <Counter
          label={t('مهامي المفتوحة')}
          value={props.openTasks}
          deferred="openTasks"
          href="/my-tasks"
          icon={<ListTodo size={15} />}
        />
      )
    case 'core.notifications':
      return (
        <Counter
          label={t('الإشعارات غير المقروءة')}
          value={props.unreadNotifications}
          href="/notifications"
          icon={<Bell size={15} />}
        />
      )
    case 'core.modules':
      return <Modules navigation={props.navigation} />
    default:
      return null
  }
}

/** Wide widgets take the full row; counters and indicators share it. */
const WIDE = new Set(['core.welcome', 'core.modules'])

function Overview({ overview, props }: { overview: OverviewState; props: Props }) {
  const { t, dir } = useMessages()
  const [customizing, setCustomizing] = useState(false)
  const shown = overview.widgets.filter((widget) => !widget.hidden)
  return (
    <div className="space-y-6" dir={dir}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{t('نظرة عامة')}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t('عملك ومؤشراتك في مكان واحد، بالترتيب الذي تختاره.')}
          </p>
        </div>
        {!props.impersonating && overview.widgets.length > 0 && (
          <Button type="button" variant="outline" onClick={() => setCustomizing(true)}>
            <Settings2 size={16} />
            {t('تخصيص')}
          </Button>
        )}
      </div>
      {shown.length ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="overview-widgets">
          {shown.map((widget) => (
            <section
              key={widget.id}
              data-widget={widget.id}
              aria-label={widget.kind === 'builtin' ? t(widget.label) : widget.label}
              className={WIDE.has(widget.id) ? 'sm:col-span-2 lg:col-span-3' : undefined}
            >
              <Widget widget={widget} props={props} />
            </section>
          ))}
        </div>
      ) : (
        <p
          className="rounded-xl border border-dashed p-12 text-center text-muted-foreground"
          data-testid="overview-empty"
        >
          {t('لا توجد عناصر ظاهرة. أظهر عنصرًا من «تخصيص».')}
        </p>
      )}
      <CustomizeOverviewDialog
        open={customizing}
        onOpenChange={setCustomizing}
        overview={overview}
      />
    </div>
  )
}

export default function Home({ overview }: { overview?: OverviewState }) {
  const props = usePage<Props>().props
  const { t, dir } = useMessages()
  return (
    <>
      <Head title={t('مساحة العمل · {app}', { app: 'AdulaJS' })} />
      {props.account && overview ? (
        <Overview overview={overview} props={props} />
      ) : (
        <div className="mx-auto max-w-5xl space-y-6 px-6 py-12" dir={dir}>
          <Card>
            <CardHeader>
              <CardTitle>
                <h1 className="text-3xl">{t('مساحة العمل')}</h1>
              </CardTitle>
              <CardDescription>{t('وحدات أعمالك وإعدادات حسابك في مكان واحد.')}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <Button asChild>
                <Link href="/login">{t('تسجيل الدخول')}</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  )
}

Home.layout = (props: { account?: unknown }) => (props.account ? Workspace : Layout)
