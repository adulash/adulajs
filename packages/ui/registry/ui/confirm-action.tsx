import { useState } from 'react'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { useMessages } from '~/components/ui/messages'

type Confirmation = {
  title: string
  description: string
  action: () => void
  destructive?: boolean
  label?: string
}

/** Keep confirmation separate from editor state; cancel never sends a mutation. */
export function useConfirmAction() {
  const { t, dir } = useMessages()
  const [pending, confirm] = useState<Confirmation | null>(null)
  return {
    confirm,
    confirmation: (
      <Dialog
        mode="confirm"
        open={Boolean(pending)}
        onOpenChange={(open) => !open && confirm(null)}
      >
        <DialogContent dir={dir} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{pending?.title ?? t('تأكيد الإجراء')}</DialogTitle>
            <DialogDescription>{pending?.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => confirm(null)}>
              {t('تراجع')}
            </Button>
            <Button
              type="button"
              variant={pending?.destructive ? 'destructive' : 'default'}
              onClick={() => {
                const action = pending?.action
                confirm(null)
                action?.()
              }}
            >
              {pending?.label ?? t('تأكيد التغيير')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    ),
  }
}
