import { test } from '@japa/runner'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  BackupProviderError,
  CloudBackups,
  openBackupArchive,
  type BackupProviderClient,
  type CloudBackupsOptions,
} from '../index.js'
import { lastDueTime } from '../src/backups/cloud_backups.js'
import { db, setup } from './helpers.js'

const key = randomBytes(32)
// A reversible stand-in for the host's encryption service; the raw column must never equal the token.
const box = {
  seal: (value: string) => `sealed:${Buffer.from(value).toString('base64')}`,
  open: (value: string) =>
    value.startsWith('sealed:') ? Buffer.from(value.slice(7), 'base64').toString() : null,
}

type FakeProvider = BackupProviderClient & {
  uploads: { name: string; bytes: Buffer; accessToken: string }[]
  failWith?: BackupProviderError
  revoked: string[]
}

function fakeProvider(provider: 'google' | 'onedrive'): FakeProvider {
  const fake: FakeProvider = {
    provider,
    uploads: [],
    revoked: [],
    authorizeUrl: ({ state, codeChallenge }) =>
      `https://consent.example/${provider}?state=${state}&challenge=${codeChallenge}`,
    async exchange({ code }) {
      if (code !== 'good') throw new BackupProviderError('auth')
      return { refreshToken: `refresh-${provider}`, accountLabel: 'owner@example.test' }
    },
    async refresh(token) {
      if (fake.failWith) throw fake.failWith
      return { accessToken: `access-for-${token}`, refreshToken: `${token}+` }
    },
    async upload({ file, name, size, accessToken }) {
      const bytes = await readFile(file)
      if (bytes.length !== size) throw new BackupProviderError('integrity')
      fake.uploads.push({ name, bytes, accessToken })
      return { remoteId: `remote-${fake.uploads.length}`, size }
    },
    async revoke(token) {
      fake.revoked.push(token)
    },
  }
  return fake
}

/** A snapshot like the application's: a dump and the files the manifest names. */
async function fakeSnapshot(directory: string, options: { workDirectory: string }) {
  await mkdir(directory)
  await writeFile(join(directory, 'database.dump'), 'PGDMP fake dump')
  await writeFile(join(directory, 'uploads.tar.gz'), 'tar')
  await writeFile(join(directory, 'attachments.json'), '{"version":1,"files":[]}')
  await writeFile(join(directory, 'SHA256SUMS'), '')
  stagings.push(options.workDirectory)
}
let stagings: string[] = []

const root = resolve('tmp', `cloud-backups-${process.pid}`)
let admins = new Set([1])
let clock = new Date('2026-11-05T10:00:00Z')
let google = fakeProvider('google')
let onedrive = fakeProvider('onedrive')

function backups(overrides: Partial<CloudBackupsOptions> = {}) {
  return new CloudBackups(db, {
    box,
    key,
    directory: root,
    createSnapshot: fakeSnapshot,
    providers: { google, onedrive },
    isAdministrator: async (id) => admins.has(id),
    now: () => clock,
    ...overrides,
  })
}

async function runField(id: number, field: string) {
  const row = await db('backup_runs').where({ id }).first()
  return row?.[field]
}

async function connectionField(field: string) {
  const row = await db('backup_connections').first()
  return row?.[field]
}

async function sortedEntries(path: string) {
  const entries = await readdir(path)
  return entries.sort()
}

async function audit(action: string) {
  return db('activities').where({ resource: 'core.backups', action }).orderBy('id', 'asc')
}

test.group('Cloud backups', (group) => {
  group.setup(setup)
  group.each.setup(async () => {
    await db('backup_runs').delete()
    await db('backup_connections').delete()
    await db('activities').where({ resource: 'core.backups' }).delete()
    await rm(root, { recursive: true, force: true })
    admins = new Set([1])
    clock = new Date('2026-11-05T10:00:00Z')
    google = fakeProvider('google')
    onedrive = fakeProvider('onedrive')
    stagings = []
  })
  group.teardown(() => rm(root, { recursive: true, force: true }))

  test('a connection stores the refresh token sealed and never returns it', async ({ assert }) => {
    const service = backups()
    const { url, state, verifier } = service.beginConnect('google', 'https://app.example/cb')
    assert.include(url, `state=${state}`)
    assert.notInclude(url, verifier)
    await service.completeConnect('google', { code: 'good', verifier, redirectUri: 'x' }, 1)
    const row = await db('backup_connections').where({ provider: 'google' }).first()
    assert.notEqual(row.refresh_token, 'refresh-google')
    assert.equal(box.open(row.refresh_token), 'refresh-google')
    const status = await service.status()
    assert.notInclude(JSON.stringify(status), 'refresh-google')
    assert.notInclude(JSON.stringify(status), row.refresh_token)
    const destination = status.destinations.find((entry) => entry.kind === 'google')!
    assert.equal(destination.connection?.accountLabel, 'owner@example.test')
    assert.equal(destination.connection?.status, 'connected')
    assert.lengthOf(await audit('connected'), 1)
  })

  test('a failed code exchange stores nothing and is audited', async ({ assert }) => {
    const service = backups()
    await assert.rejects(() =>
      service.completeConnect('google', { code: 'bad', verifier: 'v', redirectUri: 'x' }, 1)
    )
    assert.isUndefined(await db('backup_connections').first())
    const [entry] = await audit('connect_failed')
    assert.equal(entry.changes.reason, 'exchange')
  })

  test('without the encryption key nothing can be queued', async ({ assert }) => {
    const service = backups({ key: null })
    const error = await service.queue('download', 1).catch((caught) => caught)
    assert.equal(error.code, 'E_BACKUP_NOT_CONFIGURED')
    const status = await service.status()
    assert.isFalse(status.configured)
  })

  test('a download run seals the snapshot, removes the plaintext and expires', async ({
    assert,
  }) => {
    const service = backups()
    const id = await service.queue('download', 1)
    const busy = await service.queue('download', 1).catch((caught) => caught)
    assert.equal(busy.code, 'E_BACKUP_BUSY')
    assert.equal(await service.runNext(), id)
    const run = await db('backup_runs').where({ id }).first()
    assert.equal(run.status, 'succeeded')
    assert.match(run.sha256, /^[0-9a-f]{64}$/)
    // The working directory, with the plaintext snapshot, is gone.
    assert.deepEqual(await sortedEntries(root), ['files'])
    assert.isTrue(
      stagings.every((path) => path.startsWith(root)),
      'staging stays private'
    )
    const ready = await service.download(id, 1)
    assert.match(ready.fileName, /^adulajs-backup-\d{8}-\d{4}\.adulabackup$/)
    const opened = join(root, 'opened')
    await openBackupArchive(ready.path, opened, key)
    assert.equal(await readFile(join(opened, 'database.dump'), 'utf8'), 'PGDMP fake dump')
    assert.isTrue(existsSync(join(opened, 'COMPLETE')))
    await rm(opened, { recursive: true })
    assert.lengthOf(await audit('downloaded'), 1)
    clock = new Date(clock.getTime() + 25 * 60 * 60 * 1000)
    const expired = await service.download(id, 1).catch((caught) => caught)
    assert.equal(expired.status, 404)
    assert.equal(await service.pruneExpired(), 1)
    assert.isFalse(existsSync(ready.path))
    assert.equal(await runField(id, 'status'), 'expired')
  })

  test('a failing snapshot fails the run and leaves no plaintext', async ({ assert }) => {
    const service = backups({
      createSnapshot: async (directory, options) => {
        await fakeSnapshot(directory, options)
        throw new Error('pg_dump: connection refused for user secret-user')
      },
    })
    const id = await service.queue('download', 1)
    await service.runNext()
    const run = await db('backup_runs').where({ id }).first()
    assert.equal(run.status, 'failed')
    assert.equal(run.error_category, 'snapshot')
    assert.notInclude(run.error_message, 'secret-user')
    assert.deepEqual(await readdir(join(root, 'files')), [])
    assert.deepEqual(await sortedEntries(root), ['files'])
    const [entry] = await audit('failed')
    assert.equal(entry.changes.errorCategory, 'snapshot')
  })

  test('an upload refreshes, re-seals a rotated token, uploads and deletes the local copy', async ({
    assert,
  }) => {
    const service = backups()
    const { verifier } = service.beginConnect('google', 'x')
    await service.completeConnect('google', { code: 'good', verifier, redirectUri: 'x' }, 1)
    const id = await service.queue('google', 1)
    await service.runNext()
    const run = await db('backup_runs').where({ id }).first()
    assert.equal(run.status, 'succeeded')
    assert.equal(run.remote_id, 'remote-1')
    assert.lengthOf(google.uploads, 1)
    assert.equal(google.uploads[0].accessToken, 'access-for-refresh-google')
    assert.deepEqual(await readdir(join(root, 'files')), [])
    const connection = await db('backup_connections').where({ provider: 'google' }).first()
    assert.equal(box.open(connection.refresh_token), 'refresh-google+')
    const [entry] = await audit('succeeded')
    assert.equal(entry.changes.remoteId, 'remote-1')
  })

  test('a revoked grant marks the connection for reconnection', async ({ assert }) => {
    const service = backups()
    const { verifier } = service.beginConnect('onedrive', 'x')
    await service.completeConnect('onedrive', { code: 'good', verifier, redirectUri: 'x' }, 1)
    onedrive.failWith = new BackupProviderError('revoked')
    const id = await service.queue('onedrive', 1)
    await service.runNext()
    assert.equal(await runField(id, 'error_category'), 'revoked')
    assert.equal(await connectionField('status'), 'revoked')
    const error = await service.queue('onedrive', 1).catch((caught) => caught)
    assert.equal(error.code, 'E_BACKUP_NOT_CONNECTED')
  })

  test('disconnecting revokes and deletes the token and is audited', async ({ assert }) => {
    const service = backups()
    const { verifier } = service.beginConnect('google', 'x')
    await service.completeConnect('google', { code: 'good', verifier, redirectUri: 'x' }, 1)
    await service.disconnect('google', 1)
    assert.deepEqual(google.revoked, ['refresh-google'])
    assert.isUndefined(await db('backup_connections').first())
    assert.lengthOf(await audit('disconnected'), 1)
  })

  test('only one backup runs at a time across workers', async ({ assert }) => {
    let release!: () => void
    const gate = new Promise<void>((done) => (release = done))
    const service = backups({
      createSnapshot: async (directory, options) => {
        await gate
        await fakeSnapshot(directory, options)
      },
    })
    const { verifier } = service.beginConnect('google', 'x')
    await service.completeConnect('google', { code: 'good', verifier, redirectUri: 'x' }, 1)
    await service.queue('download', 1)
    await service.queue('google', 1)
    const first = service.runNext()
    // Wait until the first run is claimed.
    for (let tries = 0; tries < 50; tries++) {
      if (await db('backup_runs').where({ status: 'running' }).first()) break
      await new Promise((done) => setTimeout(done, 20))
    }
    assert.isNull(await service.runNext())
    release()
    await first
    assert.isNotNull(await service.runNext())
    assert.equal(
      await db('backup_runs')
        .where({ status: 'succeeded' })
        .count('* as n')
        .first()
        .then((row) => Number(row!.n)),
      2
    )
  })

  test('scheduled runs are queued once per period and only for an administrator', async ({
    assert,
  }) => {
    const service = backups()
    const { verifier } = service.beginConnect('google', 'x')
    clock = new Date('2026-11-04T09:00:00Z')
    await service.completeConnect('google', { code: 'good', verifier, redirectUri: 'x' }, 1)
    await service.setSchedule('google', 'daily', 1)
    clock = new Date('2026-11-05T02:10:00Z')
    assert.equal(await service.queueDue(), 1)
    assert.equal(await service.queueDue(), 0)
    const [queued] = await db('backup_runs')
    assert.equal(queued.trigger, 'schedule')
    assert.equal(queued.requested_by, 1)
    await service.runNext()
    clock = new Date('2026-11-05T20:00:00Z')
    assert.equal(await service.queueDue(), 0, 'one run per day')
    // The connecting user is no longer an administrator: the next period fails once.
    admins = new Set()
    clock = new Date('2026-11-06T02:30:00Z')
    assert.equal(await service.queueDue(), 0)
    assert.equal(await service.queueDue(), 0)
    const failed = await db('backup_runs').where({ status: 'failed' })
    assert.lengthOf(failed, 1)
    assert.equal(failed[0].error_category, 'actor')
    const invalid = await service.setSchedule('google', 'hourly', 1).catch((caught) => caught)
    assert.equal(invalid.status, 422)
    assert.lengthOf(await audit('scheduled'), 1)
  })

  test('a queued run whose requester lost administration fails at run time', async ({ assert }) => {
    const service = backups()
    const id = await service.queue('download', 1)
    admins = new Set()
    await service.runNext()
    const run = await db('backup_runs').where({ id }).first()
    assert.equal(run.error_category, 'actor')
    // The run stopped before creating any snapshot or archive.
    assert.isFalse(existsSync(join(root, 'files')))
    assert.deepEqual(stagings, [])
  })

  test('due times are 02:00 UTC daily and on Fridays weekly', ({ assert }) => {
    assert.equal(
      lastDueTime('daily', new Date('2026-11-05T01:59:00Z'))!.toISOString(),
      '2026-11-04T02:00:00.000Z'
    )
    assert.equal(
      lastDueTime('daily', new Date('2026-11-05T02:00:00Z'))!.toISOString(),
      '2026-11-05T02:00:00.000Z'
    )
    // 2026-11-05 is a Thursday; the previous Friday is 2026-10-30.
    assert.equal(
      lastDueTime('weekly', new Date('2026-11-05T12:00:00Z'))!.toISOString(),
      '2026-10-30T02:00:00.000Z'
    )
    assert.isNull(lastDueTime('off', new Date()))
  })

  test('stale runs are recovered and pruning touches only its own files', async ({ assert }) => {
    const service = backups()
    const id = await service.queue('download', 1)
    await db('backup_runs')
      .where({ id })
      .update({ status: 'running', started_at: new Date('2026-11-04T00:00:00Z') })
    assert.equal(await service.recoverStale(), 1)
    assert.equal(await runField(id, 'error_category'), 'interrupted')
    await mkdir(join(root, 'files'), { recursive: true })
    const orphan = join(
      root,
      'files',
      `99-${'0'.repeat(8)}-0000-0000-0000-${'0'.repeat(12)}.adulabackup.part`
    )
    const foreign = join(root, 'files', 'operator-notes.txt')
    const work = await mkdtemp(join(root, 'work-'))
    await writeFile(orphan, 'x')
    await writeFile(foreign, 'keep')
    const old = new Date('2026-11-01T00:00:00Z')
    await utimes(orphan, old, old)
    await utimes(work, old, old)
    await service.pruneExpired()
    assert.isFalse(existsSync(orphan))
    assert.isFalse(existsSync(work))
    assert.isTrue(existsSync(foreign))
  })

  test('refuses a backup directory inside the system temporary directory', async ({ assert }) => {
    const { tmpdir } = await import('node:os')
    const service = backups({ directory: join(tmpdir(), 'adula-backups-unsafe') })
    const id = await service.queue('download', 1)
    await service.runNext()
    assert.equal(await runField(id, 'status'), 'failed')
  })
})
