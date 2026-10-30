import type { Knex } from 'knex'
import { Settings } from '../services/settings.js'
import { AdulaError } from '../admin/errors.js'

export type CalendarSystem = 'gregory' | 'islamic-umalqura'
export type CalendarPreference = CalendarSystem | 'both'
/** Latin (0-9) or Arabic-Indic (٠-٩) digits in printed documents. */
export type DigitsPreference = 'latn' | 'arab'
export type UiPreferences = {
  calendar: CalendarPreference
  confirmDialogClose: boolean
  pageTransitions: boolean
  /** Optional for values stored before it existed; absent means 'latn'. */
  digits?: DigitsPreference
}
export const UI_PREFERENCES_KEY = 'ui.preferences'
export const DEFAULT_UI_PREFERENCES: UiPreferences = {
  calendar: 'gregory',
  confirmDialogClose: true,
  pageTransitions: true,
}

const PREFERENCE_KEYS = ['calendar', 'confirmDialogClose', 'pageTransitions', 'digits']

export function validateUiPreferences(value: unknown): UiPreferences {
  const input = value as UiPreferences | undefined
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    !['gregory', 'islamic-umalqura', 'both'].includes(input.calendar) ||
    typeof input.confirmDialogClose !== 'boolean' ||
    typeof input.pageTransitions !== 'boolean' ||
    (input.digits !== undefined && !['latn', 'arab'].includes(input.digits)) ||
    Object.keys(input).some((key) => !PREFERENCE_KEYS.includes(key))
  )
    throw new AdulaError(
      422,
      'E_UI_PREFERENCES',
      'اختر تقويمًا صالحًا وحدد خيارات تأكيد الإغلاق والانتقالات'
    )
  return {
    calendar: input.calendar,
    confirmDialogClose: input.confirmDialogClose,
    pageTransitions: input.pageTransitions,
    ...(input.digits === undefined ? {} : { digits: input.digits }),
  }
}

export async function uiPreferences(db: Knex): Promise<UiPreferences> {
  const value = await new Settings(db).get(UI_PREFERENCES_KEY)
  if (value === undefined) return { ...DEFAULT_UI_PREFERENCES }
  return validateUiPreferences(value)
}
