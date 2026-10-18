import { BaseCommand, flags } from '@adonisjs/core/ace'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { ResourceRegistry } from '../src/resource/registry.js'
import { applicationEnv, backupSnapshotService } from './backup_services.js'

const run = promisify(execFile)
const SNAPSHOT = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/

type Report = {
  startedAt: string
  finishedAt?: string
  status: 'passed' | 'failed'
  snapshot?: string
  database?: string
  tables?: Record<string, number>
  verifiedFiles?: number
  attachment?: {
    id: number
    resource: string
    recordId: number
    field: string
    path: string
    size: number
    fileVerified: boolean
  } | null
  error?: string
}

async function latestSnapshot(directory: string) {
  const entries = await readdir(directory, { withFileTypes: true })
  const candidates: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !SNAPSHOT.test(entry.name)) continue
    try {
      await stat(join(directory, entry.name, 'COMPLETE'))
      candidates.push(entry.name)
    } catch {}
  }
  if (!candidates.length) throw new Error(`No complete snapshot found under ${directory}`)
  return join(directory, candidates.sort().at(-1)!)
}

export default class BackupRestoreTest extends BaseCommand {
  static commandName = 'backup:restore-test'
  static description =
    'Restore the latest snapshot into a temporary database and verify a record together with its attachment file'
  static options = { startApp: true }
  @flags.string({ description: 'Directory that holds dated snapshots (default: /backups)' })
  declare dir: string
  @flags.string({ description: 'Explicit snapshot directory instead of the latest one' })
  declare snapshot: string
  @flags.boolean({ description: 'Pass even when no record carries an attachment' })
  declare allowEmpty: boolean

  async run() {
    const { default: db } = await import('@adonisjs/lucid/services/db')
    const env = await applicationEnv(this.app)
    const { Settings } = await import('../src/services/settings.js')
    const { isRelativeDiskPath } = await import('../src/attachments/attachment_service.js')
    const { registry } = (await this.app.import('#start/modules')) as {
      registry: ResourceRegistry
    }
    const { verifySnapshot, extractSnapshot, verifyAttachments, restoreAttachments } =
      await backupSnapshotService(this.app)
    const live = db.connection().getWriteClient()
    const settings = new Settings(live)
    const startedAt = new Date()
    const report: Report = { startedAt: startedAt.toISOString(), status: 'failed' }
    const stamp = startedAt
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d+Z$/, '')
      .toLowerCase()
    const database = `${env.get('DB_DATABASE').slice(0, 20)}_restore_${stamp}_${randomUUID().slice(0, 8)}_test`
    const pgEnv = {
      ...process.env,
      PGHOST: env.get('DB_HOST'),
      PGPORT: String(env.get('DB_PORT')),
      PGUSER: env.get('DB_USER'),
      PGPASSWORD: env.get('DB_PASSWORD'),
    }
    let extracted: string | undefined
    let connected = false
    let created = false
    try {
      const snapshot = this.snapshot
        ? resolve(this.snapshot)
        : await latestSnapshot(resolve(this.dir ?? '/backups'))
      report.snapshot = snapshot
      const files = await verifySnapshot(snapshot)
      await live.raw('CREATE DATABASE ??', [database])
      created = true
      report.database = database
      await run(
        'pg_restore',
        [
          '--no-owner',
          '--no-privileges',
          '--exit-on-error',
          `--dbname=${database}`,
          join(snapshot, 'database.dump'),
        ],
        { env: pgEnv, windowsHide: true, timeout: 600000, maxBuffer: 16 * 1024 * 1024 }
      )
      extracted = await mkdtemp(join(tmpdir(), 'adula-restore-'))
      await extractSnapshot(snapshot, extracted)
      db.manager.add(database, {
        client: 'pg',
        connection: {
          host: env.get('DB_HOST'),
          port: env.get('DB_PORT'),
          user: env.get('DB_USER'),
          password: env.get('DB_PASSWORD'),
          database,
        },
        pool: { min: 0, max: 2 },
      })
      connected = true
      const restored = db.connection(database).getWriteClient()
      const tables: Record<string, number> = {}
      for (const resource of registry.all()) {
        const count = await restored(resource.name)
          .whereNull('deleted_at')
          .count('* as count')
          .first()
        tables[resource.name] = Number(count?.count ?? 0)
      }
      const attachments = await restored('attachments')
        .whereNull('deleted_at')
        .count('* as count')
        .first()
      tables.attachments = Number(attachments?.count ?? 0)
      report.tables = tables
      if (files) {
        await verifyAttachments(files, extracted, await restored('attachments').select('*'))
        await restoreAttachments(files, extracted, true)
        report.verifiedFiles = files.length
      } else if (await restored('attachments').whereNot('disk', 'local').first()) {
        throw new Error('Legacy snapshot does not contain non-local attachments')
      }
      const candidate = await restored('attachments')
        .whereNull('deleted_at')
        .whereNotNull('record_id')
        .orderBy('id', 'desc')
        .first()
      if (!candidate) {
        if (!this.allowEmpty)
          throw new Error(
            'No record with an attachment exists in the snapshot; the drill cannot verify a file'
          )
        report.attachment = null
      } else {
        const resource = registry.all().find((entry) => entry.name === candidate.resource)
        if (!resource)
          throw new Error(
            `Attachment ${candidate.id} belongs to unknown resource ${candidate.resource}`
          )
        const record = await restored(resource.name)
          .where('id', candidate.record_id)
          .whereNull('deleted_at')
          .first('id')
        if (!record)
          throw new Error(
            `Record ${candidate.resource}#${candidate.record_id} for attachment ${candidate.id} is missing from the restored database`
          )
        if (!isRelativeDiskPath(candidate.path))
          throw new Error(`Unsafe attachment path: ${candidate.path}`)
        const file = await stat(
          join(extracted, files ? `${candidate.id}.bin` : candidate.path)
        ).catch(() => undefined)
        if (!file || !file.isFile())
          throw new Error(
            `Attachment ${candidate.id} file ${candidate.path} is missing from uploads.tar.gz`
          )
        if (file.size !== Number(candidate.size))
          throw new Error(
            `Attachment ${candidate.id} file ${candidate.path} has ${file.size} bytes, expected ${candidate.size}`
          )
        report.attachment = {
          id: Number(candidate.id),
          resource: String(candidate.resource),
          recordId: Number(candidate.record_id),
          field: String(candidate.field),
          path: String(candidate.path),
          size: Number(candidate.size),
          fileVerified: true,
        }
      }
      report.status = 'passed'
      report.finishedAt = new Date().toISOString()
      await settings.set('backup.lastRestoreTest', report.finishedAt)
      await settings.set('backup.lastRestoreTestReport', report)
      this.logger.success(`Restore drill passed: ${JSON.stringify(report)}`)
    } catch (error) {
      report.error = error instanceof Error ? error.message : String(error)
      report.finishedAt = new Date().toISOString()
      await settings.set('backup.lastRestoreTestReport', report)
      this.logger.error(`Restore drill failed: ${JSON.stringify(report)}`)
      this.exitCode = 1
    } finally {
      if (connected) await db.manager.close(database, true)
      if (created) await live.raw('DROP DATABASE IF EXISTS ?? WITH (FORCE)', [database])
      if (extracted) await rm(extracted, { recursive: true, force: true })
    }
  }
}
