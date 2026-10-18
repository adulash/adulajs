import { BaseCommand } from '@adonisjs/core/ace'

/** The application owns the outbox job mapping in `#services/events` (`publishEvents`). */
export default class AdulaOutbox extends BaseCommand {
  static commandName = 'adula:outbox'
  static description = 'Publish one locked batch of durable events to the queue'
  static options = { startApp: true }
  async run() {
    const { publishEvents } = (await this.app.import('#services/events')) as {
      publishEvents: () => Promise<number>
    }
    this.logger.info(`Published ${await publishEvents()} events`)
  }
}
