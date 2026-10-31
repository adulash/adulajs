import { BaseCommand, flags } from '@adonisjs/core/ace'

export default class AdulaRestoreReconcile extends BaseCommand {
  static commandName = 'adula:restore:reconcile'
  static description =
    'After a restore, rebuild the event queue and invalidate cached authorization'
  static options = { startApp: true }
  @flags.boolean() declare force: boolean
  async run() {
    if (!this.force)
      throw new Error(
        'Stop web, worker and scheduler first; then pass --force after restoring the database'
      )
    // The queue and cache services are application dependencies, resolved from the application.
    const { default: queue } = (await this.app.import(
      '@nemoventures/adonis-jobs/services/main'
    )) as { default: { clear(queues: string[]): Promise<unknown> } }
    const { default: cache } = (await this.app.import('@adonisjs/cache/services/main')) as {
      default: { clear(): Promise<unknown> }
    }
    const { default: db } = await import('@adonisjs/lucid/services/db')
    // This queue contains only deliveries whose authoritative records live in outbox.
    await queue.clear(['events'])
    await db
      .connection()
      .getWriteClient()
      .transaction(async (trx) => {
        await trx('outbox').update({ published_at: null })
        await trx('authorization_revision').where('id', 1).increment('version', 1)
      })
    await cache.clear()
    this.logger.success(
      'Durable events will replay with listener deduplication; authorization cache cleared'
    )
  }
}
