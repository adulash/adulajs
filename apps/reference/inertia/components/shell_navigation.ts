/**
 * One navigation model for every shell layout (ADR 049): the sidebar, its icon rail, the
 * top bar and the small-screen row all render these entries, so they show the same pages
 * and the same permissions. Pure functions only; the shell renders them.
 */

export type ShellLayout = 'sidebar' | 'top'
export type SidebarMode = 'expanded' | 'icons' | 'hidden'

/** A resource link the server permits the user to open (ResourceNavigation). */
export type NavigationLink = {
  name: string
  label: string
  href: string
  module: string
  moduleLabel?: string
}

export type ModuleGroup = {
  /** Stable menu-order id: `module.<name>`. */
  id: string
  module: string
  label: string
  links: NavigationLink[]
}

export function isSidebarMode(value: unknown): value is SidebarMode {
  return value === 'expanded' || value === 'icons' || value === 'hidden'
}

/**
 * The layout the user sees: their own choice when the system allows one, otherwise the
 * system's (the sidebar unless an administrator chose the top bar).
 */
export function effectiveLayout(
  system: { layout?: ShellLayout; layoutUserChoice?: boolean } | undefined,
  own: unknown
): ShellLayout {
  if (system?.layoutUserChoice && (own === 'sidebar' || own === 'top')) return own
  return system?.layout === 'top' ? 'top' : 'sidebar'
}

/** Resource links grouped by module, in the server's order. */
export function groupModules(navigation: NavigationLink[]): ModuleGroup[] {
  const groups = new Map<string, ModuleGroup>()
  for (const entry of navigation) {
    let group = groups.get(entry.module)
    if (!group) {
      group = {
        id: `module.${entry.module}`,
        module: entry.module,
        label: entry.moduleLabel ?? entry.module,
        links: [],
      }
      groups.set(entry.module, group)
    }
    group.links.push(entry)
  }
  return [...groups.values()]
}

/**
 * Entries the user ordered come first, in their order; the others keep the default order.
 * Unknown ids, and ids of entries the user may not see, are ignored: they are never among
 * `entries`, so a stored order can never reveal a page.
 */
export function applyOrder<T extends { id: string }>(entries: T[], order: readonly string[]): T[] {
  const position = new Map<string, number>()
  for (const id of order) if (!position.has(id)) position.set(id, position.size)
  const ordered = entries
    .filter((entry) => position.has(entry.id))
    .sort((a, b) => position.get(a.id)! - position.get(b.id)!)
  return [...ordered, ...entries.filter((entry) => !position.has(entry.id))]
}

/**
 * Replaces the ids of one group in the stored order, keeping other groups' ids, so each
 * list of the arrangement dialog saves independently.
 */
export function replaceGroupOrder(
  order: readonly string[],
  groupIds: readonly string[],
  next: readonly string[]
): string[] {
  const group = new Set(groupIds)
  return [...order.filter((id) => !group.has(id)), ...next]
}

/** Moves one entry up (-1) or down (+1); out-of-range moves leave the list unchanged. */
export function move<T>(list: readonly T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return [...list]
  const next = [...list]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

/** True when the address is the page itself or a page beneath it (the overview is exact). */
export function isActivePath(url: string, href: string) {
  const path = url.split(/[?#]/, 1)[0]
  if (href === '/') return path === '/'
  return path === href || path.startsWith(`${href}/`)
}
