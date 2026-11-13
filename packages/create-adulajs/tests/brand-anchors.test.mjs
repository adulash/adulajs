import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderProject } from '../src/project.mjs'

const reference = new URL('../../../apps/reference/', import.meta.url)
const source = (path) => readFile(new URL(path, reference), 'utf8')

// The creator rewrites the reference shell by text anchors; a reformatted or restructured
// workspace must keep them, or the new system would show the reference company (#153-#155).
test('the company identity reaches every brand spot of the workspace and guest shells', async () => {
  const target = await mkdtemp(join(tmpdir(), 'adula-brand-'))
  try {
    const files = {
      'package.json': JSON.stringify({ name: 'reference', dependencies: {} }),
      'inertia/layouts/default.tsx': await source('inertia/layouts/default.tsx'),
      'inertia/layouts/workspace.tsx': await source('inertia/layouts/workspace.tsx'),
      'inertia/components/brand-mark.tsx': await source('inertia/components/brand-mark.tsx'),
      'inertia/pages/home.tsx': await source('inertia/pages/home.tsx'),
      'inertia/app.tsx': await source('inertia/app.tsx'),
    }
    await renderProject(
      target,
      { version: '0.0.0', files },
      { name: 'acme', identity: { company: 'شركة أكمي', logoPath: '/logo.png' } }
    )
    // The creator's identity enters each file under an imported name. The shells declare names
    // of their own (the saved appearance is a local `brand`), so an imported name the file
    // also declares would be shadowed and the created system would not typecheck.
    const imported = (path, contents) => {
      const found = contents.match(/^import \{ brand(?: as (\w+))? \} from '(?:~|\.)\/brand'\n/)
      assert.ok(found, `${path} imports the company identity first`)
      const local = found[1] ?? 'brand'
      // A declaration, a destructuring or a parameter of that name anywhere in the template.
      const declared = new RegExp(
        String.raw`\b(?:const|let|var|function|class)\s+${local}\b|\{[^}]*\b${local}\b[^}]*\}\s*=|\(\s*${local}\b`
      )
      assert.doesNotMatch(files[path], declared, `${path} declares ${local} itself`)
      return local
    }
    const read = (path) => readFile(join(target, path), 'utf8')
    const workspace = await read('inertia/layouts/workspace.tsx')
    assert.doesNotMatch(workspace, /أدولا/)
    // The mark lives in brand-mark.tsx (checked below); the workspace keeps no letter of its own.
    assert.doesNotMatch(workspace, /^\s*ع$/m)
    // The brand lives in the full-width header that every layout and size shares (owner
    // decision 20); each of its name anchors shows the company name, unless a saved
    // appearance identity wins.
    const company = imported('inertia/layouts/workspace.tsx', workspace)
    const anchors = files['inertia/layouts/workspace.tsx'].split('>أدولا<').length - 1
    assert.ok(anchors >= 1)
    assert.equal(workspace.split(`>{${company}.company}<`).length - 1, anchors)
    // The guest shell (home and account pages) shows the company too, never the reference brand.
    const guest = await read('inertia/layouts/default.tsx')
    assert.doesNotMatch(guest, /AdulaJS|أدولا/)
    const guestCompany = imported('inertia/layouts/default.tsx', guest)
    assert.ok(guest.includes(`>{${guestCompany}.company}<`))
    // Home takes its title suffix from app.tsx, so it needs no brand import of its own.
    const home = await read('inertia/pages/home.tsx')
    assert.doesNotMatch(home, /AdulaJS|from '~\/brand'/)
    const app = await read('inertia/app.tsx')
    const appCompany = imported('inertia/app.tsx', app)
    assert.ok(app.includes(`const appName = ${appCompany}.company`))
    const mark = await read('inertia/components/brand-mark.tsx')
    assert.doesNotMatch(mark, /^\s*ع$/m)
    const markCompany = imported('inertia/components/brand-mark.tsx', mark)
    assert.ok(mark.includes(`{${markCompany}.logo ? <img src={${markCompany}.logo}`))
  } finally {
    await rm(target, { recursive: true, force: true })
  }
})

test('a template without the shared company mark is refused, not rendered with the reference letter', async () => {
  const target = await mkdtemp(join(tmpdir(), 'adula-brand-'))
  try {
    const files = {
      'package.json': JSON.stringify({ name: 'reference', dependencies: {} }),
      'inertia/layouts/default.tsx': await source('inertia/layouts/default.tsx'),
      'inertia/layouts/workspace.tsx': await source('inertia/layouts/workspace.tsx'),
      'inertia/pages/home.tsx': await source('inertia/pages/home.tsx'),
      'inertia/app.tsx': await source('inertia/app.tsx'),
    }
    await assert.rejects(
      renderProject(
        target,
        { version: '0.0.0', files },
        { name: 'acme', identity: { company: 'شركة أكمي', logoPath: null } }
      ),
      /brand-mark\.tsx/
    )
  } finally {
    await rm(target, { recursive: true, force: true })
  }
})

test('a template whose shell lost a brand anchor is refused, not rendered with the reference brand', async () => {
  const target = await mkdtemp(join(tmpdir(), 'adula-brand-'))
  try {
    const files = {
      'package.json': JSON.stringify({ name: 'reference', dependencies: {} }),
      'inertia/layouts/default.tsx': (await source('inertia/layouts/default.tsx')).replaceAll(
        'أدولا',
        'Adula'
      ),
      'inertia/layouts/workspace.tsx': await source('inertia/layouts/workspace.tsx'),
      'inertia/components/brand-mark.tsx': await source('inertia/components/brand-mark.tsx'),
      'inertia/app.tsx': await source('inertia/app.tsx'),
    }
    await assert.rejects(
      renderProject(
        target,
        { version: '0.0.0', files },
        { name: 'acme', identity: { company: 'شركة أكمي', logoPath: null } }
      ),
      /default\.tsx has no brand anchor/
    )
  } finally {
    await rm(target, { recursive: true, force: true })
  }
})
