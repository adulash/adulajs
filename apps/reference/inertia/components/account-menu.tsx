import { usePage } from '@inertiajs/react'
import { Form, Link } from '@adonisjs/inertia/react'
import {
  ArrowDownUp,
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
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { useMessages } from '~/components/ui/messages'
import { UserAvatar } from '~/components/ui/user-avatar'
import { usePreference } from '~/components/preferences'
import { applyTheme, isTheme, type Theme } from '~/components/theme'
import type { ShellLayout } from '~/components/shell_navigation'

type Account = { id: number; fullName: string | null; email: string; avatarUrl: string | null }

/**
 * The account menu (owner: the workspace shell): profile, sessions, delegation, the theme,
 * the navigation layout and order, logout. `full` sits at the bottom of the expanded sidebar;
 * `compact` is the avatar alone, in the icon rail and the header.
 */
export function AccountMenu({
  variant = 'full',
  onArrange,
  sidebarChoice = false,
}: {
  variant?: 'full' | 'compact'
  /** Opens the navigation order dialog; the menu item is shown when it is given. */
  onArrange?: () => void
  /** Offers what collapsing the sidebar does (the sidebar layout only). */
  sidebarChoice?: boolean
}) {
  const page = usePage<{
    account?: Account
    uiPreferences?: { layoutUserChoice?: boolean }
  }>()
  const { t } = useMessages()
  const [theme, setTheme] = usePreference<Theme>('shell.theme')
  const [layout, setLayout] = usePreference<ShellLayout | null>('shell.layout')
  const [collapse, setCollapse] = usePreference<'icons' | 'hidden'>('shell.sidebarCollapse')
  const user = page.props.account
  if (!user) return null
  const avatar = (
    <UserAvatar
      user={{ id: user.id, name: user.fullName || user.email, avatarUrl: user.avatarUrl }}
      size="md"
    />
  )
  const chooseTheme = (value: string) => {
    if (!isTheme(value)) return
    // Applies at once; saving follows in the background.
    applyTheme(value)
    void setTheme(value)
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t('قائمة الحساب')}
        className={
          variant === 'full'
            ? 'flex w-full items-center gap-3 rounded-lg p-1 text-start outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50'
            : 'grid place-items-center rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50'
        }
      >
        {avatar}
        {variant === 'full' && (
          <>
            <span className="min-w-0 flex-1">
              <strong className="block truncate text-xs">{user.fullName || t('حسابي')}</strong>
              <span className="block truncate text-[10px] text-muted-foreground" dir="ltr">
                {user.email}
              </span>
            </span>
            <ChevronsUpDown size={14} className="shrink-0 text-muted-foreground" />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={variant === 'full' ? 'top' : 'bottom'}
        align={variant === 'full' ? 'start' : 'end'}
        className="w-60"
      >
        <DropdownMenuLabel className="truncate text-xs text-muted-foreground" dir="ltr">
          {user.email}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link route="profile.show">
            <UserRound />
            {t('الملف الشخصي')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link route="account_sessions.index">
            <MonitorSmartphone />
            {t('الجلسات')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link route="api_tokens.index">
            <KeySquare />
            {t('رموز API')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/account/delegations">
            <UserRoundCheck />
            {t('التفويض أثناء الغياب')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          {t('المظهر')}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={chooseTheme}>
          <DropdownMenuRadioItem value="light">{t('فاتح')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">{t('داكن')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">{t('حسب الجهاز')}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        {page.props.uiPreferences?.layoutUserChoice && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              {t('تخطيط التنقل')}
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={layout ?? 'default'}
              onValueChange={(value) =>
                void setLayout(value === 'sidebar' || value === 'top' ? value : null)
              }
            >
              <DropdownMenuRadioItem value="default">{t('الافتراضي للنظام')}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="sidebar">{t('قائمة جانبية')}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="top">{t('قائمة علوية')}</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </>
        )}
        {sidebarChoice && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              {t('عند طي القائمة')}
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={collapse === 'hidden' ? 'hidden' : 'icons'}
              onValueChange={(value) => void setCollapse(value === 'hidden' ? 'hidden' : 'icons')}
            >
              <DropdownMenuRadioItem value="icons">{t('أيقونات')}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="hidden">{t('إخفاء كامل')}</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </>
        )}
        {onArrange && (
          <>
            {/* Apart from the theme choices above, so it does not read as a fourth one. */}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onArrange()}>
              <ArrowDownUp />
              {t('ترتيب القائمة…')}
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <Form route="session.destroy">
          <DropdownMenuItem asChild variant="destructive">
            <button type="submit" className="w-full">
              <LogOut />
              {t('تسجيل الخروج')}
            </button>
          </DropdownMenuItem>
        </Form>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
