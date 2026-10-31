import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  referenceIsCurrent,
  renderReference,
  sourcePath,
} from '../../scripts/define-resource-reference.mjs'

const source = await readFile(sourcePath, 'utf8')

test('the committed defineResource reference matches types.ts', async () => {
  assert.equal(await referenceIsCurrent(), true, 'Run pnpm docs:reference and commit the page')
})

test('every option and field prop of the reference has a description', () => {
  const page = renderReference(source)
  const empty = page.split('\n').filter((line) => line.startsWith('| `') && line.endsWith('| — |'))
  assert.deepEqual(empty, [], 'Add TSDoc comments to these entries in types.ts')
  const undescribed = [...page.matchAll(/^### (.+)\n\n(?=\||No type-specific)/gm)].map((m) => m[1])
  assert.deepEqual(undescribed, [], 'Add a TSDoc comment to these Field variants in types.ts')
})

test('every field type of the Field union gets its own section', () => {
  const page = renderReference(source)
  for (const type of ['string', 'decimal', 'percent', 'enum', 'attachment', 'user', 'manyToMany'])
    assert.match(page, new RegExp(`^### .*\`${type}\``, 'm'))
  const extended = source.replace("| { type: 'user' }", "| { type: 'user' }\n  /** A map point. */\n  | { type: 'geo' }")
  assert.notEqual(extended, source)
  assert.match(renderReference(extended), /^### `geo`\n\nA map point\.$/m)
})

test('a changed comment or default makes the page stale', () => {
  const page = renderReference(source)
  const changed = source.replace("@default '20mb'", "@default '25mb'")
  assert.notEqual(changed, source)
  const next = renderReference(changed)
  assert.notEqual(next, page)
  assert.match(next, /\| `maxSize` \| `string` \| `'25mb'` \|/)
})
