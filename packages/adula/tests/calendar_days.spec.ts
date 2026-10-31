import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { test } from '@japa/runner'
import { testConnection } from './helpers.js'

const run = promisify(execFile)
const root = fileURLToPath(new URL('../', import.meta.url))
const child = fileURLToPath(new URL('./helpers/calendar_days_child.ts', import.meta.url))

/** Reads DATE values through AdulaProvider in a fresh process pinned to one time zone. */
async function readIn(timeZone: string) {
  const output = await run(process.execPath, ['--import=@poppinss/ts-exec', child], {
    cwd: root,
    env: {
      ...process.env,
      TZ: timeZone,
      ADULA_CALENDAR_DAYS_CONNECTION: JSON.stringify(testConnection),
    },
  }).catch((error: { stderr?: string }) => {
    // Child stack frames would be misread as this error's own frames; keep the messages.
    const messages = String(error.stderr ?? error)
      .split('\n')
      .filter((line) => line.trim() && !/^\s+at /.test(line))
    throw new Error(`Calendar day child failed in ${timeZone}: ${messages.join(' | ')}`)
  })
  return JSON.parse(output.stdout.trim().split('\n').at(-1)!)
}

test.group('Calendar days', () => {
  for (const [timeZone, offset] of [
    ['Asia/Riyadh', -180],
    ['Pacific/Kiritimati', -840],
    ['America/Los_Angeles', 420],
    ['UTC', 0],
  ] as const) {
    test(`a PostgreSQL DATE reads back as the same calendar day in ${timeZone}`, async ({
      assert,
    }) => {
      const result = await readIn(timeZone)
      // The child really ran in that zone, east or west of UTC.
      assert.equal(result.offset, offset)
      assert.equal(result.raw, '2026-09-18')
      assert.equal(result.rawDay, '2026-09-18')
      assert.equal(result.leapDay, '2024-02-29')
      assert.equal(result.storedDay, '2017-10-14')
      // DATE[] elements are calendar-day strings too; NULL elements stay null.
      assert.deepEqual(result.days, ['2026-09-18', null, '2024-02-29'])
      assert.equal(result.openBeforeQuery, 0)
    }).timeout(60000)
  }
})
