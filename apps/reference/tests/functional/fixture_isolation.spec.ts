import { test } from '@japa/runner'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile } from 'node:fs/promises'
import app from '@adonisjs/core/services/app'
import { modules } from '#start/modules'

test.group('Educational fixture isolation', () => {
  test('real test runtime retains resources while normal runtime has no example modules, listeners or migrations', async ({
    assert,
  }) => {
    assert.includeMembers(
      modules.map((module) => module.name),
      ['customers', 'orders', 'tasks', 'leave_requests']
    )
    const { stdout } = await promisify(execFile)(
      process.execPath,
      ['--import=@poppinss/ts-exec', 'tests/fixtures/probe_runtime.ts'],
      {
        cwd: app.appRoot,
        env: { ...process.env, NODE_ENV: 'development', DRIVE_DISK: 'local' },
        windowsHide: true,
        timeout: 20000,
      }
    )
    const line = stdout.split(/\r?\n/).find((value) => value.startsWith('FIXTURE_PROBE:'))
    assert.exists(line)
    const probe = JSON.parse(line!.slice('FIXTURE_PROBE:'.length))
    assert.deepEqual(probe.modules, [])
    assert.deepEqual(probe.resources, [])
    // Fixture sync jobs (tests/fixtures/sync_jobs.ts) are never scheduled outside tests.
    assert.deepEqual(probe.syncJobs, [])
    // Framework listeners (webhooks, followers) are not example code; none may be educational.
    assert.deepEqual(
      probe.listeners.filter((name: string) => !name.startsWith('adula.')),
      []
    )
    assert.isFalse(
      probe.migrations.some((path: string) =>
        /fixtures|customers|orders|tasks|leave_requests/.test(path)
      )
    )
  })

  test('production frontend manifest excludes educational pages', async ({ assert }) => {
    const manifest = JSON.parse(
      await readFile(app.makePath('build/public/assets/.vite/manifest.json'), 'utf8')
    )
    assert.isNotEmpty(Object.keys(manifest))
    assert.isFalse(Object.keys(manifest).some((path) => /fixtures|pages\/orders/.test(path)))
  })
})
