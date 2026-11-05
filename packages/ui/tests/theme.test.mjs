import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const css = await readFile(new URL('../registry/theme.css', import.meta.url), 'utf8')
const block = (selector) => css.match(new RegExp(`${selector} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? ''

test('inline theme values are variables that the project brand.css can override', () => {
  // `@theme inline` copies literals into utilities, where brand.css cannot reach them (issue #23).
  const inline = block('@theme inline')
  assert.ok(inline.includes('--color-ring: var(--ring);'))
  assert.doesNotMatch(inline, /#[\da-f]{3,8}\b/i)
  assert.match(inline, /--font-sans: var\(--brand-font, 'IBM Plex Sans Arabic'\), sans-serif;/)
  const defaults = block(':root')
  for (const token of new Set([...inline.matchAll(/var\(--([a-z-]+)\)/g)].map((m) => m[1])))
    assert.match(defaults, new RegExp(`--${token}: `), `missing default for --${token}`)
})

test('registry components compose the registry Select instead of native lists', async () => {
  // A native list opens in OS styling, ignores the theme and RTL layout (issue #39).
  const { readdir } = await import('node:fs/promises')
  const dir = new URL('../registry/ui/', import.meta.url)
  for (const name of await readdir(dir))
    if (name.endsWith('.tsx'))
      assert.doesNotMatch(await readFile(new URL(name, dir), 'utf8'), /<select[\s>]/, name)
})

test('registry buttons take their height from the button size scale, not className', async () => {
  // Button sizes (xs, sm, default, lg, icon-*) keep controls aligned; a height in className
  // drifts from that scale. Existing overrides are listed so that no new one is added.
  const { readdir } = await import('node:fs/promises')
  const dir = new URL('../registry/ui/', import.meta.url)
  const found = {}
  for (const name of await readdir(dir)) {
    if (!name.endsWith('.tsx')) continue
    const source = await readFile(new URL(name, dir), 'utf8')
    const overrides = [...source.matchAll(/<Button\b[^>]*?className="([^"]*)"/gs)].filter(
      ([, classes]) => /(?:^|\s)(?:min-|max-)?(?:h|size)-/.test(classes)
    )
    if (overrides.length) found[name] = overrides.length
  }
  // No exceptions remain: every registry button uses the size scale.
  assert.deepEqual(found, {})
})

test('file fields compose FileInput instead of the native control and its English text', async () => {
  // The browser's own file control shows "Choose File / No file chosen" in its own language
  // and styling. Only FileInput may render a file input, and every other file input in the
  // registry or the reference application must be hidden behind a translated control.
  const { readdir } = await import('node:fs/promises')
  const { sep } = await import('node:path')
  const roots = [
    new URL('../registry/ui/', import.meta.url),
    new URL('../../../apps/reference/inertia/', import.meta.url),
  ]
  const native = []
  for (const root of roots)
    for (const name of await readdir(root, { recursive: true })) {
      if (!name.endsWith('.tsx') || name.split(sep).join('/').startsWith('components/ui/')) continue
      const source = await readFile(new URL(name.split(sep).join('/'), root), 'utf8')
      for (const match of source.matchAll(/<(?:input|Input)\b[^>]*?type="file"[^>]*>/gs))
        if (name !== 'file-input.tsx' && !/className="sr-only"|\bhidden\b/.test(match[0]))
          native.push(name)
    }
  assert.deepEqual(native, [])
})
