import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const css = await readFile(new URL('../registry/theme.css', import.meta.url), 'utf8')
const reference = await readFile(
  new URL('../../../apps/reference/inertia/css/adula.css', import.meta.url),
  'utf8'
)

function tokens(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const body = source.match(new RegExp(`(?:^|\\n)${escaped} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? ''
  return Object.fromEntries(
    [...body.matchAll(/--([a-z-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()])
  )
}

// OKLCH → sRGB (CSS Color 4), then WCAG relative luminance.
function luminance(value) {
  const match = value.match(/^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/)
  assert.ok(match, `expected an opaque oklch() color, got ${value}`)
  const [l, c, h] = match.slice(1).map(Number)
  const a = c * Math.cos((h * Math.PI) / 180)
  const b = c * Math.sin((h * Math.PI) / 180)
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  const rgb = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ].map((channel) => Math.min(1, Math.max(0, channel)))
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
}
function contrast(foreground, background) {
  const [high, low] = [luminance(foreground), luminance(background)].sort((x, y) => y - x)
  return (high + 0.05) / (low + 0.05)
}

// Text tokens and the surfaces they are drawn on.
const PAIRS = [
  ['foreground', 'background'],
  ['foreground', 'card'],
  ['foreground', 'secondary'],
  ['popover-foreground', 'popover'],
  ['muted-foreground', 'background'],
  ['muted-foreground', 'card'],
  ['primary-foreground', 'primary'],
  ['destructive-foreground', 'destructive'],
  ['destructive', 'background'],
  ['primary', 'accent'],
  ['success', 'background'],
  ['success', 'card'],
  ['warning', 'background'],
  ['warning', 'card'],
  ['info', 'background'],
  ['info', 'card'],
]

for (const theme of [':root', '.dark'])
  test(`${theme} text tokens reach 4.5:1 on their surfaces (#155)`, () => {
    const values = { ...tokens(css, ':root'), ...tokens(css, theme) }
    for (const [text, surface] of PAIRS) {
      const ratio = contrast(values[text], values[surface])
      assert.ok(ratio >= 4.5, `${theme} --${text} on --${surface}: ${ratio.toFixed(2)}:1`)
    }
  })

test('the dark theme overrides every color token of the light theme', () => {
  const light = tokens(css, ':root')
  const dark = tokens(css, '.dark')
  const colors = Object.keys(light).filter((name) => name !== 'radius')
  assert.deepEqual(
    colors.filter((name) => !(name in dark)),
    []
  )
  assert.match(css, /@custom-variant dark \(&:where\(\.dark, \.dark \*\)\);/)
})

test('the reference stylesheet carries the same theme tokens as the registry', () => {
  // adula:ui writes inertia/css/adula.css only once; upgrades merge new tokens by hand,
  // so the reference copy must not drift from the registry theme.
  for (const selector of ['@theme inline', ':root', '.dark'])
    assert.deepEqual(tokens(reference, selector), tokens(css, selector), selector)
  assert.match(reference, /@custom-variant dark \(&:where\(\.dark, \.dark \*\)\);/)
})
