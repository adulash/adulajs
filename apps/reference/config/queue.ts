import app from '@adonisjs/core/services/app'
import env from '#start/env'
import { defineConfig } from '@nemoventures/adonis-jobs'
import type { InferQueues } from '@nemoventures/adonis-jobs/types'

const queueConfig = defineConfig({
  connection: { connectionName: 'main' },
  // Own connections keep cache/Redis shutdown from interrupting queue cleanup.
  useSharedConnection: false,
  // Each test database has its own prefix, so concurrent runs never clear or take each other's jobs.
  defaultPrefix: app.inTest ? `adula-reference-test:${env.get('DB_DATABASE')}` : 'adula-reference',
  defaultQueue: 'events',
  healthCheck: { enabled: false },
  queues: {
    events: {
      defaultWorkerOptions: { concurrency: 4 },
      defaultJobOptions: {
        attempts: 10,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { age: 604800 },
        removeOnFail: false,
      },
    },
  },
})
export default queueConfig
declare module '@nemoventures/adonis-jobs/types' {
  interface Queues extends InferQueues<typeof queueConfig> {}
}
