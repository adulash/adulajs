import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { router } from '@inertiajs/react'
import { Link } from '@adonisjs/inertia/react'
import axios from 'axios'
import { Button } from '~/components/ui/button'
import { Dialog, DialogClose } from '~/components/ui/dialog'
import { LongDialogContent } from '~/components/ui/long-dialog'
import { useMessages } from '~/components/ui/messages'

type FooterSlot = { slot: HTMLElement | null; register: () => () => void }
const RecordFooterContext = createContext<FooterSlot | null>(null)

// Secondary actions sit at the start (me-auto on their group), then «إلغاء»/«إغلاق», then the
// primary action: the shared dialog footer rule.
const footerClass = 'flex w-full flex-wrap items-center gap-2'

/**
 * A record's actions. Inside a record dialog they move to its fixed footer (the long dialog
 * pattern, ADR 016), so they stay on screen while the body scrolls; on a record page they
 * render in place. Buttons that submit a form must name it with `form`, because the footer
 * is outside the form's markup.
 */
export function RecordFooter({ children }: { children: ReactNode }) {
  const surface = useContext(RecordFooterContext)
  const register = surface?.register
  // Registered before paint, so the dialog's fixed footer is there in the body's first frame.
  useLayoutEffect(() => register?.(), [register])
  if (!surface) return <div className={footerClass}>{children}</div>
  return surface.slot ? createPortal(children, surface.slot) : null
}

/** «إغلاق» for a record dialog's footer; nothing on a record page, which has its own way back. */
export function RecordFooterClose() {
  const { t } = useMessages()
  if (!useContext(RecordFooterContext)) return null
  return (
    <DialogClose asChild>
      <Button type="button" variant="outline">
        {t('إغلاق')}
      </Button>
    </DialogClose>
  )
}

export type ResourcePresentation = 'dialog' | 'page'

const LIST_RETURN = 'adula:list-return'
type ListReturn = { href: string; scroll: number; record: string }

/**
 * The page's scroll container: the workspace's scroll region (Inertia's `scroll-region`) when
 * it scrolls on its own, as on large screens; otherwise the window.
 */
function pageScroller(): HTMLElement | null {
  const region = document.querySelector<HTMLElement>('[scroll-region]')
  if (!region) return null
  const { overflowY } = getComputedStyle(region)
  return overflowY === 'auto' || overflowY === 'scroll' ? region : null
}

function pageScrollTop() {
  return pageScroller()?.scrollTop ?? window.scrollY
}

/**
 * Scrolls the page back to a remembered position once Inertia has settled its own scroll
 * handling (a scroll region is set on the next frame) and the list is tall enough: it retries
 * for a few frames until the position holds.
 */
function scrollPageTo(top: number) {
  let frames = 0
  const apply = () => {
    const region = pageScroller()
    if (region) region.scrollTo(0, top)
    else window.scrollTo(0, top)
    const current = region ? region.scrollTop : window.scrollY
    if (Math.abs(current - top) > 1 && ++frames < 30) requestAnimationFrame(apply)
  }
  requestAnimationFrame(apply)
}

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
        scroll: pageScrollTop(),
        record,
      } satisfies ListReturn)
    )
  } catch {
    // Storage can be unavailable (private mode); closing then falls back to backHref.
  }
}

function forgetListView() {
  try {
    sessionStorage.removeItem(LIST_RETURN)
  } catch {
    // Storage can be unavailable; nothing to forget.
  }
}

/** A path with its query on this origin, or null: never another origin or a scheme URL. */
function localPath(href: unknown): string | null {
  if (typeof href !== 'string' || !href.startsWith('/')) return null
  if (href.startsWith('//') || href.includes('\\')) return null
  try {
    const url = new URL(href, window.location.origin)
    // Dot segments can still collapse to a protocol-relative path ('/.//host').
    if (url.origin !== window.location.origin || url.pathname.startsWith('//')) return null
    return url.pathname + url.search
  } catch {
    return null
  }
}

const recordPath = (path: string) => path.split('?')[0].replace(/\/edit$/, '')

/**
 * The remembered view to return to when this record closes: the record's own list view, or
 * any page of this application that remembered itself for this record (for example «مهامي»).
 */
function listReturn(backHref: string): ListReturn | null {
  try {
    const stored = sessionStorage.getItem(LIST_RETURN) ?? 'null'
    const saved = JSON.parse(stored) as Partial<ListReturn> | null
    const href = localPath(saved?.href)
    if (!saved || !href) return null
    const record = localPath(saved.record)
    const fromList = href.split('?')[0] === new URL(backHref, window.location.origin).pathname
    const forThisRecord =
      record !== null && recordPath(record) === recordPath(window.location.pathname)
    if (!fromList && !forThisRecord) return null
    const scroll = Number.isFinite(saved.scroll) ? Number(saved.scroll) : 0
    return { href, record: record ?? '', scroll: Math.max(0, scroll) }
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
  /**
   * The record's view or edit form, as served by GET /resources/:resource/:id/view (or the
   * create form, by GET /resources/:resource/create/view). Absent while it loads: the dialog
   * is already on screen and its body shows a loading state.
   */
  view?: unknown
  /** The resource the dialog belongs to. */
  resource?: string
  /**
   * What the dialog shows, so its title and shell render before the view arrives; `label`
   * names the resource for a page that has no description of it.
   */
  opening?: { mode: 'create' | 'show' | 'edit'; id?: string; label?: string }
  /** The list URL to return to. */
  list: string
  /** The record that opened the dialog, for focus return. */
  record: string
  /** Set after a save or action, so closing refreshes the list rows. */
  changed?: boolean
}
type OverlayPage = Record<string, unknown> & { overlay?: RecordOverlay }

/** Deferred props being loaded for the page on screen (Inertia's async partial reloads). */
let deferredLoads = 0
/** Inertia writes in flight (a form submit, a POST, PUT or DELETE): never cancelled. */
let pendingWrites = 0
if (typeof window !== 'undefined') {
  router.on('start', (event) => {
    if (event.detail.visit.async) deferredLoads++
    if (event.detail.visit.method !== 'get') pendingWrites++
  })
  router.on('finish', (event) => {
    if (event.detail.visit.async) deferredLoads = Math.max(0, deferredLoads - 1)
    if (event.detail.visit.method !== 'get') pendingWrites = Math.max(0, pendingWrites - 1)
  })
}

/**
 * Cancels the page's reads still in flight (a GET visit, deferred props), so a late answer
 * cannot replace the page. A write in flight is never cancelled: its reply and message must
 * arrive, as the change may already be saved; while one is pending nothing is cancelled.
 */
function cancelReads(options: { sync: boolean; async: boolean }) {
  if (pendingWrites > 0) return false
  router.cancelAll({ async: options.async, prefetch: false, sync: options.sync })
  return true
}

/**
 * Changes the address on the client (a dialog opening or closing over the page), with no
 * request of its own. `ownPage` marks an address the mounted page itself renders (the list
 * a dialog closes back to, or the same page with another query). Deferred props loading for
 * the old address (the «مهامي» badge) answer late: Inertia applies that answer when only the
 * query changed, restoring the old address and so the dialog, and drops it when the path
 * changed. On the page's own address they are cancelled if still loading, and those missing
 * are loaded again for it; a dialog's own address never reloads them, since it renders
 * another page.
 */
export function clientVisit<TProps = OverlayPage>(
  kind: 'push' | 'replace',
  options: Parameters<typeof router.push<TProps>>[0],
  ownPage = false
) {
  const cancelled = ownPage && deferredLoads > 0 && cancelReads({ async: true, sync: false })
  const visit = kind === 'push' ? router.push.bind(router) : router.replace.bind(router)
  visit<TProps>({
    ...options,
    onSuccess: (page) => {
      options.onSuccess?.(page)
      if (!ownPage) return
      const props = page.props as Record<string, unknown>
      // Inertia keeps the page's deferred props under initialDeferredProps once they load.
      const groups =
        (page as { initialDeferredProps?: Record<string, string[]> }).initialDeferredProps ??
        page.deferredProps ??
        {}
      const keys = Object.values(groups)
        .flat()
        .filter((key) => cancelled || props[key] === undefined)
      if (keys.length) router.reload({ only: keys, async: true })
    },
  })
}

/**
 * A plain left click, which opens a dialog over the page; a modified click (new tab, new
 * window) keeps the link's own behavior.
 */
export function plainClick(event: {
  button: number
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
}) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

/** The view being loaded for the open dialog; a newer opening or a close discards it. */
let loading: { href: string; abort: AbortController } | null = null

/** The address whose loaded view is being put on the page (loadOverlay's replace). */
let delivering: string | null = null

function cancelLoading() {
  loading?.abort.abort()
  loading = null
}

// Back and Forward leave the dialog that was loading; history brings its own page.
if (typeof window !== 'undefined')
  window.addEventListener('popstate', () => {
    cancelLoading()
    // Back before the opening push applied: the page in history has no dialog.
    setShell(null)
  })

const here = () => window.location.pathname + window.location.search

type ViewData = {
  view: unknown
  childrenData?: unknown
  activity?: unknown
  presentation?: ResourcePresentation
}

/** `keep`: used for every opening while fresh (the create form), not only the next one. */
type Prefetch = { at: number; promise: Promise<ViewData>; data?: ViewData; keep: boolean }

/**
 * Views fetched ahead of the click (a record on hover or focus, the create form when its list
 * mounts), so most dialogs open complete instead of with a loading body. A record's view is
 * used once, the create form for every opening, both only while fresh; a save clears them all,
 * since any view may show what it changed.
 */
const prefetched = new Map<string, Prefetch>()
const PREFETCH_FRESH_MS = 20_000

const viewKey = (endpoint: string, params: Record<string, unknown>) =>
  `${endpoint}?${new URLSearchParams(params as Record<string, string>).toString()}`

function prefetchView(endpoint: string, params: Record<string, unknown>, keep = false) {
  const key = viewKey(endpoint, params)
  const entry = prefetched.get(key)
  if (entry && Date.now() - entry.at < PREFETCH_FRESH_MS) return
  const next: Prefetch = {
    at: Date.now(),
    keep,
    promise: axios
      .get<ViewData>(endpoint, { params, headers: { Accept: 'application/json' } })
      .then((response) => (next.data = response.data)),
  }
  // A failed prefetch is forgotten; the click loads the view itself and handles the failure.
  next.promise.catch(() => {
    if (prefetched.get(key) === next) prefetched.delete(key)
  })
  prefetched.set(key, next)
}

/** The fresh prefetched view for this request (taken out of the cache unless kept). */
function takePrefetched(endpoint: string, params: Record<string, unknown>) {
  const key = viewKey(endpoint, params)
  const entry = prefetched.get(key)
  if (!entry) return undefined
  const fresh = Date.now() - entry.at < PREFETCH_FRESH_MS
  if (!fresh || !entry.keep) prefetched.delete(key)
  return fresh ? entry : undefined
}

/** Forgets every prefetched view: called after a save. */
export function clearPrefetched() {
  prefetched.clear()
}

const recordView = (resource: string, id: string | number, mode: 'show' | 'edit') => ({
  endpoint: `/resources/${resource}/${id}/view`,
  params: (mode === 'edit' ? { mode } : {}) as Record<string, unknown>,
})
const createView = (resource: string, search = '') => ({
  endpoint: `/resources/${resource}/create/view`,
  params: Object.fromEntries(new URLSearchParams(search)) as Record<string, unknown>,
})

/** Fetches a record's view ahead of the click (row hover or focus). */
export function prefetchRecord(
  resource: string,
  id: string | number,
  mode: 'show' | 'edit' = 'show'
) {
  const { endpoint, params } = recordView(resource, id, mode)
  prefetchView(endpoint, params)
}

/** Fetches the create form ahead of the click (its list mounted, or «إضافة» hovered). */
export function prefetchCreate(resource: string, search = '') {
  const { endpoint, params } = createView(resource, search)
  prefetchView(endpoint, params, true)
}

/** Fetches a dialog's view and puts it in the dialog, if the dialog is still the one open. */
async function loadOverlay(
  href: string,
  endpoint: string,
  params: Record<string, unknown>,
  options: { changed?: boolean; fallback: () => void }
) {
  cancelLoading()
  const abort = new AbortController()
  const current = (loading = { href, abort })
  let data: ViewData
  try {
    // A prefetch on its way answers this opening too: no second request.
    const ahead = takePrefetched(endpoint, params)
    if (ahead) data = await ahead.promise
    else {
      const response = await axios.get<ViewData>(endpoint, {
        params,
        headers: { Accept: 'application/json' },
        signal: abort.signal,
      })
      data = response.data
    }
  } catch (error) {
    if (loading !== current) return
    loading = null
    if (!axios.isCancel(error)) options.fallback()
    return
  }
  // Closed, gone Back, or another dialog opened meanwhile: this answer is not wanted.
  if (loading !== current) return
  loading = null
  // A page the user asked to see as a page, not a dialog: visit it.
  if (data.presentation === 'page') return options.fallback()
  // The view may arrive before the page shows the pushed opening (the shell made the click
  // faster than the page update); it is on its way, so the opening must not load it again.
  delivering = href
  clientVisit('replace', {
    url: href,
    props: (page: OverlayPage) => ({
      ...page,
      childrenData: data.childrenData,
      activity: data.activity,
      overlay: {
        view: data.view,
        resource: page.overlay?.resource,
        list: page.overlay?.list ?? href,
        record: page.overlay?.record ?? href,
        changed: Boolean(options.changed || page.overlay?.changed),
      },
    }),
    preserveState: true,
    preserveScroll: true,
    onFinish: () => {
      if (delivering === href) delivering = null
    },
  })
}

/**
 * Opens a record in a dialog over the current page without leaving it: the generic list, or
 * any page that renders RecordOverlayDialog (for example «مهامي»), stays mounted. The dialog
 * is on screen at once and its body loads inside it, so the opening animation never waits for
 * the server. `label` names the resource in the title while it loads, on a page that has no
 * description of it. Resources with their own record pages, and failures, fall back to a
 * normal visit.
 */
export async function openRecord(
  resource: string,
  id: string | number,
  mode: 'show' | 'edit' = 'show',
  options: { replace?: boolean; changed?: boolean; label?: string } = {}
) {
  const href = `/resources/${resource}/${id}${mode === 'edit' ? '/edit' : ''}`
  const { endpoint, params } = recordView(resource, id, mode)
  const fallback = () => router.visit(href, { replace: true })
  if (options.changed) clearPrefetched()
  // Within the open dialog the current body and address stay until the next view arrives.
  if (!options.replace) {
    const opening = { mode, id: String(id), label: options.label }
    // Prefetched: the dialog opens complete, with nothing left to load.
    if (openPrefetched(href, resource, opening, endpoint, params, fallback)) return
    showOverlay(href, resource, opening)
  }
  await loadOverlay(href, endpoint, params, { changed: options.changed, fallback })
}

/**
 * Opens the create form in a dialog over the current generic list (the «إضافة» button), the
 * same way openRecord opens a record: `/resources/:resource/create` stays a page of its own
 * when it is visited or reloaded directly. `search` carries `?defaults[field]=` pre-fills.
 */
export async function openCreate(resource: string, search = '') {
  const href = `/resources/${resource}/create${search}`
  const { endpoint, params } = createView(resource, search)
  const fallback = () => router.visit(href, { replace: true })
  if (openPrefetched(href, resource, { mode: 'create' }, endpoint, params, fallback)) return
  showOverlay(href, resource, { mode: 'create' })
  await loadOverlay(href, endpoint, params, { fallback })
}

/**
 * Opens the dialog with a view that already arrived ahead of the click, so its first frame is
 * its final one. False when no such view is at hand (the caller shows the loading dialog).
 */
function openPrefetched(
  href: string,
  resource: string,
  opening: NonNullable<RecordOverlay['opening']>,
  endpoint: string,
  params: Record<string, unknown>,
  fallback: () => void
) {
  const entry = prefetched.get(viewKey(endpoint, params))
  if (!entry?.data || Date.now() - entry.at >= PREFETCH_FRESH_MS) return false
  const data = takePrefetched(endpoint, params)!.data!
  if (data.presentation === 'page') fallback()
  else showOverlay(href, resource, opening, data)
  return true
}

/** Pushes the dialog's address and its shell, with no request: the list stays as it is. */
/**
 * The dialog being opened, shown before Inertia's page update: the click renders only the
 * dialog, at once, and the page update that follows (a re-render of the whole page) finds the
 * same dialog already on screen and keeps it.
 */
let shell: RecordOverlay | null = null
const shellListeners = new Set<() => void>()
function setShell(next: RecordOverlay | null) {
  if (shell === next) return
  shell = next
  for (const listener of shellListeners) listener()
}

/** The dialog opening on this page before its address is pushed, or null. */
export function useOverlayShell() {
  return useSyncExternalStore(
    (listener) => {
      shellListeners.add(listener)
      return () => shellListeners.delete(listener)
    },
    () => shell,
    () => null
  )
}

function showOverlay(
  href: string,
  resource: string,
  opening: NonNullable<RecordOverlay['opening']>,
  // A view already at hand (prefetched): the dialog opens complete.
  data?: ViewData
) {
  cancelLoading()
  // Opening a dialog is the user's latest navigation, as a link click is: a read or deferred
  // props still in flight for the page would otherwise answer later and replace its props,
  // dialog and all. Deferred props cancelled here load again when the dialog closes back to
  // the page (clientVisit with ownPage). A pending write is left to finish.
  cancelReads({ async: true, sync: true })
  const list = here()
  const overlay: RecordOverlay = { resource, opening, list, record: href, view: data?.view }
  setShell(overlay)
  clientVisit('push', {
    url: href,
    props: (page: OverlayPage) => {
      const { childrenData: _children, activity: _activity, ...rest } = page
      return data
        ? { ...rest, overlay, childrenData: data.childrenData, activity: data.activity }
        : { ...rest, overlay }
    },
    preserveState: true,
    preserveScroll: true,
    // The page now carries the dialog itself.
    onSuccess: () => {
      if (shell === overlay) setShell(null)
    },
  })
}

/**
 * Loads the view of a dialog whose address came back from history (Forward, or Back to it)
 * while its view had not arrived. RecordOverlayDialog calls it for the overlay it shows.
 */
export function useOverlayView(overlay: RecordOverlay | undefined) {
  const opening = overlay && !overlay.view ? overlay.opening : undefined
  const resource = overlay?.resource
  // The dialog's own address: an opening is pushed with it, before Inertia updates the
  // browser's address, so window.location may still name the page behind.
  const href = overlay?.record
  useEffect(() => {
    if (!opening || !resource || !href) return
    if (loading?.href === href || delivering === href) return
    if (opening.mode === 'create')
      void loadOverlay(
        href,
        `/resources/${resource}/create/view`,
        Object.fromEntries(new URL(href, window.location.origin).searchParams),
        { fallback: () => router.visit(href, { replace: true }) }
      )
    else
      void loadOverlay(
        href,
        `/resources/${resource}/${opening.id}/view`,
        opening.mode === 'edit' ? { mode: 'edit' } : {},
        { fallback: () => router.visit(href, { replace: true }) }
      )
  }, [opening, resource, href])
}

type ListRows = {
  data: { id: unknown }[]
  permissions: Record<string, unknown>
  related: Record<string, { id: unknown }[]>
  meta: { estimatedTotal?: number } & Record<string, unknown>
}

/** Fetches a record as a row of its list (GET /resources/:resource/:id/row), or null. */
export async function fetchListRow(resource: string, id: string | number) {
  try {
    const response = await axios.get<ListRows>(`/resources/${resource}/${id}/row`, {
      headers: { Accept: 'application/json' },
    })
    return response.data
  } catch {
    return null
  }
}

/** The list's rows with this one first, whatever the sort; later pages never repeat it. */
function pinRow(result: ListRows, row: ListRows, id: string): ListRows {
  const related = { ...result.related }
  for (const [key, rows] of Object.entries(row.related))
    related[key] = [
      ...new Map([...(related[key] ?? []), ...rows].map((entry) => [String(entry.id), entry])).values(),
    ]
  const known = result.data.some((entry) => String(entry.id) === id)
  return {
    ...result,
    data: [...row.data, ...result.data.filter((entry) => String(entry.id) !== id)],
    permissions: { ...result.permissions, ...row.permissions },
    related,
    meta:
      typeof result.meta.estimatedTotal === 'number' && !known
        ? { ...result.meta, estimatedTotal: result.meta.estimatedTotal + 1 }
        : result.meta,
  }
}

/**
 * Returns from a create dialog to the mounted list it was opened from, with the new record
 * pinned first and highlighted (the `created` page prop, read by DataTable): visible at once
 * whatever the list's sort and however many pages it has, without loading the list again. It
 * stays first until the list's query changes. Without its row (the list does not reach it),
 * the list refreshes instead.
 */
export async function closeCreated(
  overlay: RecordOverlay,
  id: string | number,
  row: Promise<ListRows | null>
) {
  clearPrefetched()
  cancelLoading()
  forgetListView()
  const loaded = await row
  if (!loaded || loaded.data.length === 0) return closeRecord({ ...overlay, changed: true })
  const key = String(id)
  clientVisit('replace', {
    url: overlay.list,
    props: (page: OverlayPage) => {
      const { overlay: _closed, childrenData: _children, activity: _activity, ...rest } = page
      const result = rest.result as ListRows | undefined
      return result ? { ...rest, result: pinRow(result, loaded, key), created: key } : rest
    },
    preserveState: true,
    preserveScroll: true,
    onSuccess: () => restoreFocus(overlay.record),
  }, true)
}

/**
 * Pins a record just created at the top of the list on screen, highlighted, as closeCreated
 * does: for the standalone create page, which returns to its list after saving.
 */
export async function pinCreated(resource: string, id: string | number) {
  const loaded = await fetchListRow(resource, id)
  if (!loaded || loaded.data.length === 0) return
  const key = String(id)
  clientVisit('replace', {
    props: (page: OverlayPage) => {
      const result = page.result as ListRows | undefined
      return result ? { ...page, result: pinRow(result, loaded, key), created: key } : page
    },
    preserveState: true,
    preserveScroll: true,
  }, true)
}

/** Closes a record dialog opened by openRecord and returns to its list, refreshed if changed. */
export function closeRecord(overlay: RecordOverlay) {
  // A view still loading for this dialog is not wanted any more.
  cancelLoading()
  setShell(null)
  // The list is mounted; a later direct visit of a record must not return to this view.
  forgetListView()
  if (overlay.changed) {
    clearPrefetched()
    // Replace the record's history entry, so Back does not reopen a record that changed.
    // The list stays mounted and its rows refresh in place; the reset header restarts the
    // list's loaded pages from the first page, as the refreshed rows do.
    router.visit(overlay.list, {
      replace: true,
      preserveState: true,
      preserveScroll: true,
      // Closing a dialog never shows the top progress bar (owner decision 29).
      showProgress: false,
      headers: { 'X-Inertia-Reset': 'result' },
      onSuccess: () => restoreFocus(overlay.record),
    })
    return
  }
  clientVisit('replace', {
    url: overlay.list,
    props: (current: OverlayPage) => {
      const { overlay: _closed, childrenData: _children, activity: _activity, ...rest } = current
      return rest
    },
    preserveState: true,
    preserveScroll: true,
    onSuccess: () => restoreFocus(overlay.record),
  }, true)
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
  dismissRef,
  children,
}: {
  title: string
  description: string
  backHref: string
  presentation?: ResourcePresentation
  mode?: 'view' | 'edit'
  /** Replaces the default return visit, for dialogs opened over a mounted list. */
  onClose?: () => void
  /**
   * Receives a function that closes the dialog with its closing animation and then calls
   * onClose, without asking about unsaved changes (for a form that was just saved).
   */
  dismissRef?: { current: (() => void) | null }
  children: ReactNode
}) {
  const { t, dir } = useMessages()
  const [open, setOpen] = useState(true)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(closeTimer.current), [])
  // The footer appears once the record body registers actions for it; other bodies keep
  // their own buttons and the dialog shows no empty footer. Bodies register before paint, so
  // the bar stays in place while the loading body gives way to the loaded one.
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  const [footers, setFooters] = useState(0)
  const register = useCallback(() => {
    setFooters((count) => count + 1)
    return () => setFooters((count) => count - 1)
  }, [])
  const footer = useMemo(() => ({ slot, register }), [slot, register])
  const close = () => {
    setOpen(false)
    closeTimer.current = setTimeout(
      () => {
        if (onClose) return onClose()
        // Return to the list view the record was opened from: same query and scroll.
        const saved = listReturn(backHref)
        forgetListView()
        router.visit(saved?.href ?? backHref, {
          // Closing a dialog never shows the top progress bar (owner decision 29).
          showProgress: false,
          onSuccess: () => {
            if (saved) scrollPageTo(saved.scroll)
            // A direct route has no mounted DialogTrigger to restore focus to.
            restoreFocus(saved?.record)
          },
        })
      },
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 160
    )
  }
  if (dismissRef) dismissRef.current = close
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
        if (!open) close()
      }}
    >
      {/* The long dialog pattern: fixed header and footer, only the body scrolls. */}
      <LongDialogContent
        dir={dir}
        width="5xl"
        // Its body loads after opening (and its related lists after that): the full height
        // from the first frame keeps the dialog still while they arrive.
        height="fill"
        // A record body still on its way (loading, or mounting after the first paint): the
        // dialog itself takes the focus instead of the footer's «إلغاء» or «إغلاق», and the
        // body moves it to its first control once there (AfterFirstPaint).
        onOpenAutoFocus={(event) => {
          const content = event.currentTarget as HTMLElement
          if (!content.querySelector('[data-record-pending]')) return
          event.preventDefault()
          content.focus({ preventScroll: true })
        }}
        title={title}
        description={description}
        footer={
          footers > 0 ? (
            <div ref={setSlot} data-slot="record-footer" className={footerClass} />
          ) : undefined
        }
      >
        <RecordFooterContext.Provider value={footer}>{children}</RecordFooterContext.Provider>
      </LongDialogContent>
    </Dialog>
  )
}
