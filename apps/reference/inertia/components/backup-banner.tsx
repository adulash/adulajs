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
    <div className="px-5 pt-4 lg:px-10">
      <Alert variant="destructive">
        <TriangleAlert />
        <AlertTitle>لا توجد نسخة احتياطية خارجية سليمة خلال آخر 48 ساعة.</AlertTitle>
        <AlertDescription>
          <Link href="/admin/jobs" className="underline underline-offset-4">
            راجع صفحة تشغيل النظام
          </Link>
        </AlertDescription>
      </Alert>
    </div>
  )
}
