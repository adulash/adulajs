import { Link } from '@adonisjs/inertia/react'
import { Inbox, ShieldCheck } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { useMessages, type Translate } from '~/components/ui/messages'
import { CURRENCY_LABEL } from '~/components/ui/resource-value'
import {
  formatDecimal,
  normalizeDashboard,
  shares,
  type DashboardFormat,
  type DashboardTile,
} from '~/components/ui/dashboard_data'

export type DashboardLink = { name: string; label: string }

/** A value as the indicator shows it: grouped digits, amounts with two decimals and currency. */
export function indicatorValue(value: string, format: DashboardFormat, t: Translate) {
  const digits = formatDecimal(value, format)
  return format === 'money' ? `${digits} ${t(CURRENCY_LABEL)}` : digits
}

/**
 * An indicators page (ADR 046). Every number is computed by the server as the viewer, so it
 * covers only the records the viewer may see; widgets the viewer cannot read are absent.
 * Pass `dashboards` to switch between several pages, linked at `/dashboards/:name`.
 */
export function ResourceDashboard({
  dashboard,
  dashboards = [],
  hrefFor = (name) => `/dashboards/${name}`,
}: {
  /** The server's DashboardResult; read structurally so older or newer shapes still render. */
  dashboard: unknown
  dashboards?: DashboardLink[]
  hrefFor?: (name: string) => string
}) {
  const { t } = useMessages()
  const view = normalizeDashboard(dashboard)
  const totals = view.widgets.filter((widget) => widget.kind === 'total')
  const grouped = view.widgets.filter((widget) => widget.kind === 'grouped')
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{view.label}</h1>
          {view.description && (
            <p className="mt-3 text-sm text-muted-foreground">{view.description}</p>
          )}
          <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck size={14} />
            {t('تُحسب الأرقام ضمن نطاق صلاحياتك')}
          </p>
        </div>
      </div>
      {dashboards.length > 1 && (
        <nav
          aria-label={t('لوحات المؤشرات')}
          className="flex flex-wrap gap-1 rounded-lg border bg-muted p-1"
        >
          {dashboards.map((entry) => {
            const current = entry.name === view.name
            return (
              <Link
                key={entry.name}
                href={hrefFor(entry.name)}
                aria-current={current ? 'page' : undefined}
                className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                  current
                    ? 'bg-background font-medium text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {entry.label}
              </Link>
            )
          })}
        </nav>
      )}
      {view.widgets.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Inbox className="mx-auto mb-3 text-muted-foreground" size={30} strokeWidth={1.3} />
            <p className="text-sm font-medium">{t('لا توجد مؤشرات متاحة لك في هذه اللوحة')}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('تظهر المؤشرات التي تسمح صلاحياتك بقراءة سجلاتها.')}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {totals.length > 0 && (
            <section
              aria-label={t('المؤشرات الإجمالية')}
              className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
            >
              {totals.map((widget) => (
                <TotalTile key={widget.key} widget={widget} />
              ))}
            </section>
          )}
          {grouped.length > 0 && (
            <section aria-label={t('المؤشرات حسب الفئة')} className="grid gap-4 lg:grid-cols-2">
              {grouped.map((widget) => (
                <GroupedCard key={widget.key} widget={widget} />
              ))}
            </section>
          )}
        </>
      )}
    </div>
  )
}

/** The widget's label links to its resource list, where the same records can be reviewed. */
function WidgetLabel({ label, href }: { label: string; href: string | null }) {
  const { t } = useMessages()
  if (!href) return <>{label}</>
  return (
    <Link
      href={href}
      className="hover:text-foreground hover:underline"
      aria-label={t('فتح سجلات {label}', { label })}
    >
      {label}
    </Link>
  )
}

function TotalTile({ widget }: { widget: DashboardTile & { kind: 'total' } }) {
  const { t } = useMessages()
  return (
    <Card className="gap-2 py-5">
      <CardHeader className="px-5">
        <CardDescription>
          <WidgetLabel label={widget.label} href={widget.href} />
        </CardDescription>
      </CardHeader>
      <CardContent className="px-5">
        {widget.value === null ? (
          <p className="text-sm text-muted-foreground">{t('لا توجد بيانات ضمن نطاقك')}</p>
        ) : (
          <p dir="ltr" className="text-end text-3xl font-semibold tabular-nums tracking-tight">
            {indicatorValue(widget.value, widget.format, t)}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function GroupedCard({ widget }: { widget: DashboardTile & { kind: 'grouped' } }) {
  const { t } = useMessages()
  const bars = shares(widget.groups.map((group) => group.value))
  return (
    <Card className="gap-4 py-5">
      <CardHeader className="px-5">
        <CardTitle className="text-sm">
          <WidgetLabel label={widget.label} href={widget.href} />
        </CardTitle>
      </CardHeader>
      <CardContent className="px-5">
        {widget.groups.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t('لا توجد بيانات ضمن نطاقك')}
          </p>
        ) : (
          <ol className="grid gap-3">
            {widget.groups.map((group, index) => {
              const value = indicatorValue(group.value, widget.format, t)
              const name = group.label || t('بلا قيمة')
              return (
                <li key={group.key} className="grid gap-1.5">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="truncate">{name}</span>
                    <span dir="ltr" className="shrink-0 font-medium tabular-nums">
                      {value}
                    </span>
                  </div>
                  <div
                    role="meter"
                    aria-label={t('{label}: {value}', { label: name, value })}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={bars[index]}
                    className="h-1.5 overflow-hidden rounded-full bg-muted"
                  >
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${bars[index]}%` }}
                    />
                  </div>
                </li>
              )
            })}
          </ol>
        )}
        {widget.truncated && (
          <p className="mt-4 text-xs text-muted-foreground">{t('تُعرض الفئات الأعلى قيمة فقط.')}</p>
        )}
      </CardContent>
    </Card>
  )
}
