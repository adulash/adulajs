import * as React from 'react'
import { cn } from 'cn'
import { XIcon } from 'lucide-react'
import { Dialog as DialogPrimitive } from 'radix-ui'

import { Button } from '~/components/ui/button'
import { useMessages } from '~/components/ui/messages'
import { useUiPreferences } from '~/components/ui/ui-preferences'

/**
 * Clean close (ADR 016, decision 23 for 2.3.0): a dialog asks before closing only while
 * something differs from how it opened, and a value changed and restored is clean. The dialog
 * decides this itself; a dialog never computes its own dirty state.
 *
 * Two sources, one rule:
 * - Declared state. A dialog whose state is not plain controls (a draft object, a list order,
 *   switches, an image) declares it with the `value` prop of `Dialog`, or with
 *   `useDialogValue(value)` from a component inside the dialog. Each declaration is captured
 *   as it renders until the user first interacts with the dialog (so values reset on opening
 *   or loaded just after it are the starting point), then compared on closing.
 * - Plain controls. A dialog that declares nothing compares its inputs, text areas and
 *   selects: the value each had before the user changed it against the value now.
 *
 * When a dialog declares state, the declarations are the whole truth for it and its controls
 * are not compared one by one.
 */
type Changes = { initial: Map<Element, string>; changed: Set<Element> }
type Declared = { opened: string; current: string; settled: boolean }
type DialogState = {
  content: React.RefObject<HTMLDivElement | null>
  changes: React.RefObject<Changes>
  declared: React.RefObject<Map<symbol, Declared>>
  mode: React.RefObject<'view' | 'edit' | 'confirm'>
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

/** True for a form control the dialog compares when nothing is declared. */
function isControl(element: Element) {
  return Boolean(element.matches?.(CONTROLS))
}

/**
 * Remembers a control's value before the user changes it. On mount every control is recorded;
 * taking focus records it again until it changes, so values loaded after opening count as the
 * starting point.
 */
function remember(changes: Changes, element: Element, focus = false) {
  if (!isControl(element) || changes.changed.has(element)) return
  if (focus || !changes.initial.has(element)) changes.initial.set(element, controlValue(element))
}

/** A plain, ordered copy of a value: object keys sorted, files and dates as comparable data. */
function normalize(value: unknown): unknown {
  if (typeof value === 'function' || typeof value === 'symbol') return undefined
  if (value === null || typeof value !== 'object') return value
  if (value instanceof Date) return value.toISOString()
  if (typeof File !== 'undefined' && value instanceof File)
    return { file: value.name, size: value.size, modified: value.lastModified }
  if (typeof Blob !== 'undefined' && value instanceof Blob)
    return { blob: value.type, size: value.size }
  if (value instanceof Map) return [...value.entries()].map(([key, item]) => [key, normalize(item)])
  if (value instanceof Set) return [...value].map((item) => normalize(item) ?? null)
  if (Array.isArray(value)) return value.map((item) => normalize(item) ?? null)
  const plain: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) {
    const item = normalize((value as Record<string, unknown>)[key])
    if (item !== undefined) plain[key] = item
  }
  return plain
}

/** Stable text of a declared value: equal data gives equal text whatever the key order. */
function serializeDialogValue(value: unknown) {
  return JSON.stringify(normalize(value)) ?? ''
}

const useIsomorphicLayoutEffect =
  typeof window === 'undefined' ? React.useEffect : React.useLayoutEffect

/** Records one declaration in a dialog while `active`; removes it when inactive or unmounted. */
function useDeclaration(state: DialogState | null, value: unknown, active: boolean) {
  const [key] = React.useState(() => Symbol('dialog-value'))
  const text = active ? serializeDialogValue(value) : ''
  useIsomorphicLayoutEffect(() => {
    const declared = state?.declared.current
    if (!declared) return
    if (!active) {
      declared.delete(key)
      return
    }
    const entry = declared.get(key)
    if (!entry) declared.set(key, { opened: text, current: text, settled: false })
    else {
      entry.current = text
      if (!entry.settled) entry.opened = text
    }
  })
  useIsomorphicLayoutEffect(() => () => void state?.declared.current.delete(key), [state, key])
}

/**
 * Declares state of the surrounding dialog that is not a plain control: the dialog compares it
 * on closing with how it was when the dialog opened. Outside a dialog it does nothing, so a
 * form shown both as a page and in a dialog can always call it.
 */
function useDialogValue(value: unknown) {
  useDeclaration(React.useContext(DialogContentContext), value, true)
}

/**
 * `useDialogValue` as an element, for state that starts afresh within one opening: give it a
 * `key` that changes when a step is saved (an uploaded file becomes a mapping to review), and
 * the new step is compared with how it began. Place it inside the dialog's content.
 */
function DialogValue({ value }: { value: unknown }) {
  useDialogValue(value)
  return null
}

function Dialog({
  mode,
  value,
  onOpenChange,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root> & {
  mode?: 'view' | 'edit' | 'confirm'
  /** The dialog's editable state when it is not plain controls (see useDialogValue). */
  value?: unknown
}) {
  const content = React.useRef<HTMLDivElement>(null)
  const changes = React.useRef<Changes>({ initial: new Map(), changed: new Set() })
  const declared = React.useRef(new Map<symbol, Declared>())
  const modeRef = React.useRef<'view' | 'edit' | 'confirm'>(mode ?? 'edit')
  modeRef.current = mode ?? 'edit'
  const state = React.useMemo(() => ({ content, changes, declared, mode: modeRef }), [])
  const [confirming, setConfirming] = React.useState(false)
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(props.defaultOpen ?? false)
  const preferences = useUiPreferences()
  const { t, dir } = useMessages()
  const open = props.open ?? uncontrolledOpen
  // The value prop is one more declaration, captured afresh at every opening.
  useDeclaration(state, value, open && value !== undefined)
  // Each opening starts clean (cleared on closing: the content records its values on mount).
  React.useEffect(() => {
    if (!open) changes.current = { initial: new Map(), changed: new Set() }
  }, [open])
  const commit = (next: boolean) => {
    setUncontrolledOpen(next)
    onOpenChange?.(next)
  }
  const request = (next: boolean) => {
    // Ask only when there are unsaved changes; an untouched dialog closes at once.
    const declarations = [...declared.current.values()]
    const { initial, changed } = changes.current
    const unsaved = declarations.length
      ? declarations.some((entry) => entry.current !== entry.opened)
      : [...changed].some(
          (element) =>
            element.isConnected &&
            isControl(element) &&
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
  onPointerDownCapture,
  onKeyDownCapture,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
}) {
  const dialog = React.useContext(DialogContentContext)
  const content = dialog?.content
  const { t } = useMessages()
  // Controls: their values on mount, or when they take focus before a change, are the
  // baseline; a change marks them for comparison on closing.
  React.useEffect(() => {
    const node = content?.current
    if (!dialog || !node) return
    for (const element of node.querySelectorAll(CONTROLS)) remember(dialog.changes.current, element)
  }, [dialog, content])
  // The user's first interaction ends the opening: declared values are compared from here on.
  const settle = () => {
    for (const entry of dialog?.declared.current.values() ?? []) entry.settled = true
  }
  const touch = (target: EventTarget) => {
    settle()
    const element = target as Element
    if (dialog && isControl(element)) dialog.changes.current.changed.add(element)
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
        onPointerDownCapture={(event) => {
          settle()
          onPointerDownCapture?.(event)
        }}
        onKeyDownCapture={(event) => {
          settle()
          onKeyDownCapture?.(event)
        }}
        data-slot="dialog-content"
        // Tools and tests tell a confirmation from an editor or a details view by this.
        data-dialog-mode={dialog?.mode.current ?? 'edit'}
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
  DialogValue,
  serializeDialogValue,
  useDialogValue,
}
