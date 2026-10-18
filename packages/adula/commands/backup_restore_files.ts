import { BaseCommand, flags } from '@adonisjs/core/ace'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { backupSnapshotService } from './backup_services.js'

export default class BackupRestoreFiles extends BaseCommand {
  static commandName = 'backup:restore-files'
  static description =
    'Restore verified attachment bytes to their original disks after database recovery'
  static options = { startApp: true }

  @flags.string({ required: true })
  declare snapshot: string
  @flags.boolean({
    description: 'Write original attachment keys; stop application traffic before recovery',
  })
  declare apply: boolean

  async run() {
    if (!this.apply)
      throw new Error('Use --apply after restoring the database with application traffic stopped')
    const { default: db } = await import('@adonisjs/lucid/services/db')
    const { verifySnapshot, extractSnapshot, verifyAttachments, restoreAttachments } =
      await backupSnapshotService(this.app)
    const snapshot = resolve(this.snapshot)
    const files = await verifySnapshot(snapshot)
    if (!files) throw new Error('Legacy snapshots must use the local-files restore script')
    const extracted = await mkdtemp(join(tmpdir(), 'adula-recovery-'))
    try {
      await extractSnapshot(snapshot, extracted)
      await verifyAttachments(
        files,
        extracted,
        await db.connection().getWriteClient()('attachments').select('*')
      )
      await restoreAttachments(files, extracted, false)
      this.logger.success(
        `Restored and verified ${files.length} attachments on their original disks`
      )
    } finally {
      await rm(extracted, { recursive: true, force: true })
    }
  }
}
