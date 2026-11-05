/**
 * The light, dark or device theme (ADR 049, #155). The server renders the class on <html>
 * before the first paint; these helpers keep it in step after a change or a navigation.
 */
export type Theme = 'light' | 'dark' | 'system'

const QUERY = '(prefers-color-scheme: dark)'
let watching: MediaQueryList | null = null

function onDeviceChange(event: MediaQueryListEvent) {
  if (document.documentElement.dataset.theme === 'system')
    document.documentElement.classList.toggle('dark', event.matches)
}

export function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark' || value === 'system'
}

/** Whether the page is drawn dark right now (the theme, or the device for 'system'). */
export function resolvedTheme(theme: Theme): 'light' | 'dark' {
  if (theme !== 'system') return theme
  return typeof window !== 'undefined' && window.matchMedia?.(QUERY).matches ? 'dark' : 'light'
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement
  root.dataset.theme = theme
  root.classList.toggle('dark', resolvedTheme(theme) === 'dark')
  if (theme === 'system' && !watching && window.matchMedia) {
    watching = window.matchMedia(QUERY)
    watching.addEventListener('change', onDeviceChange)
  }
}
