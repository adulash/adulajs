import { BaseCommand } from '@adonisjs/core/ace'
import { fileURLToPath } from 'node:url'
import { syncAgentAssets } from '../src/commands/agent_assets.js'
import { renameLegacyFiles, renameRecordedMigrations } from '../src/upgrade/rename.js'

/**
 * Second step of the 2.0 upgrade, after `npx create-adulajs@latest upgrade` has
 * moved the application to the `adula` package. Renames the migration history,
 * the gap log and the managed AGENTS.md block that 1.x wrote, then runs the
 * pending migrations. Safe to repeat.
 */
export default class Upgrade extends BaseCommand {
  static commandName = 'adula:upgrade'
  static description =
    'Rename 1.x migration history and managed files to AdulaJS, then run pending migrations'
  static options = { startApp: true }
  async run() {
    const { default: db } = await import('@adonisjs/lucid/services/db')
    const config = db.getRawConnection(db.primaryConnectionName)?.config
    const table = config?.migrations?.tableName ?? 'adonis_schema'
    const renamed = await renameRecordedMigrations(db.connection().getWriteClient(), table)
    this.logger.info(`Migration history: ${renamed} recorded 1.x migrations renamed`)
    const root = fileURLToPath(this.app.appRoot)
    for (const change of await renameLegacyFiles(root)) this.logger.info(`Renamed ${change}`)
    await syncAgentAssets(root)
    this.logger.info('Managed AGENTS.md block and skills synchronized')
    const migrate = await this.kernel.exec('migration:run', ['--force'])
    if (migrate.exitCode) {
      this.exitCode = migrate.exitCode
      this.logger.error('migration:run failed; the history rename is kept and can be repeated')
      return
    }
    this.logger.success(
      'Upgrade finished. Next: ADULA_ADMIN_EMAIL=<email> node ace adula:install, then node ace adula:doctor'
    )
  }
}
