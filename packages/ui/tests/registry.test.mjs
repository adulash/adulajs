import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  UPSTREAM_EDITS,
  adaptSource,
  digest,
  loadTransformDirection,
  pairDirectionalTranslates,
  referenceSnapshot,
  writeReference,
} from '../../../scripts/ui-registry.mjs'

const transformDirection = await loadTransformDirection()
const registryDirectory = new URL('../registry/ui/', import.meta.url)
const registryFiles = (await readdir(registryDirectory)).sort()
const adapt = (filename, code) => adaptSource(filename, code, transformDirection)

// Upstream new-york-v4 shapes that prepare has to adapt.
const upstream = {
  'switch.tsx': `"use client"\n\nexport const Thumb = () => <span className="block data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0" />\n`,
  'dialog.tsx': `'use client'\n\nexport const Content = () => <div className={cn('fixed top-[50%] left-[50%] translate-x-[-50%] translate-y-[-50%]', className)} />\n`,
  'radio-group.tsx': `"use client"\n\nexport const Dot = () => <CircleIcon className="absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2" />\n`,
  'select.tsx': `export const Content = () => <div className={cn("data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1", className)}><SelectPrimitive.Root /></div>\n`,
  'sheet.tsx': `export const Side = () => <div className="inset-y-0 right-0 h-full w-3/4 border-l pl-4 text-left" />\n`,
  'pagination.tsx': `export const P = () => <nav aria-label="pagination"><ChevronLeftIcon /><span>Previous</span><ChevronRightIcon /></nav>\n`,
  'calendar.tsx': `"use client"\nimport * as React from "react"\nexport const C = () => (\n    <DayPicker\n      showOutsideDays\n    />\n)\nconst m = date.toLocaleString("default", { month: "short" })\n`,
}

test('prepare is idempotent: adapting adapted sources changes nothing', async () => {
  for (const [filename, code] of Object.entries(upstream)) {
    const once = await adapt(filename, code)
    assert.notEqual(once, code, filename)
    assert.equal(await adapt(filename, once), once, filename)
  }
  // The stored registry is the strongest case: the drift gate below asserts adapt(file) === file.
})

test('prepare writes each RTL translate once, as an explicit ltr/rtl pair', async () => {
  const thumb = await adapt('switch.tsx', upstream['switch.tsx'])
  assert.equal(thumb.match(/rtl:data-\[state=checked\]:-translate-x-\[calc\(100%-2px\)\]/g)?.length, 1)
  assert.match(thumb, /ltr:data-\[state=checked\]:translate-x-\[calc\(100%-2px\)\] rtl:data-\[state=checked\]:-translate-x-\[calc\(100%-2px\)\]/)
  assert.doesNotMatch(thumb, /use client/)
  const dialog = await adapt('dialog.tsx', upstream['dialog.tsx'])
  assert.match(dialog, /'fixed top-\[50%\] start-\[50%\] ltr:translate-x-\[-50%\] rtl:-translate-x-\[-50%\] translate-y-\[-50%\]'/)
  assert.match(await adapt('radio-group.tsx', upstream['radio-group.tsx']), /start-1\/2 size-2 ltr:-translate-x-1\/2 rtl:translate-x-1\/2 -translate-y-1\/2"/)
  const select = await adapt('select.tsx', upstream['select.tsx'])
  assert.match(select, /"ltr:data-\[side=left\]:-translate-x-1 rtl:data-\[side=left\]:translate-x-1 ltr:data-\[side=right\]:translate-x-1 rtl:data-\[side=right\]:-translate-x-1"/)
  assert.match(select, /<SelectPrimitive\.Root dir="rtl" \/>/)
  assert.equal(
    await adapt('sheet.tsx', upstream['sheet.tsx']),
    'export const Side = () => <div className="inset-y-0 end-0 h-full w-3/4 border-s ps-4 text-start" />\n'
  )
  // A source carrying the duplicate the old prepare + install produced converges to one class.
  assert.equal(
    pairDirectionalTranslates('"a:translate-x-1 rtl:a:-translate-x-1 rtl:a:-translate-x-1 b"'),
    '"ltr:a:translate-x-1 rtl:a:-translate-x-1 b"'
  )
  // A single-class cn('...') call closes with ')}' right after the class.
  const single = await adapt('x.tsx', "export const X = () => <div className={cn('translate-x-1')} />\n")
  assert.equal(single, "export const X = () => <div className={cn('ltr:translate-x-1 rtl:-translate-x-1')} />\n")
  assert.equal(await transformDirection(single, true), single)
})

test('drift gate: every registry file is already prepared and installs byte for byte', async () => {
  for (const filename of registryFiles) {
    const code = await readFile(new URL(filename, registryDirectory), 'utf8')
    assert.equal(await adapt(filename, code), code, `${filename}: run node scripts/ui-registry.mjs prepare --sources-only`)
    // shadcn add (components.json "rtl": true) runs this transform; the stored file must be its fixed point.
    assert.equal(await transformDirection(code, true), code, `${filename} changes on install`)
    assert.doesNotMatch(code, /^["']use client["']/, filename)
  }
})

test('UPSTREAM.json: each fetched shadcn file matches its hash and the stored copy is its prepared form', async () => {
  const entries = JSON.parse(await readFile(new URL('../UPSTREAM.json', import.meta.url), 'utf8'))
  const names = new Set(entries.map((entry) => entry.name))
  // ADR 055: the parts the shell and the registry compose come from shadcn, not from Radix directly.
  for (const name of ['sidebar', 'avatar', 'slider', 'alert-dialog', 'breadcrumb', 'scroll-area', 'table'])
    assert.ok(names.has(name), `${name} is recorded in UPSTREAM.json`)
  for (const entry of entries) {
    assert.match(entry.url, /^https:\/\/ui\.shadcn\.com\/r\/styles\/new-york-v4\/[a-z-]+\.json$/, entry.name)
    const source = await readFile(new URL(`../${entry.upstream}`, import.meta.url), 'utf8')
    assert.equal(digest(source), entry.sha256, `${entry.upstream}: not the file whose hash UPSTREAM.json records`)
    const stored = await readFile(new URL(`../${entry.path}`, import.meta.url), 'utf8')
    const prepared = await adapt(basename(entry.path), source.replace(/\r\n/g, '\n'))
    if (UPSTREAM_EDITS[entry.name])
      assert.notEqual(stored, prepared, `${entry.name} equals its upstream file; remove it from UPSTREAM_EDITS`)
    else
      assert.equal(stored, prepared, `${entry.path}: differs from the prepared upstream file; record the edit in UPSTREAM_EDITS and ADR 055`)
  }
  for (const name of Object.keys(UPSTREAM_EDITS)) assert.ok(names.has(name), `${name}: an edit to an unknown item`)
  // Every fetched item is installable from the registry.
  const registry = JSON.parse(await readFile(new URL('../registry.json', import.meta.url), 'utf8'))
  for (const name of names) assert.ok(registry.items.some((item) => item.name === name), `${name} is in registry.json`)
})

test('registry.json and registry/ui list the same files', async () => {
  const { files } = await referenceSnapshot()
  const listed = [...files.keys()].map((target) => target.replace('inertia/components/ui/', '')).sort()
  assert.deepEqual(listed, registryFiles)
})

test('drift gate: the generated reference copy equals the registry', async () => {
  const { files, lock } = await referenceSnapshot()
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(lock.version, pkg.version)
  assert.equal(lock.adulaCompatibility, pkg.version.split('.').slice(0, 2).join('.'))
  const scratch = await mkdtemp(join(tmpdir(), 'adula-ui-reference-'))
  try {
    assert.equal(await writeReference(scratch), registryFiles.length)
    for (const [target, source] of files) {
      const generated = await readFile(join(scratch, target))
      assert.ok(generated.equals(await readFile(source)), target)
      assert.equal(lock.files[target].hash, digest(generated.toString('utf8')), target)
    }
    assert.deepEqual(JSON.parse(await readFile(join(scratch, 'ui.lock.json'), 'utf8')), lock)
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
})

test('drift gate: a generated apps/reference copy is current', async (t) => {
  const app = fileURLToPath(new URL('../../../apps/reference/', import.meta.url))
  const directory = join(app, 'inertia/components/ui')
  if (!existsSync(directory)) return t.skip('not generated yet; pnpm build runs node scripts/ui-registry.mjs reference')
  const stale = 'apps/reference is stale; run node scripts/ui-registry.mjs reference'
  const { files, lock } = await referenceSnapshot()
  assert.deepEqual((await readdir(directory)).sort(), registryFiles, stale)
  for (const [target, source] of files)
    assert.ok((await readFile(join(app, target))).equals(await readFile(source)), `${target}: ${stale}`)
  assert.deepEqual(JSON.parse(await readFile(join(app, 'ui.lock.json'), 'utf8')), lock, stale)
})

test('the reference stylesheet registers the gitignored generated copy as a Tailwind source', async () => {
  // Tailwind 4 skips .gitignore'd paths during source detection; without this line the
  // reference build silently ships CSS with no component classes (browser tests catch it late).
  const css = await readFile(
    new URL('../../../apps/reference/inertia/css/adula.css', import.meta.url),
    'utf8'
  )
  assert.match(css, /@source\s+["']\.\.\/components\/ui["'];/)
})

test('registry.json is edited by hand: no command rewrites it (issue #163)', async () => {
  // `register` once replaced whole entries from a stale hard-coded table and dropped the
  // registry dependencies and files other items had gained since. The command is gone; running
  // it must fail without touching registry.json, and the docs must say the file is edited by hand.
  const script = fileURLToPath(new URL('../../../scripts/ui-registry.mjs', import.meta.url))
  const registryUrl = new URL('../registry.json', import.meta.url)
  const before = await readFile(registryUrl)
  const run = spawnSync(process.execPath, [script, 'register'], { encoding: 'utf8' })
  assert.notEqual(run.status, 0)
  assert.match(run.stderr, /Usage: node scripts\/ui-registry\.mjs <sync\|prepare\|build\|reference>/)
  assert.ok((await readFile(registryUrl)).equals(before), 'registry.json changed')
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8')
  assert.doesNotMatch(readme, /ui-registry\.mjs register/)
  assert.match(readme, /`registry\.json` is edited by hand/)
})
