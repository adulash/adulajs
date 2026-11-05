import { BaseCommand } from '@adonisjs/core/ace'

/** Applies the assistant's retention through the application's wiring in `#services/adula`. */
export default class AdulaAssistantPrune extends BaseCommand {
  static commandName = 'adula:assistant:prune'
  static description =
    'Delete assistant conversation metadata after 30 days, used proposals after a day and token usage after 90 days'
  static options = { startApp: true }
  async run() {
    const { adula } = (await this.app.import('#services/adula')) as {
      adula: () => { assistant: { prune: () => Promise<Record<string, number>> } }
    }
    const removed = await adula().assistant.prune()
    this.logger.info(
      `Removed ${removed.conversations} conversations, ${removed.proposals} proposals and ${removed.usage} usage rows`
    )
  }
}
