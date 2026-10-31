import { test } from 'node:test'
import assert from 'node:assert/strict'
import { argumentBatches } from '../src/system.mjs'

test('a project file list is split below the Windows command-line limit in order', () => {
  const files = Array.from(
    { length: 400 },
    (_, index) => `inertia/components/ui/generated-component-${index}.tsx`
  )
  const batches = argumentBatches(files)
  assert.ok(batches.length > 1)
  for (const batch of batches) assert.ok(batch.join(' ').length <= 4000)
  assert.deepEqual(batches.flat(), files)
})

test('a short list stays in one batch and an empty list runs nothing', () => {
  assert.deepEqual(argumentBatches(['a.ts', 'b.ts']), [['a.ts', 'b.ts']])
  assert.deepEqual(argumentBatches([]), [])
})

test('an argument longer than the limit gets a batch of its own', () => {
  const long = 'x'.repeat(50)
  assert.deepEqual(argumentBatches(['a', long, 'b'], 10), [['a'], [long], ['b']])
})
