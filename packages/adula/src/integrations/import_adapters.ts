import Papa from 'papaparse'
import { AdulaError } from '../admin/errors.js'

/** An uploaded import file as adapters see it: raw bytes, with the UTF-8 text decoded on demand. */
export type ImportFile = {
  fileName: string
  mimeType?: string
  bytes: Uint8Array
  /** The bytes decoded as UTF-8 without a byte-order mark. */
  readonly text: string
}

/** A parsed sheet: one header row and the data rows as strings. */
export type ImportTable = { headers: string[]; rows: string[][] }

/**
 * A file format the import batches can read. The CSV adapter is built in; other
 * formats (for example XLSX) are registered through `ImportBatches` option `adapters`
 * or `ImportBatches.registerAdapter()`. Limits (5 MB, 100 columns, 5000 rows) and
 * the column mapping apply to every adapter's result.
 */
export interface ImportAdapter {
  /** Short format name used by the API's `format` field, for example 'csv' or 'xlsx'. */
  name: string
  /** Lower-case file extensions without the dot, accepted by the upload. */
  extensions: string[]
  mimeTypes?: string[]
  /** True for formats that are not UTF-8 text; JSON API uploads then send base64. */
  binary?: boolean
  /** Whether this adapter reads the file (usually by extension, MIME type or signature). */
  detect(file: ImportFile): boolean
  /** Parses the file; throw AdulaError(422, 'E_IMPORT_FILE', '…') with an Arabic message. */
  parse(file: ImportFile): Promise<ImportTable>
}

export function extensionOf(fileName: string) {
  const dot = fileName.lastIndexOf('.')
  return dot === -1 ? '' : fileName.slice(dot + 1).toLowerCase()
}

/** Wraps raw upload bytes; the text is decoded once, only when an adapter reads it. */
export function importFile(fileName: string, bytes: Uint8Array, mimeType?: string): ImportFile {
  let text: string | undefined
  return {
    fileName,
    mimeType,
    bytes,
    get text() {
      text ??= Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        .toString('utf8')
        .replace(/^\uFEFF/, '')
      return text
    },
  }
}

/** The built-in CSV adapter (papaparse, delimiter detection, UTF-8 with or without BOM). */
export const csvImportAdapter: ImportAdapter = {
  name: 'csv',
  extensions: ['csv', 'txt'],
  mimeTypes: ['text/csv', 'text/plain', 'application/vnd.ms-excel'],
  detect: (file) => ['csv', 'txt'].includes(extensionOf(file.fileName)),
  async parse(file) {
    const parsed = Papa.parse<string[]>(file.text, { skipEmptyLines: 'greedy' })
    if (parsed.errors.some((error) => error.type !== 'Delimiter'))
      throw new AdulaError(422, 'E_IMPORT_FILE', `تعذر قراءة CSV: ${parsed.errors[0].message}`)
    const [headers = [], ...rows] = parsed.data
    return { headers, rows }
  },
}
