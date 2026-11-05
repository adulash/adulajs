import type { Finding } from '../commands/doctor.js'
import { parseBackupKey } from './archive.js'

/**
 * Readiness of downloadable and cloud backups (ADR 051). Every part is optional: a missing key
 * or OAuth client is reported as not configured, never as a failure. A malformed key or a
 * half-configured client is a failure, because the deployment meant to set it.
 */
export function diagnoseCloudBackups(env: Record<string, string | undefined>): Finding[] {
  const findings: Finding[] = []
  const key = env.BACKUP_ENCRYPTION_KEY
  if (!key)
    findings.push({
      check: 'backup.encryption_key',
      status: 'info',
      message:
        'BACKUP_ENCRYPTION_KEY is not configured: encrypted downloads and Drive/OneDrive backups are off',
    })
  else {
    let valid = true
    try {
      parseBackupKey(key)
    } catch {
      valid = false
    }
    findings.push({
      check: 'backup.encryption_key',
      status: valid ? 'pass' : 'fail',
      message: valid
        ? 'BACKUP_ENCRYPTION_KEY is set; keep an offline copy, archives cannot be opened without it'
        : 'BACKUP_ENCRYPTION_KEY must be the base64 encoding of exactly 32 random bytes',
    })
  }
  for (const [check, label, id, secret] of [
    [
      'backup.google_drive',
      'Google Drive',
      'BACKUP_GOOGLE_CLIENT_ID',
      'BACKUP_GOOGLE_CLIENT_SECRET',
    ],
    ['backup.onedrive', 'OneDrive', 'BACKUP_MICROSOFT_CLIENT_ID', 'BACKUP_MICROSOFT_CLIENT_SECRET'],
  ] as const) {
    const present = [env[id], env[secret]].filter(Boolean).length
    findings.push({
      check,
      status: present === 1 ? 'fail' : present === 2 && !key ? 'warn' : present ? 'pass' : 'info',
      message:
        present === 0
          ? `${label} backups are not configured`
          : present === 1
            ? `${label} needs both ${id} and ${secret}`
            : key
              ? `${label} OAuth client is configured; register the redirect URI <APP_URL>/admin/backups/oauth/${check === 'backup.google_drive' ? 'google' : 'onedrive'}/callback`
              : `${label} is configured, but uploads stay off until BACKUP_ENCRYPTION_KEY is set`,
    })
  }
  return findings
}
