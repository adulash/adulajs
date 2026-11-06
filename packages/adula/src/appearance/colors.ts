import { AdulaError } from '../admin/errors.js'

/**
 * Primary colour checks for the appearance settings (ADR 053). An administrator picks one
 * colour; the light theme uses it as is and the dark theme uses a lighter tint of it. Both
 * must reach WCAG AA (4.5:1) for normal text: the colour as text on the page background
 * (links, the active navigation item) and the foreground on the colour (primary buttons).
 * Only `#rrggbb` values are accepted, so no CSS other than a colour ever reaches a page.
 */
export const WCAG_AA = 4.5
/** The shipped theme backgrounds (`--background`): white and oklch(0.145 0 0). */
export const LIGHT_BACKGROUND = '#ffffff'
export const DARK_BACKGROUND = '#0a0a0a'
const LIGHT_TEXT = '#ffffff'
const DARK_TEXT = '#0a0a0a'

export type ThemeColors = { '--primary': string; '--primary-foreground': string }
export type DerivedTheme = { light: ThemeColors; dark: ThemeColors }

const HEX = /^#[0-9a-f]{6}$/

/** `#RRGGBB` or `#rrggbb` as lowercase `#rrggbb`; anything else is null. */
export function normalizeColor(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const color = value.trim().toLowerCase()
  return HEX.test(color) ? color : null
}

function channels(hex: string) {
  return [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16))
}

/** WCAG 2.x relative luminance of an sRGB colour. */
export function luminance(hex: string) {
  const [r, g, b] = channels(hex).map((value) => {
    const c = value / 255
    return c <= 0.040_45 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** The WCAG contrast ratio of two colours, from 1 to 21. */
export function contrast(first: string, second: string) {
  const [high, low] = [luminance(first), luminance(second)].sort((a, b) => b - a)
  return (high + 0.05) / (low + 0.05)
}

/** Rounds down to two decimals, so a ratio shown as 4.5 really reaches 4.5. */
export const ratio = (value: number) => Math.floor(value * 100) / 100

function mix(hex: string, toward: string, amount: number) {
  const from = channels(hex)
  const to = channels(toward)
  return `#${from
    .map((value, index) =>
      Math.round(value + (to[index] - value) * amount)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`
}

/** White or near-black, whichever reads better on the colour. */
function foreground(primary: string) {
  return contrast(primary, LIGHT_TEXT) >= contrast(primary, DARK_TEXT) ? LIGHT_TEXT : DARK_TEXT
}

export type ContrastCheck =
  { ok: true; theme: DerivedTheme } | { ok: false; reason: string; light: number; dark: number }

/**
 * Derives both themes from one colour and checks them. The dark tint is the colour mixed
 * with white in 5% steps until it reaches AA on the dark background.
 */
export function checkPrimaryColor(value: unknown): ContrastCheck {
  const color = normalizeColor(value)
  if (!color)
    return { ok: false, reason: 'اكتب اللون بالصيغة ‎#RRGGBB‎، مثل ‎#006c35‎', light: 0, dark: 0 }
  const lightText = contrast(color, LIGHT_BACKGROUND)
  const lightForeground = foreground(color)
  const onButton = contrast(color, lightForeground)
  let dark = color
  for (let step = 1; contrast(dark, DARK_BACKGROUND) < WCAG_AA && step <= 20; step++)
    dark = mix(color, LIGHT_TEXT, step * 0.05)
  const darkText = contrast(dark, DARK_BACKGROUND)
  const darkForeground = foreground(dark)
  const darkButton = contrast(dark, darkForeground)
  if (lightText < WCAG_AA)
    return {
      ok: false,
      reason: `اللون فاتح على الخلفية الفاتحة: التباين ${ratio(lightText)}:1 والحد الأدنى ${WCAG_AA}:1. اختر درجة أغمق.`,
      light: ratio(lightText),
      dark: ratio(darkText),
    }
  if (onButton < WCAG_AA || darkText < WCAG_AA || darkButton < WCAG_AA)
    return {
      ok: false,
      reason: `لا يبلغ اللون تباين ${WCAG_AA}:1 مع نص الأزرار في الوضعين الفاتح والداكن. اختر لونًا آخر.`,
      light: ratio(Math.min(lightText, onButton)),
      dark: ratio(Math.min(darkText, darkButton)),
    }
  return {
    ok: true,
    theme: {
      light: { '--primary': color, '--primary-foreground': lightForeground },
      dark: { '--primary': dark, '--primary-foreground': darkForeground },
    },
  }
}

/** The derived themes of a colour, or a 422 with the Arabic reason. */
export function derivePrimaryTheme(value: unknown): DerivedTheme {
  const check = checkPrimaryColor(value)
  if (!check.ok) throw new AdulaError(422, 'E_APPEARANCE_CONTRAST', check.reason)
  return check.theme
}
