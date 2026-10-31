// Explicit real-provider acceptance. Uses synthetic files and two disposable PostgreSQL databases.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { randomUUID, createHash, randomBytes } from 'node:crypto'
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'
import { createServer } from 'node:net'
import { run } from './lib/run.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const app = join(root, 'apps/reference')
const args = process.argv.slice(2).filter((arg) => arg !== '--')
assert(
  args.length === 1 && args[0].startsWith('--credentials-file='),
  'Usage: pnpm test:s3 --credentials-file=<local env file>'
)
const credentials = parseEnv(
  await readFile(resolve(args[0].slice('--credentials-file='.length)), 'utf8')
)
const require = createRequire(join(app, 'package.json'))
const { Client } = require('pg')
const {
  S3Client,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} = require('@aws-sdk/client-s3')
const base = parseEnv(await readFile(join(app, '.env.test'), 'utf8'))
const connection = process.env.TEST_DATABASE_URL
  ? { connectionString: process.env.TEST_DATABASE_URL }
  : JSON.parse(await readFile(join(root, '.work/test-database.json'), 'utf8'))
const admin = new Client(connection)
await admin.connect()
const identity = (
  await admin.query(
    "SELECT current_database() AS db, current_setting('server_version_num')::integer AS version"
  )
).rows[0]
assert(
  identity.db.endsWith('_test') && Math.floor(identity.version / 10000) === 17,
  'PostgreSQL 17 with a dedicated *_test profile is required'
)
const stamp = Date.now()
const databases = [
  `adula_s3_${stamp}_source_test`,
  `adula_s3_${stamp}_restored_test`,
]
const runId = randomUUID()
const directory = join(root, '.work', `s3-acceptance-${stamp}`)
await mkdir(directory, { recursive: true })
const manifest = join(directory, 'files.json')
const port = await new Promise((done, reject) => {
  const server = createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const selected = server.address().port
    server.close(() => done(selected))
  })
})
const config = {
  ...base,
  ...process.env,
  NODE_ENV: 'test',
  APP_KEY: randomBytes(32).toString('base64url'),
  DRIVE_DISK: 's3',
  LOG_LEVEL: 'silent',
  HOST: '127.0.0.1',
  PORT: String(port),
  APP_URL: `http://127.0.0.1:${port}`,
  ADULA_S3_ACCEPTANCE: '1',
  ADULA_S3_MANIFEST: manifest,
  REDIS_TEST_DB: '14',
}
const parameters = admin.connectionParameters
Object.assign(config, {
  DB_HOST: parameters.host,
  DB_PORT: String(parameters.port),
  DB_USER: parameters.user,
  DB_PASSWORD: parameters.password,
})
for (const key of [
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_REGION',
  'AWS_ENDPOINT',
  'S3_BUCKET',
  'BACKUP_S3_ACCESS_KEY_ID',
  'BACKUP_S3_SECRET_ACCESS_KEY',
  'BACKUP_S3_REGION',
  'BACKUP_S3_ENDPOINT',
  'BACKUP_S3_BUCKET',
]) {
  if (credentials[key]) config[key] = credentials[key]
  else delete config[key]
  if (!key.endsWith('ENDPOINT')) assert(config[key], `Missing ${key}`)
}
const source = new S3Client({
  region: config.AWS_REGION,
  endpoint: config.AWS_ENDPOINT,
  credentials: {
    accessKeyId: config.AWS_ACCESS_KEY_ID,
    secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
  },
})
const offsite = new S3Client({
  region: config.BACKUP_S3_REGION,
  endpoint: config.BACKUP_S3_ENDPOINT,
  credentials: {
    accessKeyId: config.BACKUP_S3_ACCESS_KEY_ID,
    secretAccessKey: config.BACKUP_S3_SECRET_ACCESS_KEY,
  },
})
const prefix = `adula/acceptance-tests/source-s3/${runId}/`
const backupKeys = []
const created = []
const evidence = {
  startedAt: new Date().toISOString(),
  revision: (await run('git', ['rev-parse', 'HEAD'], { cwd: root, capture: true })).stdout.trim(),
  source: 'AWS S3',
  result: 'failed',
  checks: [],
  cleanup: {},
}
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const save = () =>
  writeFile(
    join(directory, 'result.json'),
    JSON.stringify(evidence, null, 2) + '\n'
  )
async function step(name, command, argv, env = config, cwd = app, expectedCode = 0) {
  // Private logs may contain credentials: never echo their tail to the console.
  await run(command, argv, { cwd, env, log: join(directory, `${name}.log`), expect: expectedCode, label: `S3 step ${name}`, echo: false })
  console.log(`PASS ${name}`)
}
const pgEnv = {
  ...config,
  PGHOST: parameters.host,
  PGPORT: String(parameters.port),
  PGUSER: parameters.user,
  PGPASSWORD: parameters.password,
}
let failure
try {
  for (const name of databases) {
    assert(/^adula_s3_\d+_(source|restored)_test$/.test(name))
    await admin.query(`CREATE DATABASE "${name}"`)
    created.push(name)
  }
  await step(
    'upload-authorization-migration',
    process.execPath,
    ['--import=@poppinss/ts-exec', 'tests/acceptance/run_s3.ts'],
    { ...config, DB_DATABASE: databases[0], ADULA_S3_PHASE: 'source' }
  )
  const data = JSON.parse(await readFile(manifest, 'utf8'))
  assert.equal(data.files.length, 3)
  const snapshot = join(directory, 'snapshot')
  const downloaded = join(directory, 'downloaded')
  await mkdir(downloaded, { recursive: true })
  await step('operational-backup-create', process.execPath,
    ['ace', 'backup:create', '--snapshot=' + snapshot, '--prefix=' + prefix],
    { ...config, DB_DATABASE: databases[0] })
  const files = ['database.dump', 'uploads.tar.gz', 'attachments.json']
  backupKeys.push(...[...files, 'SHA256SUMS', 'COMPLETE'].map((name) => prefix + name))
  // Fetch completion before accepting or extracting the downloaded snapshot.
  await offsite.send(
    new HeadObjectCommand({
      Bucket: config.BACKUP_S3_BUCKET,
      Key: prefix + 'COMPLETE',
    })
  )
  for (const file of [...files, 'SHA256SUMS', 'COMPLETE']) {
    const response = await offsite.send(
      new GetObjectCommand({
        Bucket: config.BACKUP_S3_BUCKET,
        Key: prefix + file,
      })
    )
    const bytes = Buffer.from(await response.Body.transformToByteArray())
    assert.equal(digest(bytes), digest(await readFile(join(snapshot, file))))
    await writeFile(join(downloaded, file), bytes)
  }
  const receivedSums = await readFile(join(downloaded, 'SHA256SUMS'), 'utf8')
  for (const file of files) {
    const expected = receivedSums
      .split('\n')
      .find((line) => line.endsWith(`  ${file}`))
      ?.split('  ')[0]
    assert.equal(digest(await readFile(join(downloaded, file))), expected)
  }
  evidence.checks.push(
    'source_s3_objects_archived',
    'offsite_upload_download_checksums_and_completion'
  )
  // Simulate loss only for these synthetic UUID keys, then restore exclusively from downloads.
  for (const file of data.files) {
    await source.send(
      new DeleteObjectCommand({ Bucket: config.S3_BUCKET, Key: file.path })
    )
    await assert.rejects(
      source.send(
        new HeadObjectCommand({ Bucket: config.S3_BUCKET, Key: file.path })
      ),
      (error) => error.$metadata?.httpStatusCode === 404
    )
  }
  evidence.checks.push('original_source_objects_deleted_and_absence_verified')
  const rejectedSnapshot = join(directory, 'missing-source')
  await step('reject-incomplete-source-backup', process.execPath,
    ['ace', 'backup:create', '--snapshot=' + rejectedSnapshot, '--prefix=' + prefix + 'missing/'],
    { ...config, DB_DATABASE: databases[0] }, app, 1)
  await assert.rejects(readFile(join(rejectedSnapshot, 'COMPLETE')), (error) => error.code === 'ENOENT')
  await assert.rejects(offsite.send(new HeadObjectCommand({ Bucket: config.BACKUP_S3_BUCKET, Key: prefix + 'missing/COMPLETE' })),
    (error) => error.$metadata?.httpStatusCode === 404)
  evidence.checks.push('missing_source_rejected_without_local_or_remote_complete')
  await step(
    'isolated-database-restore',
    'pg_restore',
    [
      '--no-owner',
      '--no-privileges',
      '--exit-on-error',
      `--dbname=${databases[1]}`,
      join(downloaded, 'database.dump'),
    ],
    pgEnv
  )
  await step('operational-restore-drill', process.execPath,
    ['ace', 'backup:restore-test', '--snapshot=' + downloaded],
    { ...config, DB_DATABASE: databases[1] })
  for (const file of data.files) {
    await assert.rejects(source.send(new HeadObjectCommand({ Bucket: config.S3_BUCKET, Key: file.path })),
      (error) => error.$metadata?.httpStatusCode === 404)
  }
  evidence.checks.push('monthly_drill_does_not_write_original_keys')
  await step('operational-restore-files', process.execPath,
    ['ace', 'backup:restore-files', '--snapshot=' + downloaded, '--apply'],
    { ...config, DB_DATABASE: databases[1] })
  evidence.checks.push('operational_create_restore_drill_and_original_disk_recovery')
  await step(
    'restored-http-authorization',
    process.execPath,
    ['--import=@poppinss/ts-exec', 'tests/acceptance/run_s3.ts'],
    { ...config, DB_DATABASE: databases[1], ADULA_S3_PHASE: 'restored' }
  )
  const completed = JSON.parse(await readFile(manifest, 'utf8'))
  evidence.checks.push(...completed.checks)
  evidence.files = completed.files.map(({ size, sha256 }) => ({
    size,
    sha256,
  }))
  evidence.result = 'passed'
} catch (error) {
  failure = error
  evidence.error = error.message
} finally {
  const errors = []
  let cleanupFiles = []
  try {
    cleanupFiles = JSON.parse(await readFile(manifest, 'utf8')).files
  } catch {}
  for (const file of cleanupFiles) {
    if (!/^resources\/orders\/contract\/[0-9a-f-]{36}\.txt$/.test(file.path)) {
      errors.push('unexpected_source_path')
      continue
    }
    try {
      await source.send(
        new DeleteObjectCommand({ Bucket: config.S3_BUCKET, Key: file.path })
      )
      await assert.rejects(
        source.send(
          new HeadObjectCommand({ Bucket: config.S3_BUCKET, Key: file.path })
        ),
        (error) => error.$metadata?.httpStatusCode === 404
      )
      for (const folder of ['uploads', 'uploads-test-archive'])
        await unlink(join(app, 'storage', folder, file.path)).catch((error) => {
          if (error.code !== 'ENOENT') throw error
        })
    } catch {
      errors.push('source_object_cleanup')
    }
  }
  // Backup credentials intentionally have no DeleteObject permission. Retain this
  // small synthetic snapshot as recovery evidence; never broaden IAM to clean it.
  for (const name of created) {
    try {
      await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`)
    } catch {
      errors.push('temporary_database_cleanup')
    }
  }
  await admin.end()
  source.destroy()
  offsite.destroy()
  evidence.cleanup = {
    errors,
    sourceObjects: cleanupFiles.length,
    retainedBackupObjects: backupKeys.length,
    retainedBackupPrefix: prefix,
    databases: created.length,
  }
  evidence.finishedAt = new Date().toISOString()
  evidence.releaseAcceptance = false
  evidence.limitations = [
    'Operational Ace commands exercised directly; Docker wrapper and monthly scheduler execution not verified',
    'No container, staging, scheduled backup or production acceptance',
  ]
  if (errors.length) {
    evidence.result = 'failed'
    failure ??= new Error('Cleanup did not complete')
  }
  await save()
}
console.log(
  JSON.stringify({
    result: evidence.result,
    report: join(directory, 'result.json'),
    cleanup: evidence.cleanup,
  })
)
if (failure) {
  console.error(failure.message)
  process.exitCode = 1
}
