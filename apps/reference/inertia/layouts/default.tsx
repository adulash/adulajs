import { type Data } from '@generated/data'
import { toast, Toaster } from 'sonner'
import { usePage } from '@inertiajs/react'
import { type ReactElement, useLayoutEffect } from 'react'
import { Form, Link } from '@adonisjs/inertia/react'
import { ImpersonationBar } from '~/components/admin-nav'
import { FlashMessages } from '~/components/flash-messages'
import { BrandMark } from '~/components/brand-mark'
import { OccasionBanner } from '~/components/occasion-banner'
import { useAppearance } from '~/components/appearance'
import { Button } from '~/components/ui/button'
import { UserAvatar } from '~/components/ui/user-avatar'
import { useMessages } from '~/components/ui/messages'

// Account pages own their cross-links (sign-in, sign-up, password reset) in the card, so
// their header shows only the brand; home and the error pages keep the header links.
const AUTH_PAGES = new Set([
  'auth/login',
  'auth/signup',
  'auth/forgot',
  'auth/reset',
  'auth/two_factor',
])

/**
 * The guest shell for the home page, the account pages (sign-in, sign-up, password reset,
 * invitation and two-factor) and the error pages: a sticky header of registry buttons over the
 * theme background, the same header pattern as the workspace shell.
 */
export default function Layout({ children }: { children: ReactElement<Data.SharedProps> }) {
  const { url, component } = usePage()
  // «المظهر والهوية» (ADR 053) may replace the name and the mark, today's occasion included.
  const brand = useAppearance()?.brand
  const { t, dir } = useMessages()
  // A new page drops the previous page's toasts. A layout effect, so it runs before the
  // passive effect in <FlashMessages /> below toasts this page's flash.
  useLayoutEffect(() => {
    toast.dismiss()
  }, [url])

  const { account, signupEnabled } = children.props
  const authPage = AUTH_PAGES.has(component)
  // Home offers signing in as its own card action, so its header offers only sign-up.
  const signInLink = !authPage && component !== 'home'
  const signUpLink = !authPage && signupEnabled
  return (
    <div dir={dir} className="min-h-dvh bg-background text-foreground">
      {/* Impersonation must be visible on every layout, not only the workspace shell. */}
      <ImpersonationBar />
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
        <div className="flex h-[72px] items-center justify-between gap-3 px-5 lg:px-10">
          <Link route="home" className="flex min-w-0 items-center gap-3">
            <BrandMark size="sm" logo={brand?.logoUrl} />
            {/* A company name is identity: it wraps to two lines rather than being cut. */}
            <strong
              className="line-clamp-2 pb-0.5 text-base leading-tight text-foreground break-words"
              title={brand?.company ?? undefined}
              data-brand-name
            >
              {brand?.company ?? <>أدولا</>}
            </strong>
          </Link>
          <nav aria-label={t('الحساب')} className="flex items-center gap-2">
            {account ? (
              <>
                <UserAvatar
                  user={{
                    id: account.id,
                    name: account.fullName || account.email,
                    avatarUrl: account.avatarUrl,
                  }}
                  size="md"
                />
                <Form route="session.destroy">
                  <Button type="submit" variant="ghost" size="sm">
                    {t('تسجيل الخروج')}
                  </Button>
                </Form>
              </>
            ) : (
              <>
                {signInLink && (
                  <Button variant="ghost" size="sm" asChild>
                    <Link route="session.create">{t('الدخول')}</Link>
                  </Button>
                )}
                {signUpLink && (
                  <Button variant="outline" size="sm" asChild>
                    <Link route="new_account.create">{t('إنشاء حساب')}</Link>
                  </Button>
                )}
              </>
            )}
          </nav>
        </div>
      </header>
      <OccasionBanner className="px-5 pt-4 lg:px-10" />
      <main className="px-4 sm:px-6">{children}</main>
      {/* Once per flash, as in the workspace shell: a re-render must not toast it again. */}
      <FlashMessages />
      <Toaster position="top-center" richColors />
    </div>
  )
}
