import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { lstat, mkdir, open, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable, Transform, type TransformCallback } from 'node:stream'
import { pipeline } from 'node:stream/promises'

/**
 * The encrypted backup archive (ADR 051). A `.adulabackup` file is a 48-byte header followed
 * by AES-256-GCM frames over a small container of the snapshot files:
 *
 *   header  = "ADULABK\0" | version u8 | algorithm u8 | reserved u16 | chunkSize u32 BE |
 *             keyId 8 bytes | salt 16 bytes | reserved 8 bytes
 *   frame   = final u8 | ciphertext length u32 BE | ciphertext | tag 16 bytes
 *   AAD     = header | counter u64 BE | final u8
 *   nonce   = 4 zero bytes | counter u64 BE
 *   key     = HKDF-SHA256(masterKey, salt, "adulajs backup v1"), unique per file
 *
 * Exactly one frame is final and it is the last one, so truncation and appended data are
 * detected. The plaintext container is a sequence of entries (name length u16 BE, UTF-8 name,
 * size u64 BE, bytes) ended by a zero name length; names come from a fixed allow-list.
 */
export const BACKUP_ARCHIVE_EXTENSION = '.adulabackup'
export const BACKUP_ARCHIVE_FILES = [
  'database.dump',
  'uploads.tar.gz',
  'attachments.json',
  'SHA256SUMS',
  'COMPLETE',
] as const

const MAGIC = Buffer.from('ADULABK\0', 'latin1')
const VERSION = 1
const ALGORITHM = 1
const HEADER_SIZE = 48
const TAG_SIZE = 16
const FRAME_HEADER = 5
const DEFAULT_CHUNK = 1024 * 1024
const MAX_CHUNK = 16 * 1024 * 1024
const INFO = Buffer.from('adulajs backup v1')

export type BackupArchiveErrorCode =
  | 'E_BACKUP_KEY_INVALID'
  | 'E_BACKUP_FORMAT'
  | 'E_BACKUP_KEY'
  | 'E_BACKUP_TAMPERED'
  | 'E_BACKUP_TRUNCATED'
  | 'E_BACKUP_CONTENT'
  | 'E_BACKUP_TARGET'

const MESSAGES: Record<BackupArchiveErrorCode, string> = {
  E_BACKUP_KEY_INVALID:
    'مفتاح تشفير النسخ الاحتياطية غير صالح: يجب أن يكون 32 بايتًا بترميز base64',
  E_BACKUP_FORMAT: 'الملف ليس نسخة احتياطية مشفرة من AdulaJS أو إصداره غير مدعوم',
  E_BACKUP_KEY: 'مفتاح التشفير لا يطابق هذه النسخة الاحتياطية',
  E_BACKUP_TAMPERED: 'تعذر التحقق من سلامة النسخة الاحتياطية: الملف معدل أو تالف',
  E_BACKUP_TRUNCATED: 'النسخة الاحتياطية ناقصة: انقطع الملف قبل نهايته',
  E_BACKUP_CONTENT: 'محتوى النسخة الاحتياطية غير متوقع',
  E_BACKUP_TARGET: 'مجلد الاستعادة موجود مسبقًا أو لا يمكن إنشاؤه',
}

/** A refusal while sealing or opening an archive; the message is Arabic and holds no secret. */
export class BackupArchiveError extends Error {
  constructor(public code: BackupArchiveErrorCode) {
    super(MESSAGES[code])
  }
}

/** Decodes BACKUP_ENCRYPTION_KEY: base64 of exactly 32 bytes. */
export function parseBackupKey(value: string): Buffer {
  const text = value.trim()
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text) || text.length % 4 !== 0)
    throw new BackupArchiveError('E_BACKUP_KEY_INVALID')
  const key = Buffer.from(text, 'base64')
  if (key.length !== 32) throw new BackupArchiveError('E_BACKUP_KEY_INVALID')
  return key
}

function keyId(master: Buffer) {
  return createHmac('sha256', master).update('adula-backup-key-id').digest().subarray(0, 8)
}

function fileKey(master: Buffer, salt: Buffer) {
  return Buffer.from(hkdfSync('sha256', master, salt, INFO, 32))
}

function nonce(counter: bigint) {
  const value = Buffer.alloc(12)
  value.writeBigUInt64BE(counter, 4)
  return value
}

function aad(header: Buffer, counter: bigint, final: boolean) {
  const tail = Buffer.alloc(9)
  tail.writeBigUInt64BE(counter, 0)
  tail[8] = final ? 1 : 0
  return Buffer.concat([header, tail])
}

/** Encrypts a byte stream into the archive format. */
export function createSealStream(master: Buffer, options: { chunkSize?: number } = {}) {
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK
  if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > MAX_CHUNK)
    throw new RangeError('Invalid chunk size')
  const salt = randomBytes(16)
  const header = Buffer.alloc(HEADER_SIZE)
  MAGIC.copy(header, 0)
  header[8] = VERSION
  header[9] = ALGORITHM
  header.writeUInt32BE(chunkSize, 12)
  keyId(master).copy(header, 16)
  salt.copy(header, 24)
  const key = fileKey(master, salt)
  let counter = 0n
  let pending: Buffer[] = []
  let pendingSize = 0
  let headerSent = false

  const frame = (plain: Buffer, final: boolean) => {
    const cipher = createCipheriv('aes-256-gcm', key, nonce(counter))
    cipher.setAAD(aad(header, counter, final))
    const encrypted = Buffer.concat([cipher.update(plain), cipher.final()])
    const prefix = Buffer.alloc(FRAME_HEADER)
    prefix[0] = final ? 1 : 0
    prefix.writeUInt32BE(encrypted.length, 1)
    counter++
    return Buffer.concat([prefix, encrypted, cipher.getAuthTag()])
  }
  const start = (stream: Transform) => {
    if (!headerSent) {
      stream.push(header)
      headerSent = true
    }
  }

  return new Transform({
    transform(chunk: Buffer, _encoding, callback: TransformCallback) {
      start(this)
      pending.push(chunk)
      pendingSize += chunk.length
      // Keep at least one byte back, so the final frame always carries the tail.
      while (pendingSize > chunkSize) {
        const joined = Buffer.concat(pending)
        this.push(frame(joined.subarray(0, chunkSize), false))
        pending = [joined.subarray(chunkSize)]
        pendingSize = joined.length - chunkSize
      }
      callback()
    },
    flush(callback: TransformCallback) {
      start(this)
      this.push(frame(Buffer.concat(pending), true))
      pending = []
      callback()
    },
  })
}

/**
 * Decrypts the archive format. Each frame is authenticated before its bytes are released,
 * but the stream as a whole is only trustworthy once it ends without an error: a missing
 * final frame is reported at the end.
 */
export function createOpenStream(master: Buffer) {
  let buffer: Buffer = Buffer.alloc(0)
  let header: Buffer | null = null
  let key: Buffer | null = null
  let chunkSize = 0
  let counter = 0n
  let finished = false

  const fail = (code: BackupArchiveErrorCode) => new BackupArchiveError(code)

  return new Transform({
    transform(chunk: Buffer, _encoding, callback: TransformCallback) {
      if (finished && chunk.length) return callback(fail('E_BACKUP_TAMPERED'))
      buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk
      try {
        if (!header) {
          if (buffer.length < HEADER_SIZE) return callback()
          const candidate = buffer.subarray(0, HEADER_SIZE)
          if (!candidate.subarray(0, 8).equals(MAGIC) || candidate[8] !== VERSION)
            throw fail('E_BACKUP_FORMAT')
          if (candidate[9] !== ALGORITHM) throw fail('E_BACKUP_FORMAT')
          chunkSize = candidate.readUInt32BE(12)
          if (chunkSize < 1 || chunkSize > MAX_CHUNK) throw fail('E_BACKUP_FORMAT')
          if (!timingSafeEqual(candidate.subarray(16, 24), keyId(master)))
            throw fail('E_BACKUP_KEY')
          header = Buffer.from(candidate)
          key = fileKey(master, header.subarray(24, 40))
          buffer = buffer.subarray(HEADER_SIZE)
        }
        while (buffer.length >= FRAME_HEADER) {
          if (finished) throw fail('E_BACKUP_TAMPERED')
          const flag = buffer[0]
          const length = buffer.readUInt32BE(1)
          if (flag > 1 || length > chunkSize) throw fail('E_BACKUP_TAMPERED')
          const total = FRAME_HEADER + length + TAG_SIZE
          if (buffer.length < total) break
          const decipher = createDecipheriv('aes-256-gcm', key!, nonce(counter))
          decipher.setAAD(aad(header, counter, flag === 1))
          decipher.setAuthTag(buffer.subarray(FRAME_HEADER + length, total))
          let plain: Buffer
          try {
            plain = Buffer.concat([
              decipher.update(buffer.subarray(FRAME_HEADER, FRAME_HEADER + length)),
              decipher.final(),
            ])
          } catch {
            throw fail('E_BACKUP_TAMPERED')
          }
          counter++
          buffer = buffer.subarray(total)
          if (flag === 1) finished = true
          if (plain.length) this.push(plain)
        }
        if (finished && buffer.length) throw fail('E_BACKUP_TAMPERED')
        callback()
      } catch (error) {
        callback(error as Error)
      }
    },
    flush(callback: TransformCallback) {
      if (!header) {
        const prefix = buffer.subarray(0, MAGIC.length)
        const looksLikeArchive =
          buffer.length > 0 && MAGIC.subarray(0, prefix.length).equals(prefix)
        return callback(fail(looksLikeArchive ? 'E_BACKUP_TRUNCATED' : 'E_BACKUP_FORMAT'))
      }
      if (!finished) return callback(fail('E_BACKUP_TRUNCATED'))
      callback()
    },
  })
}

async function* containerEntries(directory: string, names: readonly string[]) {
  for (const name of names) {
    const path = join(directory, name)
    const info = await lstat(path)
    if (!info.isFile()) throw new BackupArchiveError('E_BACKUP_CONTENT')
    const nameBytes = Buffer.from(name, 'utf8')
    const head = Buffer.alloc(2 + nameBytes.length + 8)
    head.writeUInt16BE(nameBytes.length, 0)
    nameBytes.copy(head, 2)
    head.writeBigUInt64BE(BigInt(info.size), 2 + nameBytes.length)
    yield head
    let written = 0
    for await (const chunk of createReadStream(path)) {
      written += (chunk as Buffer).length
      yield chunk as Buffer
    }
    // The file changed while it was being sealed.
    if (written !== info.size) throw new BackupArchiveError('E_BACKUP_CONTENT')
  }
  yield Buffer.alloc(2)
}

/** The snapshot files present in a directory, in archive order; database.dump is required. */
async function snapshotNames(directory: string) {
  const present: string[] = []
  for (const name of BACKUP_ARCHIVE_FILES) {
    try {
      await lstat(join(directory, name))
      present.push(name)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  if (!present.includes('database.dump')) throw new BackupArchiveError('E_BACKUP_CONTENT')
  return present
}

/**
 * Seals a snapshot directory into a new archive file (created exclusively, mode 0600).
 * Returns the archive's size and SHA-256. A partial file is removed on failure.
 */
export async function sealBackupArchive(
  snapshotDirectory: string,
  outFile: string,
  master: Buffer,
  options: { chunkSize?: number } = {}
) {
  const names = await snapshotNames(snapshotDirectory)
  const hash = createHash('sha256')
  let size = 0
  const tap = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk)
      size += chunk.length
      callback(null, chunk)
    },
  })
  const output = createWriteStream(outFile, { flags: 'wx', mode: 0o600 })
  try {
    await pipeline(
      Readable.from(containerEntries(snapshotDirectory, names)),
      createSealStream(master, options),
      tap,
      output
    )
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') await rm(outFile, { force: true })
    throw error
  }
  return { size, sha256: hash.digest('hex') }
}

/** Reads the decrypted container and writes each allow-listed entry into the target. */
async function extractContainer(container: string, target: string) {
  const handle = await open(container, 'r')
  try {
    const { size: total } = await handle.stat()
    let position = 0
    const read = async (length: number) => {
      if (position + length > total) throw new BackupArchiveError('E_BACKUP_CONTENT')
      const value = Buffer.alloc(length)
      const { bytesRead } = await handle.read(value, 0, length, position)
      if (bytesRead !== length) throw new BackupArchiveError('E_BACKUP_CONTENT')
      position += length
      return value
    }
    const seen = new Set<string>()
    for (;;) {
      const lengthBytes = await read(2)
      const nameLength = lengthBytes.readUInt16BE(0)
      if (nameLength === 0) break
      if (nameLength > 64) throw new BackupArchiveError('E_BACKUP_CONTENT')
      const nameBytes = await read(nameLength)
      const name = nameBytes.toString('utf8')
      if (!(BACKUP_ARCHIVE_FILES as readonly string[]).includes(name) || seen.has(name))
        throw new BackupArchiveError('E_BACKUP_CONTENT')
      seen.add(name)
      const sizeBytes = await read(8)
      const size = Number(sizeBytes.readBigUInt64BE(0))
      if (!Number.isSafeInteger(size) || position + size > total)
        throw new BackupArchiveError('E_BACKUP_CONTENT')
      const output = createWriteStream(join(target, name), { flags: 'wx', mode: 0o600 })
      const input =
        size === 0
          ? Readable.from([])
          : createReadStream(container, { start: position, end: position + size - 1 })
      await pipeline(input, output)
      position += size
    }
    if (position !== total || !seen.has('database.dump'))
      throw new BackupArchiveError('E_BACKUP_CONTENT')
  } finally {
    await handle.close()
  }
}

/**
 * Opens an archive into a new snapshot directory (mode 0700). The decrypted container is
 * written next to the extracted files only until the archive's final frame verifies, then
 * deleted. Nothing is left behind when the archive is wrong, tampered or truncated.
 */
export async function openBackupArchive(file: string, targetDirectory: string, master: Buffer) {
  try {
    await mkdir(targetDirectory, { mode: 0o700 })
  } catch {
    throw new BackupArchiveError('E_BACKUP_TARGET')
  }
  const container = join(targetDirectory, '.archive.bin')
  try {
    await pipeline(
      createReadStream(file),
      createOpenStream(master),
      createWriteStream(container, { flags: 'wx', mode: 0o600 })
    )
    await extractContainer(container, targetDirectory)
  } catch (error) {
    await rm(targetDirectory, { recursive: true, force: true })
    throw error
  } finally {
    await rm(container, { force: true })
  }
}
