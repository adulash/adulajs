// ADR 055: AdulaJS UI is shadcn/ui on Radix. The registry and the shell that create-adulajs
// copies compose the stored shadcn components; they do not recreate controls, tables, sidebars or
// scrollbars with native HTML and CSS.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const repository = fileURLToPath(new URL('../../../', import.meta.url))
const registry = join(repository, 'packages/ui/registry/ui')
const inertia = join(repository, 'apps/reference/inertia')

const NATIVE = ['button', 'input', 'select', 'textarea', 'table', 'aside']

/**
 * The documented exceptions, by file and element, with their reason (ADR 055). The stored shadcn
 * files are allowed as a whole: rendering the element is what they are for.
 */
const EXCEPTIONS = {
  // Only a native file input opens the browser's file chooser; it stays hidden behind a Button.
  'packages/ui/registry/ui/file-input.tsx': { input: 1 },
  'packages/ui/registry/ui/resource-field.tsx': { input: 2 },
  // The sign-out menu item submits its form without script: shadcn's DropdownMenuItem asChild
  // gives a submit button the menu item's look, role and keyboard handling.
  'apps/reference/inertia/components/account-menu.tsx': { button: 1 },
  // The starter print template is HTML text for the printed document (ADR 048), not interface.
  'apps/reference/inertia/pages/admin/print_templates/index.tsx': { table: 2 },
}

/**
 * Every JSX opening tag of a refused native element in `code`, with its line. A hidden input is
 * form data, not a control.
 */
export function nativeElements(code) {
  const found = []
  const pattern = new RegExp(`<(${NATIVE.join('|')})(?=[\\s>/]|$)`, 'gm')
  for (const match of code.matchAll(pattern)) {
    if (match[1] === 'input' && /^<input\s+type="hidden"/.test(code.slice(match.index))) continue
    found.push({ element: match[1], line: code.slice(0, match.index).split('\n').length })
  }
  return found
}

/** Native scrollbar styling: scrollbar-width, scrollbar-color, scrollbar-gutter or ::-webkit-scrollbar. */
export function scrollbarStyling(code) {
  return [...code.matchAll(/scrollbar-(?:width|color|gutter)|::-webkit-scrollbar/g)].map(
    (match) => code.slice(0, match.index).split('\n').length
  )
}

/** The violations in one file: native elements beyond its exceptions, and scrollbar styling. */
export function violations(path, code, upstream = new Set()) {
  if (upstream.has(path)) return []
  const allowed = { ...(EXCEPTIONS[path] ?? {}) }
  const problems = []
  for (const { element, line } of nativeElements(code)) {
    if (allowed[element] > 0) allowed[element]--
    else problems.push(`${path}:${line} native <${element}>; compose the shadcn component`)
  }
  for (const line of scrollbarStyling(code))
    problems.push(`${path}:${line} styles a native scrollbar; use the shadcn Scroll Area`)
  return problems
}

async function files(directory, skip = () => false) {
  const found = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (skip(path)) continue
    if (entry.isDirectory()) found.push(...(await files(path, skip)))
    else if (/\.(tsx|ts|css)$/.test(entry.name)) found.push(path)
  }
  return found
}

const upstream = new Set(
  JSON.parse(await readFile(join(repository, 'packages/ui/UPSTREAM.json'), 'utf8')).map(
    (entry) => `packages/ui/${entry.path}`
  )
)
const name = (path) => relative(repository, path).replaceAll('\\', '/')

test('the registry and the shell use shadcn components, not native controls or scrollbars', async () => {
  const scanned = [
    ...(await files(registry)),
    join(repository, 'packages/ui/registry/theme.css'),
    // Everything create-adulajs copies into a new system's interface; components/ui is the
    // registry copy, checked above.
    ...(await files(inertia, (path) => name(path) === 'apps/reference/inertia/components/ui')),
  ]
  assert.ok(scanned.some((path) => name(path) === 'apps/reference/inertia/layouts/workspace.tsx'))
  const problems = []
  for (const path of scanned)
    problems.push(...violations(name(path), await readFile(path, 'utf8'), upstream))
  assert.deepEqual(problems, [])
  // Each exception is still needed: a fixed one is removed from the list.
  for (const [path, elements] of Object.entries(EXCEPTIONS)) {
    const counts = Object.groupBy(
      nativeElements(await readFile(join(repository, path), 'utf8')),
      (entry) => entry.element
    )
    for (const [element, count] of Object.entries(elements))
      assert.equal(counts[element]?.length ?? 0, count, `${path}: update the ${element} exception`)
  }
})

test('the check refuses a native control or a styled scrollbar added to the shell', () => {
  const shell = 'apps/reference/inertia/layouts/workspace.tsx'
  assert.deepEqual(violations(shell, '<Button type="button">ok</Button>\n<Table />'), [])
  assert.deepEqual(violations(shell, 'const a = 1\n  <button type="button" onClick={go}>'), [
    `${shell}:2 native <button>; compose the shadcn component`,
  ])
  assert.equal(violations(shell, '<aside id="workspace-sidebar">').length, 1)
  assert.equal(violations(shell, '<table\n  className="w-full">').length, 1)
  assert.equal(violations(shell, 'className="overflow-y-auto [scrollbar-width:thin]"').length, 1)
  assert.deepEqual(violations(shell, '<input type="hidden" name="_csrf" value={token} />'), [])
  assert.equal(violations(shell, '<input type="text" />').length, 1)
  // The exceptions are per file and per count.
  assert.deepEqual(violations('packages/ui/registry/ui/file-input.tsx', '<input hidden />'), [])
  assert.equal(violations('packages/ui/registry/ui/file-input.tsx', '<input />\n<input />').length, 1)
  // A stored shadcn file renders its element.
  assert.deepEqual(violations('packages/ui/registry/ui/table.tsx', '<table />', upstream), [])
})
