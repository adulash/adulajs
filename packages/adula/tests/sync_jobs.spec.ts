import { test } from '@japa/runner'
import { setTimeout as sleep } from 'node:timers/promises'
import {
  AdulaError,
  ResourceService,
  SyncJobError,
  SyncJobs,
  defineSyncJob,
  syncErrorCategory,
  type SyncJobContext,
} from '../index.js'
import { admin, db, registry, setup } from './helpers.js'
import { failure } from './helpers/failure.js'

test.group('Background sync jobs', (group) => {
  const seen: SyncJobContext[] = []
  const pull = defineSyncJob({
    name: 'sync:customers-pull',
    label: { ar: 'سحب العملاء', en: 'Pull customers' },
    cron: '*/15 * * * *',
    handler: async (ctx) => {
      seen.push(ctx)
      const record = await ctx.systemSave('customers', { name: `عميل مزامنة ${ctx.runId}` })
      ctx.logger.info('saved', { id: record.id })
      return { created: 1, ignored: Number.NaN }
    },
  })
  const invalid = defineSyncJob({
    name: 'sync:invalid-record',
    label: { ar: 'سجل غير صالح' },
    cron: '0 2 * * *',
    // A customer without its required name is refused by ResourceService.
    handler: async (ctx) => {
      await ctx.systemSave('customers', {})
    },
  })
  const slow = defineSyncJob({
    name: 'sync:slow',
    label: { ar: 'مهمة بطيئة' },
    cron: '30 1 1 1 *',
    timeoutMs: 50,
    handler: async (ctx) => {
      await sleep(2000, undefined, { signal: ctx.signal }).catch(() => {})
    },
  })
  const remote = defineSyncJob({
    name: 'sync:remote',
    label: { ar: 'خدمة خارجية' },
    cron: '0 3 * * 1-5',
    handler: async () => {
      throw new SyncJobError(
        'http-status:503',
        'Upstream https://user:pa55@api.example.test/v1?token=abc failed, Bearer abc.def'
      )
    },
  })
  const logs: string[] = []
  const jobs = (staleMarginMs?: number) =>
    new SyncJobs(db, new ResourceService(db, registry), [pull, invalid, slow, remote], {
      staleMarginMs,
      logger: {
        info: (message) => logs.push(message),
        warn: (message) => logs.push(message),
        error: (message) => logs.push(message),
      },
    })

  group.setup(async () => {
    await setup()
  })
  group.each.setup(async () => {
    await db('sync_job_runs').del()
    seen.length = 0
  })

  test('definitions validate the sync: name, the cron expression and duplicates', ({ assert }) => {
    const handler = async () => {}
    const base = { label: { ar: 'مهمة' }, cron: '* * * * *', handler }
    assert.throws(() => defineSyncJob({ ...base, name: 'pull-customers' }), /sync:kebab-case/)
    assert.throws(() => defineSyncJob({ ...base, name: 'sync:Pull_Customers' }), /sync:kebab-case/)
    assert.throws(
      () => defineSyncJob({ ...base, name: 'sync:x', label: { ar: ' ' } }),
      /Arabic label/
    )
    for (const cron of [
      '* * * *',
      '60 * * * *',
      '* 24 * * *',
      '0 0 0 * *',
      '5-1 * * * *',
      'a * * * *',
      '1,*/5 * * * *',
      '* * * * 8',
    ])
      assert.throws(() => defineSyncJob({ ...base, name: 'sync:x', cron }), /cron/, cron)
    assert.throws(() => defineSyncJob({ ...base, name: 'sync:x', timeoutMs: 0 }), /timeoutMs/)
    const ok = defineSyncJob({ ...base, name: 'sync:x', cron: ' 0,30  8-17/2 * 1-12 0-7 ' })
    assert.equal(ok.cron, '0,30 8-17/2 * 1-12 0-7')
    assert.equal(ok.timeoutMs, 5 * 60_000)
    assert.throws(
      () => new SyncJobs(db, new ResourceService(db, registry), [ok, ok]),
      /defined twice/
    )
  })

  test('a queued run is claimed, writes a real record through systemSave and succeeds', async ({
    assert,
  }) => {
    const sync = jobs()
    const queued = await sync.queue(pull.name, 'manual', admin.id)
    assert.equal(queued.status, 'queued')
    assert.equal(queued.requestedBy, admin.id)
    const run = await sync.runNext()
    assert.equal(run?.id, queued.id)
    assert.equal(run?.status, 'succeeded')
    assert.deepEqual(run?.stats, { created: 1 })
    assert.isAtLeast(run!.durationMs!, 0)
    assert.isNull(run?.errorCategory)
    const customer = await db('customers').where('name', `عميل مزامنة ${queued.id}`).first()
    assert.exists(customer)
    assert.equal(customer.created_by, admin.id)
    const activity = await db('activities')
      .where({ resource: 'customers', record_id: customer.id })
      .first()
    assert.equal(activity.actor_id, admin.id)
    assert.equal(seen[0].trigger, 'manual')
    assert.equal(seen[0].jobName, pull.name)
    assert.isNull(seen[0].lastSuccessAt)
    assert.include(logs, 'saved')
    assert.isNull(await sync.runNext())

    // The next run sees when the previous one succeeded.
    await sync.queue(pull.name, 'manual', admin.id)
    await sync.runNext()
    assert.equal(seen[1].lastSuccessAt?.toISOString(), run?.finishedAt)
  })

  test('a second run is refused while one is queued or running', async ({ assert }) => {
    const sync = jobs()
    await sync.queue(pull.name, 'schedule')
    const busy = await failure(sync.queue(pull.name, 'manual', admin.id))
    assert.equal(busy.status, 409)
    assert.equal(busy.code, 'E_SYNC_JOB_BUSY')
    // Another job is independent.
    await sync.queue(remote.name, 'manual', admin.id)
    // Concurrent requests race on the partial unique index, not on a read-then-insert.
    await db('sync_job_runs').del()
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => sync.queue(pull.name, 'manual', admin.id))
    )
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
    const unknown = await failure(sync.queue('sync:missing', 'manual', admin.id))
    assert.equal(unknown.status, 404)
  })

  test('two workers never claim the same run', async ({ assert }) => {
    const sync = jobs()
    await sync.queue(pull.name, 'manual', admin.id)
    await sync.queue(remote.name, 'manual', admin.id)
    const [first, second, third] = await Promise.all([
      jobs().runNext(),
      jobs().runNext(),
      jobs().runNext(),
    ])
    const ids = [first, second, third].filter(Boolean).map((run) => run!.id)
    assert.lengthOf(ids, 2)
    assert.lengthOf(new Set(ids), 2)
  })

  test('failures store their category and a sanitized, truncated message', async ({ assert }) => {
    const sync = jobs()
    await sync.queue(invalid.name, 'manual', admin.id)
    const refused = await sync.runNext()
    assert.equal(refused?.status, 'failed')
    assert.equal(refused?.errorCategory, 'validation')
    assert.include(refused!.errorMessage!, 'name')

    await sync.queue(remote.name, 'schedule')
    const upstream = await sync.runNext()
    assert.equal(upstream?.errorCategory, 'http-status:503')
    assert.notInclude(upstream!.errorMessage!, 'pa55')
    assert.notInclude(upstream!.errorMessage!, 'token=abc')
    assert.notInclude(upstream!.errorMessage!, 'abc.def')
    assert.include(upstream!.errorMessage!, 'https://api.example.test/v1')

    // A scheduled create has no requester; systemSave refuses an unattributed create.
    await sync.queue(pull.name, 'schedule')
    const unattributed = await sync.runNext()
    assert.equal(unattributed?.status, 'failed')
    assert.equal(unattributed?.errorCategory, 'authorization')

    const long = new SyncJobs(db, new ResourceService(db, registry), [
      defineSyncJob({
        name: 'sync:long',
        label: { ar: 'رسالة طويلة' },
        cron: '* * * * *',
        handler: async () => {
          throw new Error(`line\n${'x'.repeat(2000)}`)
        },
      }),
    ])
    await long.queue('sync:long', 'manual')
    const truncated = await long.runNext()
    assert.isAtMost(truncated!.errorMessage!.length, 500)
    assert.notInclude(truncated!.errorMessage!, '\n')
  })

  test('error categories cover validation, authorization, conflict and outbound failures', ({
    assert,
  }) => {
    assert.equal(syncErrorCategory(new AdulaError(422, 'E_REQUIRED', 'x')), 'validation')
    assert.equal(syncErrorCategory(new AdulaError(403, 'E_FORBIDDEN', 'x')), 'authorization')
    assert.equal(syncErrorCategory(new AdulaError(409, 'E_CONFLICT', 'x')), 'conflict')
    assert.equal(
      syncErrorCategory(Object.assign(new Error('dup'), { code: '23505' })),
      'validation'
    )
    assert.equal(syncErrorCategory(Object.assign(new Error('dns'), { code: 'ENOTFOUND' })), 'dns')
    assert.equal(
      syncErrorCategory(new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } })),
      'connect'
    )
    assert.equal(syncErrorCategory(new DOMException('aborted', 'TimeoutError')), 'timeout')
    assert.equal(syncErrorCategory(new Error('bug')), 'handler')
  })

  test('a handler exceeding its timeout is aborted and recorded as a timeout', async ({
    assert,
  }) => {
    const sync = jobs()
    await sync.queue(slow.name, 'manual', admin.id)
    const started = Date.now()
    const run = await sync.runNext()
    assert.isBelow(Date.now() - started, 1500)
    assert.equal(run?.status, 'failed')
    assert.equal(run?.errorCategory, 'timeout')
    // The job is free again.
    await sync.queue(slow.name, 'manual', admin.id)
  })

  test('a handler ignoring the abort cannot write after the timeout or overlap its next run', async ({
    assert,
  }) => {
    const attempts: { aborted: boolean; saved: boolean }[] = []
    const stubborn = defineSyncJob({
      name: 'sync:stubborn',
      label: { ar: 'مهمة عنيدة' },
      cron: '* * * * *',
      timeoutMs: 80,
      // Ignores ctx.signal and keeps writing well past its timeout.
      handler: async (ctx) => {
        for (let index = 0; index < 8; index++) {
          await sleep(40)
          const aborted = ctx.signal.aborted
          try {
            await ctx.systemSave('customers', { name: `عنيد ${ctx.runId}-${index}` })
            attempts.push({ aborted, saved: true })
          } catch {
            attempts.push({ aborted, saved: false })
          }
        }
        return { created: attempts.filter((attempt) => attempt.saved).length }
      },
    })
    const sync = new SyncJobs(db, new ResourceService(db, registry), [stubborn], {
      staleMarginMs: 5000,
    })
    const queued = await sync.queue(stubborn.name, 'manual', admin.id)
    const running = sync.runNext()
    await sleep(150)
    // Past the timeout but still settling: the run stays running and blocks the next one.
    const row = await db('sync_job_runs').where('id', queued.id).first()
    assert.equal(row.status, 'running')
    const busy = await failure(sync.queue(stubborn.name, 'manual', admin.id))
    assert.equal(busy.status, 409)
    assert.isNull(await sync.runNext())
    const run = await running
    assert.equal(run?.status, 'failed')
    assert.equal(run?.errorCategory, 'timeout')
    assert.lengthOf(attempts, 8)
    assert.isTrue(attempts.some((attempt) => attempt.aborted))
    // Every call made after the abort was refused; only earlier writes landed.
    assert.isFalse(attempts.some((attempt) => attempt.aborted && attempt.saved))
    const saved = await db('customers').where('name', 'like', `عنيد ${queued.id}-%`).count('* as n')
    assert.equal(Number(saved[0].n), attempts.filter((attempt) => attempt.saved).length)
    await sync.queue(stubborn.name, 'manual', admin.id)
  })

  test('a handler that never settles is abandoned at the stale limit and a late settle is ignored', async ({
    assert,
  }) => {
    let release: (() => void) | undefined
    const hung = defineSyncJob({
      name: 'sync:hung',
      label: { ar: 'مهمة معلقة' },
      cron: '* * * * *',
      timeoutMs: 50,
      handler: async () => {
        await new Promise<void>((resolve) => (release = resolve))
        return { late: 1 }
      },
    })
    const sync = new SyncJobs(db, new ResourceService(db, registry), [hung], {
      staleMarginMs: 100,
    })
    const queued = await sync.queue(hung.name, 'manual', admin.id)
    const started = Date.now()
    const run = await sync.runNext()
    assert.isBelow(Date.now() - started, 1500)
    assert.equal(run?.status, 'failed')
    assert.equal(run?.errorCategory, 'timeout')
    release?.()
    await sleep(50)
    const stored = await db('sync_job_runs').where('id', queued.id).first()
    assert.equal(stored.status, 'failed')
    assert.deepEqual(stored.stats, {})
    // The job is free again.
    await sync.queue(hung.name, 'manual', admin.id)
  })

  test('a run left running by a crashed worker is recovered as a timeout', async ({ assert }) => {
    const [stuck] = await db('sync_job_runs')
      .insert({
        job: slow.name,
        trigger: 'schedule',
        status: 'running',
        started_at: db.raw("now() - interval '10 seconds'"),
      })
      .returning('id')
    const [fresh] = await db('sync_job_runs')
      .insert({ job: pull.name, trigger: 'schedule', status: 'running', started_at: db.fn.now() })
      .returning('id')
    const sync = jobs(1000)
    // Blocked before recovery? queue() recovers first, so the slow job can be queued.
    const queued = await sync.queue(slow.name, 'manual', admin.id)
    const recovered = await db('sync_job_runs').where('id', stuck.id).first()
    assert.equal(recovered.status, 'failed')
    assert.equal(recovered.error_category, 'timeout')
    assert.exists(recovered.finished_at)
    const untouched = await db('sync_job_runs').where('id', fresh.id).first()
    assert.equal(untouched.status, 'running')
    const busy = await failure(sync.queue(pull.name, 'manual', admin.id))
    assert.equal(busy.status, 409)
    assert.equal(queued.status, 'queued')
  })

  test('list summarizes each job and runs returns the history newest first', async ({ assert }) => {
    const sync = jobs()
    await sync.queue(pull.name, 'manual', admin.id)
    await sync.runNext()
    await sync.queue(remote.name, 'manual', admin.id)
    await sync.runNext()
    await sync.queue(remote.name, 'schedule')
    const now = new Date(2026, 9, 18, 10, 7, 30)
    const list = await sync.list(now)
    assert.deepEqual(
      list.map((job) => job.name),
      [pull.name, invalid.name, slow.name, remote.name]
    )
    const [pulled, never, yearly, upstream] = list
    assert.equal(pulled.lastRun?.status, 'succeeded')
    assert.exists(pulled.lastSuccessAt)
    assert.isNull(pulled.lastErrorCategory)
    assert.isFalse(pulled.busy)
    assert.equal(pulled.nextRunAt, new Date(2026, 9, 18, 10, 15).toISOString())
    assert.isNull(never.lastRun)
    assert.equal(never.nextRunAt, new Date(2026, 9, 19, 2, 0).toISOString())
    assert.equal(yearly.nextRunAt, new Date(2027, 0, 1, 1, 30).toISOString())
    assert.isTrue(upstream.busy)
    assert.equal(upstream.lastRun?.status, 'queued')
    assert.equal(upstream.lastErrorCategory, 'http-status:503')
    assert.isNull(upstream.lastSuccessAt)
    // 2026-10-18 is a Sunday; weekdays 1-5 start on Monday.
    assert.equal(upstream.nextRunAt, new Date(2026, 9, 19, 3, 0).toISOString())
    const history = await sync.runs(remote.name)
    assert.deepEqual(
      history.map((run) => run.status),
      ['queued', 'failed']
    )
    assert.lengthOf(await sync.runs(remote.name, 1), 1)
    const missing = await failure(sync.runs('sync:missing'))
    assert.equal(missing.status, 404)
  })
})
