import { type Data } from '@generated/data'
import { toast, Toaster } from 'sonner'
import { usePage } from '@inertiajs/react'
import { type ReactElement, useEffect } from 'react'
import { Form, Link } from '@adonisjs/inertia/react'
import { ImpersonationBar } from '~/components/admin-nav'
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
  const { url, flash, component } = usePage()
  // «المظهر والهوية» (ADR 053) may replace the name and the mark, today's occasion included.
  const brand = useAppearance()?.brand
  const { t, dir } = useMessages()
  useEffect(() => {
    toast.dismiss()
  }, [url])

  useEffect(() => {
    if (typeof flash.error === 'string') {
      toast.error(flash.error)
    }
    if (typeof flash.success === 'string') {
      toast.success(flash.success)
    }
  })

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
          <Link route="home" className="flex items-center gap-3">
            <BrandMark size="sm" logo={brand?.logoUrl} />
            <strong className="text-base text-foreground">{brand?.company ?? <>عدولة</>}</strong>
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
      <Toaster position="top-center" richColors />
    </div>
  )
}
