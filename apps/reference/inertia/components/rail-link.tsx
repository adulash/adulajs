import type { LucideIcon } from 'lucide-react'
import { Link } from '@adonisjs/inertia/react'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { useMessages } from '~/components/ui/messages'

/** Where a tooltip opens beside the icon rail: away from the screen edge it sits on. */
export function useRailSide(): 'left' | 'right' {
  return useMessages().dir === 'rtl' ? 'left' : 'right'
}

export const railItemClass = (active: boolean) =>
  `relative grid size-10 place-items-center rounded-lg transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 ${active ? 'bg-accent text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`

/**
 * One entry of the collapsed sidebar (#153): the icon, its name as a tooltip, and the same
 * accessible name as the full entry, so keyboard and screen-reader users lose nothing.
 */
export function RailLink({
  href,
  label,
  icon: Icon,
  active,
  badge = 0,
  badgeLabel,
}: {
  href: string
  label: string
  icon: LucideIcon
  active: boolean
  badge?: number
  /** Spoken with the name when there is a badge: `{count} تنبيه إداري`. */
  badgeLabel?: string
}) {
  const side = useRailSide()
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link href={href} aria-current={active ? 'page' : undefined} className={railItemClass(active)}>
          <Icon size={19} strokeWidth={1.6} aria-hidden />
          <span className="sr-only">
            {label}
            {badge > 0 && badgeLabel ? ` ${badgeLabel}` : ''}
          </span>
          {badge > 0 && (
            <span
              aria-hidden
              className="absolute end-1.5 top-1.5 size-2 rounded-full bg-destructive ring-2 ring-card"
            />
          )}
        </Link>
      </TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  )
}
