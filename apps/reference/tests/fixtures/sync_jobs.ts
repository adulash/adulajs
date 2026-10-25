import { defineSyncJob } from 'adula'

/**
 * Test-only sync jobs (ADR 017): start/sync_jobs.ts appends them only when
 * testFixturesEnabled. One writes a fixture customer through systemSave; the other is
 * refused by the resource's required field so the failure category path is exercised.
 */
export const fixtureSyncJobs = [
  defineSyncJob({
    name: 'sync:fixture-customers',
    label: { ar: 'مزامنة العملاء التجريبية', en: 'Fixture customer sync' },
    cron: '0 3 * * *',
    timeoutMs: 30_000,
    handler: async (ctx) => {
      await ctx.systemSave('customers', {
        name: `عميل مزامنة ${ctx.runId}`,
        email: `sync-${ctx.runId}@example.test`,
      })
      ctx.logger.info('Fixture customer synchronized')
      return { created: 1 }
    },
  }),
  defineSyncJob({
    name: 'sync:fixture-failing',
    label: { ar: 'مزامنة تجريبية فاشلة', en: 'Failing fixture sync' },
    cron: '30 3 * * 1-5',
    timeoutMs: 30_000,
    handler: async (ctx) => {
      await ctx.systemSave('customers', { email: 'missing-name@example.test' })
    },
  }),
]
