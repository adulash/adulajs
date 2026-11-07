import * as React from 'react'
import { cn } from 'cn'
import { XIcon } from 'lucide-react'
import { Dialog as DialogPrimitive } from 'radix-ui'

import { Button } from '~/components/ui/button'
import { useMessages } from '~/components/ui/messages'
import { useUiPreferences } from '~/components/ui/ui-preferences'

/**
 * Controls outside every region that reports data-dirty: the value each had before the user
 * changed it, and the ones the user changed. Closing compares them, so a value changed and
 * restored is clean.
 */
type Changes = { initial: Map<Element, string>; changed: Set<Element> }
type DialogState = {
  content: React.RefObject<HTMLDivElement | null>
  changes: React.RefObject<Changes>
}
const DialogContentContext = React.createContext<DialogState | null>(null)

const CONTROLS = 'input, textarea, select'

/** A comparable value of a form control (checked state, selected options, files or text). */
function controlValue(element: Element) {
  if (element instanceof HTMLInputElement) {
    if (element.type === 'checkbox' || element.type === 'radio') return String(element.checked)
    if (element.type === 'file')
      return [...(element.files ?? [])].map((file) => `${file.name}:${file.size}`).join('|')
    return element.value
  }
  if (element instanceof HTMLSelectElement)
    return [...element.selectedOptions].map((option) => option.value).join('|')
  if (element instanceof HTMLTextAreaElement) return element.value
  return ''
}

/** True for a control the dialog compares itself: one outside every data-dirty region. */
function unreported(element: Element) {
  return Boolean(element.matches?.(CONTROLS)) && !element.closest('[data-dirty]')
}

/**
 * Remembers a control's value before the user changes it. On mount every control is recorded;
 * taking focus records it again until it changes, so values loaded after opening count as the
 * starting point.
 */
function remember(changes: Changes, element: Element, focus = false) {
  if (!unreported(element) || changes.changed.has(element)) return
  if (focus || !changes.initial.has(element)) changes.initial.set(element, controlValue(element))
}

function Dialog({
  mode,
  onOpenChange,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root> & { mode?: 'view' | 'edit' | 'confirm' }) {
  const content = React.useRef<HTMLDivElement>(null)
  const changes = React.useRef<Changes>({ initial: new Map(), changed: new Set() })
  const state = React.useMemo(() => ({ content, changes }), [])
  const [confirming, setConfirming] = React.useState(false)
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(props.defaultOpen ?? false)
  const preferences = useUiPreferences()
  const { t, dir } = useMessages()
  const open = props.open ?? uncontrolledOpen
  // Each opening starts clean (cleared on closing: the content records its values on mount).
  React.useEffect(() => {
    if (!open) changes.current = { initial: new Map(), changed: new Set() }
  }, [open])
  const commit = (next: boolean) => {
    setUncontrolledOpen(next)
    onOpenChange?.(next)
  }
  const request = (next: boolean) => {
    // Ask only when there are unsaved changes. Every element that reports data-dirty, a form
    // or not, decides for its own controls ("false" is clean whatever changed inside it). Any
    // other control counts when its value differs from the one it had before the user changed
    // it; a value changed and restored is clean. An untouched dialog closes at once.
    const regions = [...(content.current?.querySelectorAll<HTMLElement>('[data-dirty]') ?? [])]
    const { initial, changed } = changes.current
    const unsaved =
      regions.some((region) => region.dataset.dirty === 'true') ||
      [...changed].some(
        (element) =>
          element.isConnected &&
          unreported(element) &&
          controlValue(element) !== initial.get(element)
      )
    const editing = mode !== 'view' && mode !== 'confirm' && unsaved
    if (!next && editing && preferences.confirmDialogClose) setConfirming(true)
    else commit(next)
  }
  return (
    <DialogContentContext.Provider value={state}>
      <DialogPrimitive.Root data-slot="dialog" {...props} open={open} onOpenChange={request}>
        {children}
      </DialogPrimitive.Root>
      {confirming && open && (
        <Dialog mode="confirm" open onOpenChange={(next) => !next && setConfirming(false)}>
          <DialogContent showCloseButton={false} className="z-[70] sm:max-w-md" dir={dir}>
            <DialogHeader>
              <DialogTitle>{t('إغلاق النموذج؟')}</DialogTitle>
              <DialogDescription>
                {t('قد تفقد التغييرات التي لم تحفظها. يمكنك متابعة التحرير أو إغلاق النموذج.')}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setConfirming(false)}>
                {t('متابعة التحرير')}
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => {
                  setConfirming(false)
                  commit(false)
                }}
              >
                {t('إغلاق دون حفظ')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </DialogContentContext.Provider>
  )
}

function DialogTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        'fixed inset-0 z-50 bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0',
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  ref,
  className,
  children,
  showCloseButton = true,
  onInputCapture,
  onChangeCapture,
  onFocusCapture,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
}) {
  const dialog = React.useContext(DialogContentContext)
  const content = dialog?.content
  const { t } = useMessages()
  // Controls outside every data-dirty region: their values on mount, or when they take focus
  // before a change, are the baseline; a change marks them for comparison on closing.
  React.useEffect(() => {
    const node = content?.current
    if (!dialog || !node) return
    for (const element of node.querySelectorAll(CONTROLS)) remember(dialog.changes.current, element)
  }, [dialog, content])
  const touch = (target: EventTarget) => {
    const element = target as Element
    if (dialog && unreported(element)) dialog.changes.current.changed.add(element)
  }
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={(node) => {
          if (content) content.current = node
          if (typeof ref === 'function') return ref(node)
          if (ref) ref.current = node
        }}
        onFocusCapture={(event) => {
          if (dialog) remember(dialog.changes.current, event.target as Element, true)
          onFocusCapture?.(event)
        }}
        onInputCapture={(event) => {
          touch(event.target)
          onInputCapture?.(event)
        }}
        onChangeCapture={(event) => {
          touch(event.target)
          onChangeCapture?.(event)
        }}
        data-slot="dialog-content"
        className={cn(
          'fixed top-[50%] start-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] ltr:translate-x-[-50%] rtl:-translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border bg-background p-6 shadow-lg duration-200 outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 sm:max-w-lg',
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="absolute top-4 end-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            <XIcon />
            <span className="sr-only">{t('إغلاق')}</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-header"
      className={cn('flex flex-col gap-2 text-center sm:text-start', className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  showCloseButton?: boolean
}) {
  const { t } = useMessages()
  return (
    <div
      data-slot="dialog-footer"
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">{t('إغلاق')}</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('text-lg leading-none font-semibold', className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
