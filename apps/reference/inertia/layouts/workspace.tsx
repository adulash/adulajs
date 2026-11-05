import { useState, type CSSProperties, type ReactNode } from 'react'
import { usePage } from '@inertiajs/react'
import { Link } from '@adonisjs/inertia/react'
import {
  ChartColumn,
  ChevronDown,
  ClipboardList,
  LayoutDashboard,
  FileUp,
  Maximize2,
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
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { AccountMenu } from '~/components/account-menu'
import {
  AdminNav,
  AdminSectionTabs,
  ImpersonationBar,
  adminLinks,
  useAdminEntries,
  type AdminSection,
} from '~/components/admin-nav'
import { FlashMessages } from '~/components/flash-messages'
import { useUiPreferences } from '~/components/ui/ui-preferences'
import { useMessages } from '~/components/ui/messages'
import { BackupBanner } from '~/components/backup-banner'
import { NotificationBell } from '~/components/notification-bell'
import { TasksButton } from '~/components/tasks-button'
import { TopNavigation } from '~/components/top-navigation'
import { NavOrderDialog, type OrderGroup } from '~/components/nav-order-dialog'
import { RailLink, railItemClass, useRailSide } from '~/components/rail-link'
import { usePreference } from '~/components/preferences'
import { resolvedTheme, type Theme } from '~/components/theme'
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

const navLinkClass = (active: boolean) =>
  `flex items-center gap-3 rounded-lg px-4 py-2.5 text-sm transition-colors ${active ? 'bg-accent font-semibold text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`

/** A daily-work entry of the navigation; `id` is its stable menu-order id. */
export type WorkEntry = { id: string; href: string; label: string; icon: LucideIcon; badge: number }

const SIDEBAR_WIDTH: Record<SidebarMode, string> = {
  expanded: '244px',
  icons: '4.5rem',
  hidden: '0px',
}

/** The company mark; the project creator replaces its letter with the company's logo. */
function BrandMark({ size = 'md' }: { size?: 'sm' | 'md' }) {
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-xl bg-primary font-bold text-primary-foreground ${size === 'md' ? 'size-10 text-2xl' : 'size-9 text-xl'}`}
    >
            ع
    </span>
  )
}

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
      // /dashboards opens the first dashboard the viewer may see; it links to the others (ADR 046).
      ...(page.props.dashboards?.length
        ? [
            {
              id: 'work.dashboards',
              href: '/dashboards',
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

  // Server navigation labels arrive localized; the administration labels are interface text.
  const current =
    [
      ...work,
      { href: '/my-tasks', label: t('مهامي') },
      ...(page.props.navigation ?? []),
      ...adminLinks.map((entry) => ({ ...entry, label: t(entry.label) })),
    ]
      .filter((entry) => entry.href !== '/')
      .sort((a, b) => b.href.length - a.href.length)
      .find((entry) => isActive(entry.href))?.label ??
    (page.url.startsWith('/admin') ? t('الإدارة') : t('نظرة عامة'))

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
  const brandName = (
    <span>
      <strong className="block text-xl tracking-tight">عدولة</strong>
      <span className="text-[11px] text-muted-foreground">{t('مساحة أعمالك، بوضوح')}</span>
    </span>
  )
  // The account menu sits in the header whenever the expanded sidebar does not show it.
  const headerAccount = !sidebar || mode === 'hidden' ? '' : 'lg:hidden'

  return (
    <div
      dir={dir}
      className="min-h-screen bg-background text-foreground"
      data-workspace-shell
      data-layout={layout}
      data-sidebar={sidebar ? mode : undefined}
      style={shellStyle}
    >
      <FlashMessages />
      {sidebar && (
        // react-remove-scroll offsets this class by the scroll bar a dialog hides (RTL: right: 0).
        <aside
          id="workspace-sidebar"
          aria-label={t('القائمة الجانبية')}
          inert={mode === 'hidden'}
          className={`right-scroll-bar-position fixed inset-y-0 start-0 z-30 hidden w-(--shell-sidebar) flex-col overflow-y-auto border-e border-border bg-card [&>*]:shrink-0 ${mode === 'hidden' ? '' : 'lg:flex'} ${preferences.pageTransitions ? 'motion-safe:transition-[width] motion-safe:duration-200' : ''}`}
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
              <Link href="/" className="flex h-24 items-center gap-3 px-7">
                <BrandMark />
                {brandName}
              </Link>
              <p className="mb-3 px-7 text-[11px] font-semibold text-muted-foreground">
                {t('العمل اليومي')}
              </p>
              <nav aria-label={t('التنقل الرئيسي')} className="space-y-5 px-4">
                <div className="space-y-1">
                  {work.map(({ href, label, icon: Icon, badge }) => (
                    <Link
                      key={href}
                      href={href}
                      aria-current={isActive(href) ? 'page' : undefined}
                      className={navLinkClass(isActive(href))}
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
                  const open = !collapsed.includes(group.module)
                  return (
                    <div key={group.module} role="group" aria-label={group.label}>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-expanded={open}
                        onClick={() => toggle(group.module)}
                        className="h-8 w-full justify-between px-4 text-[11px] font-semibold text-muted-foreground"
                      >
                        {group.label}
                        <ChevronDown
                          size={14}
                          className={`transition-transform ${open ? '' : 'rotate-90'}`}
                        />
                      </Button>
                      {open && (
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
                    href="/users/invite"
                    className="mb-4 flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <UserPlus size={14} />
                    {t('دعوة مستخدم')}
                  </Link>
                )}
                <AccountMenu onArrange={arrange} />
              </div>
            </>
          )}
        </aside>
      )}
      <div className="lg:ps-(--shell-sidebar)">
        <header className="flex h-[72px] items-center justify-between gap-3 border-b border-border bg-background/80 px-5 backdrop-blur lg:px-10">
          <div className="flex min-w-0 items-center gap-3 text-xs text-muted-foreground">
            {sidebar ? (
              <SidebarControls mode={mode} onChange={(next) => void setMode(next)} />
            ) : (
              <Link href="/" className="hidden items-center gap-3 lg:flex">
                <BrandMark size="sm" />
                <strong className="text-base text-foreground">عدولة</strong>
              </Link>
            )}
            <span className="font-semibold text-foreground lg:hidden">عدولة</span>
            <span className={sidebar ? '' : 'lg:hidden'}>{t('مساحة العمل')}</span>
            <span className={sidebar ? '' : 'lg:hidden'}>/</span>
            <span className={`truncate text-foreground ${sidebar ? '' : 'lg:hidden'}`}>
              {current}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
            <TasksButton />
            <NotificationBell />
            <span className="hidden items-center gap-2 sm:flex">
              <span className="size-1.5 rounded-full bg-primary" />
              {t('بيئة التجربة')}
            </span>
            <span className={headerAccount}>
              <AccountMenu variant="compact" onArrange={arrange} />
            </span>
          </div>
        </header>
        {!sidebar && (
          <TopNavigation work={work} modules={modules} orderSections={orderSections} />
        )}
        <BackupBanner />
        <ImpersonationBar />
        <nav
          aria-label={t('التنقل على الجوال')}
          className="flex gap-5 overflow-auto border-b border-border bg-card px-5 py-3 text-xs lg:hidden"
        >
          {work.map((item) => (
            <Link key={item.href} href={item.href}>
              {item.label}
              {item.badge > 0 ? ` (${item.badge})` : ''}
            </Link>
          ))}
          {modules.flatMap((group) =>
            group.links.map((item) => (
              <Link key={item.href} href={item.href}>
                {item.label}
              </Link>
            ))
          )}
          {/* The administration area stays one entry on small screens too. */}
          {page.props.isAdmin && <Link href="/admin">{t('الإدارة')}</Link>}
        </nav>
        <main className="mx-auto max-w-[1440px] p-5 lg:px-10 lg:py-9">
          {/* Administration pages show their section's pages as sub-tabs (#157). */}
          <AdminSectionTabs>
            <div
              // A record dialog over a list keeps the list's key, so the list stays mounted.
              key={(page.props.overlay?.list ?? page.url).split('?')[0]}
              className={preferences.pageTransitions ? 'adula-page-enter' : undefined}
            >
              {children}
            </div>
          </AdminSectionTabs>
        </main>
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

/**
 * The sidebar's two controls (#153): collapse it to icons and back, and hide it for a
 * wider page. Each is a button with a truthful state for assistive technology.
 */
function SidebarControls({
  mode,
  onChange,
}: {
  mode: SidebarMode
  onChange: (mode: SidebarMode) => void
}) {
  const { t } = useMessages()
  const control = (label: string, expanded: boolean, Icon: LucideIcon, next: SidebarMode) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          aria-controls="workspace-sidebar"
          aria-expanded={expanded}
          onClick={() => onChange(next)}
        >
          <Icon className="ltr:-scale-x-100" aria-hidden />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
  return (
    <span className="hidden items-center gap-1 lg:flex">
      {mode === 'hidden' ? (
        control(t('إظهار القائمة الجانبية'), false, PanelRightOpen, 'expanded')
      ) : (
        <>
          {mode === 'expanded'
            ? control(t('طي القائمة الجانبية'), true, PanelRightClose, 'icons')
            : control(t('توسيع القائمة الجانبية'), false, PanelRightOpen, 'expanded')}
          {control(t('إخفاء القائمة الجانبية'), true, Maximize2, 'hidden')}
        </>
      )}
    </span>
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
  return (
    <>
      <Link href="/" className="grid h-24 place-items-center" aria-label={t('نظرة عامة')}>
        <BrandMark size="sm" />
      </Link>
      <nav aria-label={t('التنقل الرئيسي')} className="flex flex-col items-center gap-1">
        {work.map((entry) => (
          <RailLink
            key={entry.href}
            href={entry.href}
            label={entry.label}
            icon={entry.icon}
            active={isActive(entry.href)}
            badge={entry.badge}
            badgeLabel={t('{count} مفتوحة', { count: entry.badge })}
          />
        ))}
        {modules.length > 0 && <span className="my-2 h-px w-8 bg-border" aria-hidden />}
        {modules.map((group) => {
          const active = group.links.some((entry) => isActive(entry.href))
          return (
            <DropdownMenu key={group.module}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger
                    aria-label={group.label}
                    className={`${railItemClass(active)} text-sm font-semibold`}
                  >
                    <span aria-hidden>{group.label.trim().charAt(0)}</span>
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

