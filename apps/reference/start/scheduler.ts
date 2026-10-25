import scheduler from 'adonisjs-scheduler/services/main'
import db from '@adonisjs/lucid/services/db'
import { AdulaError, Settings } from 'adula'
import { adula } from '#services/adula'
import { syncJobDefinitions } from '#start/sync_jobs'
// Exactly one scheduler process is deployed. The worker owns outbox publication.
scheduler.command('backup:verify').hourly().withoutOverlapping()
// The monthly drill restores the latest snapshot and opens a record with its attachment.
scheduler.command('backup:restore-test').monthly().withoutOverlapping()
// Uploads abandoned before their record was saved would otherwise fill the storage disk.
scheduler.command('adula:uploads:prune').daily().withoutOverlapping()
// Stored inbound webhook deliveries are kept for 90 days (ADR 037).
scheduler
  .call(async () => {
    await adula().inbound.pruneDeliveries()
  })
  .daily()
  .withoutOverlapping()
// Each sync job's cron only queues a run; the worker executes it. A run still queued or
// running makes queue() refuse with 409, so a slow job is never stacked.
for (const job of syncJobDefinitions) {
  scheduler
    .call(async () => {
      try {
        await adula().syncJobs.queue(job.name, 'schedule')
      } catch (error) {
        if (!(error instanceof AdulaError && error.status === 409)) throw error
      }
    })
    .cron(job.cron)
    .withoutOverlapping()
}
scheduler
  .call(async () => {
    await new Settings(db.connection().getWriteClient()).set(
      'scheduler.heartbeat',
      new Date().toISOString()
    )
  })
  .everyThirtySeconds()
  .immediate()
  .withoutOverlapping()
