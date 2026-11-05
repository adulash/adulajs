import { BaseCommand, flags } from '@adonisjs/core/ace'
import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { openBackupArchive, parseBackupKey } from '../src/backups/archive.js'
import { applicationEnv, backupSnapshotService } from './backup_services.js'

/**
 * Opens an encrypted `.adulabackup` file into a new snapshot directory for the existing
 * restore commands (ADR 051). The directory holds plaintext data and must be deleted after
 * the restore.
 */
export default class BackupOpen extends BaseCommand {
  static commandName = 'backup:open'
  static description = 'Decrypt an .adulabackup file into a new snapshot directory for restore'
  static options = { startApp: true }
  @flags.string({ required: true })
  declare file: string
  @flags.string({ required: true })
  declare snapshot: string

  async run() {
    const env = await applicationEnv(this.app)
    const value = env.get('BACKUP_ENCRYPTION_KEY')
    if (!value) {
      this.logger.error('BACKUP_ENCRYPTION_KEY is not set')
      this.exitCode = 1
      return
    }
    const target = resolve(this.snapshot)
    await openBackupArchive(resolve(this.file), target, parseBackupKey(value))
    const { verifySnapshot } = await backupSnapshotService(this.app)
    try {
      await verifySnapshot(target)
    } catch (error) {
      await rm(target, { recursive: true, force: true })
      throw error
    }
    this.logger.success(`Snapshot opened in ${target}`)
    this.logger.warning(
      'This directory holds unencrypted data: delete it after backup:verify-snapshot and the restore'
    )
  }
}
