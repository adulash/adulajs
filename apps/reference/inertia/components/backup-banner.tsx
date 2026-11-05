import { usePage } from '@inertiajs/react'
import { Link } from '@adonisjs/inertia/react'
import { TriangleAlert } from 'lucide-react'

/** Shown to every administrator until a complete offsite backup is younger than 48 hours. */
export function BackupBanner() {
  const page = usePage<{ backupWarning?: boolean }>()
  if (!page.props.backupWarning) return null
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-3 bg-destructive px-5 py-3 text-sm text-destructive-foreground lg:px-10"
    >
      <TriangleAlert size={18} />
      <span className="font-semibold">لا توجد نسخة احتياطية خارجية سليمة خلال آخر 48 ساعة.</span>
      <Link href="/admin/jobs" className="underline underline-offset-4">
        راجع صفحة تشغيل النظام
      </Link>
    </div>
  )
}
