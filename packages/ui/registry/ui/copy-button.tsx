import { useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '~/components/ui/button'
import { useMessages } from '~/components/ui/messages'

type CopyButtonProps = {
  /** The exact text placed on the clipboard. */
  value: string
  /** Visible label; defaults to «نسخ». */
  label?: string
  /** Accessible name when the label alone is ambiguous, e.g. «نسخ AWS_REGION». */
  ariaLabel?: string
  /** Shows the icon only; `ariaLabel` then names the button. */
  iconOnly?: boolean
  className?: string
}

/**
 * Copies a value to the clipboard and confirms it in place for two seconds. When the browser
 * refuses clipboard access it says so, so the user selects and copies the text by hand.
 */
export function CopyButton({ value, label, ariaLabel, iconOnly, className }: CopyButtonProps) {
  const { t } = useMessages()
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const text = copied ? t('تم النسخ') : (label ?? t('نسخ'))
  return (
    <Button
      type="button"
      size={iconOnly ? 'icon' : 'sm'}
      variant="outline"
      className={className}
      aria-label={iconOnly || ariaLabel ? (ariaLabel ?? text) : undefined}
      data-copied={copied || undefined}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          clearTimeout(timer.current)
          timer.current = setTimeout(() => setCopied(false), 2000)
        } catch {
          toast.error(t('تعذر النسخ؛ حدّد النص وانسخه يدويًا.'))
        }
      }}
    >
      {copied ? <Check aria-hidden size={14} /> : <Copy aria-hidden size={14} />}
      {!iconOnly && text}
    </Button>
  )
}
