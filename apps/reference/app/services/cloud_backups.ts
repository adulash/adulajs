import app from '@adonisjs/core/services/app'
import encryption from '@adonisjs/core/services/encryption'
import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'
import {
  CloudBackups,
  googleDriveProvider,
  oneDriveProvider,
  parseBackupKey,
  type BackupProviderClient,
  type CloudBackupsOptions,
} from 'adula'
import env from '#start/env'
import { createSnapshot } from '#services/backup_snapshot'

/**
 * The run records only a failure category and a fixed Arabic message; the cause (a missing
 * pg_dump, a refused connection, an unreadable attachment) goes to the server log for operators.
 */
async function loggedSnapshot(directory: string, options: { workDirectory?: string }) {
  try {
    await createSnapshot(directory, options)
  } catch (error) {
    logger.error({ err: error }, 'cloud backup snapshot failed')
    throw error
  }
}

/**
 * Downloadable and cloud backups (ADR 051). Archives are sealed with BACKUP_ENCRYPTION_KEY,
 * kept for the deployment owner apart from APP_KEY; refresh tokens are sealed with the
 * application's encryption service like other stored secrets. A destination is offered only
 * when the deployment configured both values of its OAuth client.
 */
export const BACKUP_DIRECTORY = () => app.makePath('storage/backups')

export function backupRedirectUri(provider: string) {
  return `${env.get('APP_URL').replace(/\/$/, '')}/admin/backups/oauth/${provider}/callback`
}

export function backupKey() {
  const value = env.get('BACKUP_ENCRYPTION_KEY')
  return value ? parseBackupKey(value) : null
}

export function backupProviders(): CloudBackupsOptions['providers'] {
  const providers: Partial<Record<'google' | 'onedrive', BackupProviderClient>> = {}
  const googleId = env.get('BACKUP_GOOGLE_CLIENT_ID')
  const googleSecret = env.get('BACKUP_GOOGLE_CLIENT_SECRET')
  if (googleId && googleSecret)
    providers.google = googleDriveProvider({ clientId: googleId, clientSecret: googleSecret })
  const microsoftId = env.get('BACKUP_MICROSOFT_CLIENT_ID')
  const microsoftSecret = env.get('BACKUP_MICROSOFT_CLIENT_SECRET')
  if (microsoftId && microsoftSecret)
    providers.onedrive = oneDriveProvider({
      clientId: microsoftId,
      clientSecret: microsoftSecret,
      tenant: env.get('BACKUP_MICROSOFT_TENANT') || 'common',
    })
  return providers
}

/** An enabled user who holds the strongest administration permission (manage all). */
export async function activeAdministrator(userId: number) {
  const user = await db.connection().getWriteClient()('users').where({ id: userId }).first()
  if (!user || user.disabled_at) return false
  const { isAdministrator } = await import('#middleware/admin_middleware')
  return isAdministrator(userId)
}

/** Tests replace the providers (local fakes of Drive and Graph) through this override. */
let overrides: Partial<CloudBackupsOptions> = {}
export function overrideCloudBackups(value: Partial<CloudBackupsOptions>) {
  overrides = value
}

export function cloudBackups() {
  return new CloudBackups(db.connection().getWriteClient(), {
    box: {
      seal: (value) => encryption.encrypt(value),
      open: (value) => encryption.decrypt<string>(value),
    },
    key: backupKey(),
    directory: BACKUP_DIRECTORY(),
    createSnapshot: loggedSnapshot,
    providers: backupProviders(),
    isAdministrator: activeAdministrator,
    ...overrides,
  })
}
