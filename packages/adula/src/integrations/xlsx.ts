import { crc32 } from 'node:zlib'
import { Inflate, zipSync } from 'fflate'
import { readSheet } from 'read-excel-file/universal'
import { AdulaError } from '../admin/errors.js'
import { extensionOf, type ImportAdapter, type ImportTable } from './import_adapters.js'

/**
 * Limits for an uploaded workbook. Sizes are counted on the bytes actually inflated, never
 * on the sizes the archive declares. Rows include the header row.
 */
export const XLSX_LIMITS = Object.freeze({
  compressed: 5 * 1024 * 1024,
  decompressedTotal: 64 * 1024 * 1024,
  decompressedEntry: 48 * 1024 * 1024,
  entries: 200,
  sharedStrings: 500_000,
  rows: 5001,
  columns: 100,
})
export type XlsxLimits = { readonly [key in keyof typeof XLSX_LIMITS]: number }

export const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/** What the guard found: the checked first sheet and a clean archive for the reader. */
export type GuardedXlsx = {
  sheetPath: string
  sharedStrings: number
  maxRow: number
  maxColumn: number
  /** A rebuilt, uncompressed archive holding only the parts the reader needs. */
  archive: Uint8Array
}

const MALFORMED = 'تعذر قراءة ملف Excel: الملف تالف أو ليس بصيغة xlsx'
const ENCRYPTED =
  'الملف محمي بكلمة مرور أو بصيغة Excel قديمة (xls). احفظه بصيغة xlsx دون حماية ثم أعد رفعه'
const TOO_LARGE = 'حجم محتوى الملف بعد فك الضغط يتجاوز الحد المسموح'

function fail(message: string): never {
  throw new AdulaError(422, 'E_IMPORT_FILE', message)
}

const LOCAL = 0x04034b50
const CENTRAL = 0x02014b50
const END = 0x06054b50
const DESCRIPTOR = 0x08074b50
/** Small input steps bound how much one push can inflate (deflate expands at most ~1032x). */
const CHUNK = 4096

type Entry = {
  name: string
  method: number
  crc: number
  compressedSize: number
  offset: number
  dataStart: number
  end: number
}

function endOfCentralDirectory(view: DataView) {
  const last = view.byteLength - 22
  for (let at = last; at >= Math.max(0, last - 0xffff); at--)
    if (
      view.getUint32(at, true) === END &&
      at + 22 + view.getUint16(at + 20, true) === view.byteLength
    )
      return at
  return fail(MALFORMED)
}

function decodeName(bytes: Uint8Array) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return fail(MALFORMED)
  }
}

/** Reads the central directory and checks every local header against it. */
function entries(bytes: Uint8Array, limits: XlsxLimits): Entry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const eocd = endOfCentralDirectory(view)
  const count = view.getUint16(eocd + 10, true)
  const size = view.getUint32(eocd + 12, true)
  const start = view.getUint32(eocd + 16, true)
  // Multi-disk and ZIP64 archives are never needed for a 5 MB workbook.
  if (view.getUint16(eocd + 4, true) !== 0 || view.getUint16(eocd + 8, true) !== count)
    fail(MALFORMED)
  if (count === 0xffff || start === 0xffffffff || start + size !== eocd) fail(MALFORMED)
  if (count > limits.entries) fail(MALFORMED)
  const found: Entry[] = []
  const names = new Set<string>()
  let at = start
  for (let index = 0; index < count; index++) {
    if (at + 46 > eocd || view.getUint32(at, true) !== CENTRAL) fail(MALFORMED)
    const flags = view.getUint16(at + 8, true)
    const method = view.getUint16(at + 10, true)
    const crc = view.getUint32(at + 16, true)
    const compressedSize = view.getUint32(at + 20, true)
    const nameLength = view.getUint16(at + 28, true)
    const extraLength = view.getUint16(at + 30, true)
    const commentLength = view.getUint16(at + 32, true)
    const offset = view.getUint32(at + 42, true)
    if (flags & 1) fail(ENCRYPTED)
    if (method !== 0 && method !== 8) fail(MALFORMED)
    if (at + 46 + nameLength > eocd) fail(MALFORMED)
    const nameBytes = bytes.subarray(at + 46, at + 46 + nameLength)
    const name = decodeName(nameBytes)
    if (!name || names.has(name) || name.includes('\\') || name.includes('\0')) fail(MALFORMED)
    names.add(name)
    // The local header must name the same entry with the same method, unencrypted.
    if (offset + 30 > start || view.getUint32(offset, true) !== LOCAL) fail(MALFORMED)
    const localNameLength = view.getUint16(offset + 26, true)
    const localExtra = view.getUint16(offset + 28, true)
    if (
      view.getUint16(offset + 8, true) !== method ||
      (view.getUint16(offset + 6, true) & 1) !== 0 ||
      localNameLength !== nameLength ||
      offset + 30 + nameLength > start ||
      Buffer.compare(bytes.subarray(offset + 30, offset + 30 + nameLength), nameBytes) !== 0
    )
      fail(MALFORMED)
    const dataStart = offset + 30 + localNameLength + localExtra
    let end = dataStart + compressedSize
    if (end > start) fail(MALFORMED)
    if (flags & 8) {
      const signed = end + 4 <= start && view.getUint32(end, true) === DESCRIPTOR
      end += signed ? 16 : 12
      if (end > start) fail(MALFORMED)
    }
    found.push({ name, method, crc, compressedSize, offset, dataStart, end })
    at += 46 + nameLength + extraLength + commentLength
  }
  if (at !== eocd) fail(MALFORMED)
  // Entries must tile the file before the central directory: nothing hides between them
  // (an entry present only in local headers would be read by some parsers and not others).
  let cursor = 0
  for (const entry of [...found].sort((a, b) => a.offset - b.offset)) {
    if (entry.offset !== cursor) fail(MALFORMED)
    cursor = entry.end
  }
  if (cursor !== start) fail(MALFORMED)
  return found
}

type Budget = { total: number }

/** Inflates one entry, counting real output bytes and checking its CRC. */
function inflateEntry(
  bytes: Uint8Array,
  entry: Entry,
  store: boolean,
  budget: Budget,
  limits: XlsxLimits
) {
  const data = bytes.subarray(entry.dataStart, entry.dataStart + entry.compressedSize)
  const chunks: Uint8Array[] = []
  let size = 0
  let crc = 0
  const take = (chunk: Uint8Array) => {
    size += chunk.byteLength
    budget.total += chunk.byteLength
    if (size > limits.decompressedEntry || budget.total > limits.decompressedTotal) fail(TOO_LARGE)
    crc = crc32(chunk, crc)
    if (store) chunks.push(chunk)
  }
  if (entry.method === 0) take(data)
  else {
    let done = false
    const inflate = new Inflate((chunk, final) => {
      take(chunk)
      if (final) done = true
    })
    try {
      if (!data.byteLength) inflate.push(new Uint8Array(0), true)
      for (let at = 0; at < data.byteLength; at += CHUNK) {
        const end = Math.min(at + CHUNK, data.byteLength)
        inflate.push(data.subarray(at, end), end === data.byteLength)
      }
    } catch (error) {
      if (error instanceof AdulaError) throw error
      fail(MALFORMED)
    }
    if (!done) fail(MALFORMED)
  }
  if (crc >>> 0 !== entry.crc >>> 0) fail(MALFORMED)
  return store ? Buffer.concat(chunks) : null
}

/** Inflates every entry against one budget; keeps only the requested parts. */
function inflateAll(
  bytes: Uint8Array,
  list: Entry[],
  keep: (name: string) => boolean,
  limits: XlsxLimits
) {
  const kept = new Map<string, Uint8Array>()
  const budget: Budget = { total: 0 }
  for (const entry of list) {
    const part = inflateEntry(bytes, entry, keep(entry.name), budget, limits)
    if (part) kept.set(entry.name, part)
  }
  return kept
}

/** Decodes an XML part as UTF-8 and refuses DTDs (entity expansion, external entities). */
function xmlText(bytes: Uint8Array) {
  if (
    (bytes[0] === 0xfe && bytes[1] === 0xff) ||
    (bytes[0] === 0xff && bytes[1] === 0xfe) ||
    (bytes[0] === 0x00 && bytes[1] === 0x3c) ||
    (bytes[0] === 0x3c && bytes[1] === 0x00)
  )
    fail(MALFORMED)
  let text = ''
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    fail(MALFORMED)
  }
  const declared = /^\uFEFF?<\?xml[^>]*\bencoding\s*=\s*["']([^"']+)["']/i.exec(text)?.[1]
  if (declared && declared.toLowerCase().replace('_', '-') !== 'utf-8') fail(MALFORMED)
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) fail(MALFORMED)
  return text
}

const NAMED_ENTITIES: Record<string, string> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
}

const REFERENCE = /&(#x[\da-fA-F]{1,6}|#\d{1,7}|[a-z]+);/g

/**
 * Character and predefined entity references decoded as the XML parser decodes them. An
 * ampersand that does not start such a reference is refused rather than guessed at.
 */
function decodeEntities(value: string) {
  if (!value.includes('&')) return value
  if (value.replace(REFERENCE, '').includes('&')) fail(MALFORMED)
  return value.replace(REFERENCE, (_, reference: string) => {
    if (reference[0] !== '#') return NAMED_ENTITIES[reference] ?? fail(MALFORMED)
    const code =
      reference[1] === 'x' ? Number.parseInt(reference.slice(2), 16) : Number(reference.slice(1))
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : fail(MALFORMED)
  })
}

/**
 * Attributes as the reader sees them: values decoded, names without their namespace prefix
 * (`x:r` is `r`), `xmlns` declarations left out. Two attributes with the same local name are
 * refused, because the parser would keep only one of them.
 */
function attributes(source: string) {
  const found: Record<string, string> = {}
  for (const match of source.matchAll(/([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    const name = match[1]
    if (name === 'xmlns' || name.startsWith('xmlns:')) continue
    const local = name.includes(':') ? name.slice(name.lastIndexOf(':') + 1) : name
    if (Object.hasOwn(found, local)) fail(MALFORMED)
    found[local] = decodeEntities(match[2] ?? match[3])
  }
  return found
}

type XmlElement = {
  /** The local name, without a namespace prefix. */
  name: string
  closing: boolean
  selfClosing: boolean
  attributes: Record<string, string>
}

const TAG =
  /<(\/)?((?:[A-Za-z_][\w.-]*:)?[A-Za-z_][\w.-]*)((?:\s+[A-Za-z_][\w.:-]*\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/)?>/y

/**
 * The elements of an XML part, read strictly: after the XML declaration every `<` must open
 * or close an element with well-formed attributes. Comments, CDATA sections, processing
 * instructions and anything else the guard could read differently from the parser are refused.
 */
function* xmlElements(text: string): Generator<XmlElement> {
  const declaration = /^\uFEFF?<\?xml\s[^<>]*\?>/.exec(text)
  let position = declaration ? declaration[0].length : 0
  for (;;) {
    const start = text.indexOf('<', position)
    if (start === -1) return
    TAG.lastIndex = start
    const match = TAG.exec(text)
    if (!match) return fail(MALFORMED)
    position = TAG.lastIndex
    const qualified = match[2]
    yield {
      name: qualified.includes(':') ? qualified.slice(qualified.indexOf(':') + 1) : qualified,
      closing: Boolean(match[1]),
      selfClosing: Boolean(match[4]),
      attributes: match[1] ? {} : attributes(match[3]),
    }
  }
}

/** Resolves a relationship target the way the reader does. */
const partPath = (target: string) => (target.startsWith('/') ? target.slice(1) : `xl/${target}`)

function columnNumber(letters: string) {
  let value = 0
  for (const letter of letters) value = value * 26 + (letter.charCodeAt(0) - 64)
  return value
}

function sizeMessage(limits: XlsxLimits) {
  return `يجب ألا يتجاوز الملف ${limits.rows - 1} صف بيانات و${limits.columns} عمودًا`
}

/** A row number: a positive integer without sign, spaces or leading zeros. */
const ROW_REFERENCE = /^[1-9]\d{0,6}$/
/** A cell reference: one to three capital letters, then the row number. */
const CELL_REFERENCE = /^([A-Z]{1,3})([1-9]\d{0,6})$/

/**
 * Counts rows and cells against the limits, reading `r` exactly as the parser does. A row
 * or cell reference that is not in its standard form is refused, so no reference can grow
 * the parser's arrays beyond what was counted here.
 */
function measureSheet(text: string, limits: XlsxLimits) {
  let maxRow = 0
  let maxColumn = 0
  let rows = 0
  let row = 0
  let column = 0
  let cells = 0
  let inRow = false
  for (const element of xmlElements(text)) {
    if (element.name === 'row') {
      if (element.closing) {
        if (!inRow) fail(MALFORMED)
        inRow = false
        continue
      }
      if (inRow) fail(MALFORMED)
      const reference = element.attributes.r
      if (reference !== undefined && !ROW_REFERENCE.test(reference)) fail(MALFORMED)
      const number = reference === undefined ? maxRow + 1 : Number(reference)
      if (number <= maxRow) fail(MALFORMED)
      rows++
      row = number
      maxRow = number
      column = 0
      cells = 0
      if (rows > limits.rows || maxRow > limits.rows) fail(sizeMessage(limits))
      inRow = !element.selfClosing
    } else if (element.name === 'c' && !element.closing) {
      if (!inRow) fail(MALFORMED)
      const reference = element.attributes.r
      let number = column + 1
      if (reference !== undefined) {
        const parts = CELL_REFERENCE.exec(reference)
        if (!parts || Number(parts[2]) !== row) return fail(MALFORMED)
        number = columnNumber(parts[1])
      }
      if (number <= column) fail(MALFORMED)
      column = number
      cells++
      maxColumn = Math.max(maxColumn, column)
      if (cells > limits.columns || maxColumn > limits.columns) fail(sizeMessage(limits))
    }
  }
  if (inRow) fail(MALFORMED)
  return { maxRow, maxColumn }
}

/**
 * The worksheet the reader opens first (the first `<sheet>` with a name), and the shared
 * strings and styles parts, resolved as the reader resolves relationships.
 */
function workbookParts(workbook: string, relationships: string) {
  let relationId: string | undefined
  for (const element of xmlElements(workbook))
    if (element.name === 'sheet' && !element.closing && element.attributes.name) {
      relationId = element.attributes.id
      break
    }
  if (!relationId) return fail(MALFORMED)
  let sheetPath: string | undefined
  const sharedStrings = new Set(['xl/sharedStrings.xml'])
  const styles = new Set(['xl/styles.xml'])
  const ids = new Set<string>()
  for (const element of xmlElements(relationships)) {
    if (element.name !== 'Relationship' || element.closing) continue
    const { Id: id, Type: type = '', Target: target } = element.attributes
    // The reader keeps the last relationship of an id; a repeated id is refused instead.
    if (id !== undefined) {
      if (ids.has(id)) fail(MALFORMED)
      ids.add(id)
    }
    if (!target) continue
    if (id === relationId && type.endsWith('/worksheet')) sheetPath = partPath(target)
    if (type.endsWith('/sharedStrings')) sharedStrings.add(partPath(target))
    if (type.endsWith('/styles')) styles.add(partPath(target))
  }
  if (!sheetPath) return fail(MALFORMED)
  return { sheetPath, sharedStrings, styles }
}

const FIXED_PARTS = [
  '[Content_Types].xml',
  '_rels/.rels',
  'xl/workbook.xml',
  'xl/_rels/workbook.xml.rels',
]

/** Reads every element of a part, so a malformed part fails here and not in the parser. */
function checkPart(text: string) {
  for (const element of xmlElements(text)) void element
}

/**
 * Checks an uploaded workbook before any spreadsheet parser sees it (#161): signature,
 * encryption, a consistent zip structure, the real decompressed size of every entry, UTF-8
 * XML without DTDs, comments, CDATA or ambiguous references, and the sheet's row, column and
 * shared-string counts. Returns a rebuilt archive with only the allow-listed parts, so the
 * parser reads exactly what was checked.
 */
export function guardXlsx(bytes: Uint8Array, limits: XlsxLimits = XLSX_LIMITS): GuardedXlsx {
  if (bytes.byteLength > limits.compressed) fail('حجم الملف يتجاوز 5 ميغابايت')
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0)
    fail(ENCRYPTED)
  if (
    bytes.byteLength < 30 ||
    bytes[0] !== 0x50 ||
    bytes[1] !== 0x4b ||
    bytes[2] !== 3 ||
    bytes[3] !== 4
  )
    fail(MALFORMED)
  const list = entries(bytes, limits)
  const names = new Set(list.map((entry) => entry.name))
  // First pass: every entry is inflated and counted; the workbook parts are kept.
  const first = inflateAll(bytes, list, (name) => FIXED_PARTS.includes(name), limits)
  const workbook = first.get('xl/workbook.xml')
  const relationships = first.get('xl/_rels/workbook.xml.rels')
  if (!workbook || !relationships) return fail(MALFORMED)
  for (const part of first.values()) checkPart(xmlText(part))
  const parts = workbookParts(xmlText(workbook), xmlText(relationships))
  const { sheetPath } = parts
  if (!names.has(sheetPath)) fail(MALFORMED)
  const wanted = new Set(
    [sheetPath, ...parts.sharedStrings, ...parts.styles].filter((name) => names.has(name))
  )
  // Second pass for the parts the first one did not keep, under the same limits.
  const second = inflateAll(bytes, list, (name) => wanted.has(name), limits)
  let sharedStrings = 0
  for (const [name, part] of second) {
    const text = xmlText(part)
    if (name === sheetPath) continue
    if (!parts.sharedStrings.has(name)) {
      checkPart(text)
      continue
    }
    for (const element of xmlElements(text))
      if (element.name === 'si' && !element.closing && ++sharedStrings > limits.sharedStrings)
        fail(TOO_LARGE)
  }
  const { maxRow, maxColumn } = measureSheet(xmlText(second.get(sheetPath)!), limits)
  const clean: Record<string, Uint8Array> = {}
  for (const [name, part] of [...first, ...second]) clean[name] = part
  return { sheetPath, sharedStrings, maxRow, maxColumn, archive: zipSync(clean, { level: 0 }) }
}

/** A cell value as import text: dates as ISO dates, booleans as نعم/لا, numbers without exponent. */
export function xlsxCellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'boolean') return value ? 'نعم' : 'لا'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(MALFORMED)
    const text = String(value)
    return /e/i.test(text)
      ? value.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 100 })
      : text
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) fail(MALFORMED)
    const iso = value.toISOString()
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso
  }
  return String(value)
}

/** Drops trailing empty rows and trailing empty columns. */
function trimTable(rows: string[][]) {
  let height = rows.length
  while (height && rows[height - 1].every((cell) => cell.trim() === '')) height--
  const kept = rows.slice(0, height)
  let width = 0
  for (const row of kept)
    for (let index = row.length - 1; index >= width; index--)
      if (row[index].trim() !== '') {
        width = index + 1
        break
      }
  return kept.map((row) => Array.from({ length: width }, (_, index) => row[index] ?? ''))
}

/** The first sheet of a guarded workbook as an import table. */
export async function readXlsxTable(
  bytes: Uint8Array,
  limits: XlsxLimits = XLSX_LIMITS
): Promise<ImportTable> {
  const { archive } = guardXlsx(bytes, limits)
  const input = archive.buffer.slice(
    archive.byteOffset,
    archive.byteOffset + archive.byteLength
  ) as ArrayBuffer
  let data: unknown[][]
  try {
    data = (await readSheet(input, 1)) as unknown[][]
  } catch {
    return fail(MALFORMED)
  }
  const [headers = [], ...rows] = trimTable(data.map((row) => row.map(xlsxCellText)))
  if (headers.length > limits.columns || rows.length > limits.rows - 1) fail(sizeMessage(limits))
  return { headers, rows }
}

/** The built-in Excel adapter: the first sheet of an .xlsx workbook, checked by guardXlsx. */
export const xlsxImportAdapter: ImportAdapter = {
  name: 'xlsx',
  extensions: ['xlsx'],
  mimeTypes: [XLSX_MIME_TYPE],
  binary: true,
  detect: (file) =>
    extensionOf(file.fileName) === 'xlsx' ||
    (file.bytes[0] === 0x50 &&
      file.bytes[1] === 0x4b &&
      file.bytes[2] === 3 &&
      file.bytes[3] === 4),
  parse: (file) => readXlsxTable(file.bytes),
}
