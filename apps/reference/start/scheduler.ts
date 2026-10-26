import scheduler from 'adonisjs-scheduler/services/main'
import db from '@adonisjs/lucid/services/db'
import { Settings } from 'adula'
import { adula } from '#services/adula'
// Exactly one scheduler process is deployed. The worker owns outbox publication.
scheduler.command('backup:verify').hourly().withoutOverlapping()
// The monthly drill restores the latest snapshot and opens a record with its attachment.
scheduler.command('backup:restore-test').monthly().withoutOverlapping()
// Uploads abandoned before their record was saved would otherwise fill the storage disk.
scheduler.command('adula:uploads:prune').daily().withoutOverlapping()
// Workflow SLA reminders and escalations (ADR 044); each pass is idempotent.
scheduler.command('sla:evaluate').everyMinute().withoutOverlapping()
// Stored inbound webhook deliveries are kept for 90 days (ADR 037).
scheduler
  .call(async () => {
    await adula().inbound.pruneDeliveries()
  })
  .daily()
  .withoutOverlapping()
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
