import { AdulaError, definePreference } from 'adula'

// Kept apart from services/overview: start/preferences imports this module, and
// services/adula imports start/preferences, so it must not import services/adula.

export type OverviewLayoutValue = { order: string[]; hidden: string[] }

const WIDGET_ID = /^[a-zA-Z][a-zA-Z0-9_.-]{0,99}$/
const MAX_WIDGETS = 100

function invalid(): never {
  throw new AdulaError(422, 'E_PREFERENCE_VALUE', 'ترتيب النظرة العامة غير صالح')
}

function ids(value: unknown) {
  if (
    !Array.isArray(value) ||
    value.length > MAX_WIDGETS ||
    value.some((id) => typeof id !== 'string' || !WIDGET_ID.test(id))
  )
    invalid()
  return [...new Set(value as string[])]
}

/**
 * The user's overview arrangement (ADR 050), one per-user preference (ADR 049). Only its shape
 * is checked here; which ids the user may see is decided on every read by Dashboards.overview,
 * so a stored id the user may not see never shows a widget or its data.
 */
export const overviewLayout = definePreference<OverviewLayoutValue>({
  key: 'overview.layout',
  default: { order: [], hidden: [] },
  validate(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
    const entries = Object.keys(value)
    if (entries.some((key) => key !== 'order' && key !== 'hidden')) invalid()
    const input = value as Record<string, unknown>
    return { order: ids(input.order ?? []), hidden: ids(input.hidden ?? []) }
  },
})
