import type { Knex } from 'knex'
import type { ResourceService, SystemSaveOptions } from '../admin/resource_service.js'
import type { RecordData } from '../resource/types.js'
import { AdulaError } from '../admin/errors.js'
import {
  OutboundTargetError,
  outboundErrorCategory,
  type OutboundErrorCategory,
} from './outbound.js'

export type SyncTrigger = 'schedule' | 'manual'
export type SyncRunStatus = 'queued' | 'running' | 'succeeded' | 'failed'
/** Stored failure categories; the page translates them, the message is secondary. */
export type SyncErrorCategory =
  'timeout' | 'validation' | 'authorization' | 'conflict' | 'handler' | OutboundErrorCategory
/** Counters a handler returns, such as { created: 3, updated: 1 }. */
export type SyncStats = Record<string, number>

export type SyncLogger = {
  info(message: string, data?: Record<string, unknown>): void
  warn(message: string, data?: Record<string, unknown>): void
  error(message: string, data?: Record<string, unknown>): void
}

/** ResourceService.systemSave options; `id` updates, and actorId defaults to the requester. */
export type SyncSaveOptions = Omit<SystemSaveOptions, 'actorId'> & {
  id?: number
  actorId?: number | null
}

export type SyncJobContext = {
  jobName: string
  runId: number
  trigger: SyncTrigger
  /** The user who pressed "run now"; null for scheduled runs. */
  requestedBy: number | null
  /** When this job last finished successfully, for incremental pulls. */
  lastSuccessAt: Date | null
  /** Aborted when the run exceeds its timeout; pass it to outbound requests. */
  signal: AbortSignal
  logger: SyncLogger
  /**
   * Writes a record through ResourceService.systemSave (validator, hooks, audit trail).
   * Creates need an author: actorId defaults to requestedBy, so a scheduled job that
   * creates records passes the integration user's id explicitly.
   */
  systemSave(resource: string, values: RecordData, options?: SyncSaveOptions): Promise<RecordData>
}

export type SyncJobDefinition = {
  name: string
  label: { ar: string; en?: string }
  /** Five fields (minute hour day month weekday), numbers, `*`, ranges, steps and lists. */
  cron: string
  timeoutMs: number
  handler: (ctx: SyncJobContext) => Promise<SyncStats | void>
}
export type SyncJobInput = Omit<SyncJobDefinition, 'timeoutMs'> & { timeoutMs?: number }

export type SyncRun = {
  id: number
  job: string
  trigger: SyncTrigger
  status: SyncRunStatus
  requestedBy: number | null
  queuedAt: string
  startedAt: string | null
  finishedAt: string | null
  durationMs: number | null
  errorCategory: SyncErrorCategory | null
  errorMessage: string | null
  stats: SyncStats
}

export type SyncJobSummary = {
  name: string
  label: { ar: string; en?: string }
  cron: string
  timeoutMs: number
  /** A queued or running run exists; "run now" is refused until it finishes. */
  busy: boolean
  lastRun: SyncRun | null
  lastSuccessAt: string | null
  /** The category of the latest finished run when it failed. */
  lastErrorCategory: SyncErrorCategory | null
  /** The next scheduled time in the server's time zone, as the scheduler fires it. */
  nextRunAt: string | null
}

export type SyncJobsOptions = {
  logger?: SyncLogger
  /** How long past its timeout a running row may stay before it counts as crashed. */
  staleMarginMs?: number
}

/** A failure the handler classifies itself, for example `http-status:503` from a remote API. */
export class SyncJobError extends Error {
  constructor(
    public category: SyncErrorCategory,
    message: string
  ) {
    super(message)
  }
}

export const SYNC_DEFAULT_TIMEOUT_MS = 5 * 60_000
const MAX_TIMEOUT_MS = 6 * 60 * 60_000
const STALE_MARGIN_MS = 60_000
const MESSAGE_LIMIT = 500
const NAME = /^sync:[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Declares a background synchronization job; the scheduler queues it and the worker runs it. */
export function defineSyncJob(input: SyncJobInput): SyncJobDefinition {
  if (typeof input.name !== 'string' || input.name.length > 100 || !NAME.test(input.name))
    throw new Error(`Sync job name "${input.name}" must look like sync:kebab-case`)
  if (!input.label?.ar?.trim()) throw new Error(`Sync job ${input.name} needs an Arabic label`)
  parseCron(input.cron, input.name)
  const timeoutMs = input.timeoutMs ?? SYNC_DEFAULT_TIMEOUT_MS
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS)
    throw new Error(`Sync job ${input.name} timeoutMs must be between 1 ms and 6 hours`)
  if (typeof input.handler !== 'function') throw new Error(`Sync job ${input.name} needs a handler`)
  return { ...input, cron: input.cron.trim().replace(/\s+/g, ' '), timeoutMs }
}

type CronFields = [Set<number>, Set<number>, Set<number>, Set<number>, Set<number>]
const CRON_BOUNDS: [number, number][] = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
]

/**
 * Parses the subset of node-cron syntax (used by adonisjs-scheduler) whose meaning is
 * unambiguous. Steps follow node-cron: `a-b/n` keeps the values divisible by n.
 */
function parseCron(expression: unknown, job: string): CronFields {
  const parts = typeof expression === 'string' ? expression.trim().split(/\s+/) : []
  if (parts.length !== 5)
    throw new Error(`Sync job ${job} cron must have five fields (minute hour day month weekday)`)
  return parts.map((part, index) => {
    const [min, max] = CRON_BOUNDS[index]
    const values = new Set<number>()
    for (const item of part.split(',')) {
      const match = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(item)
      const from = match?.[2] === undefined ? min : Number(match[2])
      const to = match?.[3] !== undefined ? Number(match[3]) : match?.[1] === '*' ? max : from
      const step = match?.[4] === undefined ? 1 : Number(match[4])
      const stepped = match?.[4] !== undefined
      if (
        !match ||
        from < min ||
        to > max ||
        from > to ||
        step < 1 ||
        (stepped && part.includes(','))
      )
        throw new Error(`Sync job ${job} has an invalid cron field "${part}"`)
      // node-cron counts Sunday as 0 or 7.
      for (let value = from; value <= to; value++)
        if (value % step === 0 || !stepped) values.add(index === 4 && value === 7 ? 0 : value)
    }
    if (values.size === 0) throw new Error(`Sync job ${job} has an empty cron field "${part}"`)
    return values
  }) as CronFields
}

/** The first minute after `after` matching every field (node-cron matches day AND weekday). */
function nextCronTime(fields: CronFields, after: Date): Date | null {
  const [minutes, hours, days, months, weekdays] = fields
  const at = new Date(after)
  at.setSeconds(0, 0)
  at.setMinutes(at.getMinutes() + 1)
  for (let step = 0; step < 100_000; step++) {
    if (!months.has(at.getMonth() + 1)) {
      at.setMonth(at.getMonth() + 1, 1)
      at.setHours(0, 0, 0, 0)
    } else if (!days.has(at.getDate()) || !weekdays.has(at.getDay())) {
      at.setDate(at.getDate() + 1)
      at.setHours(0, 0, 0, 0)
    } else if (!hours.has(at.getHours())) at.setHours(at.getHours() + 1, 0, 0, 0)
    else if (!minutes.has(at.getMinutes())) at.setMinutes(at.getMinutes() + 1, 0, 0)
    else return at
  }
  return null
}

const VALIDATION_CODES = /^(23502|23503|23505|23514|22\w{3})$/

/** Classifies a handler failure for storage and display. */
export function syncErrorCategory(error: unknown): SyncErrorCategory {
  if (error instanceof SyncJobError) return error.category
  const { status, code } = (error ?? {}) as { status?: number; code?: string }
  // E_ACTOR: the write has no author the job may act for (for example a scheduled create).
  if (code === 'E_ACTOR' || status === 401 || status === 403) return 'authorization'
  if (code === 'E_VALIDATION_ERROR' || status === 422) return 'validation'
  if (status === 409) return 'conflict'
  if (typeof code === 'string' && VALIDATION_CODES.test(code)) return 'validation'
  if (error instanceof AdulaError) return 'handler'
  // outboundErrorCategory falls back to 'connect'; only trust it for network failures.
  const outbound = outboundErrorCategory(error)
  if (outbound !== 'connect' || error instanceof OutboundTargetError) return outbound
  for (let current = error, depth = 0; current && depth < 5; depth++) {
    const nested = (current as { code?: string }).code
    if (typeof nested === 'string' && /^(ECONN|ENET|EHOST|EPIPE|UND_ERR)/.test(nested))
      return 'connect'
    current = (current as { cause?: unknown }).cause
  }
  return 'handler'
}

/** Keeps the message useful while dropping credentials, query strings and control characters. */
function sanitize(error: unknown): string {
  let raw = error instanceof Error ? error.message : String(error)
  // VineJS keeps the refused fields in `messages`; name them, never their values.
  const fields = (error as { messages?: { field?: unknown }[] })?.messages
  if (Array.isArray(fields))
    raw += `: ${[...new Set(fields.map((item) => String(item?.field ?? '')).filter(Boolean))].join(', ')}`
  const clean = raw
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/(\w+:\/\/)[^/\s@]+@/g, '$1')
    .replace(/(https?:\/\/[^\s?#]+)[?#]\S*/g, '$1')
    .replace(/\b(bearer|basic)\s+[\w.~+/=-]+/gi, '$1 [hidden]')
    .replace(
      /\b(password|secret|token|api[_-]?key|authorization)(["']?\s*[:=]\s*)\S+/gi,
      '$1$2[hidden]'
    )
    .replace(/\s+/g, ' ')
    .trim()
  return clean.length > MESSAGE_LIMIT ? `${clean.slice(0, MESSAGE_LIMIT - 1)}…` : clean
}

const iso = (value: unknown) => (value ? new Date(value as string).toISOString() : null)
const silent: SyncLogger = { info: () => {}, warn: () => {}, error: () => {} }

/**
 * Background synchronization runs (sync_job_runs). The scheduler and "run now" queue a
 * run; the worker claims one with SKIP LOCKED and runs its handler under a timeout. At
 * most one queued or running run exists per job, enforced by a partial unique index.
 */
export class SyncJobs {
  private definitions = new Map<string, SyncJobDefinition>()
  private crons = new Map<string, CronFields>()

  constructor(
    private db: Knex,
    private resources: ResourceService,
    definitions: SyncJobDefinition[],
    private options: SyncJobsOptions = {}
  ) {
    for (const definition of definitions) {
      if (this.definitions.has(definition.name))
        throw new Error(`Sync job ${definition.name} is defined twice`)
      this.definitions.set(definition.name, definition)
      this.crons.set(definition.name, parseCron(definition.cron, definition.name))
    }
  }

  all(): SyncJobDefinition[] {
    return [...this.definitions.values()]
  }

  private definition(name: string) {
    const definition = this.definitions.get(name)
    if (!definition) throw new AdulaError(404, 'E_SYNC_JOB_NOT_FOUND', 'مهمة المزامنة غير موجودة')
    return definition
  }

  /** Queues a run; refuses (409) while a run of the same job is queued or running. */
  async queue(name: string, trigger: SyncTrigger, requestedBy: number | null = null) {
    this.definition(name)
    await this.recoverStale()
    try {
      const [row] = await this.db('sync_job_runs')
        .insert({ job: name, trigger, status: 'queued', requested_by: requestedBy })
        .returning('*')
      return this.serialize(row)
    } catch (error) {
      if ((error as { code?: string }).code === '23505')
        throw new AdulaError(
          409,
          'E_SYNC_JOB_BUSY',
          'مهمة المزامنة بانتظار التشغيل أو قيد التشغيل بالفعل'
        )
      throw error
    }
  }

  /** Runs the oldest queued run of a defined job; null when nothing is queued. */
  async runNext(): Promise<SyncRun | null> {
    await this.recoverStale()
    const names = [...this.definitions.keys()]
    if (!names.length) return null
    const claimed = await this.db.transaction(async (trx) => {
      const row = await trx('sync_job_runs')
        .where('status', 'queued')
        .whereIn('job', names)
        .orderBy([{ column: 'queued_at' }, { column: 'id' }])
        .forUpdate()
        .skipLocked()
        .first()
      if (!row) return null
      const [running] = await trx('sync_job_runs')
        .where('id', row.id)
        .update({ status: 'running', started_at: trx.fn.now() })
        .returning('*')
      return running
    })
    if (!claimed) return null
    const definition = this.definition(String(claimed.job))
    const runId = Number(claimed.id)
    const requestedBy = claimed.requested_by === null ? null : Number(claimed.requested_by)
    const last = await this.db('sync_job_runs')
      .where({ job: definition.name, status: 'succeeded' })
      .max('finished_at as at')
      .first()
    const base = this.options.logger ?? silent
    const tag = { job: definition.name, runId }
    const controller = new AbortController()
    // After the timeout the handler's tools refuse, so an ignored signal cannot keep writing.
    const live = () => {
      if (controller.signal.aborted) throw controller.signal.reason
    }
    const logger: SyncLogger = {
      info: (message, data) => (live(), base.info(message, { ...tag, ...data })),
      warn: (message, data) => (live(), base.warn(message, { ...tag, ...data })),
      error: (message, data) => (live(), base.error(message, { ...tag, ...data })),
    }
    const margin = this.options.staleMarginMs ?? STALE_MARGIN_MS
    const timers: NodeJS.Timeout[] = []
    timers.push(
      setTimeout(
        () =>
          controller.abort(
            new SyncJobError('timeout', `Sync job exceeded ${definition.timeoutMs} ms`)
          ),
        definition.timeoutMs
      )
    )
    // The row stays running (and the job busy) until the handler settles. One that never
    // settles is abandoned at the stale limit, as recoverStale would do for a crash.
    const abandoned = new Promise<{ abandoned: true }>((resolve) => {
      timers.push(setTimeout(() => resolve({ abandoned: true }), definition.timeoutMs + margin))
    })
    const started = Date.now()
    const settled = Promise.resolve()
      .then(() =>
        definition.handler({
          jobName: definition.name,
          runId,
          trigger: claimed.trigger,
          requestedBy,
          lastSuccessAt: last?.at ? new Date(last.at) : null,
          signal: controller.signal,
          logger,
          systemSave: async (resource, values, { id, actorId, ...options } = {}) => {
            live()
            return this.resources.systemSave(resource, values, id, {
              reason: definition.name,
              ...options,
              actorId: actorId === undefined ? requestedBy : actorId,
            })
          },
        })
      )
      .then(
        (stats) => ({ ok: true as const, stats }),
        (error: unknown) => ({ ok: false as const, error })
      )
    const outcome = await Promise.race([settled, abandoned])
    for (const timer of timers) clearTimeout(timer)
    let update: Record<string, unknown>
    if ('abandoned' in outcome || controller.signal.aborted) {
      update = {
        status: 'failed',
        error_category: 'timeout',
        error_message: sanitize(
          'abandoned' in outcome
            ? 'لم تتوقف المهمة بعد انتهاء مهلتها؛ أوقفت كتاباتها واعتُبرت منتهية المهلة'
            : controller.signal.reason
        ),
      }
    } else if (outcome.ok) {
      update = { status: 'succeeded', stats: JSON.stringify(numericStats(outcome.stats)) }
    } else {
      const category = syncErrorCategory(outcome.error)
      update = {
        status: 'failed',
        error_category: category,
        error_message: sanitize(outcome.error),
      }
    }
    if (update.status === 'failed')
      base.warn('Sync job failed', { ...tag, category: update.error_category })
    // Conditional on running: a run stale recovery already closed is never overwritten.
    const [row] = await this.db('sync_job_runs')
      .where({ id: runId, status: 'running' })
      .update({ ...update, finished_at: this.db.fn.now(), duration_ms: Date.now() - started })
      .returning('*')
    // Stale recovery may already have closed the run; report what is stored.
    return this.serialize(row ?? (await this.db('sync_job_runs').where('id', runId).first()))
  }

  /**
   * Marks running rows older than their timeout plus a margin as failed timeouts, so a
   * worker that crashed mid-run does not block the job forever.
   */
  async recoverStale(): Promise<number> {
    const margin = this.options.staleMarginMs ?? STALE_MARGIN_MS
    const rows = await this.db('sync_job_runs')
      .where('status', 'running')
      .select('id', 'job', 'started_at')
    let recovered = 0
    for (const row of rows) {
      const limit = (this.definitions.get(row.job)?.timeoutMs ?? SYNC_DEFAULT_TIMEOUT_MS) + margin
      if (Date.now() - new Date(row.started_at).getTime() <= limit) continue
      recovered += await this.db('sync_job_runs').where({ id: row.id, status: 'running' }).update({
        status: 'failed',
        finished_at: this.db.fn.now(),
        error_category: 'timeout',
        error_message: 'توقف التشغيل دون نتيجة؛ اعتُبر منتهي المهلة',
      })
    }
    return recovered
  }

  /** Every defined job with its latest run, last success and next scheduled time. */
  async list(now = new Date()): Promise<SyncJobSummary[]> {
    const names = [...this.definitions.keys()]
    if (!names.length) return []
    const latest = await this.db('sync_job_runs')
      .distinctOn('job')
      .whereIn('job', names)
      .orderBy([{ column: 'job' }, { column: 'id', order: 'desc' }])
    const finished = await this.db('sync_job_runs')
      .distinctOn('job')
      .whereIn('job', names)
      .whereIn('status', ['succeeded', 'failed'])
      .orderBy([{ column: 'job' }, { column: 'id', order: 'desc' }])
    const successes = await this.db('sync_job_runs')
      .whereIn('job', names)
      .where('status', 'succeeded')
      .groupBy('job')
      .select('job')
      .max('finished_at as at')
    const busy = await this.db('sync_job_runs')
      .whereIn('job', names)
      .whereIn('status', ['queued', 'running'])
      .distinct('job')
    return this.all().map((definition) => {
      const last = latest.find((row) => row.job === definition.name)
      const done = finished.find((row) => row.job === definition.name)
      const next = nextCronTime(this.crons.get(definition.name)!, now)
      return {
        name: definition.name,
        label: definition.label,
        cron: definition.cron,
        timeoutMs: definition.timeoutMs,
        busy: busy.some((row) => row.job === definition.name),
        lastRun: last ? this.serialize(last) : null,
        lastSuccessAt: iso(successes.find((row) => row.job === definition.name)?.at),
        lastErrorCategory: done?.status === 'failed' ? done.error_category : null,
        nextRunAt: next ? next.toISOString() : null,
      }
    })
  }

  /** Run history of one job, newest first. */
  async runs(name: string, limit = 20): Promise<SyncRun[]> {
    this.definition(name)
    const rows = await this.db('sync_job_runs')
      .where('job', name)
      .orderBy('id', 'desc')
      .limit(Math.min(Math.max(Math.trunc(limit) || 20, 1), 100))
    return rows.map((row) => this.serialize(row))
  }

  private serialize(row: Record<string, any>): SyncRun {
    return {
      id: Number(row.id),
      job: String(row.job),
      trigger: row.trigger,
      status: row.status,
      requestedBy: row.requested_by === null ? null : Number(row.requested_by),
      queuedAt: iso(row.queued_at)!,
      startedAt: iso(row.started_at),
      finishedAt: iso(row.finished_at),
      durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
      errorCategory: row.error_category ?? null,
      errorMessage: row.error_message ?? null,
      stats: row.stats ?? {},
    }
  }
}

/** Keeps finite numeric counters only, so stats stay small and safe to display. */
function numericStats(stats: unknown): SyncStats {
  if (!stats || typeof stats !== 'object') return {}
  return Object.fromEntries(
    Object.entries(stats as Record<string, unknown>)
      .filter(
        ([key, value]) => key.length <= 64 && typeof value === 'number' && Number.isFinite(value)
      )
      .slice(0, 50)
  ) as SyncStats
}
