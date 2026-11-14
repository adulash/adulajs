import { useEffect, useLayoutEffect, useRef } from 'react'
import { usePage } from '@inertiajs/react'
import { clientVisit } from '~/components/ui/resource-surface'

/*
 * Entity dialogs with their own address (owner decision 30 for 2.3.0, ADR 016). A dialog that
 * creates, edits or shows a lasting item is open while its query parameter is in the address:
 * `?new=1` for a create dialog, `?edit=<id>` for an edit dialog. Opening adds the parameter
 * with a client-side visit (no request, no progress bar), so Back closes the dialog and stays
 * on the page, a reload keeps it open and the address can be shared. Transient dialogs
 * (confirmations, one-setting edits, reordering, one-time secrets, step flows) keep no address.
 *
 * A dialog only names its parameter and maps the value to its item; the history rules live
 * here and nowhere else.
 */

/** The page address (path and query) with one query parameter set, or removed with null. */
export function withDialogParam(url: string, name: string, value: string | null) {
  const [beforeHash, hash = ''] = url.split('#', 2)
  const [path, search = ''] = beforeHash.split('?', 2)
  const query = new URLSearchParams(search)
  if (value === null) query.delete(name)
  else query.set(name, value)
  const rest = query.toString()
  return `${path}${rest ? `?${rest}` : ''}${hash ? `#${hash}` : ''}`
}

/** The value of one query parameter of a page address, or null. */
export function dialogParam(url: string, name: string) {
  const search = url.split('#', 1)[0].split('?', 2)[1] ?? ''
  return new URLSearchParams(search).get(name)
}

/** The dialog address this page pushed last; closing it again goes Back instead of forward. */
let pushed: string | null = null

/** The address a close is going Back to, while that popstate is on its way. */
let returning: string | null = null

const here = () => `${window.location.pathname}${window.location.search}${window.location.hash}`

if (typeof window !== 'undefined') {
  // A close goes Back to the page the dialog opened over. That history entry holds the page as
  // it was when the dialog opened, and Inertia would put it back by mounting the page again
  // (losing focus, scroll and anything saved meanwhile). This listener runs before Inertia's
  // (capture phase on the target), takes over that one popstate and keeps the mounted page,
  // with its current props, at the address it returned to. Every other Back is Inertia's.
  window.addEventListener(
    'popstate',
    (event) => {
      const target = returning
      returning = null
      pushed = null
      if (target === null || here() !== target) return
      event.stopImmediatePropagation()
      clientVisit('replace', { url: target, preserveState: true, preserveScroll: true }, true)
    },
    { capture: true }
  )
}

export type DialogParam<T, P = undefined> = {
  /** The parameter's value in the address, or null while the dialog is closed. */
  value: string | null
  /** The item the value names; null while closed, unknown, or still resolving. */
  item: T | null
  /**
   * Opens the dialog: pushes the parameter (`1` when no value is given). `preset` reaches
   * onOpen for this opening only (a choice the address does not carry, such as a parent).
   */
  open: (value?: string | number, preset?: P) => void
  /** Closes the dialog: Back when this page pushed it, otherwise the parameter is replaced away. */
  close: () => void
}

export type DialogParamOptions<T, P = undefined> = {
  /** The item is still being fetched for the value (a direct load); nothing is stripped yet. */
  pending?: boolean
  /** Called once per opening, when the value first resolves, to start the dialog's draft. */
  onOpen?: (item: T, value: string, preset: P | undefined) => void
}

/**
 * Binds a dialog to the query parameter `name` of the page address. `resolve` maps the value
 * to the dialog's item and returns undefined for a value that names nothing this user may open:
 * the dialog then stays closed and the parameter is removed with replace, so an unknown or
 * forbidden id shows nothing and reveals nothing.
 */
export function useDialogParam<T, P = undefined>(
  name: string,
  resolve: (value: string) => T | undefined,
  options: DialogParamOptions<T, P> = {}
): DialogParam<T, P> {
  const url = usePage().url
  const value = dialogParam(url, name)
  const found = value === null ? undefined : resolve(value)
  const item = found ?? null
  const { pending = false, onOpen } = options

  // A value that resolves to nothing is removed from the address, without a history entry.
  const unknown = value !== null && found === undefined && !pending
  useEffect(() => {
    if (!unknown) return
    if (pushed === here()) pushed = null
    clientVisit(
      'replace',
      { url: withDialogParam(here(), name, null), preserveState: true, preserveScroll: true },
      true
    )
  }, [unknown, name])

  // The draft starts before paint, once per opening (a value, then the item it names).
  const started = useRef<string | null>(null)
  const latest = useRef(onOpen)
  latest.current = onOpen
  const preset = useRef<P | undefined>(undefined)
  useLayoutEffect(() => {
    if (value === null) {
      started.current = null
      return
    }
    if (found === undefined || started.current === value) return
    started.current = value
    const given = preset.current
    preset.current = undefined
    latest.current?.(found, value, given)
  }, [value, found])

  const open = (next: string | number = '1', given?: P) => {
    const target = withDialogParam(here(), name, String(next))
    if (target === here()) return
    preset.current = given
    clientVisit(
      'push',
      {
        url: target,
        preserveState: true,
        preserveScroll: true,
        onSuccess: () => {
          pushed = target
        },
      },
      true
    )
  }

  const close = () => {
    const current = here()
    if (dialogParam(current, name) === null) return
    const target = withDialogParam(current, name, null)
    if (pushed === current) {
      pushed = null
      returning = target
      window.history.back()
      return
    }
    clientVisit('replace', { url: target, preserveState: true, preserveScroll: true }, true)
  }

  return { value, item, open, close }
}

export type EntityDialog<T> = {
  /** `'new'` while creating, the edited item while editing, null while closed. */
  item: T | 'new' | null
  openCreate: () => void
  openEdit: (id: string | number) => void
  close: () => void
}

/**
 * One dialog that creates and edits the same kind of item: `?new=1` creates and `?edit=<id>`
 * edits. A page with two such dialogs gives the second its own parameter names. `find` maps an
 * id to the item; `canCreate: false` drops `?new=1` as an unknown value.
 */
export function useEntityDialog<T>(options: {
  find: (id: string) => T | undefined
  names?: { create: string; edit: string }
  canCreate?: boolean
  pending?: boolean
  onOpen?: (item: T | 'new') => void
}): EntityDialog<T> {
  const { create = 'new', edit = 'edit' } = options.names ?? {}
  const allowed = options.canCreate !== false
  const creating = useDialogParam(
    create,
    (value) => (value === '1' && allowed ? ('new' as const) : undefined),
    { onOpen: () => options.onOpen?.('new') }
  )
  const editing = useDialogParam(edit, options.find, {
    pending: options.pending,
    onOpen: (item) => options.onOpen?.(item),
  })
  return {
    item: editing.item ?? creating.item,
    openCreate: () => creating.open(),
    openEdit: (id) => editing.open(id),
    close: () => (editing.value !== null ? editing.close() : creating.close()),
  }
}
