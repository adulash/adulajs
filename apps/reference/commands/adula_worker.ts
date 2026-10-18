import { BaseCommand } from '@adonisjs/core/ace'

export default class AdulaWorker extends BaseCommand {
  static commandName = 'adula:worker'
  static description = 'Run the queue consumer and transactional outbox publisher'
  static options = { startApp: true, staysAlive: true }
  async run() {
    const { publishEvents } = await import('#services/events')
    const { deliverNotificationEmails } = await import('#services/notification_mail')
    const { adula } = await import('#services/adula')
    const { default: db } = await import('@adonisjs/lucid/services/db')
    const { Settings } = await import('adula')
    const worker = await this.kernel.exec('queue:work', [])
    if (worker.error) throw worker.error
    let active: Promise<void> | undefined
    let stopped = false
    const tick = () => {
      if (active || stopped) return
      active = (async () => {
        try {
          await publishEvents()
          await deliverNotificationEmails()
          await adula().workflows.tick()
          await adula().imports.process()
          // The built-in guarded client connects only to the validated, pinned address.
          await adula().webhooks.deliver()
          await new Settings(db.connection().getWriteClient()).set(
            'worker.heartbeat',
            new Date().toISOString()
          )
        } catch (error) {
          this.logger.error(error instanceof Error ? error.message : String(error))
        }
      })().finally(() => {
        active = undefined
      })
    }
    const timer = setInterval(tick, 1000)
    this.app.terminating(async () => {
      stopped = true
      clearInterval(timer)
      await active
    })
    tick()
  }
}
