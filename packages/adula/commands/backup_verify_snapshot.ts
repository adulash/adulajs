import { BaseCommand, flags } from '@adonisjs/core/ace'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { applicationEnv, backupSnapshotService } from './backup_services.js'

export default class BackupVerifySnapshot extends BaseCommand {
  static commandName = 'backup:verify-snapshot'
  static description = 'Validate snapshot checksums, manifest and archive before database recovery'
  static options = { startApp: true }
  @flags.string({ required: true })
  declare snapshot: string

  async run() {
    const { verifySnapshot, extractSnapshot, verifyAttachments } = await backupSnapshotService(
      this.app
    )
    const env = await applicationEnv(this.app)
    const directory = resolve(this.snapshot)
    const files = await verifySnapshot(directory)
    if (!files && env.get('DRIVE_DISK') !== 'local')
      throw new Error('Legacy snapshot does not contain S3 attachments')
    const extracted = await mkdtemp(join(tmpdir(), 'adula-verify-'))
    try {
      await extractSnapshot(directory, extracted)
      if (files) await verifyAttachments(files, extracted, files)
      this.logger.success('Snapshot integrity verified')
    } finally {
      await rm(extracted, { recursive: true, force: true })
    }
  }
}
