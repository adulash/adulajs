import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import redis from '@adonisjs/redis/services/main'
import env from '#start/env'
import redisConfig from '#config/redis'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Minimal block reader for the production Compose file: returns the lines
 * indented under a top-level key, or under a service. It avoids a YAML
 * dependency; the file keeps one key per line, which this test enforces.
 */
function block(lines: string[], header: RegExp, indent: number) {
  const start = lines.findIndex((line) => header.test(line))
  if (start === -1) return null
  const body: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (line.trim() && !line.startsWith(' '.repeat(indent + 1))) break
    body.push(line)
  }
  return body
}
const keys = (body: string[], indent: number) =>
  body
    .map((line) => line.match(new RegExp(`^ {${indent}}([A-Z][A-Z0-9_]*):`))?.[1])
    .filter((key): key is string => Boolean(key))

async function compose() {
  const source = await readFile(app.makePath('docker-compose.prod.yml'), 'utf8')
  const lines = source.split(/\r?\n/)
  const service = (name: string) => {
    const body = block(lines, new RegExp(`^  ${name}:`), 2)
    if (!body) throw new Error(`Missing service ${name}`)
    return body.join('\n')
  }
  const environment = (anchor: string) => {
    const body = block(lines, new RegExp(`^x-${anchor}: &${anchor}$`), 0)
    if (!body) throw new Error(`Missing x-${anchor}`)
    return keys(body, 2)
  }
  return { text: lines.join('\n'), service, environment }
}

/** start/env.ts keys, split into those AdonisJS requires at boot and optional ones. */
async function envSchema() {
  const source = await readFile(app.makePath('start/env.ts'), 'utf8')
  const all = [...source.matchAll(/^\s+([A-Z][A-Z0-9_]*): Env\.schema\.([a-z.]+)/gm)]
  return {
    all: all.map((match) => match[1]),
    required: all.filter((match) => !match[2].includes('optional')).map((match) => match[1]),
  }
}

test.group('Production deployment (Compose)', () => {
  test('no service receives the whole .env file', async ({ assert }) => {
    const { text } = await compose()
    assert.notMatch(text, /^\s*env_file:/m)
  })

  test('the backup runs as node after a one-shot root step owns the volume', async ({ assert }) => {
    const { service } = await compose()
    const backup = service('backup')
    assert.match(backup, /^ {4}user: node$/m)
    assert.notMatch(backup, /user: root/)
    assert.match(
      backup,
      /backup-permissions: \{ condition: service_completed_successfully \}/,
      'backup must wait for the ownership step'
    )
    const init = service('backup-permissions')
    assert.match(init, /^ {4}user: root$/m)
    assert.match(init, /command: \[chown, -R, 'node:node', \/backups\]/)
    assert.match(init, /restart: 'no'/)
    // The root step needs no application secrets.
    assert.notMatch(init, /environment|APP_KEY|PASSWORD/)
  })

  test('redis requires a password at start-up and its health check authenticates', async ({
    assert,
  }) => {
    const { service } = await compose()
    const redisService = service('redis')
    assert.include(redisService, '--requirepass "$$REDIS_PASSWORD"')
    assert.include(redisService, 'REDIS_PASSWORD: ${REDIS_PASSWORD:?REDIS_PASSWORD is required}')
    assert.include(redisService, 'REDISCLI_AUTH: ${REDIS_PASSWORD:?REDIS_PASSWORD is required}')
    assert.match(redisService, /test: \[CMD-SHELL, 'redis-cli ping \| grep -q PONG'\]/)
  })

  test('each Node service receives what start/env.ts needs and nothing more', async ({
    assert,
  }) => {
    const { service, environment } = await compose()
    const schema = await envSchema()
    const runtime = environment('runtime-environment')
    const application = environment('application-environment')
    // The image sets these (Dockerfile ENV); HOST is overridden for the application.
    const dockerfile = await readFile(app.makePath('Dockerfile'), 'utf8')
    const imageEnv = [...(dockerfile.match(/^ENV (.+)$/m)?.[1].matchAll(/([A-Z_]+)=/g) ?? [])].map(
      (match) => match[1]
    )
    for (const key of schema.required)
      assert.isTrue(
        runtime.includes(key) || imageEnv.includes(key),
        `${key} is required at boot, so every Node service (backup included) needs it`
      )
    for (const key of [
      'BACKUP_S3_ENDPOINT',
      'BACKUP_S3_BUCKET',
      'BACKUP_S3_REGION',
      'BACKUP_S3_ACCESS_KEY_ID',
      'BACKUP_S3_SECRET_ACCESS_KEY',
      'REDIS_PASSWORD',
    ])
      assert.include(runtime, key)
    for (const key of schema.all)
      assert.isTrue(
        runtime.includes(key) || application.includes(key) || imageEnv.includes(key),
        `${key} from start/env.ts is not passed to the application services`
      )
    // Optional application credentials never reach the backup.
    for (const key of ['SMTP_PASSWORD', 'GITHUB_CLIENT_SECRET', 'GOOGLE_CLIENT_SECRET'])
      assert.notInclude(runtime, key)
    assert.include(service('backup'), 'environment: *runtime-environment')
    assert.include(service('web'), 'environment: *application-environment')
    for (const name of ['worker', 'scheduler']) assert.include(service(name), '<<: *application')
  })

  test('only Caddy reaches the application, and the app trusts that hop for client addresses', async ({
    assert,
  }) => {
    const { service, environment, text } = await compose()
    // No application service publishes a host port; Caddy alone does.
    for (const name of ['web', 'worker', 'scheduler'])
      assert.notMatch(service(name), /^ {4}ports:/m, `${name} must not publish a port`)
    assert.match(service('caddy'), /^ {4}ports:/m)
    assert.include(environment('application-environment'), 'TRUSTED_PROXIES')
    assert.include(text, 'TRUSTED_PROXIES: ${TRUSTED_PROXIES:-loopback,uniquelocal}')
    // Caddy replaces any client-supplied X-Forwarded-For with the real peer address.
    const caddyfile = await readFile(app.makePath('deploy/Caddyfile'), 'utf8')
    assert.match(caddyfile, /header_up X-Forwarded-For \{remote_host\}/)
    assert.match(caddyfile, /health_uri \/health/)
  })

  test('every Redis consumer authenticates through the configured connection', async ({
    assert,
  }) => {
    // The one connection carries REDIS_PASSWORD (undefined when empty, for development).
    assert.deepEqual(Object.keys(redisConfig.connections), ['main'])
    assert.equal(redisConfig.connection, 'main')
    assert.strictEqual(redisConfig.connections.main.password, env.get('REDIS_PASSWORD'))
    // The /health probe and setup inspection use the default connection instance.
    // ioredis stores an absent password as null.
    assert.strictEqual(
      redis.connection().ioConnection.options.password ?? undefined,
      env.get('REDIS_PASSWORD')
    )
    // adonis-jobs copies the named connection's ioredis options for BullMQ.
    assert.include(
      await readFile(app.makePath('config/queue.ts'), 'utf8'),
      "connectionName: 'main'"
    )
    // Cache and limiter name the same connection; no source opens its own Redis client.
    const sources: string[] = []
    for (const directory of ['app', 'start', 'config', 'commands', 'providers']) {
      for (const entry of await readdir(app.makePath(directory), { recursive: true })) {
        if (!String(entry).endsWith('.ts')) continue
        sources.push(await readFile(join(app.makePath(directory), String(entry)), 'utf8'))
      }
    }
    const all = sources.join('\n')
    assert.notMatch(all, /from 'ioredis'|new Redis\(/)
    const names = [...all.matchAll(/connectionName: '([^']+)'/g)].map((match) => match[1])
    assert.includeMembers(names, ['main'])
    assert.deepEqual([...new Set(names)], ['main'])
    assert.include(
      await readFile(app.makePath('config/cache.ts'), 'utf8'),
      "connectionName: 'main'"
    )
    assert.include(
      await readFile(app.makePath('config/limiter.ts'), 'utf8'),
      "connectionName: 'main'"
    )
  })
})
