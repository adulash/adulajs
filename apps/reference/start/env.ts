/*
|--------------------------------------------------------------------------
| Environment variables service
|--------------------------------------------------------------------------
|
| The `Env.create` method creates an instance of the Env service. The
| service validates the environment variables and also cast values
| to JavaScript data types.
|
*/

import { Env } from '@adonisjs/core/env'

const env = await Env.create(new URL('../', import.meta.url), {
  // Node
  NODE_ENV: Env.schema.enum(['development', 'production', 'test'] as const),
  PORT: Env.schema.number(),
  HOST: Env.schema.string({ format: 'host' }),
  LOG_LEVEL: Env.schema.string(),

  // App
  APP_KEY: Env.schema.secret(),
  /** Optional Gotenberg service for PDF printing (docker-compose.pdf.yml). */
  GOTENBERG_URL: Env.schema.string.optional({ format: 'url', tld: false }),
  APP_URL: Env.schema.string({ format: 'url', tld: false }),

  // Session
  SESSION_DRIVER: Env.schema.enum(['cookie', 'memory', 'database'] as const),
  DB_HOST: Env.schema.string(),
  DB_PORT: Env.schema.number(),
  DB_USER: Env.schema.string(),
  DB_PASSWORD: Env.schema.string(),
  DB_DATABASE: Env.schema.string(),
  // Connections per process; size it with the web concurrency and PostgreSQL max_connections.
  DB_POOL_MAX: Env.schema.number.optional(),
  // Login attempts per minute from one address (default 100); raise it for large offices behind one NAT.
  LOGIN_ADDRESS_LIMIT: Env.schema.number.optional(),
  // Self-signup: true/false is obeyed; unset allows it only until an administrator exists.
  SIGNUP_ENABLED: Env.schema.boolean.optional(),
  // Reverse proxies whose X-Forwarded-For is believed (comma-separated loopback,
  // linklocal, uniquelocal, addresses or CIDRs). Unset trusts loopback only.
  TRUSTED_PROXIES: Env.schema.string.optional(),
  // Lets outgoing webhooks and workflow HTTP steps reach http:// and private or loopback
  // addresses. Never enable it where administrators must not reach the internal network.
  WEBHOOKS_ALLOW_PRIVATE: Env.schema.boolean.optional(),
  REDIS_HOST: Env.schema.string(),
  REDIS_PORT: Env.schema.number(),
  REDIS_PASSWORD: Env.schema.string.optional(),
  DRIVE_DISK: Env.schema.enum(['local', 's3'] as const),
  BACKUP_S3_ENDPOINT: Env.schema.string.optional(),
  BACKUP_S3_BUCKET: Env.schema.string.optional(),
  BACKUP_S3_PREFIX: Env.schema.string.optional(),
  BACKUP_S3_REGION: Env.schema.string.optional(),
  BACKUP_S3_ACCESS_KEY_ID: Env.schema.string.optional(),
  BACKUP_S3_SECRET_ACCESS_KEY: Env.schema.string.optional(),

  /*
  |----------------------------------------------------------
  | Variables for configuring the limiter package
  |----------------------------------------------------------
  */
  LIMITER_STORE: Env.schema.enum.optional(['redis', 'memory'] as const),

  /*
  |----------------------------------------------------------
  | Variables for configuring the mail package
  |----------------------------------------------------------
  */
  MAIL_MAILER: Env.schema.enum.optional(['smtp'] as const),
  MAIL_FROM_NAME: Env.schema.string.optional(),
  MAIL_FROM_ADDRESS: Env.schema.string.optional(),
  SMTP_HOST: Env.schema.string.optional(),
  SMTP_PORT: Env.schema.number.optional(),
  SMTP_SECURE: Env.schema.boolean.optional(),
  SMTP_REQUIRE_TLS: Env.schema.boolean.optional(),
  SMTP_USERNAME: Env.schema.string.optional(),
  SMTP_PASSWORD: Env.schema.string.optional(),

  /*
  |----------------------------------------------------------
  | Variables for configuring ally package (a provider is
  | offered only when both of its values are present)
  |----------------------------------------------------------
  */
  GITHUB_CLIENT_ID: Env.schema.string.optional(),
  GITHUB_CLIENT_SECRET: Env.schema.string.optional(),
  GOOGLE_CLIENT_ID: Env.schema.string.optional(),
  GOOGLE_CLIENT_SECRET: Env.schema.string.optional(),
  // Microsoft Entra ID: offered when all three are present. A tenant GUID is recommended.
  MICROSOFT_CLIENT_ID: Env.schema.string.optional(),
  MICROSOFT_CLIENT_SECRET: Env.schema.string.optional(),
  MICROSOFT_TENANT_ID: Env.schema.string.optional(),

  /*
  |----------------------------------------------------------
  | Variables for the s3 drive disk (DRIVE_DISK=s3)
  |----------------------------------------------------------
  */
  AWS_ACCESS_KEY_ID: Env.schema.string.optional(),
  AWS_SECRET_ACCESS_KEY: Env.schema.string.optional(),
  AWS_REGION: Env.schema.string.optional(),
  AWS_ENDPOINT: Env.schema.string.optional(),
  S3_BUCKET: Env.schema.string.optional(),
})

if (env.get('NODE_ENV') === 'production') {
  for (const key of [
    'BACKUP_S3_ENDPOINT',
    'BACKUP_S3_BUCKET',
    'BACKUP_S3_REGION',
    'BACKUP_S3_ACCESS_KEY_ID',
    'BACKUP_S3_SECRET_ACCESS_KEY',
  ] as const) {
    if (!env.get(key)) throw new Error(`${key} is required in production`)
  }
  if (env.get('SESSION_DRIVER') !== 'database')
    throw new Error('Production requires revocable database sessions')
  if (env.get('DRIVE_DISK') === 's3')
    for (const key of [
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
      'AWS_REGION',
      'S3_BUCKET',
    ] as const)
      if (!env.get(key)) throw new Error(`${key} is required when DRIVE_DISK=s3`)
}
export default env
