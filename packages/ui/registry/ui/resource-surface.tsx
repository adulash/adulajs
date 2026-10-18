import { useEffect, useRef, useState, type ReactNode } from 'react'
import { router } from '@inertiajs/react'
import { Link } from '@adonisjs/inertia/react'
import axios from 'axios'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { useMessages } from '~/components/ui/messages'

export type ResourcePresentation = 'dialog' | 'page'

const LIST_RETURN = 'adula:list-return'
type ListReturn = { href: string; scroll: number; record: string }

/**
 * Remembers the list view (query and scroll) before a record opens from it, so closing the
 * record dialog returns to that view. DataTable calls it; page overrides that link to records
 * from their own list can call it too.
 */
export function rememberListView(record: string) {
  try {
    sessionStorage.setItem(
      LIST_RETURN,
      JSON.stringify({
        href: window.location.pathname + window.location.search,
        scroll: window.scrollY,
        record,
      } satisfies ListReturn)
    )
  } catch {
    // Storage can be unavailable (private mode); closing then falls back to backHref.
  }
}

function listReturn(backHref: string): ListReturn | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(LIST_RETURN) ?? 'null') as ListReturn | null
    const path = (href: string) => new URL(href, window.location.origin).pathname
    if (saved && typeof saved.href === 'string' && path(saved.href) === path(backHref)) return saved
  } catch {
    // Ignore unreadable entries.
  }
  return null
}

/**
 * A record opened over the list it belongs to (#31): the list stays mounted, keeps its
 * query, loaded pages and scroll, and the URL names the record so it can be shared or
 * reloaded as a standalone page.
 */
export type RecordOverlay = {
  /** The record's view or edit form, as served by GET /resources/:resource/:id/view. */
  view: unknown
  /** The list URL to return to. */
  list: string
  /** The record that opened the dialog, for focus return. */
  record: string
  /** Set after a save or action, so closing refreshes the list rows. */
  changed?: boolean
}
type OverlayPage = Record<string, unknown> & { overlay?: RecordOverlay }

/**
 * Opens a record in a dialog over the current generic list without leaving it. Page
 * overrides can call it for their own rows. Resources with their own record pages, and
 * failures, fall back to a normal visit.
 */
export async function openRecord(
  resource: string,
  id: string | number,
  mode: 'show' | 'edit' = 'show',
  options: { replace?: boolean; changed?: boolean } = {}
) {
  const href = `/resources/${resource}/${id}${mode === 'edit' ? '/edit' : ''}`
  let data: { view: unknown; childrenData?: unknown; activity?: unknown }
  try {
    const response = await axios.get(`/resources/${resource}/${id}/view`, {
      params: mode === 'edit' ? { mode } : {},
      headers: { Accept: 'application/json' },
    })
    data = response.data
  } catch {
    router.visit(href)
    return
  }
  const list = window.location.pathname + window.location.search
  const visit = options.replace ? router.replace.bind(router) : router.push.bind(router)
  visit({
    url: href,
    props: (current: OverlayPage) => ({
      ...current,
      childrenData: data.childrenData,
      activity: data.activity,
      overlay: {
        view: data.view,
        list: options.replace ? (current.overlay?.list ?? list) : list,
        record: options.replace ? (current.overlay?.record ?? href) : href,
        changed: Boolean(options.changed || (options.replace && current.overlay?.changed)),
      },
    }),
    preserveState: true,
    preserveScroll: true,
  })
}

/** Closes a record dialog opened by openRecord and returns to its list, refreshed if changed. */
export function closeRecord(overlay: RecordOverlay) {
  if (overlay.changed) {
    // Replace the record's history entry, so Back does not reopen a record that changed.
    router.visit(overlay.list, {
      replace: true,
      preserveScroll: true,
      onSuccess: () => restoreFocus(overlay.record),
    })
    return
  }
  router.replace({
    url: overlay.list,
    props: (current: OverlayPage) => {
      const { overlay: _closed, childrenData: _children, activity: _activity, ...rest } = current
      return rest
    },
    preserveState: true,
    preserveScroll: true,
    onSuccess: () => restoreFocus(overlay.record),
  })
}

/** Return focus to the control that opened the record, else to the page heading without a ring. */
function restoreFocus(record: string | undefined) {
  const trigger = record
    ? document.querySelector<HTMLElement>(`main a[href="${CSS.escape(record)}"]`)
    : null
  const target = trigger ?? document.querySelector<HTMLElement>('main h1')
  if (!trigger && target) {
    target.setAttribute('tabindex', '-1')
    target.classList.add('outline-none')
  }
  target?.focus({ preventScroll: true })
}

/** Forms and record details are modal unless the user requests a page override. */
export function ResourceSurface({
  title,
  description,
  backHref,
  presentation = 'dialog',
  mode,
  onClose,
  children,
}: {
  title: string
  description: string
  backHref: string
  presentation?: ResourcePresentation
  mode?: 'view' | 'edit'
  /** Replaces the default return visit, for dialogs opened over a mounted list. */
  onClose?: () => void
  children: ReactNode
}) {
  const { t, dir } = useMessages()
  const [open, setOpen] = useState(true)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(closeTimer.current), [])
  if (presentation === 'page')
    return (
      <section dir={dir} className="space-y-6">
        <Button variant="outline" asChild>
          <Link href={backHref}>{t('العودة إلى القائمة')}</Link>
        </Button>
        <header>
          <h1 className="text-3xl font-semibold">{title}</h1>
          <p className="mt-3 text-sm text-muted-foreground">{description}</p>
        </header>
        {children}
      </section>
    )

  return (
    <Dialog
      mode={mode}
      open={open}
      onOpenChange={(open) => {
        if (!open) {
          setOpen(false)
          closeTimer.current = setTimeout(
            () => {
              if (onClose) return onClose()
              // Return to the list view the record was opened from: same query and scroll.
              const saved = listReturn(backHref)
              router.visit(saved?.href ?? backHref, {
                onSuccess: () => {
                  if (saved) window.scrollTo(0, saved.scroll)
                  // A direct route has no mounted DialogTrigger to restore focus to.
                  restoreFocus(saved?.record)
                },
              })
            },
            window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 160
          )
        }
      }}
    >
      <DialogContent
        dir={dir}
        className="flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl"
      >
        <DialogHeader className="shrink-0 border-b px-6 py-5 pe-12 text-start">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-6">{children}</div>
      </DialogContent>
    </Dialog>
  )
}
