/**
 * The resolved appearance on the page (ADR 053): the `appearance` shared prop sets the primary
 * colour tokens for the light and dark themes and names the document title. The values were
 * validated on the server (`#rrggbb` only), and are checked again here before use.
 */
export type ThemeColors = { '--primary': string; '--primary-foreground': string }
export type AppearanceTheme = { light: ThemeColors; dark: ThemeColors }
export type SharedAppearance = {
  company: string
  logoUrl: string | null
  login: { title: string | null; description: string | null }
  guestHome: { title: string | null; description: string | null }
  banner: string | null
  occasion: { name: string; endsOn: string } | null
  theme: AppearanceTheme | null
}

const HEX = /^#[0-9a-f]{6}$/
const STYLE_ID = 'adula-appearance'
let company: string | null = null

/** The company name for the document title, once a page has shared it. */
export const appearanceCompany = () => company

function block(selector: string, colors: ThemeColors) {
  const primary = colors['--primary']
  const foreground = colors['--primary-foreground']
  if (!HEX.test(primary) || !HEX.test(foreground)) return ''
  return `${selector}{--primary:${primary};--primary-foreground:${foreground}}`
}

/** Writes (or removes) the one style element that overrides the primary tokens. */
export function applyAppearance(appearance: SharedAppearance | undefined) {
  if (typeof document === 'undefined') return
  company = appearance?.company ?? null
  const theme = appearance?.theme
  // Doubled selectors outrank the theme's own `:root` and `.dark` whatever order the style
  // elements end up in (Vite injects stylesheets after this one in development).
  const css = theme ? block(':root:root', theme.light) + block(':root:root.dark', theme.dark) : ''
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (!css) {
    style?.remove()
    return
  }
  if (!style) {
    style = document.createElement('style')
    style.id = STYLE_ID
    document.head.append(style)
  }
  if (style.textContent !== css) style.textContent = css
}

/*
 * The same contrast rules as the server (packages/adula/src/appearance/colors.ts), for the
 * live preview only: the server decides whether a colour is saved.
 */
const WCAG_AA = 4.5
const LIGHT_BACKGROUND = '#ffffff'
const DARK_BACKGROUND = '#0a0a0a'

const channels = (hex: string) =>
  [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16))

function luminance(hex: string) {
  const [r, g, b] = channels(hex).map((value) => {
    const c = value / 255
    return c <= 0.040_45 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(first: string, second: string) {
  const [high, low] = [luminance(first), luminance(second)].sort((a, b) => b - a)
  return (high + 0.05) / (low + 0.05)
}

const ratio = (value: number) => Math.floor(value * 100) / 100

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

const foreground = (primary: string) =>
  contrast(primary, '#ffffff') >= contrast(primary, '#0a0a0a') ? '#ffffff' : '#0a0a0a'

export type ColorCheck =
  | { ok: true; theme: AppearanceTheme; light: number; dark: number }
  | { ok: false; reason: string; light: number; dark: number }

export function checkColor(value: string): ColorCheck {
  const color = value.trim().toLowerCase()
  if (!HEX.test(color))
    return { ok: false, reason: 'اكتب اللون بالصيغة ‎#RRGGBB‎', light: 0, dark: 0 }
  const lightText = contrast(color, LIGHT_BACKGROUND)
  const lightForeground = foreground(color)
  const onButton = contrast(color, lightForeground)
  let dark = color
  for (let step = 1; contrast(dark, DARK_BACKGROUND) < WCAG_AA && step <= 20; step++)
    dark = mix(color, '#ffffff', step * 0.05)
  const darkForeground = foreground(dark)
  const darkText = contrast(dark, DARK_BACKGROUND)
  const darkButton = contrast(dark, darkForeground)
  const light = ratio(Math.min(lightText, onButton))
  const darkRatio = ratio(Math.min(darkText, darkButton))
  if (lightText < WCAG_AA)
    return {
      ok: false,
      reason: `اللون فاتح على الخلفية الفاتحة: التباين ${ratio(lightText)}:1 والحد الأدنى ${WCAG_AA}:1. اختر درجة أغمق.`,
      light,
      dark: darkRatio,
    }
  if (onButton < WCAG_AA || darkText < WCAG_AA || darkButton < WCAG_AA)
    return {
      ok: false,
      reason: `لا يبلغ اللون تباين ${WCAG_AA}:1 مع نص الأزرار في الوضعين الفاتح والداكن. اختر لونًا آخر.`,
      light,
      dark: darkRatio,
    }
  return {
    ok: true,
    light,
    dark: darkRatio,
    theme: {
      light: { '--primary': color, '--primary-foreground': lightForeground },
      dark: { '--primary': dark, '--primary-foreground': darkForeground },
    },
  }
}

/**
 * The light theme's own tokens, read from the `:root` rules of the loaded theme CSS (the
 * shipped tokens and any brand.css override, later rules winning), with `color-scheme: light`.
 * Set on the light preview panel, they keep it light while the page itself is dark, the way
 * the `.dark` class keeps the dark panel dark on a light page. Empty before the page loads.
 */
export function lightThemeTokens(): Record<string, string> {
  if (typeof document === 'undefined') return {}
  const tokens: Record<string, string> = {}
  const visit = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule) {
        if (rule.selectorText.trim() !== ':root') continue
        for (const name of Array.from(rule.style))
          if (name.startsWith('--')) tokens[name] = rule.style.getPropertyValue(name).trim()
      } else if (typeof CSSLayerBlockRule !== 'undefined' && rule instanceof CSSLayerBlockRule) {
        visit(rule.cssRules)
      }
    }
  }
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      visit(sheet.cssRules)
    } catch {
      // A stylesheet from another origin cannot be read; the theme CSS is same-origin.
    }
  }
  return { ...tokens, colorScheme: 'light' }
}

/** The colour tokens as inline styles, for a preview scoped to one element. */
export function previewStyle(colors: ThemeColors | null): Record<string, string> {
  return colors ? { ...colors } : {}
}
