import { BaseCommand } from '@adonisjs/core/ace'

/** The application owns the Drive-backed pruning in `#services/upload_pruning`. */
export default class AdulaUploadsPrune extends BaseCommand {
  static commandName = 'adula:uploads:prune'
  static description = 'Delete uploads older than a day that were never bound to a record'
  static options = { startApp: true }
  async run() {
    const { pruneUnboundUploads } = (await this.app.import('#services/upload_pruning')) as {
      pruneUnboundUploads: () => Promise<{ removed: number; failed: number }>
    }
    const { removed, failed } = await pruneUnboundUploads()
    this.logger.info(`Removed ${removed} unbound uploads`)
    if (failed) {
      this.logger.error(`${failed} unbound uploads could not be removed; they will be retried`)
      this.exitCode = 1
    }
  }
}
