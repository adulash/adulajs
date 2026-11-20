import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { usePage } from '@inertiajs/react'
import { Link } from '@adonisjs/inertia/react'
import {
  ChartColumn,
  ChevronDown,
  ClipboardList,
  LayoutDashboard,
  FileUp,
  UserPlus,
  type LucideIcon,
} from 'lucide-react'
import type { DashboardSummary, ResourceNavigation } from 'adula'
import { Toaster } from '~/components/ui/sonner'
import { Badge } from '~/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { Separator } from '~/components/ui/separator'
import { ScrollArea } from '~/components/ui/scroll-area'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from '~/components/ui/sidebar'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '~/components/ui/breadcrumb'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '~/components/ui/tooltip'
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
import { OccasionBanner } from '~/components/occasion-banner'
import { useAppearance } from '~/components/appearance'
import { NotificationBell } from '~/components/notification-bell'
import AssistantLauncher from '~/components/assistant/assistant-launcher'
import { TasksButton } from '~/components/tasks-button'
import { TopNavigation } from '~/components/top-navigation'
import { NavOrderDialog, type OrderGroup } from '~/components/nav-order-dialog'
import { SIDEBAR_ACTIVE, SidebarEntry, useRailSide } from '~/components/rail-link'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '~/components/ui/collapsible'
import { moduleIcons } from '~/components/module_icons'
import { usePreference } from '~/components/preferences'
import { resolvedTheme, type Theme } from '~/components/theme'
import { openInvite } from '~/components/invite-user-dialog'
import {
  applyOrder,
  effectiveLayout,
  groupModules,
  isActivePath,
  isSidebarMode,
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
  icons: '3rem',
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
  const appearance = useAppearance()
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
      { href: '/account/delegations', label: t('التفويض أثناء الغياب') },
    ]
      .filter((entry) => entry.href !== '/')
      .sort((a, b) => b.href.length - a.href.length)
      .find((entry) =>
        isActive('match' in entry && typeof entry.match === 'string' ? entry.match : entry.href)
      )?.label ??
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
    '--shell-header': '72px',
    // shadcn Sidebar's widths: the expanded sidebar and the icon rail.
    '--sidebar-width': SIDEBAR_WIDTH.expanded,
    '--sidebar-width-icon': SIDEBAR_WIDTH.icons,
  } as CSSProperties
  // The brand belongs to the header (owner decision 20); the tagline shows beside a wide sidebar.
  // «المظهر والهوية» (ADR 053) may replace the name and the mark, today's occasion included.
  // A company name is identity and is never cut at desktop widths: it takes two lines, and a
  // saved name takes the tagline's place.
  const appearanceBrand = appearance?.brand
  const savedCompany = appearanceBrand?.company ?? null
  const brand = (
    <Link href="/" className="flex min-w-0 items-center gap-2" data-brand>
      <BrandMark size="sm" logo={appearanceBrand?.logoUrl} />
      <span className="min-w-0">
        <strong
          className="line-clamp-2 pb-0.5 text-base leading-tight tracking-tight break-words"
          title={savedCompany ?? undefined}
          data-brand-name
        >
          {savedCompany ?? <>أدولا</>}
        </strong>
        {!savedCompany && (
          <span className="hidden truncate text-[11px] text-muted-foreground sm:block">
            {t('مساحة أعمالك، بوضوح')}
          </span>
        )}
      </span>
    </Link>
  )
  // One control for the sidebar: open it, or collapse it the way the user chose (icons or
  // hidden, from the account menu). The header trigger and the rail on the sidebar's edge share it.
  const open = sidebar && mode === 'expanded'
  const toggleLabel = open ? t('طي القائمة الجانبية') : t('إظهار القائمة الجانبية')
  // The account menu sits in the header whenever the expanded sidebar does not show it.
  const headerAccount = !sidebar || mode !== 'expanded' ? '' : 'lg:hidden'
  const area = page.url.startsWith('/account') ? t('حسابي') : t('مساحة العمل')

  return (
    // shadcn Sidebar (ADR 055): the provider is controlled by the user's `shell.sidebar`
    // preference, so the trigger and the rail store the mode; there is no keyboard shortcut.
    <SidebarProvider
      dir={dir}
      open={!sidebar || mode === 'expanded'}
      onOpenChange={(next) => void setMode(next ? 'expanded' : collapseTo)}
      // From the large breakpoint the frame fills the window: the header on top, the sidebar
      // and the page below it, and the page area scrolls on its own (scrollbar at the inline
      // end of the window: the left in Arabic). Printing returns to the normal flow.
      className={`block min-h-screen bg-background text-foreground lg:flex lg:h-svh lg:min-h-0 lg:flex-col lg:overflow-hidden print:block print:h-auto print:overflow-visible ${preferences.pageTransitions ? '' : '[&_[data-slot=sidebar-gap]]:transition-none'}`}
      data-workspace-shell
      data-layout={layout}
      data-sidebar={sidebar ? mode : undefined}
      style={shellStyle}
    >
      {/* shadcn Sidebar opens tooltips at once; the shell keeps the application's delay. */}
      <TooltipProvider delayDuration={300}>
        <FlashMessages />
        {/* One header from edge to edge (owner decision 20); the warnings sit right under it. */}
        <div className="sticky top-0 z-30 shrink-0 bg-background" data-shell-top>
          <header
            className="flex h-(--shell-header) items-center border-b border-border bg-background"
            data-shell-header
          >
            <div
              // The start segment stands above the sidebar, as wide as it: the brand and the
              // sidebar's own trigger.
              className={`flex h-full min-w-0 shrink-0 items-center gap-2 ps-5 pe-3 ${sidebar && mode !== 'hidden' ? 'lg:w-(--shell-sidebar) lg:border-e lg:border-border' : ''} ${sidebar && mode === 'icons' ? 'lg:justify-center lg:px-0' : 'lg:ps-7'} ${preferences.pageTransitions ? 'motion-safe:transition-[width] motion-safe:duration-200 motion-safe:ease-linear' : ''}`}
              data-header-start
            >
              <span className={`min-w-0 flex-1 ${sidebar && mode === 'icons' ? 'lg:hidden' : ''}`}>
                {brand}
              </span>
              {sidebar && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <SidebarTrigger
                      // The panel icon points to the sidebar's side: mirrored in right-to-left.
                      className="hidden lg:inline-flex rtl:[&>svg]:-scale-x-100"
                      aria-label={toggleLabel}
                      aria-controls="workspace-sidebar"
                      aria-expanded={open}
                      data-sidebar-trigger
                    />
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
          {!sidebar && (
            <TopNavigation work={work} modules={modules} orderSections={orderSections} />
          )}
        </div>
        <div className="lg:flex lg:min-h-0 lg:flex-1 print:block">
          {sidebar && (
            // From the large breakpoint only; phones and tablets use the navigation row below.
            <div className="hidden lg:contents print:hidden!">
              <Sidebar
                id="workspace-sidebar"
                role="complementary"
                aria-label={t('القائمة الجانبية')}
                // Collapsing shows the icon rail or hides the sidebar off the canvas, as the user
                // chose in the account menu; hidden, nothing inside it can take focus.
                collapsible={
                  mode === 'hidden' || (mode === 'expanded' && collapseTo === 'hidden')
                    ? 'offcanvas'
                    : 'icon'
                }
                inert={mode === 'hidden'}
                // Below the full-width header (shadcn's site-header layout).
                // Off the canvas it is also invisible once it has slid away, as it was before.
                className={`top-(--shell-header) h-[calc(100svh-var(--shell-header))]! group-data-[collapsible=offcanvas]:invisible ${preferences.pageTransitions ? 'motion-safe:transition-[left,right,width,visibility]' : 'transition-none'}`}
              >
                {/* Its own thin scroller, shown on hover, apart from the page's (the owner's
                  double scrollbar). */}
                <ScrollArea
                  dir={dir}
                  className="min-h-0 flex-1 [&>[data-slot=scroll-area-viewport]>div]:block!"
                >
                  <SidebarContent className="overflow-visible! pt-4">
                    <nav aria-label={t('التنقل الرئيسي')}>
                      <SidebarGroup>
                        <SidebarGroupLabel>{t('العمل اليومي')}</SidebarGroupLabel>
                        <SidebarMenu>
                          {work.map((entry) => (
                            <SidebarEntry
                              key={entry.href}
                              href={entry.href}
                              label={entry.label}
                              icon={entry.icon}
                              active={isActive(entry.match ?? entry.href)}
                              badge={{
                                count: entry.badge,
                                label: t('{count} مفتوحة', { count: entry.badge }),
                              }}
                            />
                          ))}
                        </SidebarMenu>
                      </SidebarGroup>
                      <ModuleGroups
                        modules={modules}
                        rail={mode === 'icons'}
                        isActive={isActive}
                        collapsed={collapsed}
                        onToggle={toggle}
                      />
                    </nav>
                    <AdminNav order={orderSections} />
                  </SidebarContent>
                </ScrollArea>
                <SidebarFooter className="gap-0 p-0">
                  {mode === 'icons' ? (
                    <div className="mb-6 grid place-items-center border-t border-border pt-5">
                      <AccountMenu variant="compact" onArrange={arrange} />
                    </div>
                  ) : (
                    <div className="mx-5 mb-6 border-t border-border pt-5">
                      {page.props.canInviteUsers && (
                        <SidebarMenu className="mb-4">
                          <SidebarMenuItem>
                            <SidebarMenuButton asChild size="sm">
                              <Link
                                // Administrators invite over the users list; the address opens
                                // that dialog directly.
                                href={
                                  page.props.isAdmin ? '/admin/users?invite=1' : '/users/invite'
                                }
                                // Over the users list it opens there at once, with no request.
                                onClick={page.props.isAdmin ? openInvite : undefined}
                              >
                                <UserPlus aria-hidden />
                                <span>{t('دعوة مستخدم')}</span>
                              </Link>
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        </SidebarMenu>
                      )}
                      <AccountMenu onArrange={arrange} sidebarChoice />
                    </div>
                  )}
                </SidebarFooter>
                {/* The rail on the sidebar's edge toggles it too; out of the tab order, since the
                  header trigger is the keyboard control. */}
                <SidebarRail aria-label={toggleLabel} title={toggleLabel} data-sidebar-rail />
              </Sidebar>
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
              <OccasionBanner className="px-5 pt-4 lg:px-10" />
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
      </TooltipProvider>
    </SidebarProvider>
  )
}

/**
 * The module groups of the sidebar (shadcn SidebarGroup on Collapsible, ADR 055). Expanded,
 * each group folds open or shut (a per-browser convenience); in the icon rail each module is
 * one icon that opens a menu of its pages, named by its tooltip and accessible name (#153).
 */
function ModuleGroups({
  modules,
  rail,
  isActive,
  collapsed,
  onToggle,
}: {
  modules: ModuleGroup[]
  rail: boolean
  isActive: (href: string) => boolean
  collapsed: string[]
  onToggle: (module: string) => void
}) {
  const side = useRailSide()
  const icons = moduleIcons(modules.map((group) => group.module))
  if (!rail)
    return modules.map((group) => {
      const expanded = !collapsed.includes(group.module)
      return (
        <Collapsible key={group.module} open={expanded} onOpenChange={() => onToggle(group.module)}>
          <SidebarGroup role="group" aria-label={group.label}>
            <SidebarGroupLabel asChild>
              <CollapsibleTrigger>
                {group.label}
                <ChevronDown
                  className={`ms-auto transition-transform ${expanded ? '' : 'rotate-90 ltr:-rotate-90'}`}
                />
              </CollapsibleTrigger>
            </SidebarGroupLabel>
            <CollapsibleContent>
              <SidebarMenu>
                {group.links.map((entry) => (
                  <SidebarEntry
                    key={entry.href}
                    href={entry.href}
                    label={entry.label}
                    icon={ClipboardList}
                    active={isActive(entry.href)}
                  />
                ))}
              </SidebarMenu>
            </CollapsibleContent>
          </SidebarGroup>
        </Collapsible>
      )
    })
  return (
    <SidebarGroup>
      <SidebarMenu>
        {modules.map((group) => {
          const Icon = icons.get(group.module)!
          return (
            <SidebarMenuItem key={group.module}>
              <DropdownMenu>
                <SidebarMenuButton
                  asChild
                  isActive={group.links.some((entry) => isActive(entry.href))}
                  tooltip={{ children: group.label, side }}
                  className={SIDEBAR_ACTIVE}
                >
                  <DropdownMenuTrigger aria-label={group.label} data-module={group.module}>
                    <Icon aria-hidden />
                  </DropdownMenuTrigger>
                </SidebarMenuButton>
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
            </SidebarMenuItem>
          )
        })}
      </SidebarMenu>
    </SidebarGroup>
  )
}
