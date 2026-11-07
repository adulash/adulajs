import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { usePage } from '@inertiajs/react'
import { Link } from '@adonisjs/inertia/react'
import {
  ChartColumn,
  ChevronDown,
  ClipboardList,
  LayoutDashboard,
  FileUp,
  PanelRightClose,
  PanelRightOpen,
  UserPlus,
  type LucideIcon,
} from 'lucide-react'
import type { DashboardSummary, ResourceNavigation } from 'adula'
import { Toaster } from '~/components/ui/sonner'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { Separator } from '~/components/ui/separator'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '~/components/ui/breadcrumb'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { AccountMenu } from '~/components/account-menu'
import { BrandMark } from '~/components/brand-mark'
import {
  AdminNav,
  AdminSectionTabs,
  AdminTabPanel,
  ImpersonationBar,
  adminLinks,
  sectionHref,
  useAdminEntries,
  type AdminSection,
} from '~/components/admin-nav'
import { ALERTS_SECTION } from '~/components/admin_sections'
import { FlashMessages } from '~/components/flash-messages'
import { useUiPreferences } from '~/components/ui/ui-preferences'
import { useMessages } from '~/components/ui/messages'
import { BackupBanner } from '~/components/backup-banner'
import { NotificationBell } from '~/components/notification-bell'
import AssistantLauncher from '~/components/assistant/assistant-launcher'
import { TasksButton } from '~/components/tasks-button'
import { TopNavigation } from '~/components/top-navigation'
import { NavOrderDialog, type OrderGroup } from '~/components/nav-order-dialog'
import { RailLink, railItemClass, useRailSide } from '~/components/rail-link'
import { moduleIcons } from '~/components/module_icons'
import { usePreference } from '~/components/preferences'
import { resolvedTheme, type Theme } from '~/components/theme'
import {
  applyOrder,
  effectiveLayout,
  groupModules,
  isActivePath,
  isSidebarMode,
  navLinkClass,
  type ModuleGroup,
  type ShellLayout,
  type SidebarMode,
} from '~/components/shell_navigation'

/** Collapsed module groups are a per-browser convenience; storage may be unavailable. */
function useCollapsedModules() {
  const [collapsed, setCollapsed] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('adula:nav-collapsed') ?? '[]') as string[]
    } catch {
      return []
    }
  })
  const toggle = (module: string) =>
    setCollapsed((current) => {
      const next = current.includes(module)
        ? current.filter((name) => name !== module)
        : [...current, module]
      try {
        localStorage.setItem('adula:nav-collapsed', JSON.stringify(next))
      } catch {
        // The groups still toggle for this page view.
      }
      return next
    })
  return { collapsed, toggle }
}

/** A daily-work entry of the navigation; `id` is its stable menu-order id. */
export type WorkEntry = {
  id: string
  href: string
  label: string
  icon: LucideIcon
  badge: number
  /** The address prefix that marks the entry current, when it differs from `href`. */
  match?: string
}

const SIDEBAR_WIDTH: Record<SidebarMode, string> = {
  expanded: '244px',
  icons: '4.5rem',
  hidden: '0px',
}

/** A phone navigation link; the current page is marked like the other navigation. */
const phoneLinkClass = (active: boolean) =>
  `inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 ${active ? 'bg-accent font-semibold text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`

export default function Workspace({ children }: { children: ReactNode }) {
  const preferences = useUiPreferences()
  const { t, dir } = useMessages()
  const page = usePage<{
    account?: { fullName: string | null; email: string }
    navigation: ResourceNavigation
    canInviteUsers?: boolean
    canImport?: boolean
    isAdmin?: boolean
    dashboards?: DashboardSummary[]
    uiPreferences?: { layout?: ShellLayout; layoutUserChoice?: boolean }
    /** Set while a record dialog is open over a list (ADR 035). */
    overlay?: { list: string }
  }>()
  const { collapsed, toggle } = useCollapsedModules()
  const [storedMode, setMode] = usePreference<SidebarMode>('shell.sidebar')
  const [storedCollapse] = usePreference<'icons' | 'hidden'>('shell.sidebarCollapse')
  const collapseTo: SidebarMode = storedCollapse === 'hidden' ? 'hidden' : 'icons'
  const [ownLayout] = usePreference<ShellLayout | null>('shell.layout')
  const [order, setOrder, resetOrder] = usePreference<string[]>('shell.navOrder')
  const [theme] = usePreference<Theme>('shell.theme')
  const [arranging, setArranging] = useState(false)
  const layout = effectiveLayout(page.props.uiPreferences, ownLayout)
  const mode: SidebarMode = isSidebarMode(storedMode) ? storedMode : 'expanded'
  const navOrder = Array.isArray(order) ? order : []

  // Daily work first: the overview, indicators and imports only for users who can create
  // records (#34, #35). «مهامي» sits beside the notification bell (#156).
  const work = applyOrder<WorkEntry>(
    [
      { id: 'work.overview', href: '/', label: t('نظرة عامة'), icon: LayoutDashboard, badge: 0 },
      // The entry opens the first dashboard the viewer may see directly, and stays current on
      // every dashboard, which link to each other (ADR 046).
      ...(page.props.dashboards?.length
        ? [
            {
              id: 'work.dashboards',
              href: `/dashboards/${page.props.dashboards[0].name}`,
              match: '/dashboards',
              label: t('لوحات المؤشرات'),
              icon: ChartColumn,
              badge: 0,
            },
          ]
        : []),
      ...(page.props.canImport
        ? [{ id: 'work.imports', href: '/imports', label: t('الاستيراد'), icon: FileUp, badge: 0 }]
        : []),
    ],
    navOrder
  )
  const modules = applyOrder(groupModules(page.props.navigation ?? []), navOrder)
  const orderSections = (sections: AdminSection[]) =>
    applyOrder(
      sections.map((section) => ({ id: `admin.${section.id}`, section })),
      navOrder
    ).map((entry) => entry.section)
  const admin = useAdminEntries(orderSections)
  const isActive = (href: string) => isActivePath(page.url, href)
  // The phone navigation scrolls sideways; its current entry is brought into view.
  const phoneNav = useRef<HTMLElement>(null)
  useEffect(() => {
    phoneNav.current
      ?.querySelector<HTMLElement>('[aria-current="page"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [page.url])

  // Server navigation labels arrive localized; the administration labels are interface text.
  const current =
    [
      ...work,
      { href: '/my-tasks', label: t('مهامي') },
      ...(page.props.navigation ?? []),
      ...adminLinks.map((entry) => ({ ...entry, label: t(entry.label) })),
      // The account pages, named as in the account menu.
      { href: '/account/profile', label: t('الملف الشخصي') },
      { href: '/account/sessions', label: t('الجلسات') },
      { href: '/account/tokens', label: t('رموز API') },
      { href: '/account/delegations', label: t('التفويض أثناء الغياب') },
    ]
      .filter((entry) => entry.href !== '/')
      .sort((a, b) => b.href.length - a.href.length)
      .find((entry) =>
        isActive('match' in entry && typeof entry.match === 'string' ? entry.match : entry.href)
      )
      ?.label ??
    (page.url.startsWith('/admin')
      ? t('الإدارة')
      : page.url.startsWith('/account')
        ? t('حسابي')
        : t('نظرة عامة'))

  // The arrangement dialog lists only entries this user can see.
  const orderGroups: OrderGroup[] = [
    { id: 'work', title: t('العمل اليومي'), entries: work },
    {
      id: 'modules',
      title: t('التطبيقات'),
      entries: modules.map((group) => ({ id: group.id, label: group.label })),
    },
    ...(admin.isAdmin
      ? [
          {
            id: 'admin',
            title: t('أقسام الإدارة'),
            entries: admin.sections.map((section) => ({
              id: `admin.${section.id}`,
              label: t(section.title),
            })),
          },
        ]
      : []),
  ].filter((group) => group.entries.length > 1)
  const arrange = orderGroups.length ? () => setArranging(true) : undefined

  const sidebar = layout === 'sidebar'
  const shellStyle = {
    '--shell-sidebar': sidebar ? SIDEBAR_WIDTH[mode] : '0px',
  } as CSSProperties
  // The brand belongs to the header (owner decision 20); the tagline shows beside a wide sidebar.
  const brand = (
    <Link href="/" className="flex min-w-0 items-center gap-3" data-brand>
      <BrandMark size="sm" />
      <span className="min-w-0">
        <strong className="block truncate text-base leading-tight tracking-tight">عدولة</strong>
        <span className="hidden truncate text-[11px] text-muted-foreground sm:block">
          {t('مساحة أعمالك، بوضوح')}
        </span>
      </span>
    </Link>
  )
  // One control for the sidebar: open it, or collapse it the way the user chose (icons or
  // hidden, from the account menu). The header trigger and the rail on the sidebar's edge share it.
  const open = sidebar && mode === 'expanded'
  const toggleSidebar = () => void setMode(open ? collapseTo : 'expanded')
  const toggleLabel = open ? t('طي القائمة الجانبية') : t('إظهار القائمة الجانبية')
  // The account menu sits in the header whenever the expanded sidebar does not show it.
  const headerAccount = !sidebar || mode !== 'expanded' ? '' : 'lg:hidden'
  const area = page.url.startsWith('/account') ? t('حسابي') : t('مساحة العمل')

  return (
    <div
      dir={dir}
      // From the large breakpoint the frame fills the window: the header on top, the sidebar
      // and the page below it, and the page area scrolls on its own (scrollbar at the inline
      // end of the window: the left in Arabic). Printing returns to the normal flow.
      className="min-h-screen bg-background text-foreground lg:flex lg:h-svh lg:min-h-0 lg:flex-col lg:overflow-hidden print:block print:h-auto print:overflow-visible"
      data-workspace-shell
      data-layout={layout}
      data-sidebar={sidebar ? mode : undefined}
      style={shellStyle}
    >
      <FlashMessages />
      {/* One header from edge to edge (owner decision 20); the warnings sit right under it. */}
      <div className="sticky top-0 z-30 shrink-0 bg-background" data-shell-top>
        <header
          className="flex h-[72px] items-center border-b border-border bg-background"
          data-shell-header
        >
          <div
            // The start segment stands above the sidebar, as wide as it: the brand and the
            // sidebar's own trigger.
            className={`flex h-full min-w-0 shrink-0 items-center gap-2 ps-5 pe-3 ${sidebar && mode !== 'hidden' ? 'lg:w-(--shell-sidebar) lg:border-e lg:border-border' : ''} ${sidebar && mode === 'icons' ? 'lg:justify-center lg:px-0' : 'lg:ps-7'} ${preferences.pageTransitions ? 'motion-safe:transition-[width] motion-safe:duration-200' : ''}`}
            data-header-start
          >
            <span className={`min-w-0 flex-1 ${sidebar && mode === 'icons' ? 'lg:hidden' : ''}`}>
              {brand}
            </span>
            {sidebar && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="hidden lg:inline-flex"
                    aria-label={toggleLabel}
                    aria-controls="workspace-sidebar"
                    aria-expanded={open}
                    onClick={toggleSidebar}
                    data-sidebar-trigger
                  >
                    {open ? (
                      <PanelRightClose className="ltr:-scale-x-100" aria-hidden />
                    ) : (
                      <PanelRightOpen className="ltr:-scale-x-100" aria-hidden />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{toggleLabel}</TooltipContent>
              </Tooltip>
            )}
          </div>
          <div className="flex min-w-0 flex-1 items-center justify-between gap-3 pe-5 lg:pe-10">
            <div className="flex min-w-0 items-center gap-3 ps-4 lg:ps-6" data-breadcrumb>
              {sidebar && mode === 'icons' && <span className="hidden lg:block">{brand}</span>}
              <Separator
                orientation="vertical"
                className={`data-[orientation=vertical]:h-4 ${sidebar && mode === 'expanded' ? 'lg:hidden' : ''}`}
              />
              <Breadcrumb className={sidebar ? '' : 'lg:hidden'}>
                <BreadcrumbList className="flex-nowrap text-xs">
                  <BreadcrumbItem className="hidden sm:inline-flex">{area}</BreadcrumbItem>
                  <BreadcrumbSeparator className="hidden sm:block" />
                  <BreadcrumbItem className="min-w-0">
                    <BreadcrumbPage className="truncate">{current}</BreadcrumbPage>
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
            </div>
            <div className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
              <TasksButton />
              <AssistantLauncher />
              <NotificationBell />
              <span className="hidden items-center gap-2 sm:flex">
                <span className="size-1.5 rounded-full bg-primary" />
                {t('بيئة التجربة')}
              </span>
              <span className={headerAccount}>
                <AccountMenu variant="compact" onArrange={arrange} sidebarChoice={sidebar} />
              </span>
            </div>
          </div>
        </header>
        {!sidebar && <TopNavigation work={work} modules={modules} orderSections={orderSections} />}
      </div>
      <div className="lg:flex lg:min-h-0 lg:flex-1 print:block">
        {sidebar && (
          <div
            className={`relative hidden shrink-0 print:hidden ${mode === 'hidden' ? '' : 'lg:flex'}`}
          >
            <aside
              id="workspace-sidebar"
              aria-label={t('القائمة الجانبية')}
              inert={mode === 'hidden'}
              // Its own thin scroller, apart from the page's (the owner's double scrollbar).
              className={`flex w-(--shell-sidebar) flex-col overflow-y-auto border-e border-border bg-card pt-6 [scrollbar-color:transparent_transparent] [scrollbar-width:thin] hover:[scrollbar-color:var(--border)_transparent] focus-within:[scrollbar-color:var(--border)_transparent] [&>*]:shrink-0 ${preferences.pageTransitions ? 'motion-safe:transition-[width] motion-safe:duration-200' : ''}`}
            >
              {mode === 'icons' ? (
                <IconRail
                  work={work}
                  modules={modules}
                  isActive={isActive}
                  orderSections={orderSections}
                  onArrange={arrange}
                />
              ) : (
                <>
                  <p className="mb-3 px-7 text-[11px] font-semibold text-muted-foreground">
                    {t('العمل اليومي')}
                  </p>
                  <nav aria-label={t('التنقل الرئيسي')} className="space-y-5 px-4">
                    <div className="space-y-1">
                      {work.map(({ href, match, label, icon: Icon, badge }) => (
                        <Link
                          key={href}
                          href={href}
                          aria-current={isActive(match ?? href) ? 'page' : undefined}
                          className={navLinkClass(isActive(match ?? href))}
                        >
                          <Icon size={19} strokeWidth={1.6} />
                          {label}
                          {badge > 0 && (
                            <Badge
                              className="ms-auto px-1.5"
                              aria-label={t('{count} مفتوحة', { count: badge })}
                            >
                              {badge}
                            </Badge>
                          )}
                        </Link>
                      ))}
                    </div>
                    {modules.map((group) => {
                      const expanded = !collapsed.includes(group.module)
                      return (
                        <div key={group.module} role="group" aria-label={group.label}>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-expanded={expanded}
                            onClick={() => toggle(group.module)}
                            className="h-8 w-full justify-between px-4 text-[11px] font-semibold text-muted-foreground"
                          >
                            {group.label}
                            <ChevronDown
                              size={14}
                              className={`transition-transform ${expanded ? '' : 'rotate-90'}`}
                            />
                          </Button>
                          {expanded && (
                            <div className="mt-1 space-y-1">
                              {group.links.map((entry) => (
                                <Link
                                  key={entry.href}
                                  href={entry.href}
                                  aria-current={isActive(entry.href) ? 'page' : undefined}
                                  className={navLinkClass(isActive(entry.href))}
                                >
                                  <ClipboardList size={18} strokeWidth={1.6} />
                                  {entry.label}
                                </Link>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </nav>
                  <AdminNav order={orderSections} />
                  <div className="mx-5 mb-6 mt-auto border-t border-border pt-5">
                    {page.props.canInviteUsers && (
                      <Link
                        // Administrators invite over the users list; the address opens that dialog directly.
                        href={page.props.isAdmin ? "/admin/users?invite=1" : "/users/invite"}
                        className="mb-4 flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <UserPlus size={14} />
                        {t('دعوة مستخدم')}
                      </Link>
                    )}
                    <AccountMenu onArrange={arrange} sidebarChoice />
                  </div>
                </>
              )}
            </aside>
            {/* The rail on the sidebar's edge toggles it too (shadcn SidebarRail). */}
            <button
              type="button"
              tabIndex={-1}
              aria-label={toggleLabel}
              title={toggleLabel}
              onClick={toggleSidebar}
              className="absolute inset-y-0 -end-2 z-20 w-4 cursor-ew-resize after:absolute after:inset-y-0 after:start-1/2 after:w-[2px] after:transition-colors hover:after:bg-border"
              data-sidebar-rail
            />
          </div>
        )}
        {/* Phones: the main navigation first, then the section tabs and the page. */}
        <nav
          ref={phoneNav}
          aria-label={t('التنقل على الجوال')}
          className="flex gap-1 overflow-auto border-b border-border bg-card px-3 py-2 text-xs whitespace-nowrap lg:hidden"
        >
          {work.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item.match ?? item.href) ? 'page' : undefined}
              className={phoneLinkClass(isActive(item.match ?? item.href))}
            >
              {item.label}
              {item.badge > 0 && (
                <Badge className="px-1.5" aria-label={t('{count} مفتوحة', { count: item.badge })}>
                  {item.badge}
                </Badge>
              )}
            </Link>
          ))}
          {modules.flatMap((group) =>
            group.links.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive(item.href) ? 'page' : undefined}
                className={phoneLinkClass(isActive(item.href))}
              >
                {item.label}
              </Link>
            ))
          )}
          {/* The same two administration entries as the sidebar, each opening its first
              page directly. */}
          {admin.isAdmin &&
            admin.sections.map((section) => {
              const active = admin.current?.section.id === section.id
              return (
                <Link
                  key={section.id}
                  href={sectionHref(section)}
                  aria-current={active ? 'page' : undefined}
                  className={phoneLinkClass(active)}
                >
                  {t(section.title)}
                  {section.id === ALERTS_SECTION && admin.alerts > 0 && (
                    <Badge
                      variant="destructive"
                      className="px-1.5"
                      aria-label={t('{count} تنبيه إداري', { count: admin.alerts })}
                    >
                      {admin.alerts}
                    </Badge>
                  )}
                </Link>
              )
            })}
        </nav>
        {/* Administration pages put their section's tabs at the head of this column, right
            under the header (owner decision 22). */}
        <AdminSectionTabs className="min-w-0 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col print:block">
          {/* The warnings head the page column, beside the sidebar. */}
          <div className="shrink-0 print:hidden">
            <BackupBanner />
            <ImpersonationBar />
          </div>
          <div
            // The page's scroll container from the large breakpoint; Inertia keeps and restores
            // its position across visits (scroll-region).
            scroll-region=""
            className="min-w-0 lg:min-h-0 lg:flex-1 lg:overflow-y-auto print:overflow-visible"
            data-page-scroll
          >
            <main className="mx-auto max-w-[1440px] p-5 lg:px-10 lg:py-9">
              <AdminTabPanel>
                <div
                  // A record dialog over a list keeps the list's key, so the list stays mounted.
                  key={(page.props.overlay?.list ?? page.url).split('?')[0]}
                  className={preferences.pageTransitions ? 'adula-page-enter' : undefined}
                >
                  {children}
                </div>
              </AdminTabPanel>
            </main>
          </div>
        </AdminSectionTabs>
      </div>
      {arrange && (
        <NavOrderDialog
          open={arranging}
          onOpenChange={setArranging}
          groups={orderGroups}
          order={navOrder}
          onSave={setOrder}
          onReset={resetOrder}
        />
      )}
      <Toaster position="bottom-left" richColors theme={resolvedTheme(theme ?? 'light')} />
    </div>
  )
}

/** The collapsed sidebar: icons with their names as tooltips (#153). */
function IconRail({
  work,
  modules,
  isActive,
  orderSections,
  onArrange,
}: {
  work: WorkEntry[]
  modules: ModuleGroup[]
  isActive: (href: string) => boolean
  orderSections: (sections: AdminSection[]) => AdminSection[]
  onArrange?: () => void
}) {
  const { t } = useMessages()
  const side = useRailSide()
  const icons = moduleIcons(modules.map((group) => group.module))
  return (
    <>
      <nav aria-label={t('التنقل الرئيسي')} className="flex flex-col items-center gap-1">
        {work.map((entry) => (
          <RailLink
            key={entry.href}
            href={entry.href}
            label={entry.label}
            icon={entry.icon}
            active={isActive(entry.match ?? entry.href)}
            badge={entry.badge}
            badgeLabel={t('{count} مفتوحة', { count: entry.badge })}
          />
        ))}
        {modules.length > 0 && <Separator className="my-2 w-8 data-[orientation=horizontal]:w-8" />}
        {modules.map((group) => {
          const active = group.links.some((entry) => isActive(entry.href))
          const Icon = icons.get(group.module)!
          return (
            <DropdownMenu key={group.module}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger
                    aria-label={group.label}
                    data-module={group.module}
                    className={railItemClass(active)}
                  >
                    <Icon size={19} strokeWidth={1.6} aria-hidden />
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side={side}>{group.label}</TooltipContent>
              </Tooltip>
              <DropdownMenuContent side={side} align="start" className="w-56">
                <DropdownMenuLabel className="text-xs text-muted-foreground">
                  {group.label}
                </DropdownMenuLabel>
                {group.links.map((entry) => (
                  <DropdownMenuItem key={entry.href} asChild>
                    <Link
                      href={entry.href}
                      aria-current={isActive(entry.href) ? 'page' : undefined}
                      className="aria-[current=page]:font-semibold aria-[current=page]:text-primary"
                    >
                      <ClipboardList />
                      {entry.label}
                    </Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )
        })}
      </nav>
      <AdminNav order={orderSections} compact />
      <div className="mb-6 mt-auto grid place-items-center border-t border-border pt-5">
        <AccountMenu variant="compact" onArrange={onArrange} />
      </div>
    </>
  )
}
