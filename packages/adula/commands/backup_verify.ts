import { BaseCommand } from '@adonisjs/core/ace'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { applicationEnv } from './backup_services.js'

export default class BackupVerify extends BaseCommand {
  static commandName = 'backup:verify'
  static description = 'Verify recent database, uploads and checksum objects in offsite storage'
  static options = { startApp: true }
  async run() {
    const { verifyBackup } = await import('../src/services/backup.js')
    const { default: db } = await import('@adonisjs/lucid/services/db')
    const env = await applicationEnv(this.app)
    const prefix = env.get('BACKUP_S3_PREFIX') ?? 'adula'
    const status = await verifyBackup(
      db.connection().getWriteClient(),
      async () => {
        const endpoint = env.get('BACKUP_S3_ENDPOINT')
        const bucket = env.get('BACKUP_S3_BUCKET')
        if (!endpoint || !bucket) throw new Error('Offsite storage is not configured')
        const { stdout } = await promisify(execFile)(
          'aws',
          [
            '--endpoint-url',
            endpoint,
            's3api',
            'list-objects-v2',
            '--bucket',
            bucket,
            '--prefix',
            prefix + '/',
            '--output',
            'json',
          ],
          {
            timeout: 60000,
            maxBuffer: 16 * 1024 * 1024,
            windowsHide: true,
            env: {
              ...process.env,
              AWS_ACCESS_KEY_ID: env.get('BACKUP_S3_ACCESS_KEY_ID'),
              AWS_SECRET_ACCESS_KEY: env.get('BACKUP_S3_SECRET_ACCESS_KEY'),
              AWS_DEFAULT_REGION: env.get('BACKUP_S3_REGION'),
              AWS_PAGER: '',
            },
          }
        )
        const result = JSON.parse(stdout) as {
          Contents?: { Key: string; Size: number; LastModified: string }[]
        }
        return (result.Contents ?? []).map((item) => ({
          key: item.Key,
          size: item.Size,
          modifiedAt: item.LastModified,
        }))
      },
      Date.now(),
      prefix
    )
    const { Settings } = await import('../src/services/settings.js')
    const { backupFingerprint } = (await this.app.import('#services/initial_setup')) as {
      backupFingerprint: () => string
    }
    await new Settings(db.connection().getWriteClient()).set('setup.backup_check', {
      fingerprint: backupFingerprint(),
      at: status.checkedAt,
    })
    this.logger.log(JSON.stringify(status))
    if (!status.healthy) this.exitCode = 1
  }
}
