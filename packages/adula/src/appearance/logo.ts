import { AdulaError } from '../admin/errors.js'

/**
 * Logos (ADR 053) are untrusted bytes shown on public pages. Only PNG, JPEG and still WebP
 * are accepted, recognised by their first bytes; SVG is refused because it can carry script.
 * libvips decodes one frame within a pixel budget and re-encodes it in the same format,
 * fitted inside 1024×512 without enlarging, so the stored file carries no metadata and no
 * payload hidden in the original. The result is checked again before it is stored.
 */
export const LOGO_LIMITS = Object.freeze({
  maxBytes: 1024 * 1024,
  maxInputSide: 4096,
  maxWidth: 1024,
  maxHeight: 512,
  minSide: 16,
})

export type LogoType = 'png' | 'jpeg' | 'webp'
export type LogoImage = {
  type: LogoType
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  extname: 'png' | 'jpg' | 'webp'
  width: number
  height: number
  bytes: Buffer
}

const TYPE_MESSAGE = 'الشعار يجب أن يكون صورة PNG أو JPEG أو WebP'
const wrongType = () => new AdulaError(422, 'E_LOGO_TYPE', TYPE_MESSAGE)
const corrupt = () => new AdulaError(422, 'E_LOGO_CORRUPT', 'ملف الشعار تالف أو غير مكتمل')

const MIME: Record<LogoType, LogoImage['mimeType']> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
}
const EXTNAME: Record<LogoType, LogoImage['extname']> = { png: 'png', jpeg: 'jpg', webp: 'webp' }

/** The format named by the file's first bytes; the name and declared type are never trusted. */
export function detectLogoType(bytes: Uint8Array): LogoType | null {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10])))
    return 'png'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg'
  if (
    b.length >= 12 &&
    b.subarray(0, 4).toString('latin1') === 'RIFF' &&
    b.subarray(8, 12).toString('latin1') === 'WEBP'
  )
    return 'webp'
  return null
}

/** The headers a stored logo is served with: its allow-listed type, no sniffing, no script. */
export function logoHeaders(logo: { mimeType: string; size: number; id: number }) {
  const type = Object.values(MIME).includes(logo.mimeType as LogoImage['mimeType'])
    ? logo.mimeType
    : 'application/octet-stream'
  return {
    'Content-Type': type,
    'Content-Length': String(logo.size),
    'Content-Disposition': 'inline',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cross-Origin-Resource-Policy': 'same-origin',
    'ETag': `"logo-${logo.id}"`,
    // A logo id never changes its bytes; a new logo is a new id and a new URL.
    'Cache-Control': 'public, max-age=31536000, immutable',
  } as Record<string, string>
}

export async function prepareLogoImage(input: Uint8Array): Promise<LogoImage> {
  if (input.byteLength > LOGO_LIMITS.maxBytes)
    throw new AdulaError(422, 'E_LOGO_SIZE', 'حجم الشعار يتجاوز ١ ميغابايت')
  const type = detectLogoType(input)
  if (!type) throw wrongType()
  const { default: sharp } = await import('sharp')
  const options = {
    limitInputPixels: LOGO_LIMITS.maxInputSide * LOGO_LIMITS.maxInputSide,
    animated: false,
    failOn: 'error' as const,
  }
  let bytes: Buffer
  try {
    const source = sharp(Buffer.from(input), options)
    const metadata = await source.metadata()
    // The decoder must agree with the first bytes, and a logo is one still frame.
    if (metadata.format !== type) throw wrongType()
    if ((metadata.pages ?? 1) !== 1)
      throw new AdulaError(422, 'E_LOGO_TYPE', 'الشعار يجب أن يكون صورة ثابتة')
    const fitted = source.rotate().resize({
      width: LOGO_LIMITS.maxWidth,
      height: LOGO_LIMITS.maxHeight,
      fit: 'inside',
      withoutEnlargement: true,
    })
    bytes =
      type === 'png'
        ? await fitted.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer()
        : type === 'jpeg'
          ? await fitted.jpeg({ quality: 90, mozjpeg: true }).toBuffer()
          : await fitted.webp({ quality: 90, effort: 4 }).toBuffer()
  } catch (error) {
    if (error instanceof AdulaError) throw error
    throw corrupt()
  }
  const again = await sharp(bytes, options)
    .metadata()
    .catch(() => {
      throw corrupt()
    })
  const width = again.width ?? 0
  const height = again.height ?? 0
  if (
    detectLogoType(bytes) !== type ||
    width < LOGO_LIMITS.minSide ||
    height < LOGO_LIMITS.minSide ||
    width > LOGO_LIMITS.maxWidth ||
    height > LOGO_LIMITS.maxHeight
  )
    throw new AdulaError(422, 'E_LOGO_DIMENSIONS', 'أبعاد الشعار يجب ألا تقل عن ١٦ بكسل')
  if (bytes.length > LOGO_LIMITS.maxBytes)
    throw new AdulaError(422, 'E_LOGO_SIZE', 'حجم الشعار يتجاوز ١ ميغابايت')
  return { type, mimeType: MIME[type], extname: EXTNAME[type], width, height, bytes }
}
