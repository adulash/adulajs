import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { readIdentity, renderProject } from '../src/project.mjs'

// The generated project formats its sources with the starter's prettier and config, which the
// reference application in this repository shares.
const reference = fileURLToPath(new URL('../../../apps/reference/', import.meta.url))
const loaded = await import(
  pathToFileURL(createRequire(join(reference, 'package.json')).resolve('prettier')).href
)
const prettier = loaded.default ?? loaded

test('a supplied identity colour reaches the brand files and survives formatting', async () => {
  const template = JSON.parse(
    await readFile(new URL('../build/template.json', import.meta.url), 'utf8')
  )
  const root = await mkdtemp(join(tmpdir(), 'adula-identity-'))
  try {
    await writeFile(
      join(root, 'brand.json'),
      JSON.stringify({ primaryColor: '#14532d', guidelines: 'Supplied by the test.' })
    )
    const identity = await readIdentity(join(root, 'brand.json'), 'شركة الاختبار')
    const target = join(root, 'system')
    await renderProject(target, template, { name: 'system', identity })
    const design = await readFile(join(target, 'docs/design-identity.md'), 'utf8')
    assert.match(design, /- Primary color: #14532d/)
    assert.match(design, /- Guidelines: Supplied by the test\./)
    assert.match(design, /- Logo: Pending/)
    const config = await prettier.resolveConfig(join(reference, 'inertia/brand.ts'))
    assert(config, 'the starter prettier configuration resolves')
    // The creator runs prettier on these files after rendering; the result must keep the
    // identity and be stable under a second pass.
    for (const [file, expected] of [
      ['inertia/css/brand.css', /--primary: #14532d;/],
      ['inertia/css/brand.css', /--ring: #14532d;/],
      ['inertia/css/brand.css', /--primary-foreground: #ffffff;/],
      ['inertia/brand.ts', /company: 'شركة الاختبار'/],
    ]) {
      const options = { ...config, filepath: join(target, file) }
      const formatted = await prettier.format(await readFile(join(target, file), 'utf8'), options)
      assert.match(formatted, expected, file)
      assert(await prettier.check(formatted, options), `${file} is stable under prettier`)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
