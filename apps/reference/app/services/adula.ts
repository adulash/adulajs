import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'
import {
  ActorStore,
  Assignments,
  RecordCollaboration,
  BulkActions,
  Dashboards,
  ResourceService,
  SavedViews,
  Webhooks,
  ImportBatches,
  InboundWebhooks,
  WorkflowEngine,
  WorkflowDelegations,
  createOutboundPoster,
} from 'adula'
import env from '#start/env'
import encryption from '@adonisjs/core/services/encryption'
import { registry } from '#start/modules'
import { dashboards } from '#start/dashboards'
import { bulkActions } from '#start/bulk_actions'
import cache from '@adonisjs/cache/services/main'
import type { Actor } from 'adula'
import type { HttpContext } from '@adonisjs/core/http'
import { activeImpersonation } from '#services/impersonation'
import { HttpChannelSettings } from 'adula'
import { SyncJobs } from 'adula'
import { syncJobDefinitions } from '#start/sync_jobs'

export { IMPERSONATOR_KEY } from '#services/impersonation'

export function adula() {
  const knex = db.connection().getWriteClient()
  const resources = new ResourceService(knex, registry)
  const actors = new ActorStore(knex, registry, {
    get: async (key) => (await cache.get<Actor>({ key })) ?? undefined,
    set: async (key, value) => {
      await cache.set({ key, value, ttl: '5m' })
    },
  })
  // closeNote: 'optional' shows a closing note field; 'required' refuses an empty note.
  const assignments = new Assignments(knex, resources, actors, { closeNote: 'optional' })
  return {
    registry,
    resources,
    savedViews: new SavedViews(knex, registry),
    bulk: new BulkActions(registry, resources, bulkActions, {
      report: (error, context) =>
        logger.error({ err: error, ...context }, 'bulk action row failed'),
    }),
    dashboards: new Dashboards(knex, registry, resources, dashboards),
    actors,
    collaboration: new RecordCollaboration(knex, resources, actors),
    assignments,
    workflows: new WorkflowEngine(
      knex,
      registry,
      resources,
      actors,
      assignments,
      registry.workflows(),
      { post: createOutboundPoster(outboundPolicy()) }
    ),
    delegations: new WorkflowDelegations(knex),
    imports: new ImportBatches(knex, registry, resources, actors),
    // Declared in start/sync_jobs.ts; the scheduler queues them and the worker runs them.
    syncJobs: new SyncJobs(knex, resources, syncJobDefinitions, {
      logger: {
        info: (message, data) => logger.info(data ?? {}, message),
        warn: (message, data) => logger.warn(data ?? {}, message),
        error: (message, data) => logger.error(data ?? {}, message),
      },
    }),
    inbound: new InboundWebhooks(knex, {
      seal: (value) => encryption.encrypt(value),
      open: (value) => encryption.decrypt<string>(value),
    }),
    // The SMS/WhatsApp provider; its signing secret is sealed like webhook secrets.
    channelSettings: new HttpChannelSettings(
      knex,
      {
        seal: (value) => encryption.encrypt(value),
        open: (value) => encryption.decrypt<string>(value),
      },
      outboundPolicy()
    ),
    webhooks: new Webhooks(
      knex,
      registry,
      {
        seal: (value) => encryption.encrypt(value),
        open: (value) => encryption.decrypt<string>(value),
      },
      outboundPolicy()
    ),
  }
}

/** Private and plain-HTTP targets are reachable only with WEBHOOKS_ALLOW_PRIVATE=true. */
function outboundPolicy() {
  return { allowPrivateTargets: env.get('WEBHOOKS_ALLOW_PRIVATE') === true }
}

/** The signed-in actor; while impersonating, it also names the acting administrator. */
export async function requestActor(ctx: HttpContext): Promise<Actor> {
  const actor = await adula().actors.load(ctx.auth.getUserOrFail().id)
  const impersonation = activeImpersonation(ctx)
  return impersonation ? { ...actor, impersonatorId: impersonation.adminId } : actor
}
