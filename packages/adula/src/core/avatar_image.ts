import { crc32 } from 'node:zlib'
import { AdulaError } from '../admin/errors.js'

/**
 * Profile pictures (ADR 050) are untrusted bytes. The browser crops and re-encodes every
 * picture to at most 512 px, so the server accepts only what that produces: PNG or still
 * WebP within these bounds. Nothing here decodes pixel data; the container is checked and
 * rewritten so that only the chunks a browser needs to draw the picture remain.
 */
export const AVATAR_LIMITS = Object.freeze({ maxBytes: 1024 * 1024, minSide: 32, maxSide: 512 })

export type AvatarImage = {
  type: 'png' | 'webp'
  mimeType: 'image/png' | 'image/webp'
  extname: 'png' | 'webp'
  width: number
  height: number
  bytes: Buffer
}

const TYPE_MESSAGE = 'الصورة الشخصية يجب أن تكون بصيغة PNG أو WebP'
const CORRUPT_MESSAGE = 'ملف الصورة تالف أو غير مكتمل'
const SIZE_MESSAGE = 'حجم الصورة الشخصية يتجاوز ١ ميغابايت'
const DIMENSIONS_MESSAGE = 'أبعاد الصورة الشخصية يجب أن تكون بين ٣٢ و٥١٢ بكسل'
const ANIMATED_MESSAGE = 'الصورة الشخصية يجب أن تكون صورة ثابتة'

const wrongType = () => new AdulaError(422, 'E_AVATAR_TYPE', TYPE_MESSAGE)
const corrupt = () => new AdulaError(422, 'E_AVATAR_CORRUPT', CORRUPT_MESSAGE)

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
/** Chunks a still PNG needs; text, EXIF, ICC, time and animation chunks are dropped. */
const PNG_KEEP = new Set(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND'])
/** Bit depths allowed for each PNG colour type (PNG specification, table 11.1). */
const PNG_DEPTHS: Record<number, number[]> = {
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16],
}

function chunk(type: string, data: Buffer) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0)
  return Buffer.concat([head, data, crc])
}

function png(bytes: Buffer) {
  let offset = PNG_SIGNATURE.length
  const kept: Buffer[] = [PNG_SIGNATURE]
  let width = 0
  let height = 0
  let colorType = -1
  let sawPalette = false
  let idat: 'none' | 'open' | 'closed' = 'none'
  let first = true
  for (;;) {
    if (offset + 12 > bytes.length) throw corrupt()
    const length = bytes.readUInt32BE(offset)
    const type = bytes.toString('latin1', offset + 4, offset + 8)
    if (length > 0x7fffffff || offset + 12 + length > bytes.length) throw corrupt()
    if (!/^[A-Za-z]{4}$/.test(type)) throw corrupt()
    const data = bytes.subarray(offset + 8, offset + 8 + length)
    const stored = bytes.readUInt32BE(offset + 8 + length)
    if (crc32(bytes.subarray(offset + 4, offset + 8 + length)) >>> 0 !== stored) throw corrupt()
    offset += 12 + length
    if (first) {
      if (type !== 'IHDR' || length !== 13) throw corrupt()
      first = false
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      const depth = data[8]
      colorType = data[9]
      if (
        !PNG_DEPTHS[colorType]?.includes(depth) ||
        data[10] !== 0 ||
        data[11] !== 0 ||
        (data[12] !== 0 && data[12] !== 1)
      )
        throw corrupt()
    } else if (type === 'IHDR') throw corrupt()
    // Animated PNG frames: a profile picture is a still image.
    if (type === 'acTL' || type === 'fcTL' || type === 'fdAT')
      throw new AdulaError(422, 'E_AVATAR_TYPE', ANIMATED_MESSAGE)
    // An unknown critical chunk (upper-case first letter) cannot be skipped safely.
    if (!PNG_KEEP.has(type) && type[0] === type[0].toUpperCase()) throw corrupt()
    if (type === 'PLTE') {
      if (idat !== 'none' || sawPalette || length % 3 !== 0 || length === 0) throw corrupt()
      sawPalette = true
    }
    if (type === 'IDAT') {
      if (idat === 'closed') throw corrupt()
      idat = 'open'
    } else if (idat === 'open') idat = 'closed'
    if (PNG_KEEP.has(type)) kept.push(chunk(type, Buffer.from(data)))
    // Bytes after IEND (a polyglot tail) are not kept.
    if (type === 'IEND') break
  }
  if (idat === 'none' || (colorType === 3 && !sawPalette)) throw corrupt()
  return { width, height, bytes: Buffer.concat(kept) }
}

/** WebP flags (VP8X): ICC profile, EXIF and XMP metadata are cleared with their chunks. */
const VP8X_ANIMATION = 0x02
const VP8X_METADATA = 0x04 | 0x08 | 0x20

function webpFrame(type: string, data: Buffer) {
  if (type === 'VP8 ') {
    if (data.length < 10 || data[3] !== 0x9d || data[4] !== 0x01 || data[5] !== 0x2a)
      throw corrupt()
    return { width: data.readUInt16LE(6) & 0x3fff, height: data.readUInt16LE(8) & 0x3fff }
  }
  if (data.length < 5 || data[0] !== 0x2f) throw corrupt()
  const bits = data.readUInt32LE(1)
  if (bits >>> 29 !== 0) throw corrupt()
  return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
}

function webp(bytes: Buffer) {
  if (bytes.length < 20) throw corrupt()
  const riff = bytes.readUInt32LE(4)
  if (riff < 12 || riff % 2 !== 0 || riff + 8 > bytes.length) throw corrupt()
  const end = riff + 8
  let offset = 12
  const chunks: { type: string; data: Buffer }[] = []
  while (offset < end) {
    if (offset + 8 > end) throw corrupt()
    const type = bytes.toString('latin1', offset, offset + 4)
    const length = bytes.readUInt32LE(offset + 4)
    const padded = length + (length % 2)
    if (offset + 8 + padded > end) throw corrupt()
    chunks.push({ type, data: bytes.subarray(offset + 8, offset + 8 + length) })
    offset += 8 + padded
  }
  if (!chunks.length) throw corrupt()
  if (chunks.some((entry) => entry.type === 'ANIM' || entry.type === 'ANMF'))
    throw new AdulaError(422, 'E_AVATAR_TYPE', ANIMATED_MESSAGE)
  const [head] = chunks
  let out: { type: string; data: Buffer }[]
  let width: number
  let height: number
  if (head.type === 'VP8 ' || head.type === 'VP8L') {
    if (chunks.length !== 1) throw corrupt()
    ;({ width, height } = webpFrame(head.type, head.data))
    out = [head]
  } else if (head.type === 'VP8X') {
    if (head.data.length !== 10) throw corrupt()
    const flags = head.data[0]
    if (flags & VP8X_ANIMATION) throw new AdulaError(422, 'E_AVATAR_TYPE', ANIMATED_MESSAGE)
    width = head.data.readUIntLE(4, 3) + 1
    height = head.data.readUIntLE(7, 3) + 1
    const rest = chunks.slice(1)
    const frames = rest.filter((entry) => entry.type === 'VP8 ' || entry.type === 'VP8L')
    if (frames.length !== 1) throw corrupt()
    const frame = webpFrame(frames[0].type, frames[0].data)
    if (frame.width !== width || frame.height !== height) throw corrupt()
    const alpha = rest.filter((entry) => entry.type === 'ALPH')
    if (alpha.length > 1 || (alpha.length && frames[0].type !== 'VP8 ')) throw corrupt()
    const header = Buffer.from(head.data)
    header[0] = flags & ~VP8X_METADATA
    // EXIF, XMP, ICCP and unknown chunks are dropped; ALPH must precede the frame.
    out = [{ type: 'VP8X', data: header }, ...alpha, frames[0]]
  } else throw corrupt()
  const parts: Buffer[] = []
  for (const entry of out) {
    const head8 = Buffer.alloc(8)
    head8.write(entry.type, 0, 'latin1')
    head8.writeUInt32LE(entry.data.length, 4)
    parts.push(head8, entry.data)
    if (entry.data.length % 2) parts.push(Buffer.alloc(1))
  }
  const body = Buffer.concat(parts)
  const header = Buffer.alloc(12)
  header.write('RIFF', 0, 'latin1')
  header.writeUInt32LE(body.length + 4, 4)
  header.write('WEBP', 8, 'latin1')
  return { width, height, bytes: Buffer.concat([header, body]) }
}

function detect(bytes: Buffer): 'png' | 'webp' | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return 'png'
  if (
    bytes.length >= 12 &&
    bytes.toString('latin1', 0, 4) === 'RIFF' &&
    bytes.toString('latin1', 8, 12) === 'WEBP'
  )
    return 'webp'
  return null
}

function parse(type: 'png' | 'webp', bytes: Buffer) {
  try {
    return type === 'png' ? png(bytes) : webp(bytes)
  } catch (error) {
    if (error instanceof AdulaError) throw error
    // A read past a declared length means the file is truncated or forged.
    throw corrupt()
  }
}

/**
 * Checks an uploaded profile picture by its first bytes (never its name or declared type),
 * bounds its size and dimensions from the header, and returns a copy without metadata or
 * trailing bytes. Anything else, including SVG, GIF, JPEG, HTML and animations, is refused.
 */
export function sanitizeAvatarImage(input: Uint8Array): AvatarImage {
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength)
  if (bytes.length > AVATAR_LIMITS.maxBytes)
    throw new AdulaError(422, 'E_AVATAR_SIZE', SIZE_MESSAGE)
  const type = detect(bytes)
  if (!type) throw wrongType()
  const parsed = parse(type, bytes)
  const inBounds = (side: number) => side >= AVATAR_LIMITS.minSide && side <= AVATAR_LIMITS.maxSide
  if (!inBounds(parsed.width) || !inBounds(parsed.height))
    throw new AdulaError(422, 'E_AVATAR_DIMENSIONS', DIMENSIONS_MESSAGE)
  // The rewritten file must read back as the same picture.
  const again = parse(type, parsed.bytes)
  if (again.width !== parsed.width || again.height !== parsed.height) throw corrupt()
  return {
    type,
    mimeType: type === 'png' ? 'image/png' : 'image/webp',
    extname: type,
    width: parsed.width,
    height: parsed.height,
    bytes: again.bytes,
  }
}

/**
 * Prepares an uploaded profile picture for storage (ADR 050). `sanitizeAvatarImage` first
 * checks the bytes without decoding them (type, size, header, dimensions, animation), so
 * nothing unexpected reaches the decoder. libvips then decodes the single still frame
 * within a pixel budget and re-encodes it, which drops every metadata chunk and any payload
 * hidden inside the compressed pixel data. The result is checked again before it is stored.
 */
export async function prepareAvatarImage(input: Uint8Array): Promise<AvatarImage> {
  const checked = sanitizeAvatarImage(input)
  const { default: sharp } = await import('sharp')
  const options = {
    limitInputPixels: AVATAR_LIMITS.maxSide * AVATAR_LIMITS.maxSide,
    animated: false,
    failOn: 'error' as const,
  }
  let encoded: Buffer
  try {
    const image = sharp(checked.bytes, options)
    const metadata = await image.metadata()
    if ((metadata.pages ?? 1) !== 1) throw new AdulaError(422, 'E_AVATAR_TYPE', ANIMATED_MESSAGE)
    // Metadata is kept only when asked for (withMetadata), so the output carries none.
    encoded =
      checked.type === 'png'
        ? await image.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer()
        : await image.webp({ quality: 90, effort: 4 }).toBuffer()
    if (encoded.length > AVATAR_LIMITS.maxBytes && checked.type === 'png')
      encoded = await sharp(checked.bytes, options).webp({ quality: 85, effort: 4 }).toBuffer()
  } catch (error) {
    if (error instanceof AdulaError) throw error
    throw corrupt()
  }
  return sanitizeAvatarImage(encoded)
}
