import { useEffect, useRef, type ReactNode } from 'react'
import { router, usePage } from '@inertiajs/react'
import { Link } from '@adonisjs/inertia/react'
import { ShieldCheck, UserCog } from 'lucide-react'
import { calendarDisplay } from '~/components/ui/calendar_date'
import { useUiPreferences } from '~/components/ui/ui-preferences'
import { useMessages } from '~/components/ui/messages'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Separator } from '~/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { RailLink } from '~/components/rail-link'
import { navLinkClass } from '~/components/shell_navigation'
import {
  ALERTS_SECTION,
  sectionFor,
  visibleSections,
  type AdminSection,
  type AdminShellProps,
} from '~/components/admin_sections'

export { adminLinks, adminSections, setupPage } from '~/components/admin_sections'
export type { AdminPage, AdminSection } from '~/components/admin_sections'

type AdminNavProps = AdminShellProps & { isAdmin?: boolean }

/** The first page a section entry opens (the setup while it is pending, for the settings). */
export function sectionHref(section: AdminSection) {
  return section.pages[0].href
}

/**
 * The administration entries in the order the user chose (#157): the sidebar shows one
 * entry per section, and each section's pages are horizontal tabs under the header (owner decision 22).
 */
export function useAdminEntries(order: (sections: AdminSection[]) => AdminSection[] = (s) => s) {
  const page = usePage<AdminNavProps>()
  const props = page.props
  const sections = order(visibleSections(props))
  const current = sectionFor(page.url, props)
  return { sections, current, alerts: props.adminAlerts ?? 0, isAdmin: !!props.isAdmin }
}

/**
 * The administration area of the sidebar: exactly two entries, «الإعدادات» and «الأشخاص
 * والصلاحيات», without sub-items (owner's review of 2.3.0, ADR 049). Their pages are tabs
 * inside the page. The alerts count sits on «الإعدادات», where the failed workflows and the
 * backups are.
 */
export function AdminNav({
  order,
  compact = false,
}: {
  order?: (sections: AdminSection[]) => AdminSection[]
  /** The collapsed sidebar: icons with their names as tooltips (#153). */
  compact?: boolean
}) {
  const { t } = useMessages()
  const { sections, current, alerts, isAdmin } = useAdminEntries(order)
  if (!isAdmin) return null
  const alertLabel = t('{count} تنبيه إداري', { count: alerts })
  if (compact)
    return (
      <nav aria-label={t('التنقل الإداري')} className="flex flex-col items-center gap-1">
        <Separator className="my-2 w-8 data-[orientation=horizontal]:w-8" />
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
    )
  return (
    <div className="mt-6 border-t border-border pt-5">
      <p className="mb-3 px-7 text-[11px] font-semibold text-muted-foreground">{t('الإدارة')}</p>
      <nav aria-label={t('التنقل الإداري')} className="space-y-1 px-4">
        {sections.map((section) => {
          const active = current?.section.id === section.id
          return (
            <Link
              key={section.id}
              href={sectionHref(section)}
              aria-current={active ? 'page' : undefined}
              className={navLinkClass(active)}
            >
              <section.icon size={19} strokeWidth={1.6} />
              {t(section.title)}
              {section.id === ALERTS_SECTION && alerts > 0 && (
                <Badge variant="destructive" className="ms-auto px-1.5" aria-label={alertLabel}>
                  {alerts}
                </Badge>
              )}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}

/** The current section and page when the section has more than one page to show as tabs. */
function useSectionTabs() {
  const page = usePage<AdminNavProps>()
  const current = sectionFor(page.url, page.props)
  return current && current.section.pages.length > 1 ? { ...current, props: page.props } : null
}

/**
 * The pages of the current administration section as the registry Tabs in their default
 * look (owner decision 22): one horizontal row right below the main header, across the page
 * area. Each tab is a link to its page, so the address selects the tab (direct links,
 * reloads, Back and Forward), and the page is the tab panel. Arrow keys move between tabs;
 * Enter opens one (manual activation, since opening a tab loads a page). The row stays in
 * view while the page scrolls; it wraps onto further rows on a large screen and,
 * on a phone, scrolls sideways to its active tab.
 *
 * It wraps the page column, so the row and the panel inside the page share one Tabs root.
 */
export function AdminSectionTabs({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  const { t, dir } = useMessages()
  const current = useSectionTabs()
  const list = useRef<HTMLDivElement>(null)
  const active = current?.page.id
  useEffect(() => {
    const trigger = list.current?.querySelector<HTMLElement>('[data-state="active"]')
    trigger?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active])
  if (!current) return <div className={className}>{children}</div>
  const { section, props } = current
  return (
    <Tabs
      dir={dir}
      activationMode="manual"
      value={current.page.id}
      className={`gap-0 ${className ?? ''}`}
      data-admin-tabs
    >
      <div
        // Under the main header: sticky on a phone, where the document scrolls; outside the
        // page's own scroll region from the large breakpoint, so it never scrolls away.
        className="sticky top-[72px] z-20 shrink-0 border-b border-border bg-background lg:static print:hidden"
        data-admin-tabs-row
      >
        {/* The same centred column as the page below it. */}
        <div className="mx-auto max-w-[1440px] px-5 py-2 lg:px-10" data-admin-tabs-column>
        <TabsList
          ref={list}
          aria-label={t('صفحات القسم: {section}', { section: t(section.title) })}
          wrap
        >
          {section.pages.map((entry) => {
            const count = entry.alerts?.(props) ?? 0
            return (
              <TabsTrigger key={entry.id} value={entry.id} asChild>
                <Link href={entry.href}>
                  <entry.icon strokeWidth={1.6} />
                  {t(entry.label)}
                  {count > 0 && (
                    <Badge
                      variant="destructive"
                      className="px-1.5"
                      aria-label={t('{count} تنبيه إداري', { count })}
                    >
                      {count}
                    </Badge>
                  )}
                </Link>
              </TabsTrigger>
            )
          })}
        </TabsList>
        </div>
      </div>
      {children}
    </Tabs>
  )
}

/** The page inside its section's tab panel; any other page passes through. */
export function AdminTabPanel({ children }: { children: ReactNode }) {
  const current = useSectionTabs()
  if (!current) return <>{children}</>
  return (
    <TabsContent value={current.page.id} className="w-full min-w-0">
      {children}
    </TabsContent>
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
