import * as React from 'react'
import { cn } from 'cn'
import {
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { ScrollArea } from '~/components/ui/scroll-area'
import { useMessages } from '~/components/ui/messages'

// Named after the Tailwind max-width each one applies from the small screen breakpoint up.
const widths = {
  lg: 'sm:max-w-lg',
  xl: 'sm:max-w-xl',
  '2xl': 'sm:max-w-2xl',
  '3xl': 'sm:max-w-3xl',
  '4xl': 'sm:max-w-4xl',
  '5xl': 'sm:max-w-5xl',
} as const

type LongDialogContentProps = {
  title: React.ReactNode
  description?: React.ReactNode
  /**
   * Actions shown in the fixed footer: secondary actions first (pushed to the start side with
   * `sm:me-auto`), then «إلغاء» or «إغلاق» as outline inside `DialogClose`, then the primary.
   * Closing asks first only while something differs from how the dialog opened (Dialog).
   */
  footer?: React.ReactNode
  /** Dialog width from the small screen breakpoint up; phones always use the full width. */
  width?: keyof typeof widths
  /**
   * `content` (default) grows with the body up to the maximum height. `fill` takes the maximum
   * height from the first frame, for a body that loads after opening: the dialog's size never
   * changes when its data arrives, so the opening animation is never disturbed.
   */
  height?: 'content' | 'fill'
  children: React.ReactNode
} & Omit<React.ComponentProps<typeof DialogContent>, 'title' | 'className' | 'children'>

/**
 * The long dialog pattern (ADR 016): the header and footer stay fixed and only the body scrolls,
 * with a scrollbar that stays visible in both themes so the reader sees there is more below.
 * The body is `[data-long-dialog-body]`, a Scroll Area; `[data-slot=scroll-area-viewport]` inside
 * it is the element that scrolls.
 * Place it inside a shadcn `Dialog`; the layout matches the record surface (resource-surface).
 */
export function LongDialogContent({
  title,
  description,
  footer,
  width = 'xl',
  height = 'content',
  children,
  ...props
}: LongDialogContentProps) {
  const { dir } = useMessages()
  return (
    <DialogContent
      // Anchored to the top, so content that loads after opening extends the dialog downward.
      // Clipped, not hidden: focus cannot scroll the header away; the body is the only scroller.
      className={cn(
        'top-4 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] translate-y-0 flex-col gap-0 overflow-clip p-0 sm:top-[5dvh] sm:max-h-[90dvh]',
        height === 'fill' && 'h-[calc(100dvh-2rem)] sm:h-[90dvh]',
        widths[width]
      )}
      data-long-dialog=""
      {...props}
    >
      <DialogHeader className="shrink-0 border-b px-6 py-5 pe-12 text-start">
        <DialogTitle>{title}</DialogTitle>
        {description && <DialogDescription>{description}</DialogDescription>}
      </DialogHeader>
      <ScrollArea
        // Radix lays the area out left to right unless told the reading direction.
        dir={props.dir === 'ltr' || props.dir === 'rtl' ? props.dir : dir}
        data-long-dialog-body=""
        // shadcn Scroll Area (ADR 055), always shown so the reader sees there is more below; its
        // thumb uses the muted text token, which reads in light and dark. The viewport is the
        // scroller; its content is a block so long text wraps instead of widening the dialog.
        type="always"
        className="flex min-h-0 flex-1 flex-col overflow-hidden [&>[data-slot=scroll-area-viewport]]:min-h-0 [&>[data-slot=scroll-area-viewport]]:flex-1 [&>[data-slot=scroll-area-viewport]]:scroll-py-6 [&>[data-slot=scroll-area-viewport]]:overscroll-contain [&>[data-slot=scroll-area-viewport]>div]:block! [&_[data-slot=scroll-area-thumb]]:bg-muted-foreground"
      >
        <div className="p-4 sm:p-6" data-long-dialog-padding="">
          {children}
        </div>
      </ScrollArea>
      {footer && (
        <DialogFooter className="shrink-0 border-t px-6 py-4" data-slot="long-dialog-footer">
          {footer}
        </DialogFooter>
      )}
    </DialogContent>
  )
}
