import { createHmac, randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import redis from '@adonisjs/redis/services/main'
import drive from '@adonisjs/drive/services/main'
import { InitialSetup, Settings, runtimeHealth, type SetupCheck } from 'adula'
import env from '#start/env'
import { mailTest, mailFingerprint, publicMailTest } from '#services/mail_delivery_test'

const database = () => db.connection().getWriteClient()
export const setup = () => new InitialSetup(database())
export const backupFingerprint = () =>
  fingerprint([
    env.get('BACKUP_S3_ENDPOINT'),
    env.get('BACKUP_S3_BUCKET'),
    env.get('BACKUP_S3_PREFIX') ?? 'adula',
    env.get('BACKUP_S3_REGION'),
    env.get('BACKUP_S3_ACCESS_KEY_ID'),
    env.get('BACKUP_S3_SECRET_ACCESS_KEY'),
  ])
export const fingerprint = (values: unknown[]) =>
  createHmac('sha256', env.get('APP_KEY').release()).update(JSON.stringify(values)).digest('hex')
export const storageFingerprint = () =>
  fingerprint([
    env.get('DRIVE_DISK'),
    env.get('AWS_ENDPOINT'),
    env.get('S3_BUCKET'),
    env.get('AWS_REGION'),
    env.get('AWS_ACCESS_KEY_ID'),
    env.get('AWS_SECRET_ACCESS_KEY'),
  ])
export const infrastructureFingerprint = () =>
  fingerprint([
    env.get('DB_HOST'),
    env.get('DB_PORT'),
    env.get('DB_DATABASE'),
    env.get('DB_USER'),
    env.get('DB_PASSWORD'),
    env.get('REDIS_HOST'),
    env.get('REDIS_PORT'),
    env.get('REDIS_PASSWORD'),
  ])
export const oauthFingerprint = (provider: 'github' | 'google') =>
  fingerprint(
    provider === 'github'
      ? [env.get('GITHUB_CLIENT_ID'), env.get('GITHUB_CLIENT_SECRET'), env.get('APP_URL')]
      : [env.get('GOOGLE_CLIENT_ID'), env.get('GOOGLE_CLIENT_SECRET'), env.get('APP_URL')]
  )

export async function identity() {
  try {
    const brand = JSON.parse(await readFile(app.makePath('company-identity.json'), 'utf8')) as {
      company: string
      logo?: string
    }
    return { company: String(brand.company), logo: brand.logo ?? null }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const root = await database()('org_units').whereNull('parent_id').orderBy('id').first('name')
    return { company: root?.name ?? 'النظام المرجعي', logo: null }
  }
}

export async function probeStorage() {
  const disk = drive.use()
  const path = `.adula-setup/${randomUUID()}.txt`
  const payload = Buffer.from(`adula-storage-check:${randomUUID()}`)
  try {
    await disk.putStream(path, Readable.from(payload), { contentLength: payload.length })
    const chunks: Buffer[] = []
    for await (const chunk of await disk.getStream(path)) chunks.push(Buffer.from(chunk))
    if (!Buffer.concat(chunks).equals(payload)) throw new Error('Storage round trip mismatch')
  } finally {
    await disk.delete(path)
  }
}
/** Identity file contents by path, reused while the file's size and mtime are unchanged. */
const identityFiles = new Map<string, { key: string; text: string }>()
async function identitySource(path: string) {
  const file = app.makePath(path)
  let key: string
  try {
    const info = await stat(file)
    key = `${info.size}:${info.mtimeMs}`
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw error
  }
  const cached = identityFiles.get(path)
  if (cached?.key === key) return cached.text
  const text = await readFile(file, 'utf8')
  identityFiles.set(path, { key, text })
  return text
}

/**
 * The approved identity's fingerprint. The shell asks on every administrator page
 * (setupPending), so the files are re-read only when they change.
 */
export async function identityFingerprint() {
  const sources = await Promise.all(
    ['docs/design-identity.md', 'inertia/css/brand.css', 'inertia/brand.ts'].map(identitySource)
  )
  return fingerprint([await identity(), ...sources])
}
export async function probeInfrastructure() {
  await database().raw('SELECT 1')
  if ((await redis.ping()) !== 'PONG') throw new Error('Redis unavailable')
}

export async function setupSnapshot(user: { id: number; email: string }) {
  const settings = new Settings(database())
  const brand = await identity()
  const approved = await settings.get<{ fingerprint: string }>('setup.identity')
  const health = await runtimeHealth(database())
  const currentCheck = async (name: string, key: string) => {
    const state = await settings.get<SetupCheck>(`setup.check.${name}`)
    if (!state || state.fingerprint !== key) return null
    return {
      status: state.status,
      checkedAt: state.checkedAt,
      fresh: Date.now() - Date.parse(state.checkedAt) < 86_400_000,
    }
  }
  const notification = await settings.get<{ id: number; at: string }>(
    'setup.notification',
    'user',
    String(user.id)
  )
  const receipt = notification
    ? await database()('notifications')
        .where({ id: notification.id, user_id: user.id })
        .first('read_at')
    : null
  const mail = await mailTest().current(user.id, user.email, mailFingerprint())
  const oauth = await Promise.all(
    (['github', 'google'] as const).map(async (provider) => {
      const configured =
        provider === 'github'
          ? Boolean(env.get('GITHUB_CLIENT_ID') && env.get('GITHUB_CLIENT_SECRET'))
          : Boolean(env.get('GOOGLE_CLIENT_ID') && env.get('GOOGLE_CLIENT_SECRET'))
      const proof = await settings.get<{ fingerprint: string; at: string }>(
        `setup.oauth.${provider}`
      )
      return {
        provider,
        configured,
        verifiedAt:
          configured && proof?.fingerprint === oauthFingerprint(provider) ? proof.at : null,
      }
    })
  )
  const storage = await currentCheck('storage', storageFingerprint())
  const infrastructure = await currentCheck('infrastructure', infrastructureFingerprint())
  const backupConfigured = [
    'BACKUP_S3_ENDPOINT',
    'BACKUP_S3_BUCKET',
    'BACKUP_S3_REGION',
    'BACKUP_S3_ACCESS_KEY_ID',
    'BACKUP_S3_SECRET_ACCESS_KEY',
  ].every((key) => Boolean(env.get(key as 'BACKUP_S3_BUCKET')))
  const backupHealth = await settings.get<{ healthy: boolean; checkedAt: string }>('backup.health')
  const backupProof = await settings.get<{ fingerprint: string }>('setup.backup_check')
  const restore = await settings.get<{
    status?: 'passed' | 'failed'
    finishedAt?: string
    error?: string
    attachment?: { fileVerified?: boolean }
  }>('backup.lastRestoreTestReport')
  return {
    brand,
    identityConfirmed: approved?.fingerprint === (await identityFingerprint()),
    mailTest: publicMailTest(mail),
    mailRecipient: user.email,
    notification: notification ? { ...notification, read: Boolean(receipt?.read_at) } : null,
    storage,
    storageDisk: env.get('DRIVE_DISK'),
    infrastructure,
    health,
    oauth,
    backup: {
      configured: backupConfigured,
      inspection: backupProof?.fingerprint === backupFingerprint() ? (backupHealth ?? null) : null,
      restore: restore
        ? {
            status: restore.status,
            finishedAt: restore.finishedAt,
            fileVerified: Boolean(restore.attachment?.fileVerified),
          }
        : null,
    },
    environment: app.inProduction ? 'production' : 'development',
  }
}

/**
 * Whether the one-time setup still needs the administrator: identity not confirmed, or
 * the storage and infrastructure checks never passed. Cheap enough for every page.
 */
export async function setupPending() {
  const settings = new Settings(database())
  const approved = await settings.get<{ fingerprint: string }>('setup.identity')
  if (approved?.fingerprint !== (await identityFingerprint())) return true
  for (const name of ['storage', 'infrastructure']) {
    const state = await settings.get<SetupCheck>(`setup.check.${name}`)
    if (state?.status !== 'passed') return true
  }
  return false
}
