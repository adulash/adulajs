import type { ReactNode } from 'react'
import { router, usePage } from '@inertiajs/react'
import { Link } from '@adonisjs/inertia/react'
import {
  Activity,
  History,
  KeyRound,
  Network,
  Rocket,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  UserCog,
  Users,
  Mail,
  Webhook,
  GitBranch,
  Hash,
  ListChecks,
  type LucideIcon,
} from 'lucide-react'
import { calendarDisplay } from '~/components/ui/calendar_date'
import { useUiPreferences } from '~/components/ui/ui-preferences'
import { useMessages } from '~/components/ui/messages'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'

export type NavLink = { href: string; label: string; icon: LucideIcon }
export type AdminGroup = { label: string; links: NavLink[] }

/**
 * The administration area by concern (#34); it replaces a flat list next to daily work.
 * Labels are the Arabic interface text and are shown through `t()`.
 */
export const adminGroups: AdminGroup[] = [
  {
    label: 'الأشخاص والصلاحيات',
    links: [
      { href: '/admin/users', label: 'المستخدمون', icon: Users },
      { href: '/admin/roles', label: 'الأدوار والصلاحيات', icon: ShieldCheck },
      { href: '/admin/org-units', label: 'الهيكل التنظيمي', icon: Network },
      { href: '/admin/sessions', label: 'الجلسات', icon: KeyRound },
    ],
  },
  {
    label: 'الإعدادات',
    links: [
      { href: '/admin/settings', label: 'الإعدادات', icon: SlidersHorizontal },
      { href: '/admin/lookups', label: 'القوائم المرجعية', icon: ListChecks },
      { href: '/admin/sequences', label: 'الترقيم التسلسلي', icon: Hash },
      { href: '/admin/templates', label: 'قوالب الرسائل', icon: Mail },
      { href: '/admin/webhooks', label: 'الربط الخارجي', icon: Webhook },
    ],
  },
  {
    label: 'المراقبة والتشغيل',
    links: [
      { href: '/admin/jobs', label: 'تشغيل النظام', icon: Activity },
      { href: '/admin/workflows', label: 'تدفقات فاشلة', icon: GitBranch },
      { href: '/admin/activity', label: 'سجل النشاط', icon: History },
    ],
  },
]
export const setupLink: NavLink = { href: '/admin/setup', label: 'الإعداد الأولي', icon: Rocket }
export const adminLinks: NavLink[] = [setupLink, ...adminGroups.flatMap((group) => group.links)]

const linkClass = (active: boolean) =>
  `flex items-center gap-3 rounded-lg px-4 py-2.5 text-sm transition-colors ${active ? 'bg-accent font-semibold text-primary' : 'text-muted-foreground hover:bg-background hover:text-foreground'}`

/**
 * One administration entry for administrators, pinned under daily work. Inside the
 * administration area it expands into its categories; the one-time setup is listed
 * first until it is complete. A badge signals failed workflows or a stale backup.
 */
export function AdminNav() {
  const page = usePage<{ isAdmin?: boolean; adminAlerts?: number; setupPending?: boolean }>()
  const { t } = useMessages()
  if (!page.props.isAdmin) return null
  const inside = page.url.startsWith('/admin')
  const alerts = page.props.adminAlerts ?? 0
  return (
    <div className="mt-6 border-t border-border px-4 pt-5">
      <Link
        href="/admin"
        aria-current={inside && page.url === '/admin' ? 'page' : undefined}
        className={`${linkClass(false)} ${inside ? 'font-semibold text-foreground' : ''}`}
      >
        <Settings size={17} strokeWidth={1.6} />
        {t('الإدارة')}
        {alerts > 0 && (
          <Badge
            variant="destructive"
            className="ms-auto px-1.5"
            aria-label={t('{count} تنبيه إداري', { count: alerts })}
          >
            {alerts}
          </Badge>
        )}
      </Link>
      {inside && (
        <nav aria-label={t('التنقل الإداري')} className="mt-2 space-y-4">
          {page.props.setupPending && (
            <Link
              href={setupLink.href}
              aria-current={page.url.startsWith(setupLink.href) ? 'page' : undefined}
              className={linkClass(page.url.startsWith(setupLink.href))}
            >
              <setupLink.icon size={17} strokeWidth={1.6} />
              {t(setupLink.label)}
            </Link>
          )}
          {adminGroups.map((group) => (
            <div key={group.label} role="group" aria-label={t(group.label)}>
              <p className="mb-1 px-4 text-[11px] font-semibold text-muted-foreground">
                {t(group.label)}
              </p>
              {group.links.map(({ href, label, icon: Icon }) => {
                const active = page.url.startsWith(href)
                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={active ? 'page' : undefined}
                    className={linkClass(active)}
                  >
                    <Icon size={17} strokeWidth={1.6} />
                    {t(label)}
                  </Link>
                )
              })}
            </div>
          ))}
        </nav>
      )}
    </div>
  )
}

export function ImpersonationBar() {
  const page = usePage<{
    impersonating?: boolean
    user?: { fullName: string | null; email: string }
  }>()
  const { t } = useMessages()
  if (!page.props.impersonating) return null
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-300 bg-amber-50 px-5 py-2 text-sm text-amber-900 lg:px-10"
    >
      <span className="flex items-center gap-2">
        <UserCog size={16} />
        {t('أنت تتصفح باسم {name}', {
          name: page.props.user?.fullName || page.props.user?.email || '',
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
