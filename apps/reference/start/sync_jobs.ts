import type { SyncJobDefinition } from 'adula'
import { testFixturesEnabled } from '#start/test_fixtures'

/**
 * Background synchronization jobs (defineSyncJob from adula). start/scheduler.ts queues
 * each one on its cron; the worker runs it; administrators see it on /admin/jobs.
 */
export const syncJobDefinitions: SyncJobDefinition[] = []
if (testFixturesEnabled) {
  const { fixtureSyncJobs } = await import('#tests/fixtures/sync_jobs')
  syncJobDefinitions.push(...fixtureSyncJobs)
}
