import type { Actor, OverviewState } from 'adula'
import { adula } from '#services/adula'
import { overviewLayout, type OverviewLayoutValue } from '#services/overview_layout'

export { overviewLayout, type OverviewLayoutValue }

/**
 * Widgets the starter draws itself, from data every signed-in user already has. Labels are
 * Arabic interface text; the page translates them like its other text.
 */
export const OVERVIEW_BUILTINS = [
  { id: 'core.welcome', label: 'حسابي والإعدادات' },
  { id: 'core.tasks', label: 'مهامي المفتوحة' },
  { id: 'core.notifications', label: 'الإشعارات غير المقروءة' },
  { id: 'core.modules', label: 'وحدات العمل' },
] as const

/** The signed-in user's overview, arranged by their saved layout. */
export async function overviewFor(actor: Actor): Promise<OverviewState> {
  const runtime = adula()
  const saved = await runtime.preferences.get<OverviewLayoutValue>(actor.id, overviewLayout.key)
  return runtime.dashboards.overview(actor, saved, OVERVIEW_BUILTINS)
}
