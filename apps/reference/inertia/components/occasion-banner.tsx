import { PartyPopper } from 'lucide-react'
import { Alert, AlertDescription } from '~/components/ui/alert'
import { useAppearance } from '~/components/appearance'

/**
 * The message of today's occasion (ADR 053), at the head of the page in the workspace and
 * guest shells. It shows only while an occasion with a message is active and disappears by
 * itself after the occasion's last day.
 */
export function OccasionBanner({ className = '' }: { className?: string }) {
  const banner = useAppearance()?.banner
  if (!banner) return null
  return (
    <div className={`mx-auto max-w-[1440px] ${className}`} data-occasion-banner>
      <Alert role="status">
        <PartyPopper />
        <AlertDescription>{banner}</AlertDescription>
      </Alert>
    </div>
  )
}
