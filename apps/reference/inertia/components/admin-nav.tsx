import { useEffect, useState, type ReactNode } from 'react'
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
 * entry per section, and each section's pages are vertical tabs inside the page.
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

const WIDE = '(min-width: 1024px)'

/** True from the large breakpoint, where the section tabs stand vertically beside the page. */
function useWide() {
  const [wide, setWide] = useState(
    () => typeof window === 'undefined' || window.matchMedia(WIDE).matches
  )
  useEffect(() => {
    const query = window.matchMedia(WIDE)
    const update = () => setWide(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return wide
}

/**
 * The pages of the current administration section as the registry Tabs (owner's review of
 * 2.3.0, ADR 049): vertical at the start side of the page body, sticky while the page
 * scrolls; one horizontal row that scrolls below the large breakpoint. Each tab is a link
 * to its page, so the address selects the tab (direct links, reloads, Back and Forward), and
 * the page is the tab panel. Arrow keys move between tabs; Enter opens one (manual
 * activation, since opening a tab loads a page).
 */
export function AdminSectionTabs({ children }: { children: ReactNode }) {
  const page = usePage<AdminNavProps>()
  const { t, dir } = useMessages()
  const wide = useWide()
  const current = sectionFor(page.url, page.props)
  if (!current || current.section.pages.length < 2) return <>{children}</>
  const { section } = current
  return (
    <Tabs
      dir={dir}
      orientation={wide ? 'vertical' : 'horizontal'}
      activationMode="manual"
      value={current.page.id}
      className="gap-6 lg:items-start lg:gap-8"
      data-admin-tabs
    >
      <TabsList
        aria-label={t('صفحات القسم: {section}', { section: t(section.title) })}
        className="max-w-full shrink-0 justify-start overflow-x-auto lg:sticky lg:top-[calc(var(--shell-top,0px)+1.5rem)] lg:w-56 lg:overflow-visible"
      >
        {section.pages.map((entry) => {
          const count = entry.alerts?.(page.props) ?? 0
          return (
            <TabsTrigger
              key={entry.id}
              value={entry.id}
              asChild
              // The shell's active navigation pattern, filled, with no border or bar.
              className="flex-none data-[state=active]:bg-accent data-[state=active]:font-semibold data-[state=active]:text-primary group-data-[variant=default]/tabs-list:data-[state=active]:shadow-none dark:data-[state=active]:border-transparent dark:data-[state=active]:bg-accent dark:data-[state=active]:text-primary"
            >
              <Link href={entry.href}>
                <entry.icon strokeWidth={1.6} />
                {t(entry.label)}
                {count > 0 && (
                  <Badge
                    variant="destructive"
                    className="ms-auto px-1.5"
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
      <TabsContent value={current.page.id} className="w-full min-w-0">
        {children}
      </TabsContent>
    </Tabs>
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
