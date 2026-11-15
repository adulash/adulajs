import app from '@adonisjs/core/services/app'
import env from '#start/env'
import { defineConfig, store, drivers } from '@adonisjs/cache'
import type { InferStores } from '@adonisjs/cache/types'

const cacheConfig = defineConfig({
  default: 'redis',
  // Each test database has its own prefix, so concurrent runs never clear each other's cache.
  prefix: app.inTest ? `adula-reference-test:${env.get('DB_DATABASE')}` : 'adula-reference',
  ttl: '5m',
  stores: {
    redis: store()
      .useL1Layer(drivers.memory())
      .useL2Layer(drivers.redis({ connectionName: 'main' })),
  },
})
export default cacheConfig
declare module '@adonisjs/cache/types' {
  interface CacheStores extends InferStores<typeof cacheConfig> {}
}
