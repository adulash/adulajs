import type { ReactNode } from 'react'
import { router, usePage } from '@inertiajs/react'
import { Link } from '@adonisjs/inertia/react'
import { Settings, ShieldCheck, UserCog } from 'lucide-react'
import { calendarDisplay } from '~/components/ui/calendar_date'
import { useUiPreferences } from '~/components/ui/ui-preferences'
import { useMessages } from '~/components/ui/messages'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { RailLink } from '~/components/rail-link'
import {
  ALERTS_SECTION,
  sectionFor,
  setupPage,
  visibleSections,
  type AdminPage,
  type AdminSection,
  type AdminShellProps,
} from '~/components/admin_sections'

export { adminLinks, adminSections, setupPage } from '~/components/admin_sections'
export type { AdminPage, AdminSection } from '~/components/admin_sections'

const linkClass = (active: boolean) =>
  `flex items-center gap-3 rounded-lg px-4 py-2.5 text-sm transition-colors ${active ? 'bg-accent font-semibold text-primary' : 'text-muted-foreground hover:bg-background hover:text-foreground'}`

type AdminNavProps = AdminShellProps & { isAdmin?: boolean; adminAlerts?: number }

/** The first page a section entry opens. */
export function sectionHref(section: AdminSection) {
  return section.pages[0].href
}

/**
 * The administration entries in the order the user chose (#157): the sidebar shows one
 * entry per section, and each section's pages are sub-tabs inside the page.
 */
export function useAdminEntries(order: (sections: AdminSection[]) => AdminSection[] = (s) => s) {
  const page = usePage<AdminNavProps>()
  const props = page.props
  const sections = order(visibleSections(props))
  const current = sectionFor(page.url, props)
  const setup = setupPage.visible?.(props) ? setupPage : null
  return { sections, current, setup, alerts: props.adminAlerts ?? 0, isAdmin: !!props.isAdmin }
}

/**
 * One administration entry for administrators, pinned under daily work. Inside the
 * administration area it lists one entry per section (#157); the one-time setup is listed
 * first until it is complete. A badge signals failed workflows or a stale backup.
 */
export function AdminNav({
  order,
  compact = false,
}: {
  order?: (sections: AdminSection[]) => AdminSection[]
  /** The collapsed sidebar: icons with their names as tooltips (#153). */
  compact?: boolean
}) {
  const page = usePage<AdminNavProps>()
  const { t } = useMessages()
  const { sections, current, setup, alerts, isAdmin } = useAdminEntries(order)
  if (!isAdmin) return null
  const inside = page.url.startsWith('/admin')
  if (compact) {
    const alertLabel = t('{count} تنبيه إداري', { count: alerts })
    return (
      <div className="mt-4 flex flex-col items-center gap-1 border-t border-border pt-4">
        <RailLink
          href="/admin"
          label={t('الإدارة')}
          icon={Settings}
          active={page.url === '/admin'}
          badge={inside ? 0 : alerts}
          badgeLabel={alertLabel}
        />
        {inside && (
          <nav aria-label={t('التنقل الإداري')} className="flex flex-col items-center gap-1">
            {setup && (
              <RailLink
                href={setup.href}
                label={t(setup.label)}
                icon={setup.icon}
                active={page.url.startsWith(setup.href)}
              />
            )}
            {sections.map((section) => (
              <RailLink
                key={section.id}
                href={sectionHref(section)}
                label={t(section.title)}
                icon={section.icon}
                active={current?.section.id === section.id}
                badge={section.id === ALERTS_SECTION ? alerts : 0}
                badgeLabel={alertLabel}
              />
            ))}
          </nav>
        )}
      </div>
    )
  }
  const alertBadge = alerts > 0 && (
    <Badge
      variant="destructive"
      className="ms-auto px-1.5"
      aria-label={t('{count} تنبيه إداري', { count: alerts })}
    >
      {alerts}
    </Badge>
  )
  return (
    <div className="mt-6 border-t border-border px-4 pt-5">
      <Link
        href="/admin"
        aria-current={inside && page.url === '/admin' ? 'page' : undefined}
        className={`${linkClass(false)} ${inside ? 'font-semibold text-foreground' : ''}`}
      >
        <Settings size={17} strokeWidth={1.6} />
        {t('الإدارة')}
        {!inside && alertBadge}
      </Link>
      {inside && (
        <nav aria-label={t('التنقل الإداري')} className="mt-2 space-y-1">
          {setup && <AdminEntry page={setup} active={page.url.startsWith(setup.href)} />}
          {sections.map((section) => (
            <Link
              key={section.id}
              href={sectionHref(section)}
              aria-current={current?.section.id === section.id ? 'page' : undefined}
              className={linkClass(current?.section.id === section.id)}
            >
              <section.icon size={17} strokeWidth={1.6} />
              {t(section.title)}
              {section.id === ALERTS_SECTION && alertBadge}
            </Link>
          ))}
        </nav>
      )}
    </div>
  )
}

function AdminEntry({ page, active }: { page: AdminPage; active: boolean }) {
  const { t } = useMessages()
  return (
    <Link
      href={page.href}
      aria-current={active ? 'page' : undefined}
      className={linkClass(active)}
    >
      <page.icon size={17} strokeWidth={1.6} />
      {t(page.label)}
    </Link>
  )
}

/**
 * The pages of the current administration section as vertical sub-tabs at the start side
 * (#157); below the large breakpoint they become one scrolling row.
 */
export function AdminSectionTabs({ children }: { children: ReactNode }) {
  const page = usePage<AdminNavProps>()
  const { t } = useMessages()
  const current = sectionFor(page.url, page.props)
  if (!current || current.section.pages.length < 2) return <>{children}</>
  const { section } = current
  return (
    <div className="lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-8">
      <nav
        aria-label={t('صفحات القسم: {section}', { section: t(section.title) })}
        className="mb-6 lg:mb-0"
        data-admin-subtabs
      >
        <p className="mb-2 px-3 text-[11px] font-semibold text-muted-foreground">
          {t(section.title)}
        </p>
        <ul className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
          {section.pages.map((entry) => {
            const active = entry.id === current.page.id
            return (
              <li key={entry.id} className="shrink-0">
                <Link
                  href={entry.href}
                  aria-current={active ? 'page' : undefined}
                  className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors ${active ? 'bg-accent font-semibold text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
                >
                  <entry.icon size={16} strokeWidth={1.6} />
                  {t(entry.label)}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

export function ImpersonationBar() {
  const page = usePage<{
    impersonating?: boolean
    account?: { fullName: string | null; email: string }
  }>()
  const { t } = useMessages()
  if (!page.props.impersonating) return null
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-3 border-b border-warning/30 bg-warning/10 px-5 py-2 text-sm text-warning lg:px-10"
    >
      <span className="flex items-center gap-2">
        <UserCog size={16} />
        {t('أنت تتصفح باسم {name}', {
          name: page.props.account?.fullName || page.props.account?.email || '',
        })}
      </span>
      <Button size="sm" variant="outline" onClick={() => router.post('/impersonation/stop')}>
        {t('إنهاء الانتحال')}
      </Button>
    </div>
  )
}

export function AdminHeader({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children?: ReactNode
}) {
  const { t } = useMessages()
  return (
    <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
      <div>
        <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck size={15} />
          <span>{t('الإدارة')}</span>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-3 text-sm text-muted-foreground">{description}</p>}
      </div>
      {children && <div className="flex flex-wrap gap-2 pt-3">{children}</div>}
    </div>
  )
}

export function useDateTimeFormatter() {
  const { calendar } = useUiPreferences()
  return (value: string | null | undefined) => calendarDisplay(value, calendar, true)
}

export function formatAge(ms: number | null) {
  if (ms === null) return 'لا يوجد'
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `قبل ${seconds} ثانية`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `قبل ${minutes} دقيقة`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `قبل ${hours} ساعة`
  return `قبل ${Math.round(hours / 24)} يوماً`
}
