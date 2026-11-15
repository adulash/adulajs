import { usePage } from '@inertiajs/react'
import { Link } from '@adonisjs/inertia/react'
import { TriangleAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'

/**
 * Shown to every administrator until a complete offsite backup is younger than 48 hours. It is
 * the destructive Alert, as on the backups page, and the wrapper only aligns it with the page.
 */
export function BackupBanner() {
  const page = usePage<{ backupWarning?: boolean }>()
  if (!page.props.backupWarning) return null
  return (
    // The same centred column as the page below it.
    <div className="mx-auto max-w-[1440px] px-5 pt-4 lg:px-10" data-backup-banner>
      <Alert variant="destructive">
        <TriangleAlert />
        {/* A short title keeps the whole warning on a phone; the 48 hours sit in the description. */}
        <AlertTitle>لا توجد نسخة احتياطية خارجية حديثة</AlertTitle>
        <AlertDescription>
          <p>لم تُنشأ نسخة خارجية سليمة خلال آخر 48 ساعة.</p>
          <Link href="/admin/jobs" className="underline underline-offset-4">
            راجع صفحة تشغيل النظام
          </Link>
        </AlertDescription>
      </Alert>
    </div>
  )
}
