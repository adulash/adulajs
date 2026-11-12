import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// A new application keeps flash messages for the page they belong to: its kernel uses the
// starter's session middleware, which wraps AdonisJS's (a background JSON read between a write
// and its redirect would otherwise take the write's message).
test('new applications use the flash-keeping session middleware', async () => {
  const template = JSON.parse(
    await readFile(new URL('../build/template.json', import.meta.url), 'utf8')
  )
  const kernel = template.files['start/kernel.ts']
  assert.match(kernel, /import\('#middleware\/session_middleware'\)/)
  assert.doesNotMatch(kernel, /import\('@adonisjs\/session\/session_middleware'\)/)
  const middleware = template.files['app/middleware/session_middleware.ts']
  assert.ok(middleware, 'the starter ships app/middleware/session_middleware.ts')
  assert.match(middleware, /from '@adonisjs\/session\/session_middleware'/)
  assert.match(middleware, /request\.method\(\)/)
})
