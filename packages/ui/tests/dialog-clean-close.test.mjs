import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Clean close is the shared Dialog's behaviour (ADR 016, decision 23 for 2.3.0): a dialog
 * declares state it does not hold in plain controls (`value` or `useDialogValue`) and never
 * computes whether it is dirty. These checks keep hand-made dirty state from coming back.
 */
const root = fileURLToPath(new URL('../../../', import.meta.url))
const sources = [
  join(root, 'packages/ui/registry'),
  // The project-owned screens; components/ui is the generated copy of the registry.
  join(root, 'apps/reference/inertia'),
]

/**
 * Files allowed to report data-dirty, each with the reason. A region may report it only when
 * it owns an external editor whose state the dialog cannot see. None does today.
 */
const allowed = new Map()

async function files(directory) {
  const found = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue
      if (path === join(root, 'apps/reference/inertia/components/ui')) continue
      found.push(...(await files(path)))
    } else if (/\.(tsx?|jsx?)$/.test(entry.name)) found.push(path)
  }
  return found
}

const all = (await Promise.all(sources.map(files))).flat()
const relativeTo = (path) => relative(root, path).replaceAll('\\', '/')

test('no screen or registry component computes its own dirty state for a dialog', async () => {
  const offenders = []
  for (const path of all) {
    const name = relativeTo(path)
    if (name === 'packages/ui/registry/ui/dialog.tsx') continue
    const code = await readFile(path, 'utf8')
    if (/data-dirty/.test(code) && !allowed.has(name)) offenders.push(`${name}: data-dirty`)
    // A snapshot of the opening values compared by hand, the pattern the Dialog replaced.
    if (/JSON\.stringify\([^)]*\)\s*!==|!==\s*JSON\.stringify\(/.test(code))
      offenders.push(`${name}: compares a JSON snapshot by hand`)
  }
  assert.deepEqual(
    offenders,
    [],
    'Declare the state with the Dialog `value` prop or useDialogValue instead (ADR 016).'
  )
})

test('the allowlist names only files that still report data-dirty, each with a reason', async () => {
  for (const [name, reason] of allowed) {
    assert.ok(reason.length > 20, `${name}: give the reason it owns an external editor`)
    const code = await readFile(join(root, name), 'utf8')
    assert.match(code, /data-dirty/, `${name} no longer reports data-dirty: remove it`)
  }
})

test('the shared Dialog decides from declared state and controls, not from data-dirty regions', async () => {
  const dialog = await readFile(join(root, 'packages/ui/registry/ui/dialog.tsx'), 'utf8')
  assert.doesNotMatch(dialog, /querySelectorAll[^\n]*data-dirty/)
  assert.doesNotMatch(dialog, /closest\('\[data-dirty\]'\)/)
  assert.match(dialog, /function useDialogValue\(value: unknown\)/)
  assert.match(dialog, /^ {2}useDialogValue,$/m)
  assert.match(dialog, /^ {2}DialogValue,$/m)
  // The public surface is the value prop, useDialogValue and DialogValue; the rest is internal.
  const exported = dialog.match(/^export \{([\s\S]*?)\}/m)?.[1] ?? ''
  assert.doesNotMatch(exported, /serialize/)
  // Stable serialization: object keys are sorted before comparing.
  assert.match(dialog, /Object\.keys\(value\)\.sort\(\)/)
})
