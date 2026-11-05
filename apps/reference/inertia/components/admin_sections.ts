import {
  Activity,
  DatabaseBackup,
  GitBranch,
  Hash,
  History,
  KeyRound,
  ListChecks,
  Mail,
  Network,
  Printer,
  Rocket,
  ShieldCheck,
  SlidersHorizontal,
  UserRoundCheck,
  Users,
  Webhook,
  type LucideIcon,
} from 'lucide-react'

/** Shared props an administration page can be shown or hidden by. */
export type AdminShellProps = { setupPending?: boolean; [key: string]: unknown }

/** One page of an administration section, shown as a vertical sub-tab (ADR 049). */
export type AdminPage = {
  /** Unique within its section: `users`. */
  id: string
  /** `/admin/users`; nested addresses (`/admin/users/7`) belong to the same page. */
  href: string
  /** Arabic interface text, shown through `t()`. */
  label: string
  icon: LucideIcon
  /** Replaces the address-prefix match when a page owns unusual addresses. */
  match?: (url: string) => boolean
  /** Hides a page that does not apply; the server still authorizes every request. */
  visible?: (props: AdminShellProps) => boolean
}

/**
 * One administration section: one sidebar entry, its pages as sub-tabs. The id is stable
 * (it is stored in users' menu order as `admin.<id>`): never rename a released id.
 */
export type AdminSection = { id: string; title: string; icon: LucideIcon; pages: AdminPage[] }

/**
 * The administration area by concern (#34, #157). To add a page, append it to a section; to
 * add a section, append one here. Its routes belong inside the `middleware.admin()` group.
 */
export const adminSections: AdminSection[] = [
  {
    id: 'people',
    title: 'الأشخاص والصلاحيات',
    icon: Users,
    pages: [
      { id: 'users', href: '/admin/users', label: 'المستخدمون', icon: Users },
      { id: 'roles', href: '/admin/roles', label: 'الأدوار والصلاحيات', icon: ShieldCheck },
      { id: 'org-units', href: '/admin/org-units', label: 'الهيكل التنظيمي', icon: Network },
      { id: 'sessions', href: '/admin/sessions', label: 'الجلسات', icon: KeyRound },
      {
        id: 'delegations',
        href: '/admin/delegations',
        label: 'تفويضات الموافقات',
        icon: UserRoundCheck,
      },
    ],
  },
  {
    id: 'settings',
    title: 'الإعدادات',
    icon: SlidersHorizontal,
    pages: [
      {
        id: 'general',
        href: '/admin/settings',
        label: 'الإعدادات العامة',
        icon: SlidersHorizontal,
      },
      { id: 'lookups', href: '/admin/lookups', label: 'القوائم المرجعية', icon: ListChecks },
      { id: 'sequences', href: '/admin/sequences', label: 'الترقيم التسلسلي', icon: Hash },
      { id: 'templates', href: '/admin/templates', label: 'قوالب الرسائل', icon: Mail },
      {
        id: 'print-templates',
        href: '/admin/print-templates',
        label: 'قوالب الطباعة',
        icon: Printer,
      },
      { id: 'webhooks', href: '/admin/webhooks', label: 'الربط الخارجي', icon: Webhook },
    ],
  },
  {
    id: 'operations',
    title: 'المراقبة والتشغيل',
    icon: Activity,
    pages: [
      { id: 'jobs', href: '/admin/jobs', label: 'تشغيل النظام', icon: Activity },
      { id: 'backups', href: '/admin/backups', label: 'النسخ الاحتياطي', icon: DatabaseBackup },
      { id: 'workflows', href: '/admin/workflows', label: 'تدفقات فاشلة', icon: GitBranch },
      { id: 'activity', href: '/admin/activity', label: 'سجل النشاط', icon: History },
    ],
  },
]

/** The one-time setup, listed before the sections until it is complete. */
export const setupPage: AdminPage = {
  id: 'setup',
  href: '/admin/setup',
  label: 'الإعداد الأولي',
  icon: Rocket,
  visible: (props) => Boolean(props.setupPending),
}

/** The section that collects failed workflows and stale backups carries the alerts badge. */
export const ALERTS_SECTION = 'operations'

function pathOf(url: string) {
  return url.split(/[?#]/, 1)[0]
}

/** True when the address is the page's own or nested under it. */
export function pageMatches(page: AdminPage, url: string) {
  if (page.match) return page.match(url)
  const path = pathOf(url)
  return path === page.href || path.startsWith(`${page.href}/`)
}

/** Sections with the pages that apply; a section without any is dropped. */
export function visibleSections(
  props: AdminShellProps,
  sections: AdminSection[] = adminSections
): AdminSection[] {
  return sections
    .map((section) => ({
      ...section,
      pages: section.pages.filter((page) => !page.visible || page.visible(props)),
    }))
    .filter((section) => section.pages.length > 0)
}

/**
 * The section and page an address belongs to. The longest matching address wins, so
 * `/admin/backups/restore` is its own page even when `/admin/backups` exists.
 */
export function sectionFor(
  url: string,
  props: AdminShellProps,
  sections: AdminSection[] = adminSections
): { section: AdminSection; page: AdminPage } | null {
  let best: { section: AdminSection; page: AdminPage } | null = null
  for (const section of visibleSections(props, sections))
    for (const page of section.pages)
      if (pageMatches(page, url) && (!best || page.href.length > best.page.href.length))
        best = { section, page }
  return best
}

/** Every administration page, for the breadcrumb. */
export const adminLinks: AdminPage[] = [
  setupPage,
  ...adminSections.flatMap((section) => section.pages),
]
