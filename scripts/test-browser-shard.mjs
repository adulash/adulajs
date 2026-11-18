// Runs one shard of the reference browser suite, so CI runs the suite in parallel jobs
// (ADR 054). Every spec file belongs to exactly one shard; the clean-close sweep, by far the
// longest file, is split into parts by its targets (ADULA_SWEEP_PART). New files join a shard
// automatically.
//
//   node scripts/test-browser-shard.mjs --shard=2/4 [--theme=dark] [--list]
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { root, run } from './lib/run.mjs'

const BROWSER = 'apps/reference/tests/browser'
const SWEEP = 'clean_close_sweep.spec.ts'
/** Parts of the sweep, one per shard at most. */
export const SWEEP_PARTS = 3
/** Measured locally (2026-11-18): the whole sweep took 821 s, about 137 ordinary tests of 6 s, so a third is 45. */
const SWEEP_PART_WEIGHT = 45

/** The units to place: a file (weighted by its test count) or one part of the sweep. */
export async function units(dir = join(root, BROWSER)) {
  const files = (await readdir(dir)).filter((file) => file.endsWith('.spec.ts')).sort()
  const out = []
  for (const file of files) {
    if (file === SWEEP) {
      for (let part = 1; part <= SWEEP_PARTS; part++)
        out.push({ file, part, weight: SWEEP_PART_WEIGHT })
      continue
    }
    const text = await readFile(join(dir, file), 'utf8')
    out.push({ file, weight: Math.max(1, (text.match(/^\s*test\(/gm) ?? []).length) })
  }
  return out
}

/** Longest-first greedy placement into `count` shards; the same input gives the same plan. */
export function plan(list, count) {
  const shards = Array.from({ length: count }, () => ({ weight: 0, units: [] }))
  const sorted = [...list].sort((a, b) => b.weight - a.weight || a.file.localeCompare(b.file) || (a.part ?? 0) - (b.part ?? 0))
  for (const unit of sorted) {
    // A shard holds at most one sweep part: two parts in one process would share its state.
    const open = shards.filter((shard) => !(unit.part && shard.units.some((u) => u.part)))
    const target = open.reduce((low, shard) => (shard.weight < low.weight ? shard : low))
    target.units.push(unit)
    target.weight += unit.weight
  }
  return shards
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2).filter((arg) => arg !== '--')
  const value = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3)
  const [index, count] = (value('shard') ?? '').split('/').map(Number)
  if (!(count >= SWEEP_PARTS && index >= 1 && index <= count))
    throw new Error(`Usage: --shard=<k>/<n> with n >= ${SWEEP_PARTS}`)
  const shard = plan(await units(), count)[index - 1]
  const files = shard.units.map((unit) => `tests/browser/${unit.file}`)
  const sweep = shard.units.find((unit) => unit.part)
  console.log(`Shard ${index}/${count} (${shard.weight}): ${shard.units.map((u) => (u.part ? `${u.file}#${u.part}` : u.file)).join(', ')}`)
  if (args.includes('--list')) process.exit(0)
  const env = { ...process.env }
  if (value('theme') === 'dark') env.ADULA_TEST_THEME = 'dark'
  if (sweep) env.ADULA_SWEEP_PART = `${sweep.part}/${SWEEP_PARTS}`
  await run(process.execPath, ['ace', 'test', 'browser', `--files=${files.join(',')}`], {
    cwd: join(root, 'apps/reference'),
    env,
    label: `browser shard ${index}/${count}${value('theme') === 'dark' ? ' in the dark theme' : ''}`,
  })
}
