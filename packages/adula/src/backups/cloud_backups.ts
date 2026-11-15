import { randomBytes, randomUUID } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import type { Knex } from 'knex'
import { AdulaError } from '../admin/errors.js'
import { logActivity } from '../core/activity.js'
import type { SyncTrigger } from '../integrations/sync_jobs.js'
import type { SecretBox } from '../integrations/webhooks.js'
import { BACKUP_ARCHIVE_EXTENSION, BackupArchiveError, sealBackupArchive } from './archive.js'
import {
  BackupProviderError,
  pkcePair,
  type BackupProvider,
  type BackupProviderClient,
} from './providers.js'

/**
 * Backups an administrator downloads or sends to Google Drive or OneDrive (ADR 051). A run is
 * queued by an administrator or the schedule and executed by the worker: it creates a
 * snapshot in a private working directory, seals it into an encrypted archive, removes the
 * plaintext, then either keeps the archive for a time-limited download or uploads it and
 * deletes the local copy. Refresh tokens are sealed by the host's SecretBox and never leave
 * this class.
 */
export type BackupKind = 'download' | BackupProvider
export type BackupSchedule = 'off' | 'daily' | 'weekly'
/** Same values as a sync run's trigger: who started the run. */
export type BackupTrigger = SyncTrigger
export type BackupRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'expired'

export type BackupConnection = {
  provider: BackupProvider
  status: 'connected' | 'revoked'
  accountLabel: string | null
  schedule: BackupSchedule
  connectedBy: number
  connectedAt: string
}
export type BackupRun = {
  id: number
  kind: BackupKind
  trigger: BackupTrigger
  status: BackupRunStatus
  requestedBy: number
  fileName: string | null
  size: number | null
  sha256: string | null
  expiresAt: string | null
  errorCategory: string | null
  error: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}
export type CloudBackupStatus = {
  /** Whether BACKUP_ENCRYPTION_KEY is set; without it no backup can be created. */
  configured: boolean
  destinations: {
    kind: BackupKind
    /** Whether the deployment configured this destination's OAuth client. */
    configured: boolean
    connection: BackupConnection | null
    lastRun: BackupRun | null
  }[]
  /** Archives ready to download, newest first. */
  downloads: BackupRun[]
  active: BackupRun[]
}

export type CloudBackupsOptions = {
  box: SecretBox
  /** The decoded BACKUP_ENCRYPTION_KEY, or null when the deployment has not set it. */
  key: Buffer | null
  /** A private directory outside public paths and the system temporary directory. */
  directory: string
  createSnapshot(directory: string, options: { workDirectory: string }): Promise<void>
  providers: Partial<Record<BackupProvider, BackupProviderClient>>
  /** The strongest administration decision (CASL manage all) for a user id. */
  isAdministrator(userId: number): Promise<boolean>
  downloadTtlMs?: number
  timeoutMs?: number
  now?: () => Date
}

const KINDS: BackupKind[] = ['download', 'google', 'onedrive']
const PROVIDERS: BackupProvider[] = ['google', 'onedrive']
const SCHEDULES: BackupSchedule[] = ['off', 'daily', 'weekly']
const CLAIM_LOCK = 19300251
const STORED_FILE = /^\d+-[0-9a-f-]{36}\.adulabackup(\.part)?$/

/** The Arabic text stored and shown for a failure category; never a raw error message. */
export const BACKUP_FAILURE_MESSAGES: Record<string, string> = {
  'not-configured': 'مفتاح تشفير النسخ الاحتياطية غير مضبوط في بيئة التشغيل',
  'connection': 'الوجهة غير متصلة. أعد ربطها',
  'actor': 'من ربط الوجهة لم يعد مديرًا للنظام. أعد ربطها بحساب مدير',
  'revoked': 'سحب الحساب إذن الوصول. أعد ربط الوجهة',
  'auth': 'رفض مزود الخدمة بيانات الاعتماد',
  'quota': 'لا توجد مساحة كافية في حساب التخزين',
  'integrity': 'لم يطابق الملف المرفوع النسخة المحلية',
  'snapshot': 'تعذر إنشاء لقطة من قاعدة البيانات والملفات',
  'archive': 'تعذر تشفير النسخة الاحتياطية',
  'timeout': 'انتهت مهلة العملية',
  'interrupted': 'توقفت العملية قبل اكتمالها',
  'response': 'رد مزود الخدمة بصيغة غير متوقعة',
  'blocked-target': 'عنوان مزود الخدمة غير مسموح',
  'dns': 'تعذر الوصول إلى مزود الخدمة',
  'connect': 'تعذر الاتصال بمزود الخدمة',
  'tls': 'فشل الاتصال الآمن بمزود الخدمة',
}

function failureMessage(category: string) {
  return (
    BACKUP_FAILURE_MESSAGES[category] ??
    (category.startsWith('http-status:')
      ? `رد مزود الخدمة برمز ${category.slice('http-status:'.length)}`
      : 'تعذر إكمال النسخ الاحتياطي')
  )
}

function iso(value: unknown) {
  return value ? new Date(value as string).toISOString() : null
}

function runFrom(row: Record<string, any>): BackupRun {
  return {
    id: Number(row.id),
    kind: row.kind,
    trigger: row.trigger,
    status: row.status,
    requestedBy: Number(row.requested_by),
    fileName: row.status === 'succeeded' && row.kind === 'download' ? downloadName(row) : null,
    size: row.size_bytes === null || row.size_bytes === undefined ? null : Number(row.size_bytes),
    sha256: row.sha256 ?? null,
    expiresAt: iso(row.expires_at),
    errorCategory: row.error_category ?? null,
    error: row.error_message ?? null,
    createdAt: iso(row.created_at)!,
    startedAt: iso(row.started_at),
    finishedAt: iso(row.finished_at),
  }
}

function connectionFrom(row: Record<string, any>): BackupConnection {
  // Explicit columns only: the sealed refresh token never leaves the class.
  return {
    provider: row.provider,
    status: row.status,
    accountLabel: row.account_label ?? null,
    schedule: row.schedule,
    connectedBy: Number(row.connected_by),
    connectedAt: iso(row.connected_at)!,
  }
}

/** The file name an administrator receives: the run's start time, never the stored name. */
function downloadName(row: Record<string, any>) {
  const at = new Date(row.started_at ?? row.created_at)
  const stamp = at.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-')
  return `adulajs-backup-${stamp}${BACKUP_ARCHIVE_EXTENSION}`
}

function notConfigured() {
  return new AdulaError(
    409,
    'E_BACKUP_NOT_CONFIGURED',
    'مفتاح تشفير النسخ الاحتياطية غير مضبوط في بيئة التشغيل'
  )
}

function within(parent: string, child: string) {
  const path = relative(parent, child)
  return (
    path === '' || (!path.startsWith('..') && !path.startsWith(sep) && !/^[A-Za-z]:/.test(path))
  )
}

/** The most recent scheduled time at or before `now`: 02:00 UTC daily, or on Fridays. */
export function lastDueTime(schedule: BackupSchedule, now: Date) {
  if (schedule === 'off') return null
  const due = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 2))
  if (due > now) due.setUTCDate(due.getUTCDate() - 1)
  if (schedule === 'weekly') while (due.getUTCDay() !== 5) due.setUTCDate(due.getUTCDate() - 1)
  return due
}

export class CloudBackups {
  private now: () => Date
  private downloadTtlMs: number
  private timeoutMs: number

  constructor(
    private db: Knex,
    private options: CloudBackupsOptions
  ) {
    this.now = options.now ?? (() => new Date())
    this.downloadTtlMs = options.downloadTtlMs ?? 24 * 60 * 60 * 1000
    this.timeoutMs = options.timeoutMs ?? 6 * 60 * 60 * 1000
  }

  get configured() {
    return this.options.key !== null
  }

  private provider(provider: string) {
    if (!(PROVIDERS as string[]).includes(provider))
      throw new AdulaError(404, 'E_NOT_FOUND', 'الوجهة غير موجودة')
    const client = this.options.providers[provider as BackupProvider]
    if (!client)
      throw new AdulaError(
        409,
        'E_BACKUP_PROVIDER_NOT_CONFIGURED',
        'هذه الوجهة غير مهيأة في بيئة التشغيل'
      )
    return client
  }

  /** Connection state, last results and ready downloads; never a token. */
  async status(): Promise<CloudBackupStatus> {
    const connections = await this.db('backup_connections').select(
      'provider',
      'status',
      'account_label',
      'schedule',
      'connected_by',
      'connected_at'
    )
    const destinations = []
    for (const kind of KINDS) {
      const last = await this.db('backup_runs')
        .where({ kind })
        .whereIn('status', ['succeeded', 'failed', 'expired'])
        .orderBy('id', 'desc')
        .first()
      const connection = connections.find((row) => row.provider === kind)
      destinations.push({
        kind,
        configured: kind === 'download' ? true : Boolean(this.options.providers[kind]),
        connection: connection ? connectionFrom(connection) : null,
        lastRun: last ? runFrom(last) : null,
      })
    }
    const downloads = await this.db('backup_runs')
      .where({ kind: 'download', status: 'succeeded' })
      .where('expires_at', '>', this.now())
      .orderBy('id', 'desc')
      .limit(10)
    const active = await this.db('backup_runs')
      .whereIn('status', ['queued', 'running'])
      .orderBy('id', 'asc')
    return {
      configured: this.configured,
      destinations,
      downloads: downloads.map(runFrom),
      active: active.map(runFrom),
    }
  }

  /** Starts an OAuth connection: the caller keeps state and verifier in the server session. */
  beginConnect(provider: string, redirectUri: string) {
    const client = this.provider(provider)
    const state = randomBytes(32).toString('base64url')
    const { verifier, challenge } = pkcePair()
    return {
      url: client.authorizeUrl({ state, codeChallenge: challenge, redirectUri }),
      state,
      verifier,
    }
  }

  async completeConnect(
    provider: string,
    input: { code: string; verifier: string; redirectUri: string },
    actorId: number
  ) {
    const client = this.provider(provider)
    let result: { refreshToken: string; accountLabel: string | null }
    try {
      result = await client.exchange(input)
    } catch (error) {
      await this.connectFailed(provider as BackupProvider, 'exchange', actorId)
      throw new AdulaError(
        502,
        'E_BACKUP_CONNECT',
        error instanceof BackupProviderError
          ? `تعذر ربط الوجهة: ${failureMessage(error.category)}`
          : 'تعذر ربط الوجهة'
      )
    }
    const sealed = this.options.box.seal(result.refreshToken)
    const [row] = await this.db('backup_connections')
      .insert({
        provider,
        status: 'connected',
        account_label: result.accountLabel,
        refresh_token: sealed,
        connected_by: actorId,
        connected_at: this.now(),
        updated_at: this.now(),
      })
      .onConflict('provider')
      .merge([
        'status',
        'account_label',
        'refresh_token',
        'connected_by',
        'connected_at',
        'updated_at',
      ])
      .returning('id')
    await logActivity(this.db, {
      resource: 'core.backups',
      recordId: Number(row.id ?? row),
      actorId,
      action: 'connected',
      changes: { provider },
    })
  }

  /** Records a refused connection attempt (bad state, provider error or failed exchange). */
  async connectFailed(provider: BackupProvider | string, reason: string, actorId: number) {
    await logActivity(this.db, {
      resource: 'core.backups',
      recordId: 0,
      actorId,
      action: 'connect_failed',
      changes: { provider: String(provider).slice(0, 20), reason },
    })
  }

  async disconnect(provider: string, actorId: number) {
    if (!(PROVIDERS as string[]).includes(provider))
      throw new AdulaError(404, 'E_NOT_FOUND', 'الوجهة غير موجودة')
    const row = await this.db('backup_connections').where({ provider }).first()
    if (!row) throw new AdulaError(404, 'E_NOT_FOUND', 'الوجهة غير متصلة')
    const client = this.options.providers[provider as BackupProvider]
    const token = this.options.box.open(row.refresh_token)
    if (client?.revoke && token) {
      try {
        await client.revoke(token)
      } catch {
        // The local token is deleted either way; the provider may already have revoked it.
      }
    }
    await this.db.transaction(async (trx) => {
      await trx('backup_runs')
        .where({ connection_id: row.id, status: 'queued' })
        .update({
          status: 'failed',
          error_category: 'connection',
          error_message: failureMessage('connection'),
          finished_at: this.now(),
        })
      await trx('backup_connections').where({ id: row.id }).delete()
      await logActivity(trx, {
        resource: 'core.backups',
        recordId: Number(row.id),
        actorId,
        action: 'disconnected',
        changes: { provider },
      })
    })
  }

  async setSchedule(provider: string, schedule: string, actorId: number) {
    if (!(SCHEDULES as string[]).includes(schedule))
      throw new AdulaError(422, 'E_VALIDATION', 'اختر جدولًا صحيحًا')
    const row = await this.db('backup_connections').where({ provider }).first()
    if (!row) throw new AdulaError(404, 'E_NOT_FOUND', 'الوجهة غير متصلة')
    await this.db('backup_connections')
      .where({ id: row.id })
      .update({ schedule, updated_at: this.now() })
    await logActivity(this.db, {
      resource: 'core.backups',
      recordId: Number(row.id),
      actorId,
      action: 'scheduled',
      changes: { provider, schedule },
    })
  }

  /** Queues a backup run; one queued or running run per destination. */
  async queue(kind: string, actorId: number, trigger: BackupTrigger = 'manual') {
    if (!(KINDS as string[]).includes(kind))
      throw new AdulaError(422, 'E_VALIDATION', 'اختر وجهة صحيحة')
    if (!this.configured) throw notConfigured()
    let connectionId: number | null = null
    if (kind !== 'download') {
      this.provider(kind)
      const connection = await this.db('backup_connections').where({ provider: kind }).first()
      if (!connection || connection.status !== 'connected')
        throw new AdulaError(409, 'E_BACKUP_NOT_CONNECTED', 'الوجهة غير متصلة. أعد ربطها')
      connectionId = connection.id
    }
    let id: number
    try {
      const [row] = await this.db('backup_runs')
        .insert({
          kind,
          connection_id: connectionId,
          trigger,
          status: 'queued',
          requested_by: actorId,
          // The scheduler compares created_at with this clock (queueDue), not the database's.
          created_at: this.now(),
        })
        .returning('id')
      id = Number(row.id ?? row)
    } catch (error) {
      if ((error as { code?: string }).code === '23505')
        throw new AdulaError(409, 'E_BACKUP_BUSY', 'توجد نسخة احتياطية قيد التنفيذ لهذه الوجهة')
      throw error
    }
    await logActivity(this.db, {
      resource: 'core.backups',
      recordId: id,
      actorId,
      action: 'queued',
      changes: { kind, trigger },
    })
    return id
  }

  /**
   * Queues the scheduled runs that are due: one per connected destination and period. A
   * destination whose connecting administrator lost that role gets one failed run per period.
   */
  async queueDue() {
    if (!this.configured) return 0
    const now = this.now()
    let queued = 0
    const connections = await this.db('backup_connections')
      .where({ status: 'connected' })
      .whereNot({ schedule: 'off' })
    for (const connection of connections) {
      if (!this.options.providers[connection.provider as BackupProvider]) continue
      const due = lastDueTime(connection.schedule, now)
      if (!due) continue
      const since =
        due > new Date(connection.connected_at) ? due : new Date(connection.connected_at)
      const recent = await this.db('backup_runs')
        .where({ kind: connection.provider })
        .where('created_at', '>=', since)
        .first()
      if (recent) continue
      if (!(await this.options.isAdministrator(Number(connection.connected_by)))) {
        const [row] = await this.db('backup_runs')
          .insert({
            kind: connection.provider,
            connection_id: connection.id,
            trigger: 'schedule',
            status: 'failed',
            requested_by: connection.connected_by,
            error_category: 'actor',
            error_message: failureMessage('actor'),
            created_at: now,
            finished_at: now,
          })
          .returning('id')
        await this.audit(Number(row.id ?? row), Number(connection.connected_by), 'failed', {
          kind: connection.provider,
          trigger: 'schedule',
          errorCategory: 'actor',
        })
        continue
      }
      try {
        await this.queue(connection.provider, Number(connection.connected_by), 'schedule')
        queued++
      } catch (error) {
        if (!(error instanceof AdulaError) || error.code !== 'E_BACKUP_BUSY') throw error
      }
    }
    return queued
  }

  private async audit(
    id: number,
    actorId: number,
    action: string,
    changes: Record<string, unknown>
  ) {
    await logActivity(this.db, { resource: 'core.backups', recordId: id, actorId, action, changes })
  }

  /** Claims the oldest queued run; only one backup runs in the whole system at a time. */
  private async claim() {
    return this.db.transaction(async (trx) => {
      await trx.raw('SELECT pg_advisory_xact_lock(?)', [CLAIM_LOCK])
      const running = await trx('backup_runs').where({ status: 'running' }).first()
      if (running) return null
      const row = await trx('backup_runs')
        .where({ status: 'queued' })
        .orderBy('id', 'asc')
        .forUpdate()
        .skipLocked()
        .first()
      if (!row) return null
      const [claimed] = await trx('backup_runs')
        .where({ id: row.id })
        .update({ status: 'running', started_at: this.now() })
        .returning('*')
      return claimed as Record<string, any>
    })
  }

  private async privateDirectory() {
    const root = resolve(this.options.directory)
    if (within(resolve(tmpdir()), root) || /[\\/]public([\\/]|$)/.test(root))
      throw new Error('The backup directory must not be inside public or temporary paths')
    await mkdir(join(root, 'files'), { recursive: true, mode: 0o700 })
    await chmod(root, 0o700).catch(() => {})
    await chmod(join(root, 'files'), 0o700).catch(() => {})
    return root
  }

  /** Runs the next queued backup; returns its id, or null when nothing ran. */
  async runNext(signal?: AbortSignal) {
    const run = await this.claim()
    if (!run) return null
    const id = Number(run.id)
    const actorId = Number(run.requested_by)
    const changes = { kind: run.kind, trigger: run.trigger }
    let local: string | null = null
    try {
      if (!this.options.key) throw new CategorizedFailure('not-configured')
      let client: BackupProviderClient | undefined
      let connection: Record<string, any> | undefined
      if (run.kind !== 'download') {
        client = this.options.providers[run.kind as BackupProvider]
        connection = await this.db('backup_connections').where({ provider: run.kind }).first()
        if (!client || !connection || connection.status !== 'connected')
          throw new CategorizedFailure('connection')
      }
      if (!(await this.options.isAdministrator(actorId))) throw new CategorizedFailure('actor')
      const root = await this.privateDirectory()
      const sealed = await this.sealSnapshot(root, id)
      local = sealed.path
      if (run.kind === 'download') {
        await this.db('backup_runs')
          .where({ id })
          .update({
            status: 'succeeded',
            file_name: sealed.stored,
            size_bytes: sealed.size,
            sha256: sealed.sha256,
            expires_at: new Date(this.now().getTime() + this.downloadTtlMs),
            finished_at: this.now(),
          })
        local = null
        await this.audit(id, actorId, 'succeeded', {
          ...changes,
          size: sealed.size,
          sha256: sealed.sha256,
        })
        return id
      }
      const token = this.options.box.open(connection!.refresh_token)
      if (!token) throw new CategorizedFailure('revoked')
      const access = await client!.refresh(token)
      if (access.refreshToken && access.refreshToken !== token)
        await this.db('backup_connections')
          .where({ id: connection!.id })
          .update({
            refresh_token: this.options.box.seal(access.refreshToken),
            updated_at: this.now(),
          })
      const uploaded = await client!.upload({
        file: sealed.path,
        name: downloadName(run),
        size: sealed.size,
        sha256: sealed.sha256,
        accessToken: access.accessToken,
        signal: AbortSignal.any([AbortSignal.timeout(this.timeoutMs), ...(signal ? [signal] : [])]),
      })
      await this.db('backup_runs')
        .where({ id })
        .update({
          status: 'succeeded',
          size_bytes: sealed.size,
          sha256: sealed.sha256,
          remote_id: uploaded.remoteId.slice(0, 500),
          finished_at: this.now(),
        })
      await this.audit(id, actorId, 'succeeded', {
        ...changes,
        size: sealed.size,
        sha256: sealed.sha256,
        remoteId: uploaded.remoteId.slice(0, 500),
      })
      return id
    } catch (error) {
      const category = failureCategory(error)
      await this.db('backup_runs')
        .where({ id })
        .update({
          status: 'failed',
          error_category: category,
          error_message: failureMessage(category),
          finished_at: this.now(),
        })
      if (category === 'revoked' && run.kind !== 'download')
        await this.db('backup_connections')
          .where({ provider: run.kind })
          .update({ status: 'revoked', updated_at: this.now() })
      await this.audit(id, actorId, 'failed', { ...changes, errorCategory: category })
      return id
    } finally {
      if (local) await rm(local, { force: true })
    }
  }

  /** Snapshot → sealed archive. The plaintext working directory is removed in every case. */
  private async sealSnapshot(root: string, id: number) {
    const work = await mkdtemp(join(root, 'work-'))
    const stored = `${id}-${randomUUID()}${BACKUP_ARCHIVE_EXTENSION}`
    const path = join(root, 'files', stored)
    const part = `${path}.part`
    try {
      await chmod(work, 0o700).catch(() => {})
      const snapshot = join(work, 'snapshot')
      try {
        await this.options.createSnapshot(snapshot, { workDirectory: work })
        await writeFile(join(snapshot, 'COMPLETE'), '', { mode: 0o600 })
      } catch (error) {
        throw new CategorizedFailure('snapshot', error)
      }
      let sealed: { size: number; sha256: string }
      try {
        sealed = await sealBackupArchive(snapshot, part, this.options.key!)
      } catch (error) {
        throw new CategorizedFailure('archive', error)
      }
      await rename(part, path)
      return { path, stored, ...sealed }
    } catch (error) {
      await rm(part, { force: true })
      throw error
    } finally {
      await rm(work, { recursive: true, force: true })
    }
  }

  /**
   * A ready download for an administrator: the stored path and the name to send. The access
   * is audited. Missing, expired, failed and non-download runs are not found.
   */
  async download(runId: number, actorId: number) {
    if (!Number.isSafeInteger(runId) || runId < 1)
      throw new AdulaError(404, 'E_NOT_FOUND', 'النسخة الاحتياطية غير موجودة')
    const row = await this.db('backup_runs')
      .where({ id: runId, kind: 'download', status: 'succeeded' })
      .where('expires_at', '>', this.now())
      .first()
    if (!row || !row.file_name || !STORED_FILE.test(row.file_name))
      throw new AdulaError(404, 'E_NOT_FOUND', 'النسخة الاحتياطية غير موجودة أو انتهت صلاحيتها')
    const path = join(resolve(this.options.directory), 'files', row.file_name)
    try {
      await stat(path)
    } catch {
      throw new AdulaError(404, 'E_NOT_FOUND', 'النسخة الاحتياطية غير موجودة أو انتهت صلاحيتها')
    }
    await this.audit(runId, actorId, 'downloaded', {
      size: Number(row.size_bytes),
      sha256: row.sha256,
    })
    return { path, fileName: downloadName(row), size: Number(row.size_bytes) }
  }

  /** Marks runs that a stopped worker left running as failed. */
  async recoverStale() {
    const cutoff = new Date(this.now().getTime() - this.timeoutMs)
    const rows = await this.db('backup_runs')
      .where({ status: 'running' })
      .where('started_at', '<', cutoff)
      .update({
        status: 'failed',
        error_category: 'interrupted',
        error_message: failureMessage('interrupted'),
        finished_at: this.now(),
      })
      .returning(['id', 'requested_by', 'kind', 'trigger'])
    for (const row of rows)
      await this.audit(Number(row.id), Number(row.requested_by), 'failed', {
        kind: row.kind,
        trigger: row.trigger,
        errorCategory: 'interrupted',
      })
    return rows.length
  }

  /**
   * Deletes expired downloads and leftovers of interrupted runs. Only this class's own names
   * under the backup directory are touched: `files/<id>-<uuid>.adulabackup[.part]` and `work-*`.
   */
  async pruneExpired() {
    const now = this.now()
    const root = resolve(this.options.directory)
    const expired = await this.db('backup_runs')
      .where({ kind: 'download', status: 'succeeded' })
      .where('expires_at', '<=', now)
    for (const row of expired) {
      if (row.file_name && STORED_FILE.test(row.file_name))
        await rm(join(root, 'files', row.file_name), { force: true })
      await this.db('backup_runs').where({ id: row.id }).update({ status: 'expired' })
    }
    const kept = await this.db('backup_runs')
      .where({ kind: 'download', status: 'succeeded' })
      .whereNotNull('file_name')
      .select('file_name')
    const keep = new Set(kept.map((row) => row.file_name))
    const stale = now.getTime() - this.timeoutMs
    const entries = async (path: string) => {
      try {
        return await readdir(path, { withFileTypes: true })
      } catch {
        return []
      }
    }
    for (const entry of await entries(join(root, 'files'))) {
      if (!entry.isFile() || !STORED_FILE.test(entry.name) || keep.has(entry.name)) continue
      const path = join(root, 'files', entry.name)
      const info = await stat(path).catch(() => null)
      if (info && info.mtimeMs < stale) await rm(path, { force: true })
    }
    for (const entry of await entries(root)) {
      if (!entry.isDirectory() || !entry.name.startsWith('work-')) continue
      const path = join(root, entry.name)
      const info = await stat(path).catch(() => null)
      if (info && info.mtimeMs < stale) await rm(path, { recursive: true, force: true })
    }
    return expired.length
  }
}

class CategorizedFailure extends Error {
  constructor(
    public category: string,
    cause?: unknown
  ) {
    super(category, { cause })
  }
}

function failureCategory(error: unknown) {
  if (error instanceof CategorizedFailure) return error.category
  if (error instanceof BackupProviderError) return error.category
  if (error instanceof BackupArchiveError) return 'archive'
  const name = (error as { name?: string })?.name
  if (name === 'TimeoutError' || name === 'AbortError') return 'timeout'
  return 'snapshot'
}
