// Runs the reference browser suite with the dark theme as every user's default (#155).
// ADULA_TEST_THEME is honoured only while the test fixtures are enabled (NODE_ENV=test).
import { join } from 'node:path'
import { root, run } from './lib/run.mjs'

const extra = process.argv.slice(2).filter((arg) => arg !== '--')
await run(process.execPath, ['ace', 'test', 'browser', ...extra], {
  cwd: join(root, 'apps/reference'),
  env: { ...process.env, ADULA_TEST_THEME: 'dark' },
  label: 'browser suite in the dark theme',
})
