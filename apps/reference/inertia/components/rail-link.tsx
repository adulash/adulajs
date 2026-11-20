import type { LucideIcon } from 'lucide-react'
import { Link } from '@adonisjs/inertia/react'
import { SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem } from '~/components/ui/sidebar'
import { useMessages } from '~/components/ui/messages'
import { Badge } from '~/components/ui/badge'

/** Where a tooltip opens beside the icon rail: away from the screen edge it sits on. */
export function useRailSide(): 'left' | 'right' {
  return useMessages().dir === 'rtl' ? 'left' : 'right'
}

/**
 * The current entry keeps the semibold weight the top menu, the tabs and the phone row share
 * (owner's decision of 2026-11-20, ADR 055); shadcn's SidebarMenuButton sets `font-medium`.
 */
export const SIDEBAR_ACTIVE = 'data-[active=true]:font-semibold'

/**
 * One sidebar entry on shadcn's SidebarMenuButton (ADR 055): the icon and its name, the name as
 * a tooltip while the sidebar is the icon rail (#153), and an optional count. The count is
 * part of the link's accessible name, so the rail, where the count shows as a dot, loses
 * nothing.
 */
export function SidebarEntry({
  href,
  label,
  icon: Icon,
  active,
  badge,
}: {
  href: string
  label: string
  icon: LucideIcon
  active: boolean
  /**
   * A count beside the name, a shadcn Badge in SidebarMenuBadge: `destructive` for alerts,
   * `default` (the primary colour, as the header's «مهامي» count) for work.
   */
  badge?: { count: number; label: string; tone?: 'default' | 'destructive' }
}) {
  const side = useRailSide()
  const shown = badge && badge.count > 0
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={active}
        tooltip={{ children: label, side }}
        // Long names stop before the count, as shadcn does for a menu action.
        className={`${SIDEBAR_ACTIVE} ${shown ? 'pe-8' : ''}`}
      >
        <Link
          href={href}
          aria-current={active ? 'page' : undefined}
          aria-label={shown ? `${label} ${badge.label}` : undefined}
        >
          <Icon aria-hidden />
          <span>{label}</span>
        </Link>
      </SidebarMenuButton>
      {shown && (
        <>
          <SidebarMenuBadge aria-hidden>
            <Badge
              variant={badge.tone ?? 'default'}
              className="h-5 min-w-5 justify-center px-1 tabular-nums"
            >
              {badge.count}
            </Badge>
          </SidebarMenuBadge>
          {/* In the icon rail the count becomes a dot on the icon. */}
          <span
            aria-hidden
            className={`pointer-events-none absolute end-0.5 top-0.5 hidden size-2 rounded-full ring-2 ring-sidebar group-data-[collapsible=icon]:block ${badge.tone === 'destructive' ? 'bg-destructive' : 'bg-primary'}`}
          />
        </>
      )}
    </SidebarMenuItem>
  )
}
