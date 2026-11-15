import { AdulaError, UserPreferences, definePreference, type PreferenceDefinition } from 'adula'
import env from '#start/env'
import { overviewLayout } from '#services/overview_layout'
// adula:imports

function oneOf<T extends string | null>(values: readonly T[]) {
  return (value: unknown): T => {
    if (values.includes(value as T)) return value as T
    throw new AdulaError(422, 'E_PREFERENCE_VALUE', 'قيمة التفضيل غير صالحة')
  }
}

const NAV_ID = /^[a-z][a-z0-9_.-]{0,63}$/
const THEMES = ['light', 'dark', 'system'] as const
type Theme = (typeof THEMES)[number]
// Test runs only (NODE_ENV=test): ADULA_TEST_THEME=dark runs the browser suites in the dark
// theme (pnpm test:browser:dark). Never read in development or production.
const testTheme =
  env.get('NODE_ENV') === 'test'
    ? THEMES.find((theme) => theme === process.env.ADULA_TEST_THEME)
    : undefined

/** Workspace shell preferences (ADR 049). */
export const SHELL_PREFERENCES: PreferenceDefinition[] = [
  // Full panel, icons only, or hidden (#153).
  definePreference<'expanded' | 'icons' | 'hidden'>({
    key: 'shell.sidebar',
    default: 'expanded',
    validate: oneOf(['expanded', 'icons', 'hidden']),
  }),
  // What collapsing the sidebar does: shrink it to icons or hide it (owner decision 20).
  definePreference<'icons' | 'hidden'>({
    key: 'shell.sidebarCollapse',
    default: 'icons',
    validate: oneOf(['icons', 'hidden']),
  }),
  // The user's own layout when the system allows a choice; null follows the system (#154).
  definePreference<'sidebar' | 'top' | null>({
    key: 'shell.layout',
    default: null,
    validate: oneOf<'sidebar' | 'top' | null>(['sidebar', 'top', null]),
  }),
  definePreference<Theme>({
    key: 'shell.theme',
    default: testTheme ?? 'light',
    validate: oneOf(THEMES),
  }),
  // Navigation entry ids in the user's order (#157); ids the user cannot see are ignored.
  definePreference<string[]>({
    key: 'shell.navOrder',
    default: [],
    validate(value) {
      if (
        !Array.isArray(value) ||
        value.length > 60 ||
        value.some((id) => typeof id !== 'string' || !NAV_ID.test(id))
      )
        throw new AdulaError(422, 'E_PREFERENCE_VALUE', 'ترتيب القائمة غير صالح')
      return [...new Set(value as string[])]
    },
  }),
]

/** Per-user interface preferences, stored in settings with scope 'user'. */
export const preferences: PreferenceDefinition[] = [
  ...SHELL_PREFERENCES,
  // The user's overview arrangement (#159, ADR 050).
  overviewLayout /* adula:preferences */,
]
// Checked once at boot: a bad definition stops the application before any request.
UserPreferences.validate(preferences)
