import {
  Blocks,
  Boxes,
  Briefcase,
  FileStack,
  FolderKanban,
  Layers,
  Package,
  type LucideIcon,
} from 'lucide-react'

/**
 * Icons for module groups in the collapsed sidebar (ADR 049). Project-owned: add an entry
 * per module name to give it a meaningful icon, for example `sales: ShoppingCart`.
 * Modules have no icon in the framework's API on purpose; the name and the tooltip carry
 * the meaning, and this map only gives each group a recognisable shape.
 */
export const MODULE_ICONS: Record<string, LucideIcon> = {}

/** Neutral shapes for modules without an entry; one module always gets the same one. */
const FALLBACK_ICONS: readonly LucideIcon[] = [
  Boxes,
  Layers,
  FolderKanban,
  Package,
  Briefcase,
  FileStack,
  Blocks,
]

export function moduleIcon(
  module: string,
  icons: Record<string, LucideIcon> = MODULE_ICONS,
  fallbacks: readonly LucideIcon[] = FALLBACK_ICONS
): LucideIcon {
  const chosen = Object.hasOwn(icons, module) ? icons[module] : undefined
  if (chosen) return chosen
  let hash = 0
  for (const character of module) hash = (hash * 31 + character.codePointAt(0)!) >>> 0
  return fallbacks[hash % fallbacks.length]
}
