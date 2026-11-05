import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile, lstat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import db from '@adonisjs/lucid/services/db'
import drive from '@adonisjs/drive/services/main'
import { isRelativeDiskPath } from 'adula'
import env from '#start/env'

const run = promisify(execFile)
export const snapshotFiles = ['database.dump', 'uploads.tar.gz', 'attachments.json']
export type ArchivedAttachment = {
  id: number
  disk: string
  path: string
  size: number
  sha256: string
}
export const pgEnvironment = () => ({
  ...process.env,
  PGHOST: env.get('DB_HOST'),
  PGPORT: String(env.get('DB_PORT')),
  PGUSER: env.get('DB_USER'),
  PGPASSWORD: env.get('DB_PASSWORD'),
})

export async function fileHash(path: string) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

export function attachmentDisk(name: string) {
  return drive.use(name as 'local' | 's3')
}

/**
 * The dump and attachment inventory share one PostgreSQL MVCC snapshot. Attachments are staged
 * in `workDirectory` when given (encrypted backups keep their plaintext in a private directory),
 * otherwise in the system temporary directory.
 */
export async function createSnapshot(directory: string, options: { workDirectory?: string } = {}) {
  await mkdir(directory) // Never reuse a partially or fully published snapshot.
  const objects = await mkdtemp(join(options.workDirectory ?? tmpdir(), 'adula-backup-'))
  try {
    const entries: ArchivedAttachment[] = []
    await db
      .connection()
      .getWriteClient()
      .transaction(async (trx) => {
        await trx.raw('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
        const result = await trx.raw('SELECT pg_export_snapshot() AS snapshot')
        await run(
          'pg_dump',
          [
            '--format=custom',
            `--snapshot=${result.rows[0].snapshot}`,
            `--file=${join(directory, 'database.dump')}`,
            env.get('DB_DATABASE'),
          ],
          { env: pgEnvironment(), windowsHide: true, timeout: 3600000 }
        )
        // Include released/soft-deleted files too: their rows remain in the dump.
        const rows = await trx('attachments').orderBy('id')
        for (const row of rows) {
          if (!isRelativeDiskPath(row.path)) throw new Error(`Unsafe attachment path: ${row.path}`)
          const file = join(objects, `${row.id}.bin`)
          await pipeline(
            await attachmentDisk(row.disk).getStream(row.path),
            createWriteStream(file)
          )
          const info = await stat(file)
          const size = info.size
          if (size !== Number(row.size)) throw new Error(`Attachment ${row.id} size mismatch`)
          entries.push({
            id: Number(row.id),
            disk: row.disk,
            path: row.path,
            size,
            sha256: await fileHash(file),
          })
        }
      })
    await run('tar', ['-czf', 'uploads.tar.gz', '-C', objects.replaceAll('\\', '/'), '.'], {
      cwd: directory,
      windowsHide: true,
      timeout: 3600000,
    })
    await writeFile(
      join(directory, 'attachments.json'),
      JSON.stringify({ version: 1, files: entries }, null, 2) + '\n'
    )
    const sums = await Promise.all(
      snapshotFiles.map(async (name) => `${await fileHash(join(directory, name))}  ${name}`)
    )
    await writeFile(join(directory, 'SHA256SUMS'), sums.join('\n') + '\n')
  } finally {
    await rm(objects, { recursive: true, force: true })
  }
}

export async function verifySnapshot(directory: string) {
  await stat(join(directory, 'COMPLETE'))
  const text = await readFile(join(directory, 'SHA256SUMS'), 'utf8')
  const names = new Set<string>()
  for (const line of text.trim().split(/\r?\n/)) {
    const match = /^([a-f0-9]{64}) {2}(database\.dump|uploads\.tar\.gz|attachments\.json)$/.exec(
      line
    )
    if (!match || names.has(match[2])) throw new Error('Malformed SHA256SUMS')
    names.add(match[2])
    if ((await fileHash(join(directory, match[2]))) !== match[1])
      throw new Error(`Checksum mismatch for ${match[2]}`)
  }
  if (!names.has('database.dump') || !names.has('uploads.tar.gz'))
    throw new Error('Incomplete SHA256SUMS')
  const hasManifest = await stat(join(directory, 'attachments.json')).then(
    () => true,
    (error) => {
      if (error.code !== 'ENOENT') throw error
      return false
    }
  )
  if (hasManifest !== names.has('attachments.json'))
    throw new Error('Manifest checksum is required')
  if (!hasManifest) return null // Legacy local-only snapshots remain readable.
  const manifest = JSON.parse(await readFile(join(directory, 'attachments.json'), 'utf8'))
  if (manifest.version !== 1 || !Array.isArray(manifest.files))
    throw new Error('Unsupported attachment manifest')
  const ids = new Set<number>()
  for (const file of manifest.files) {
    if (
      !Number.isSafeInteger(file.id) ||
      file.id < 1 ||
      ids.has(file.id) ||
      typeof file.disk !== 'string' ||
      typeof file.path !== 'string' ||
      !isRelativeDiskPath(file.path) ||
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      !/^[a-f0-9]{64}$/.test(file.sha256)
    )
      throw new Error('Invalid attachment manifest entry')
    attachmentDisk(file.disk)
    ids.add(file.id)
  }
  return manifest.files as ArchivedAttachment[]
}

export async function extractSnapshot(directory: string, target: string) {
  const archive = join(directory, 'uploads.tar.gz')
  const flags = process.platform === 'win32' ? ['--force-local'] : []
  const options = { windowsHide: true, timeout: 3600000, maxBuffer: 64 * 1024 * 1024 }
  const listing = await run('tar', [...flags, '-tzf', archive], options)
  for (const entry of listing.stdout.trim().split(/\r?\n/)) {
    const path = entry.replace(/^\.\//, '').replace(/\/$/, '')
    if (path && path !== '.' && !isRelativeDiskPath(path)) throw new Error('Unsafe archive path')
  }
  // Reject links/devices before extraction; generated snapshots contain regular files only.
  const verbose = await run('tar', [...flags, '-tvzf', archive], options)
  if (verbose.stdout.split(/\r?\n/).some((line) => line && !['-', 'd'].includes(line[0])))
    throw new Error('Archive contains a link or special file')
  await run('tar', [...flags, '-xzf', archive], { ...options, cwd: target })
}

export async function verifyAttachments(
  files: ArchivedAttachment[],
  extracted: string,
  rows: Record<string, any>[]
) {
  if (files.length !== rows.length)
    throw new Error('Attachment inventory differs from restored database')
  const inventory = new Map(files.map((file) => [file.id, file]))
  for (const row of rows) {
    const file = inventory.get(Number(row.id))
    if (!file || file.disk !== row.disk || file.path !== row.path || file.size !== Number(row.size))
      throw new Error(`Attachment ${row.id} differs from restored database`)
    const path = join(extracted, `${file.id}.bin`)
    const info = await lstat(path)
    if (!info.isFile() || info.size !== file.size || (await fileHash(path)) !== file.sha256)
      throw new Error(`Attachment ${file.id} checksum mismatch`)
  }
}

/** Drills write only isolated keys; actual recovery explicitly writes original keys. */
export async function restoreAttachments(
  files: ArchivedAttachment[],
  extracted: string,
  drill: boolean
) {
  const prefix = `.adula-restore-tests/${randomUUID()}`
  for (const file of files) {
    const disk = attachmentDisk(file.disk)
    const key = drill ? `${prefix}/${file.id}.bin` : file.path
    try {
      await disk.putStream(key, createReadStream(join(extracted, `${file.id}.bin`)), {
        contentLength: file.size,
      })
      const hash = createHash('sha256')
      let size = 0
      for await (const chunk of await disk.getStream(key)) {
        hash.update(chunk)
        size += Buffer.byteLength(chunk)
      }
      if (size !== file.size || hash.digest('hex') !== file.sha256)
        throw new Error(`Restored attachment ${file.id} checksum mismatch`)
    } finally {
      if (drill) await disk.delete(key)
    }
  }
}
