import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../registry/ui/sortable-list.tsx', import.meta.url), 'utf8')

/** The JSX opening tag of the element whose attributes contain `marker`. */
function openingTag(marker) {
  const at = source.indexOf(marker)
  assert.notEqual(at, -1, `${marker} is missing`)
  const start = source.lastIndexOf('<', at)
  const end = source.indexOf('\n              >', at)
  assert.ok(start !== -1 && end !== -1, `${marker} is not inside a JSX opening tag`)
  return source.slice(start, end)
}

test('sortable-list composes the shadcn Button instead of hand-styled native buttons', () => {
  assert.doesNotMatch(source, /<button[\s>]/, 'a native <button> is hand-styled here')
  assert.match(source, /import \{ Button \} from '~\/components\/ui\/button'/)
})

test('the drag handle is a ghost icon Button that keeps its name, state and handlers', () => {
  const handle = openingTag("t('مقبض نقل {item}'")
  assert.match(handle, /^<Button\b/)
  assert.match(handle, /variant="ghost"/)
  assert.match(handle, /size="icon-sm"/)
  assert.match(handle, /type="button"/)
  // The ref feeds keyboard focus; the aria and data attributes drive the Dialog's Escape handling.
  for (const attribute of [
    'ref={',
    'aria-pressed=',
    'aria-describedby="sortable-list-hint"',
    'data-sortable-picked=',
    'onKeyDown=',
    'onBlur=',
    'onPointerDown=',
    'onPointerMove=',
    'onPointerUp=',
    'onPointerCancel=',
  ])
    assert.ok(handle.includes(attribute), `the handle lost ${attribute}`)
  // Pointer dragging needs touch-action none; the Button supplies focus and hover styles.
  assert.match(handle, /touch-none/)
  assert.doesNotMatch(handle, /focus-visible:ring|hover:bg-|text-muted-foreground/)
})

test('every icon Button takes its size from size="icon-sm", never from a size class', () => {
  const buttons = source.match(/<Button\b[\s\S]*?\n\s*>/g) ?? []
  assert.equal(buttons.length, 3, 'the handle and the two move buttons')
  for (const button of buttons) {
    assert.match(button, /size="icon-sm"/)
    assert.doesNotMatch(button, /className="[^"]*\bsize-\d/)
  }
})
