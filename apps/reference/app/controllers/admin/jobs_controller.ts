import type { HttpContext } from '@adonisjs/core/http'
import queue from '@nemoventures/adonis-jobs/services/main'
import { AdulaError, logActivity, runtimeHealth, type QueueSnapshot } from 'adula'
import { adula } from '#services/adula'
import { actorId, knex, mutate, wantsJson } from './support.js'

/** BullMQ stays in the application; AdulaJS only defines the snapshot shape. */
async function snapshot(): Promise<QueueSnapshot> {
  const events = queue.useQueue('events')
  const counts = await events.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed')
  const failed = await events.getFailed(0, 49)
  return {
    name: 'events',
    counts: {
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      delayed: counts.delayed ?? 0,
      failed: counts.failed ?? 0,
      completed: counts.completed ?? 0,
    },
    failed: failed.map((job) => ({
      id: String(job.id),
      name: job.name,
      attemptsMade: job.attemptsMade,
      failedReason: job.failedReason ?? '',
      failedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
    })),
  }
}

/** The :name parameter of the sync routes, such as sync:customers-pull. */
function syncName(ctx: HttpContext) {
  let name = String(ctx.params.name)
  try {
    name = decodeURIComponent(name)
  } catch {}
  if (!/^sync:[a-z0-9-]{1,95}$/.test(name))
    throw new AdulaError(404, 'E_SYNC_JOB_NOT_FOUND', 'مهمة المزامنة غير موجودة')
  return name
}

export default class JobsController {
  async index(ctx: HttpContext) {
    const props = {
      health: await runtimeHealth(knex()),
      queues: [await snapshot()],
      syncJobs: await adula().syncJobs.list(),
    }
    if (wantsJson(ctx)) return props
    return ctx.inertia.render('admin/jobs/index', props)
  }

  async retry(ctx: HttpContext) {
    const id = String(ctx.params.id)
    if (!/^[\w-]{1,128}$/.test(id))
      throw new AdulaError(404, 'E_JOB_NOT_FOUND', 'الوظيفة غير موجودة')
    return mutate(
      ctx,
      async () => {
        const job = await queue.useQueue('events').getJob(id)
        if (!job) throw new AdulaError(404, 'E_JOB_NOT_FOUND', 'الوظيفة غير موجودة')
        if (!(await job.isFailed()))
          throw new AdulaError(422, 'E_JOB_NOT_FAILED', 'يمكن إعادة المحاولة للوظائف الفاشلة فقط')
        await job.retry()
        await logActivity(knex(), {
          resource: 'core.jobs',
          recordId: 0,
          actorId: actorId(ctx),
          action: 'retry',
          changes: { jobId: id, name: job.name },
        })
        return { id, state: await job.getState() }
      },
      'أعيدت الوظيفة إلى الطابور'
    )
  }

  /** "Run now": queues a manual run for the worker; 409 while one is queued or running. */
  async runSync(ctx: HttpContext) {
    const name = syncName(ctx)
    return mutate(
      ctx,
      async () => {
        const run = await adula().syncJobs.queue(name, 'manual', actorId(ctx))
        await logActivity(knex(), {
          resource: 'core.jobs',
          recordId: 0,
          actorId: actorId(ctx),
          action: 'sync.run',
          changes: { job: name, runId: run.id },
        })
        return run
      },
      'أضيفت مهمة المزامنة إلى قائمة التشغيل'
    )
  }

  /** Run history of one sync job, newest first, for the history dialog. */
  async syncRuns(ctx: HttpContext) {
    const limit = Number(ctx.request.input('limit', 20))
    return { data: await adula().syncJobs.runs(syncName(ctx), limit) }
  }
}
