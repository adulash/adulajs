import { useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '~/components/ui/alert-dialog'
import { useMessages } from '~/components/ui/messages'

type Confirmation = {
  title: string
  description: string
  action: () => void
  destructive?: boolean
  label?: string
}

/**
 * Keep confirmation separate from editor state; cancel never sends a mutation. The question is
 * shadcn's Alert Dialog (ADR 055): it interrupts, and only its two buttons answer it.
 */
export function useConfirmAction() {
  const { t, dir } = useMessages()
  const [pending, confirm] = useState<Confirmation | null>(null)
  return {
    confirm,
    confirmation: (
      <AlertDialog open={Boolean(pending)} onOpenChange={(open) => !open && confirm(null)}>
        <AlertDialogContent dir={dir}>
          <AlertDialogHeader>
            <AlertDialogTitle>{pending?.title ?? t('تأكيد الإجراء')}</AlertDialogTitle>
            <AlertDialogDescription>{pending?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('تراجع')}</AlertDialogCancel>
            <AlertDialogAction
              variant={pending?.destructive ? 'destructive' : 'default'}
              onClick={() => {
                const action = pending?.action
                confirm(null)
                action?.()
              }}
            >
              {pending?.label ?? t('تأكيد التغيير')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    ),
  }
}
