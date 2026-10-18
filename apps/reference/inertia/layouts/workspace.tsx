import { useState, type ReactNode } from 'react'
import { usePage } from '@inertiajs/react'
import { Link } from '@adonisjs/inertia/react'
import {
  ChevronDown,
  ClipboardList,
  LayoutDashboard,
  ListChecks,
  FileUp,
  UserPlus,
} from 'lucide-react'
import type { ResourceNavigation } from 'adula'
import { Toaster } from '~/components/ui/sonner'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { AccountMenu } from '~/components/account-menu'
import { AdminNav, ImpersonationBar, adminLinks } from '~/components/admin-nav'
import { FlashMessages } from '~/components/flash-messages'
import { useUiPreferences } from '~/components/ui/ui-preferences'
import { useMessages } from '~/components/ui/messages'
import { BackupBanner } from '~/components/backup-banner'
import { NotificationBell } from '~/components/notification-bell'

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
  `flex items-center gap-3 rounded-lg px-4 py-2.5 text-sm transition-colors ${active ? 'bg-accent font-semibold text-primary' : 'text-muted-foreground hover:bg-background hover:text-foreground'}`

export default function Workspace({ children }: { children: ReactNode }) {
  const preferences = useUiPreferences()
  const { t, dir } = useMessages()
  const page = usePage<{
    user?: { fullName: string | null; email: string }
    navigation: ResourceNavigation
    canInviteUsers?: boolean
    canImport?: boolean
    openTasks?: number
    isAdmin?: boolean
  }>()
  const { collapsed, toggle } = useCollapsedModules()
  const openTasks = page.props.openTasks ?? 0
  // Daily work first: the overview, one list of everything waiting for the user, and imports
  // only for users who can create records (#34, #35).
  const work = [
    { href: '/', label: t('نظرة عامة'), icon: LayoutDashboard, badge: 0 },
    { href: '/my-tasks', label: t('مهامي'), icon: ListChecks, badge: openTasks },
    ...(page.props.canImport
      ? [{ href: '/imports', label: t('الاستيراد'), icon: FileUp, badge: 0 }]
      : []),
  ]
  const modules = [
    ...new Map(
      (page.props.navigation ?? []).map((entry) => [
        entry.module,
        {
          module: entry.module,
          label: entry.moduleLabel ?? entry.module,
          links: (page.props.navigation ?? []).filter((item) => item.module === entry.module),
        },
      ])
    ).values(),
  ]
  const navigation = [
    ...work,
    ...(page.props.navigation ?? []).map((entry) => ({ ...entry, icon: ClipboardList, badge: 0 })),
  ]
  const isActive = (href: string) => (href !== '/' ? page.url.startsWith(href) : page.url === '/')
  // Server navigation labels arrive localized; the administration labels are interface text.
  const current =
    [...navigation, ...adminLinks.map((entry) => ({ ...entry, label: t(entry.label) }))].find(
      (entry) => entry.href !== '/' && page.url.startsWith(entry.href)
    )?.label ?? (page.url.startsWith('/admin') ? t('الإدارة') : t('نظرة عامة'))
  return (
    <div dir={dir} className="min-h-screen bg-background text-foreground" data-workspace-shell>
      <FlashMessages />
      <aside className="fixed inset-y-0 start-0 z-30 hidden w-[244px] flex-col overflow-y-auto border-e border-border bg-white lg:flex [&>*]:shrink-0">
        <Link href="/" className="flex h-24 items-center gap-3 px-7">
          <span className="grid size-10 place-items-center rounded-xl bg-primary text-2xl font-bold text-white">
            ع
          </span>
          <span>
            <strong className="block text-xl tracking-tight">عدولة</strong>
            <span className="text-[11px] text-muted-foreground">
              {t('مساحة أعمالك، بوضوح')}
            </span>
          </span>
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
                  <Badge className="ms-auto px-1.5" aria-label={t('{count} مفتوحة', { count: badge })}>
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
        <AdminNav />
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
          <AccountMenu />
        </div>
      </aside>
      <div className="lg:ps-[244px]">
        <div className="flex h-[72px] items-center justify-between border-b border-border bg-white/80 px-5 lg:px-10">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground lg:hidden">عدولة</span>
            <span>{t('مساحة العمل')}</span>
            <span>/</span>
            <span className="text-foreground">{current}</span>
          </div>
          <span className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <NotificationBell />
            <span className="size-1.5 rounded-full bg-primary" />
            {t('بيئة التجربة')}
          </span>
        </div>
        <BackupBanner />
        <ImpersonationBar />
        <nav
          aria-label={t('التنقل على الجوال')}
          className="flex gap-5 overflow-auto border-b border-border bg-white px-5 py-3 text-xs lg:hidden"
        >
          {navigation.map((item) => (
            <Link key={item.href} href={item.href}>
              {item.label}
              {item.badge > 0 ? ` (${item.badge})` : ''}
            </Link>
          ))}
          {/* The administration area stays one entry on small screens too. */}
          {page.props.isAdmin && <Link href="/admin">{t('الإدارة')}</Link>}
        </nav>
        <main className="mx-auto max-w-[1440px] p-5 lg:px-10 lg:py-9">
          <div
            key={page.url.split('?')[0]}
            className={preferences.pageTransitions ? 'adula-page-enter' : undefined}
          >
            {children}
          </div>
        </main>
      </div>
      <Toaster position="bottom-left" richColors />
    </div>
  )
}
