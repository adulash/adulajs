import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { plan, SWEEP_PARTS, units } from '../../scripts/test-browser-shard.mjs'

const browser = fileURLToPath(new URL('../../apps/reference/tests/browser/', import.meta.url))

test('the CI shards run every browser spec file exactly once and each sweep part once', async () => {
  const files = (await readdir(browser)).filter((file) => file.endsWith('.spec.ts')).sort()
  const list = await units()
  for (const count of [SWEEP_PARTS, 4, 6]) {
    const shards = plan(list, count)
    assert.equal(shards.length, count)
    const placed = shards.flatMap((shard) => shard.units.map((u) => (u.part ? `${u.file}#${u.part}` : u.file)))
    const expected = files.flatMap((file) =>
      file === 'clean_close_sweep.spec.ts'
        ? Array.from({ length: SWEEP_PARTS }, (_, i) => `${file}#${i + 1}`)
        : [file]
    )
    assert.deepEqual([...placed].sort(), [...expected].sort(), `${count} shards`)
    for (const shard of shards) {
      assert.ok(shard.units.length > 0, 'no empty shard')
      assert.ok(shard.units.filter((u) => u.part).length <= 1, 'one sweep part per process')
    }
    assert.deepEqual(plan(list, count), shards, 'the plan is deterministic')
  }
})
