import { usePage } from '@inertiajs/react'
import { Link } from '@adonisjs/inertia/react'
import { ListChecks } from 'lucide-react'
import { useMessages } from '~/components/ui/messages'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { isActivePath } from '~/components/shell_navigation'

/**
 * «مهامي» beside the notification bell (#156). The badge is the number the page lists as
 * open: the same server count, read as the user, so the two never disagree.
 */
export function TasksButton() {
  const page = usePage<{ account?: { id: number }; openTasks?: number }>()
  const { t } = useMessages()
  if (!page.props.account) return null
  // A deferred prop: undefined until it arrives, then no badge for zero.
  const count = page.props.openTasks ?? 0
  const active = isActivePath(page.url, '/my-tasks')
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href="/my-tasks"
          aria-label={count ? t('مهامي، {count} مفتوحة', { count }) : t('مهامي')}
          aria-current={active ? 'page' : undefined}
          data-testid="my-tasks-button"
          className={`relative grid size-9 place-items-center rounded-full transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 ${active ? 'bg-accent text-foreground' : 'text-muted-foreground'}`}
        >
          <ListChecks size={18} strokeWidth={1.6} aria-hidden />
          {count > 0 && (
            <span
              data-testid="open-tasks-count"
              aria-hidden
              className="absolute -end-0.5 -top-0.5 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] font-semibold leading-4 text-primary-foreground"
            >
              {count}
            </span>
          )}
        </Link>
      </TooltipTrigger>
      <TooltipContent>{t('مهامي')}</TooltipContent>
    </Tooltip>
  )
}
