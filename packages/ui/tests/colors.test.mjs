import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

// Hard-coded colors ignore the dark theme (#155): components use the theme tokens instead.
const palette =
  'red|rose|amber|yellow|orange|emerald|green|lime|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|slate|gray|zinc|neutral|stone'
const utilities =
  'bg|text|border|ring|fill|stroke|from|to|via|divide|outline|decoration|placeholder'
const hardCoded = new RegExp(
  `bg-white|text-white|\\b(?:${utilities})-(?:${palette})-[0-9]{2,3}\\b|#[0-9a-fA-F]{3,8}\\b`,
  'g'
)

const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const registryUi = join(packageRoot, 'registry', 'ui')
const referenceInertia = fileURLToPath(new URL('../../../apps/reference/inertia', import.meta.url))

/**
 * Comments are removed first, so issue references such as "(#111)" never count. A line may
 * keep a literal color only with a `colors-allow:` comment stating why (a QR code's quiet zone).
 */
function strip(source) {
  return source
    .split('\n')
    .filter((line) => !line.includes('colors-allow:'))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
}

function offenders(source) {
  return [...strip(source).matchAll(hardCoded)].map((match) => match[0])
}

async function tsxFiles(dir, skip = () => false) {
  const files = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (skip(path)) continue
    if (entry.isDirectory()) files.push(...(await tsxFiles(path, skip)))
    else if (entry.name.endsWith('.tsx')) files.push(path)
  }
  return files
}

async function report(files, base) {
  const found = []
  for (const file of files) {
    const hits = offenders(await readFile(file, 'utf8'))
    if (hits.length) found.push(`${relative(base, file)}: ${[...new Set(hits)].join(', ')}`)
  }
  return found
}

test('the guard sees palette classes and hex colors but not comments or issue numbers', () => {
  assert.deepEqual(offenders('className="bg-red-50 text-white"'), ['bg-red-50', 'text-white'])
  assert.deepEqual(offenders("style={{ color: '#1c1917' }}"), ['#1c1917'])
  assert.deepEqual(offenders('// see #111\n/* bg-white (#109) */ className="bg-card"'), [])
  assert.deepEqual(offenders("const qr = 'bg-white' // colors-allow: QR codes"), [])
  assert.deepEqual(offenders('className="bg-destructive/10 text-destructive"'), [])
})

test('AdulaJS-owned registry components use theme tokens, not hard-coded colors', async () => {
  const upstream = JSON.parse(await readFile(join(packageRoot, 'UPSTREAM.json'), 'utf8'))
  const tracked = new Set(upstream.map((entry) => join(packageRoot, entry.path)))
  const files = (await tsxFiles(registryUi)).filter((file) => !tracked.has(file))
  assert.ok(files.length > 0)
  assert.deepEqual(await report(files, packageRoot), [])
})

test('reference pages and components use theme tokens, not hard-coded colors', async () => {
  // components/ui is generated from the registry and checked above.
  const generated = join(referenceInertia, 'components', 'ui')
  const files = await tsxFiles(referenceInertia, (path) => path === generated)
  assert.ok(files.length > 0)
  assert.deepEqual(await report(files, referenceInertia), [])
})
