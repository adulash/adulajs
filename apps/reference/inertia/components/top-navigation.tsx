import { usePage } from '@inertiajs/react'
import { Link } from '@adonisjs/inertia/react'
import { ChevronDown, ClipboardList, Settings, type LucideIcon } from 'lucide-react'
import { Badge } from '~/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { useMessages } from '~/components/ui/messages'
import { useAdminEntries, sectionHref, type AdminSection } from '~/components/admin-nav'
import { isActivePath, type ModuleGroup } from '~/components/shell_navigation'
import { moduleIcons } from '~/components/module_icons'

type Entry = { href: string; match?: string; label: string; icon?: LucideIcon; badge?: number }

// The shell's active navigation pattern (navLinkClass): a filled entry, no underline.
const itemClass = (active: boolean) =>
  `flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 ${active ? 'bg-accent font-semibold text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`

// The current page inside a menu.
const currentItem = 'aria-[current=page]:font-semibold aria-[current=page]:text-primary'

/**
 * The top layout (#154): daily work as links, then one drop-down menu per module listing
 * its pages, and «الإدارة» listing its sections (owner's choice: menus, not a second row of
 * tabs). It renders the same navigation model as the sidebar, so the pages and permissions
 * are identical. The registry DropdownMenu brings arrow keys, Escape and focus return.
 */
export function TopNavigation({
  work,
  modules,
  orderSections,
}: {
  work: Entry[]
  modules: ModuleGroup[]
  orderSections: (sections: AdminSection[]) => AdminSection[]
}) {
  const page = usePage()
  const { t } = useMessages()
  const admin = useAdminEntries(orderSections)
  const isActive = (href: string) => isActivePath(page.url, href)
  const insideAdmin = page.url.startsWith('/admin')
  // The same shapes as the collapsed sidebar.
  const icons = moduleIcons(modules.map((group) => group.module))
  return (
    <div className="hidden border-b border-border bg-card lg:block" data-top-navigation>
      <nav
        aria-label={t('التنقل الرئيسي')}
        className="flex items-center gap-1 overflow-x-auto px-10 py-2"
      >
        {work.map(({ href, match, label, icon: Icon, badge = 0 }) => (
          <Link
            key={href}
            href={href}
            aria-current={isActive(match ?? href) ? 'page' : undefined}
            className={itemClass(isActive(match ?? href))}
          >
            {Icon && <Icon size={16} strokeWidth={1.6} aria-hidden />}
            {label}
            {badge > 0 && <Badge className="px-1.5">{badge}</Badge>}
          </Link>
        ))}
        {modules.map((group) => {
          const active = group.links.some((entry) => isActive(entry.href))
          const Icon = icons.get(group.module)!
          return (
            <DropdownMenu key={group.module}>
              <DropdownMenuTrigger
                className={itemClass(active)}
                data-current={active ? 'true' : undefined}
                data-module={group.module}
              >
                <Icon size={16} strokeWidth={1.6} aria-hidden />
                {group.label}
                <ChevronDown size={14} aria-hidden className="text-muted-foreground" />
              </DropdownMenuTrigger>
              {/* start and end are logical: the menu aligns with its entry in RTL and LTR alike. */}
              <DropdownMenuContent align="start" className="w-60">
                {/* A single page needs no heading: it would repeat the entry's own name. */}
                {group.links.length > 1 && (
                  <DropdownMenuLabel className="text-xs text-muted-foreground">
                    {group.label}
                  </DropdownMenuLabel>
                )}
                {group.links.map((entry) => (
                  <DropdownMenuItem key={entry.href} asChild>
                    <Link
                      href={entry.href}
                      aria-current={isActive(entry.href) ? 'page' : undefined}
                      className={currentItem}
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
        {admin.isAdmin && (
          <DropdownMenu>
            <DropdownMenuTrigger
              className={`${itemClass(insideAdmin)} ms-auto`}
              data-current={insideAdmin ? 'true' : undefined}
            >
              <Settings size={16} strokeWidth={1.6} aria-hidden />
              {t('الإدارة')}
              {admin.alerts > 0 && (
                <Badge
                  variant="destructive"
                  className="px-1.5"
                  aria-label={t('{count} تنبيه إداري', { count: admin.alerts })}
                >
                  {admin.alerts}
                </Badge>
              )}
              <ChevronDown size={14} aria-hidden className="text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuItem asChild>
                <Link
                  href="/admin"
                  aria-current={page.url === '/admin' ? 'page' : undefined}
                  className={currentItem}
                >
                  <Settings />
                  {t('الإدارة')}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {admin.sections.map((section) => (
                <DropdownMenuItem key={section.id} asChild>
                  <Link
                    href={sectionHref(section)}
                    aria-current={admin.current?.section.id === section.id ? 'page' : undefined}
                    className={currentItem}
                  >
                    <section.icon />
                    {t(section.title)}
                  </Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </nav>
    </div>
  )
}
