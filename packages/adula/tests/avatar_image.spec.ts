import { test } from '@japa/runner'
import { crc32, deflateSync } from 'node:zlib'
import { AVATAR_LIMITS, AdulaError, sanitizeAvatarImage } from '../index.js'

// Fixtures are built here byte by byte, so each test states exactly what the file contains.
// This suite needs no database.

function pngChunk(type: string, data: Buffer = Buffer.alloc(0)) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0)
  return Buffer.concat([head, data, crc])
}
function ihdr(width: number, height: number, depth = 8, colorType = 6) {
  const data = Buffer.alloc(13)
  data.writeUInt32BE(width, 0)
  data.writeUInt32BE(height, 4)
  data[8] = depth
  data[9] = colorType
  return pngChunk('IHDR', data)
}
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
function pixels(width: number, height: number) {
  const row = Buffer.alloc(1 + width * 4, 0x7f)
  row[0] = 0
  return pngChunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: height }, () => row))))
}
function png(
  options: {
    width?: number
    height?: number
    before?: Buffer[]
    after?: Buffer[]
    tail?: Buffer
  } = {}
) {
  const width = options.width ?? 64
  const height = options.height ?? 64
  return Buffer.concat([
    SIGNATURE,
    ihdr(width, height),
    ...(options.before ?? []),
    pixels(width, height),
    ...(options.after ?? []),
    pngChunk('IEND'),
    options.tail ?? Buffer.alloc(0),
  ])
}
function chunkTypes(bytes: Buffer) {
  const types: string[] = []
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset)
    types.push(bytes.toString('latin1', offset + 4, offset + 8))
    offset += 12 + length
  }
  return types
}

function riffChunk(type: string, data: Buffer) {
  const head = Buffer.alloc(8)
  head.write(type, 0, 'latin1')
  head.writeUInt32LE(data.length, 4)
  return Buffer.concat([head, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)])
}
function vp8l(width: number, height: number) {
  const data = Buffer.alloc(16)
  data[0] = 0x2f
  data.writeUInt32LE(((width - 1) | ((height - 1) << 14)) >>> 0, 1)
  return riffChunk('VP8L', data)
}
function vp8x(width: number, height: number, flags: number) {
  const data = Buffer.alloc(10)
  data[0] = flags
  data.writeUIntLE(width - 1, 4, 3)
  data.writeUIntLE(height - 1, 7, 3)
  return riffChunk('VP8X', data)
}
function webp(chunks: Buffer[]) {
  const body = Buffer.concat(chunks)
  const head = Buffer.alloc(12)
  head.write('RIFF', 0, 'latin1')
  head.writeUInt32LE(body.length + 4, 4)
  head.write('WEBP', 8, 'latin1')
  return Buffer.concat([head, body])
}
function riffTypes(bytes: Buffer) {
  const types: string[] = []
  for (let offset = 12; offset < bytes.length;) {
    const length = bytes.readUInt32LE(offset + 4)
    types.push(bytes.toString('latin1', offset, offset + 4))
    offset += 8 + length + (length % 2)
  }
  return types
}

function refused(
  assert: { fail(message: string): void; equal(a: unknown, b: unknown): void },
  bytes: Buffer,
  code: string
) {
  try {
    sanitizeAvatarImage(bytes)
  } catch (error) {
    if (!(error instanceof AdulaError)) throw error
    assert.equal(error.status, 422)
    assert.equal(error.code, code)
    return
  }
  assert.fail(`expected ${code}`)
}

test.group('Profile picture sanitizer (ADR 050)', () => {
  test('a PNG keeps only the chunks needed to draw it', ({ assert }) => {
    const exif = pngChunk('eXIf', Buffer.from('MM\0*GPSLatitude=24.7136'))
    const text = pngChunk('tEXt', Buffer.from('Comment\0<script>alert(1)</script>'))
    const itxt = pngChunk('iTXt', Buffer.from('XML:com.adobe.xmp\0\0\0\0\0<x:xmpmeta/>'))
    const time = pngChunk('tIME', Buffer.from([7, 234, 11, 5, 10, 0, 0]))
    const input = png({ before: [exif, text, itxt], after: [time] })
    const image = sanitizeAvatarImage(input)
    assert.equal(image.type, 'png')
    assert.equal(image.mimeType, 'image/png')
    assert.equal(image.width, 64)
    assert.equal(image.height, 64)
    assert.deepEqual(chunkTypes(image.bytes), ['IHDR', 'IDAT', 'IEND'])
    for (const secret of ['GPSLatitude', 'script', 'xmpmeta'])
      assert.notInclude(image.bytes.toString('latin1'), secret)
    // The output is itself a valid picture with correct checksums.
    assert.deepEqual(sanitizeAvatarImage(image.bytes).bytes, image.bytes)
  })

  test('bytes after IEND (a polyglot tail) are dropped', ({ assert }) => {
    const input = png({ tail: Buffer.from('<html><script>alert(document.cookie)</script></html>') })
    const image = sanitizeAvatarImage(input)
    assert.notInclude(image.bytes.toString('latin1'), '<html>')
    assert.isTrue(image.bytes.length < input.length)
  })

  test('a still WebP loses its EXIF, XMP and ICC chunks and their flags', ({ assert }) => {
    const input = webp([
      vp8x(128, 96, 0x20 | 0x08 | 0x04),
      riffChunk('ICCP', Buffer.from('icc-profile-bytes')),
      vp8l(128, 96),
      riffChunk('EXIF', Buffer.from('GPSLongitude=46.6753')),
      riffChunk('XMP ', Buffer.from('<x:xmpmeta>author</x:xmpmeta>')),
    ])
    const image = sanitizeAvatarImage(input)
    assert.equal(image.type, 'webp')
    assert.equal(image.width, 128)
    assert.equal(image.height, 96)
    assert.deepEqual(riffTypes(image.bytes), ['VP8X', 'VP8L'])
    assert.equal(image.bytes[20] & 0x2c, 0)
    assert.equal(image.bytes.readUInt32LE(4), image.bytes.length - 8)
    assert.notInclude(image.bytes.toString('latin1'), 'GPSLongitude')
    const simple = sanitizeAvatarImage(webp([vp8l(40, 40)]))
    assert.deepEqual(riffTypes(simple.bytes), ['VP8L'])
  })

  test('other formats and disguised files are refused by their first bytes', ({ assert }) => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')
    refused(assert, svg, 'E_AVATAR_TYPE')
    refused(assert, Buffer.concat([Buffer.from('<html>'), png()]), 'E_AVATAR_TYPE')
    refused(assert, Buffer.from('GIF89a\x40\x00\x40\x00', 'latin1'), 'E_AVATAR_TYPE')
    refused(
      assert,
      Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]),
      'E_AVATAR_TYPE'
    )
    refused(assert, Buffer.from('MZ\x90\x00 setup.exe', 'latin1'), 'E_AVATAR_TYPE')
    refused(assert, Buffer.alloc(0), 'E_AVATAR_TYPE')
  })

  test('dimensions are bounded from the header before anything is stored', ({ assert }) => {
    // A decompression bomb declares a huge canvas in a few bytes.
    refused(
      assert,
      Buffer.concat([SIGNATURE, ihdr(50000, 50000), pixels(1, 1), pngChunk('IEND')]),
      'E_AVATAR_DIMENSIONS'
    )
    refused(assert, png({ width: AVATAR_LIMITS.maxSide + 1, height: 64 }), 'E_AVATAR_DIMENSIONS')
    refused(assert, png({ width: 31, height: 31 }), 'E_AVATAR_DIMENSIONS')
    refused(assert, webp([vp8l(4000, 4000)]), 'E_AVATAR_DIMENSIONS')
    assert.equal(sanitizeAvatarImage(png({ width: 512, height: 512 })).width, 512)
  })

  test('files over the size limit are refused', ({ assert }) => {
    const big = png({ after: [pngChunk('tEXt', Buffer.alloc(AVATAR_LIMITS.maxBytes, 0x41))] })
    refused(assert, big, 'E_AVATAR_SIZE')
  })

  test('animations are refused', ({ assert }) => {
    refused(assert, png({ before: [pngChunk('acTL', Buffer.alloc(8))] }), 'E_AVATAR_TYPE')
    refused(assert, webp([vp8x(64, 64, 0x02), vp8l(64, 64)]), 'E_AVATAR_TYPE')
    refused(
      assert,
      webp([vp8x(64, 64, 0), riffChunk('ANIM', Buffer.alloc(6)), vp8l(64, 64)]),
      'E_AVATAR_TYPE'
    )
  })

  test('forged structure is refused', ({ assert }) => {
    const valid = png()
    const badCrc = Buffer.from(valid)
    badCrc[valid.length - 13] ^= 0xff
    refused(assert, badCrc, 'E_AVATAR_CORRUPT')
    // IHDR must come first and appear once.
    refused(
      assert,
      Buffer.concat([SIGNATURE, pixels(64, 64), ihdr(64, 64), pngChunk('IEND')]),
      'E_AVATAR_CORRUPT'
    )
    refused(assert, png({ before: [ihdr(64, 64)] }), 'E_AVATAR_CORRUPT')
    // A colour type and bit depth the specification does not allow.
    refused(
      assert,
      Buffer.concat([SIGNATURE, ihdr(64, 64, 3, 2), pixels(64, 64), pngChunk('IEND')]),
      'E_AVATAR_CORRUPT'
    )
    // A palette image without a palette, and image data split around another chunk.
    refused(
      assert,
      Buffer.concat([SIGNATURE, ihdr(64, 64, 8, 3), pixels(64, 64), pngChunk('IEND')]),
      'E_AVATAR_CORRUPT'
    )
    refused(
      assert,
      Buffer.concat([
        SIGNATURE,
        ihdr(64, 64),
        pixels(64, 64),
        pngChunk('tEXt', Buffer.from('a\0b')),
        pixels(64, 64),
        pngChunk('IEND'),
      ]),
      'E_AVATAR_CORRUPT'
    )
    // An unknown critical chunk cannot be skipped.
    refused(assert, png({ before: [pngChunk('ZZZZ', Buffer.from('x'))] }), 'E_AVATAR_CORRUPT')
    // WebP whose frame disagrees with its canvas, or whose RIFF size lies.
    refused(assert, webp([vp8x(64, 64, 0), vp8l(65, 64)]), 'E_AVATAR_CORRUPT')
    const lying = webp([vp8l(64, 64)])
    lying.writeUInt32LE(lying.length + 100, 4)
    refused(assert, lying, 'E_AVATAR_CORRUPT')
  })

  test('every truncation of a valid file is refused with a 422, never a crash', ({ assert }) => {
    for (const input of [
      png({ width: 40, height: 40 }),
      webp([vp8x(40, 40, 0x08), vp8l(40, 40), riffChunk('EXIF', Buffer.from('x'))]),
    ]) {
      for (let length = 0; length < input.length; length++) {
        const cut = input.subarray(0, length)
        try {
          sanitizeAvatarImage(cut)
          assert.fail(`truncated at ${length} accepted`)
        } catch (error) {
          assert.instanceOf(error, AdulaError)
          assert.equal((error as AdulaError).status, 422)
        }
      }
    }
  })
})
