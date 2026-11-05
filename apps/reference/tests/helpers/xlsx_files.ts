import { crc32, deflateRawSync } from 'node:zlib'
import { ApiRequest } from '@japa/api-client'

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

/** A zip archive of the given entries (deflated), built with node:zlib only. */
export function zipFiles(entries: Record<string, Uint8Array | string>) {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const [name, value] of Object.entries(entries)) {
    const data = typeof value === 'string' ? Buffer.from(value) : Buffer.from(value)
    const packed = deflateRawSync(data, { level: 9 })
    const fileName = Buffer.from(name)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(crc32(data), 14)
    local.writeUInt32LE(packed.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(fileName.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(crc32(data), 16)
    central.writeUInt32LE(packed.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(fileName.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, fileName, packed)
    centrals.push(central, fileName)
    offset += 30 + fileName.length + packed.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(entries).length, 8)
  end.writeUInt16LE(Object.keys(entries).length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

/**
 * The package parts every real workbook carries. Upload validation detects the type from the
 * bytes, and only `[Content_Types].xml` naming a spreadsheet makes a zip an xlsx file.
 */
export const XLSX_PACKAGE_PARTS = {
  '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
  '_rels/.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
}

const escape = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

/** A one-sheet workbook of inline strings, enough for the import adapter. */
export function xlsxWorkbook(rows: string[][], extra: Record<string, Uint8Array | string> = {}) {
  const sheet = rows
    .map(
      (row, index) =>
        `<row r="${index + 1}">${row
          .map(
            (value, column) =>
              `<c r="${String.fromCharCode(65 + column)}${index + 1}" t="inlineStr"><is><t>${escape(value)}</t></is></c>`
          )
          .join('')}</row>`
    )
    .join('')
  return zipFiles({
    ...XLSX_PACKAGE_PARTS,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${MAIN}" xmlns:r="${REL}"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${MAIN}"><sheetData>${sheet}</sheetData></worksheet>`,
    ...extra,
  })
}

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/** Makes `response.body()` the raw workbook bytes (superagent would decode them as text). */
export function bufferXlsxResponses() {
  ApiRequest.addParser(XLSX_TYPE, (response, callback) => {
    const chunks: Buffer[] = []
    response.on('data', (chunk: Buffer) => chunks.push(chunk))
    response.on('end', () => callback(null, Buffer.concat(chunks)))
  })
}
