import { test } from '@japa/runner'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { Writable } from 'node:stream'
import {
  BackupArchiveError,
  createOpenStream,
  createSealStream,
  openBackupArchive,
  parseBackupKey,
  sealBackupArchive,
} from '../index.js'
import { diagnoseCloudBackups } from '../src/backups/doctor.js'

const key = randomBytes(32)

async function seal(bytes: Buffer, chunkSize = 16, master = key) {
  const parts: Buffer[] = []
  await pipeline(
    Readable.from([bytes]),
    createSealStream(master, { chunkSize }),
    new Writable({
      write(chunk, _encoding, callback) {
        parts.push(chunk)
        callback()
      },
    })
  )
  return Buffer.concat(parts)
}

async function unseal(bytes: Buffer, master = key) {
  const parts: Buffer[] = []
  // Split the input oddly so frame parsing is exercised across chunk boundaries.
  const pieces = [] as Buffer[]
  for (let index = 0; index < bytes.length; index += 7)
    pieces.push(bytes.subarray(index, index + 7))
  await pipeline(
    Readable.from(pieces),
    createOpenStream(master),
    new Writable({
      write(chunk, _encoding, callback) {
        parts.push(chunk)
        callback()
      },
    })
  )
  return Buffer.concat(parts)
}

async function code(run: () => Promise<unknown>) {
  try {
    await run()
  } catch (error) {
    if (error instanceof BackupArchiveError) return error.code
    throw error
  }
  return 'no error'
}

/** Byte offset of frame `index` in a sealed buffer. */
function frameOffset(sealed: Buffer, index: number) {
  let offset = 48
  for (let current = 0; current < index; current++)
    offset += 5 + sealed.readUInt32BE(offset + 1) + 16
  return offset
}

async function snapshotDir(root: string) {
  const directory = join(root, 'snapshot')
  await mkdir(directory)
  await writeFile(join(directory, 'database.dump'), randomBytes(70_000))
  await writeFile(join(directory, 'uploads.tar.gz'), randomBytes(3000))
  await writeFile(join(directory, 'attachments.json'), '{"version":1,"files":[]}')
  await writeFile(join(directory, 'SHA256SUMS'), 'x  database.dump\n')
  await writeFile(join(directory, 'COMPLETE'), '')
  return directory
}

test.group('Encrypted backup archive', () => {
  test('round trips empty, tiny, exact-multiple and multi-chunk payloads', async ({ assert }) => {
    for (const size of [0, 1, 16, 32, 100, 4097]) {
      const plain = randomBytes(size)
      const sealed = await seal(plain)
      assert.isFalse(sealed.includes(plain.subarray(0, 16)) && size >= 16, `size ${size}`)
      assert.deepEqual(await unseal(sealed), plain, `size ${size}`)
    }
  })

  test('every file gets its own salt, so equal input never gives equal output', async ({
    assert,
  }) => {
    const plain = Buffer.from('نسخة احتياطية')
    assert.notDeepEqual(await seal(plain), await seal(plain))
  })

  test('detects tampering in the header, ciphertext, tag, frame flag and frame order', async ({
    assert,
  }) => {
    const sealed = await seal(randomBytes(64))
    const flip = (offset: number) => {
      const copy = Buffer.from(sealed)
      copy[offset] ^= 1
      return copy
    }
    // The salt (header bytes 24-39) is authenticated with every frame.
    assert.equal(await code(() => unseal(flip(30))), 'E_BACKUP_TAMPERED')
    assert.equal(await code(() => unseal(flip(frameOffset(sealed, 1) + 5))), 'E_BACKUP_TAMPERED')
    assert.equal(await code(() => unseal(flip(frameOffset(sealed, 2) - 1))), 'E_BACKUP_TAMPERED')
    // Marking an inner frame final fails authentication.
    const early = Buffer.from(sealed)
    early[frameOffset(sealed, 0)] = 1
    assert.equal(await code(() => unseal(early)), 'E_BACKUP_TAMPERED')
    // Swapping two equal-length frames breaks the counter binding.
    const first = frameOffset(sealed, 0)
    const second = frameOffset(sealed, 1)
    const third = frameOffset(sealed, 2)
    const swapped = Buffer.concat([
      sealed.subarray(0, first),
      sealed.subarray(second, third),
      sealed.subarray(first, second),
      sealed.subarray(third),
    ])
    assert.equal(await code(() => unseal(swapped)), 'E_BACKUP_TAMPERED')
  })

  test('detects truncation at and inside a frame, and data after the final frame', async ({
    assert,
  }) => {
    const sealed = await seal(randomBytes(64))
    assert.equal(
      await code(() => unseal(sealed.subarray(0, frameOffset(sealed, 2)))),
      'E_BACKUP_TRUNCATED'
    )
    assert.equal(
      await code(() => unseal(sealed.subarray(0, sealed.length - 3))),
      'E_BACKUP_TRUNCATED'
    )
    assert.equal(await code(() => unseal(sealed.subarray(0, 20))), 'E_BACKUP_TRUNCATED')
    assert.equal(
      await code(() => unseal(Buffer.concat([sealed, Buffer.from([0])]))),
      'E_BACKUP_TAMPERED'
    )
  })

  test('names a wrong key and a foreign file clearly', async ({ assert }) => {
    const sealed = await seal(randomBytes(40))
    assert.equal(await code(() => unseal(sealed, randomBytes(32))), 'E_BACKUP_KEY')
    assert.equal(
      await code(() => unseal(Buffer.from('PK\x03\x04 not a backup at all, really'))),
      'E_BACKUP_FORMAT'
    )
    const future = Buffer.from(sealed)
    future[8] = 2
    assert.equal(await code(() => unseal(future)), 'E_BACKUP_FORMAT')
    assert.equal(await code(() => unseal(Buffer.alloc(0))), 'E_BACKUP_FORMAT')
  })

  test('accepts only a base64 key of exactly 32 bytes', ({ assert }) => {
    assert.lengthOf(parseBackupKey(randomBytes(32).toString('base64')), 32)
    for (const value of [
      randomBytes(31).toString('base64'),
      randomBytes(33).toString('base64'),
      'not base64 at all!',
      '',
    ])
      assert.throws(() => parseBackupKey(value), BackupArchiveError)
  })

  test('seals a snapshot directory and opens it into a new private directory', async ({
    assert,
  }) => {
    const root = await mkdtemp(join(tmpdir(), 'adula-archive-test-'))
    try {
      const snapshot = await snapshotDir(root)
      const file = join(root, 'backup.adulabackup')
      const result = await sealBackupArchive(snapshot, file, key, { chunkSize: 4096 })
      const info = await stat(file)
      assert.equal(result.size, info.size)
      assert.match(result.sha256, /^[0-9a-f]{64}$/)
      const sealedBytes = await readFile(file)
      const dump = await readFile(join(snapshot, 'database.dump'))
      assert.isFalse(sealedBytes.includes(dump.subarray(0, 64)), 'plaintext is not in the archive')
      // An existing archive is never overwritten.
      await assert.rejects(() => sealBackupArchive(snapshot, file, key))
      const target = join(root, 'opened')
      await openBackupArchive(file, target, key)
      for (const name of await readdir(snapshot))
        assert.deepEqual(
          await readFile(join(target, name)),
          await readFile(join(snapshot, name)),
          name
        )
      assert.sameMembers(await readdir(target), await readdir(snapshot))
      if (process.platform !== 'win32') {
        const [directory, archive] = await Promise.all([stat(target), stat(file)])
        assert.equal(directory.mode & 0o777, 0o700)
        assert.equal(archive.mode & 0o777, 0o600)
      }
      // The target must be new.
      assert.equal(await code(() => openBackupArchive(file, target, key)), 'E_BACKUP_TARGET')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('leaves nothing behind when the key is wrong or the archive is cut', async ({ assert }) => {
    const root = await mkdtemp(join(tmpdir(), 'adula-archive-test-'))
    try {
      const snapshot = await snapshotDir(root)
      const file = join(root, 'backup.adulabackup')
      await sealBackupArchive(snapshot, file, key, { chunkSize: 4096 })
      const wrong = join(root, 'wrong')
      assert.equal(
        await code(() => openBackupArchive(file, wrong, randomBytes(32))),
        'E_BACKUP_KEY'
      )
      assert.isFalse(existsSync(wrong))
      const cut = join(root, 'cut.adulabackup')
      const bytes = await readFile(file)
      await writeFile(cut, bytes.subarray(0, bytes.length - 100))
      const partial = join(root, 'partial')
      assert.equal(await code(() => openBackupArchive(cut, partial, key)), 'E_BACKUP_TRUNCATED')
      assert.isFalse(existsSync(partial))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('refuses unexpected container entries and snapshots without a database dump', async ({
    assert,
  }) => {
    const root = await mkdtemp(join(tmpdir(), 'adula-archive-test-'))
    try {
      // A forged container that names a path outside the allow-list.
      const name = Buffer.from('../escape')
      const entry = Buffer.alloc(2 + name.length + 8)
      entry.writeUInt16BE(name.length, 0)
      name.copy(entry, 2)
      entry.writeBigUInt64BE(1n, 2 + name.length)
      const forged = join(root, 'forged.adulabackup')
      await writeFile(forged, await seal(Buffer.concat([entry, Buffer.from('x'), Buffer.alloc(2)])))
      const target = join(root, 'target')
      assert.equal(await code(() => openBackupArchive(forged, target, key)), 'E_BACKUP_CONTENT')
      assert.isFalse(existsSync(target))
      assert.isFalse(existsSync(join(root, 'escape')))
      const empty = join(root, 'empty')
      await mkdir(empty)
      await writeFile(join(empty, 'uploads.tar.gz'), 'x')
      assert.equal(
        await code(() => sealBackupArchive(empty, join(root, 'e.adulabackup'), key)),
        'E_BACKUP_CONTENT'
      )
      if (process.platform !== 'win32') {
        const linked = join(root, 'linked')
        await mkdir(linked)
        await symlink('/etc/hostname', join(linked, 'database.dump'))
        assert.equal(
          await code(() => sealBackupArchive(linked, join(root, 'l.adulabackup'), key)),
          'E_BACKUP_CONTENT'
        )
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('doctor reports missing backup settings as not configured, never as a failure', ({
    assert,
  }) => {
    const status = (env: Record<string, string | undefined>) =>
      Object.fromEntries(
        diagnoseCloudBackups(env).map((finding) => [finding.check, finding.status])
      )
    assert.deepEqual(status({}), {
      'backup.encryption_key': 'info',
      'backup.google_drive': 'info',
      'backup.onedrive': 'info',
    })
    const good = randomBytes(32).toString('base64')
    assert.equal(status({ BACKUP_ENCRYPTION_KEY: good })['backup.encryption_key'], 'pass')
    assert.equal(status({ BACKUP_ENCRYPTION_KEY: 'short' })['backup.encryption_key'], 'fail')
    assert.equal(status({ BACKUP_GOOGLE_CLIENT_ID: 'id' })['backup.google_drive'], 'fail')
    assert.equal(
      status({ BACKUP_GOOGLE_CLIENT_ID: 'id', BACKUP_GOOGLE_CLIENT_SECRET: 's' })[
        'backup.google_drive'
      ],
      'warn'
    )
    assert.equal(
      status({
        BACKUP_ENCRYPTION_KEY: good,
        BACKUP_MICROSOFT_CLIENT_ID: 'id',
        BACKUP_MICROSOFT_CLIENT_SECRET: 's',
      })['backup.onedrive'],
      'pass'
    )
    // No finding ever repeats a secret value.
    const messages = diagnoseCloudBackups({
      BACKUP_ENCRYPTION_KEY: good,
      BACKUP_GOOGLE_CLIENT_SECRET: 'very-secret',
    })
      .map((finding) => finding.message)
      .join(' ')
    assert.notInclude(messages, good)
    assert.notInclude(messages, 'very-secret')
  })
})
