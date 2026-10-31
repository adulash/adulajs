import { type Data } from '@generated/data'
import { toast, Toaster } from 'sonner'
import { usePage } from '@inertiajs/react'
import { type ReactElement, useEffect } from 'react'
import { Form, Link } from '@adonisjs/inertia/react'
import { ImpersonationBar } from '~/components/admin-nav'

export default function Layout({ children }: { children: ReactElement<Data.SharedProps> }) {
  const { url, flash } = usePage()
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

  return (
    <div data-adula-legacy>
      {/* Impersonation must be visible on every layout, not only the workspace shell. */}
      <ImpersonationBar />
      <header>
        <div>
          <div>
            <Link route="home" aria-label="AdulaJS — الرئيسية">
              <strong dir="ltr">AdulaJS</strong>
            </Link>
          </div>
          <div>
            <nav>
              {children.props.user ? (
                <>
                  <span>{children.props.user.initials}</span>
                  <Form route="session.destroy">
                    <button type="submit">تسجيل الخروج</button>
                  </Form>
                </>
              ) : (
                <>
                  {children.props.signupEnabled && (
                    <Link route="new_account.create">إنشاء حساب</Link>
                  )}
                  <Link route="session.create">الدخول</Link>
                </>
              )}
            </nav>
          </div>
        </div>
      </header>
      <main>{children}</main>
      <Toaster position="top-center" richColors />
    </div>
  )
}
