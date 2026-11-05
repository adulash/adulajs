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
test('the company identity reaches every brand spot of the workspace shell', async () => {
  const target = await mkdtemp(join(tmpdir(), 'adula-brand-'))
  try {
    const files = {
      'package.json': JSON.stringify({ name: 'reference', dependencies: {} }),
      'inertia/layouts/default.tsx': await source('inertia/layouts/default.tsx'),
      'inertia/layouts/workspace.tsx': await source('inertia/layouts/workspace.tsx'),
      'inertia/pages/home.tsx': await source('inertia/pages/home.tsx'),
      'inertia/app.tsx': await source('inertia/app.tsx'),
    }
    await renderProject(
      target,
      { version: '0.0.0', files },
      { name: 'acme', identity: { company: 'شركة أكمي', logoPath: '/logo.png' } }
    )
    const workspace = await readFile(join(target, 'inertia/layouts/workspace.tsx'), 'utf8')
    assert.doesNotMatch(workspace, /عدولة/)
    assert.doesNotMatch(workspace, /^\s*ع$/m)
    assert.match(workspace, /\{brand\.logo \? <img src=\{brand\.logo\}/)
    // The sidebar, the collapsed rail's header and the top bar all show the company name.
    assert.ok(workspace.split('>{brand.company}<').length - 1 >= 3)
    assert.match(workspace, /^import \{ brand \} from '~\/brand'/)
  } finally {
    await rm(target, { recursive: true, force: true })
  }
})
