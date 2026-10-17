import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
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
