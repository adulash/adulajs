import { usePage } from '@inertiajs/react'
import { Form, Link } from '@adonisjs/inertia/react'
import {
  ChevronsUpDown,
  KeySquare,
  LogOut,
  MonitorSmartphone,
  UserRound,
  UserRoundCheck,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'

/** The user block at the bottom of the workspace sidebar: profile, sessions, delegation, logout. */
export function AccountMenu() {
  const { user } = usePage<{ user?: { fullName: string | null; email: string } }>().props
  if (!user) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="قائمة الحساب"
        className="flex w-full items-center gap-3 rounded-lg p-1 text-start outline-none hover:bg-background focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-secondary font-semibold">
          {user.fullName?.slice(0, 1) || 'م'}
        </span>
        <span className="min-w-0 flex-1">
          <strong className="block truncate text-xs">{user.fullName || 'حسابي'}</strong>
          <span className="block truncate text-[10px] text-muted-foreground" dir="ltr">
            {user.email}
          </span>
        </span>
        <ChevronsUpDown size={14} className="shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-56">
        <DropdownMenuLabel className="truncate text-xs text-muted-foreground" dir="ltr">
          {user.email}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link route="profile.show">
            <UserRound />
            الملف الشخصي
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link route="account_sessions.index">
            <MonitorSmartphone />
            الجلسات
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link route="api_tokens.index">
            <KeySquare />
            رموز API
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/account/delegations">
            <UserRoundCheck />
            التفويض أثناء الغياب
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <Form route="session.destroy">
          <DropdownMenuItem asChild variant="destructive">
            <button type="submit" className="w-full">
              <LogOut />
              تسجيل الخروج
            </button>
          </DropdownMenuItem>
        </Form>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
