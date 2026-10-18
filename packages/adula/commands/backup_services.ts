import type { ApplicationService } from '@adonisjs/core/types'

/**
 * The backup commands ship with the package, while the snapshot format, the Drive disks and
 * the validated environment belong to the application. They are resolved through the
 * application's importer, so `#start/env` and `#services/backup_*` are the application's own.
 */
export type ArchivedAttachment = {
  id: number
  disk: string
  path: string
  size: number
  sha256: string
}

export type BackupSnapshotService = {
  createSnapshot(directory: string): Promise<void>
  verifySnapshot(directory: string): Promise<ArchivedAttachment[] | null>
  extractSnapshot(directory: string, target: string): Promise<void>
  verifyAttachments(
    files: ArchivedAttachment[],
    extracted: string,
    rows: Record<string, any>[]
  ): Promise<void>
  restoreAttachments(files: ArchivedAttachment[], extracted: string, drill: boolean): Promise<void>
}

export type SnapshotTransport = {
  exists(): Promise<boolean>
  put(name: string, file?: string): Promise<void>
  read(name: string): Promise<AsyncIterable<Uint8Array>>
}

/** The application's validated environment (`#start/env`). */
export type ApplicationEnv = { get(key: string): any }

export async function applicationEnv(app: ApplicationService) {
  return ((await app.import('#start/env')) as { default: ApplicationEnv }).default
}

export async function backupSnapshotService(app: ApplicationService) {
  return (await app.import('#services/backup_snapshot')) as BackupSnapshotService
}
