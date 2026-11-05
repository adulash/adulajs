import * as React from 'react'
import { cn } from 'cn'
import {
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'

const widths = {
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-xl',
  xl: 'sm:max-w-3xl',
  full: 'sm:max-w-5xl',
} as const

type LongDialogContentProps = {
  title: React.ReactNode
  description?: React.ReactNode
  /** Actions shown in the fixed footer: «إلغاء» or «إغلاق» (outline) first, then the primary. */
  footer?: React.ReactNode
  /** Dialog width from the small screen breakpoint up; phones always use the full width. */
  width?: keyof typeof widths
  children: React.ReactNode
} & Omit<React.ComponentProps<typeof DialogContent>, 'title' | 'className' | 'children'>

/**
 * The long dialog pattern (ADR 016): the header and footer stay fixed and only the body scrolls,
 * with a scrollbar that stays visible in both themes so the reader sees there is more below.
 * Place it inside a shadcn `Dialog`; the layout matches the record surface (resource-surface).
 */
export function LongDialogContent({
  title,
  description,
  footer,
  width = 'lg',
  children,
  ...props
}: LongDialogContentProps) {
  return (
    <DialogContent
      // Anchored to the top, so content that loads after opening extends the dialog downward.
      // Clipped, not hidden: focus cannot scroll the header away; the body is the only scroller.
      className={cn(
        'top-4 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] translate-y-0 flex-col gap-0 overflow-clip p-0 sm:top-[5dvh] sm:max-h-[90dvh]',
        widths[width]
      )}
      data-long-dialog=""
      {...props}
    >
      <DialogHeader className="shrink-0 border-b px-6 py-5 pe-12 text-start">
        <DialogTitle>{title}</DialogTitle>
        {description && <DialogDescription>{description}</DialogDescription>}
      </DialogHeader>
      <div
        data-slot="long-dialog-body"
        // overflow-y: scroll keeps the scrollbar on screen while idle; the gutter keeps the
        // content from shifting, and the thumb uses theme tokens to read in light and dark.
        className="min-h-0 flex-1 scroll-py-6 overflow-y-scroll overscroll-contain p-4 [scrollbar-color:var(--muted-foreground)_transparent] [scrollbar-gutter:stable] [scrollbar-width:thin] sm:p-6"
      >
        {children}
      </div>
      {footer && (
        <DialogFooter className="shrink-0 border-t px-6 py-4" data-slot="long-dialog-footer">
          {footer}
        </DialogFooter>
      )}
    </DialogContent>
  )
}
