import {
  Archive,
  Blocks,
  Boxes,
  Briefcase,
  Building2,
  ClipboardCheck,
  FileStack,
  FolderKanban,
  Layers,
  Library,
  Package,
  Shapes,
  type LucideIcon,
} from 'lucide-react'

/**
 * Icons for module groups in the collapsed sidebar (ADR 049). Project-owned: add an entry
 * per module name to give it a meaningful icon, for example `sales: ShoppingCart`.
 * Modules have no icon in the framework's API on purpose; the name and the tooltip carry
 * the meaning, and this map only gives each group a recognisable shape.
 */
export const MODULE_ICONS: Record<string, LucideIcon> = {}

/** Neutral shapes for modules without an entry. */
const FALLBACK_ICONS: readonly LucideIcon[] = [
  Boxes,
  Layers,
  FolderKanban,
  Package,
  Briefcase,
  FileStack,
  Blocks,
  Archive,
  Building2,
  ClipboardCheck,
  Library,
  Shapes,
]

function hash(text: string) {
  let value = 0
  for (const character of text) value = (value * 31 + character.codePointAt(0)!) >>> 0
  return value
}

/**
 * One icon per module, distinct whenever the shapes allow it. A module with an entry in
 * `icons` uses it; the others start from a shape derived from their name, so a module
 * keeps its shape between visits, and move to the next unused shape when another module
 * shown beside it already took that one. Only when every shape is taken do two modules
 * share one.
 */
export function moduleIcons(
  modules: readonly string[],
  icons: Record<string, LucideIcon> = MODULE_ICONS,
  fallbacks: readonly LucideIcon[] = FALLBACK_ICONS
): Map<string, LucideIcon> {
  const assigned = new Map<string, LucideIcon>()
  const used = new Set<LucideIcon>()
  for (const module of modules) {
    const chosen = Object.hasOwn(icons, module) ? icons[module] : undefined
    if (chosen) {
      assigned.set(module, chosen)
      used.add(chosen)
    }
  }
  // Sorted, so the assignment does not depend on the user's menu order.
  for (const module of [...new Set(modules)].sort()) {
    if (assigned.has(module)) continue
    const start = hash(module) % fallbacks.length
    let icon = fallbacks[start]
    for (let step = 0; step < fallbacks.length; step++) {
      const candidate = fallbacks[(start + step) % fallbacks.length]
      if (!used.has(candidate)) {
        icon = candidate
        break
      }
    }
    assigned.set(module, icon)
    used.add(icon)
  }
  return assigned
}
