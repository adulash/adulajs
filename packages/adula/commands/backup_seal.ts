import { BaseCommand, flags } from '@adonisjs/core/ace'
import { resolve } from 'node:path'
import { parseBackupKey, sealBackupArchive } from '../src/backups/archive.js'
import { applicationEnv, backupSnapshotService } from './backup_services.js'

/** Seals a verified snapshot directory into an encrypted `.adulabackup` file (ADR 051). */
export default class BackupSeal extends BaseCommand {
  static commandName = 'backup:seal'
  static description = 'Encrypt a verified snapshot directory into a new .adulabackup file'
  static options = { startApp: true }
  @flags.string({ required: true })
  declare snapshot: string
  @flags.string({ required: true })
  declare file: string

  async run() {
    const env = await applicationEnv(this.app)
    const value = env.get('BACKUP_ENCRYPTION_KEY')
    if (!value) {
      this.logger.error('BACKUP_ENCRYPTION_KEY is not set')
      this.exitCode = 1
      return
    }
    const directory = resolve(this.snapshot)
    const { verifySnapshot } = await backupSnapshotService(this.app)
    await verifySnapshot(directory)
    const { size, sha256 } = await sealBackupArchive(
      directory,
      resolve(this.file),
      parseBackupKey(value)
    )
    this.logger.success(`Sealed ${size} bytes, sha256 ${sha256}`)
  }
}
