import { type Data } from '@generated/data'
import { toast, Toaster } from 'sonner'
import { usePage } from '@inertiajs/react'
import { type ReactElement, useEffect } from 'react'
import { Form, Link } from '@adonisjs/inertia/react'
import { ImpersonationBar } from '~/components/admin-nav'
import { Button } from '~/components/ui/button'
import { useMessages } from '~/components/ui/messages'

/**
 * The guest shell for the home page, the account pages (sign-in, sign-up, password reset,
 * invitation and two-factor) and the error pages: a sticky header of registry buttons over the
 * theme background, the same header pattern as the workspace shell.
 */
export default function Layout({ children }: { children: ReactElement<Data.SharedProps> }) {
  const { url, flash } = usePage()
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
  const path = url.split('?')[0]
  // Home and sign-in already offer signing in as the page's own action.
  const signInLink = path !== '/' && path !== '/login'
  return (
    <div dir={dir} className="min-h-dvh bg-background text-foreground">
      {/* Impersonation must be visible on every layout, not only the workspace shell. */}
      <ImpersonationBar />
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link
            route="home"
            aria-label={t('AdulaJS — الرئيسية')}
            className="text-base font-semibold text-foreground"
          >
            <span dir="ltr">AdulaJS</span>
          </Link>
          <nav aria-label={t('الحساب')} className="flex items-center gap-2">
            {account ? (
              <>
                <span className="text-sm text-muted-foreground">{account.initials}</span>
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
                {signupEnabled && (
                  <Button variant="outline" size="sm" asChild>
                    <Link route="new_account.create">{t('إنشاء حساب')}</Link>
                  </Button>
                )}
              </>
            )}
          </nav>
        </div>
      </header>
      <main className="px-4 sm:px-6">{children}</main>
      <Toaster position="top-center" richColors />
    </div>
  )
}
