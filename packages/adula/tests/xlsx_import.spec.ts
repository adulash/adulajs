import { test } from '@japa/runner'
import { strToU8, zipSync } from 'fflate'
import writeXlsxFile from 'write-excel-file/node'
import {
  AdulaError,
  guardXlsx,
  importFile,
  readXlsxTable,
  XLSX_LIMITS,
  xlsxImportAdapter,
} from '../index.js'

const MALFORMED = 'تعذر قراءة ملف Excel: الملف تالف أو ليس بصيغة xlsx'
const ENCRYPTED = 'الملف محمي بكلمة مرور'
const TOO_LARGE = 'حجم محتوى الملف بعد فك الضغط يتجاوز الحد المسموح'
const SIZE = 'يجب ألا يتجاوز الملف 5000 صف بيانات و100 عمودًا'

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const WORKBOOK = `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${MAIN}" xmlns:r="${REL}"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`
const RELS = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`

const cell = (reference: string, text: string) =>
  `<c r="${reference}" t="inlineStr"><is><t>${text}</t></is></c>`
const sheet = (rows: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${MAIN}"><sheetData>${rows}</sheetData></worksheet>`

/** A minimal workbook with inline strings; extra entries are added as given. */
function workbook(sheetXml: string, extra: Record<string, Uint8Array> = {}, level = 6) {
  return zipSync(
    {
      'xl/workbook.xml': strToU8(WORKBOOK),
      'xl/_rels/workbook.xml.rels': strToU8(RELS),
      'xl/worksheets/sheet1.xml': strToU8(sheetXml),
      ...extra,
    },
    { level: level as 6 }
  )
}

async function rejection(action: () => unknown) {
  try {
    await action()
  } catch (error) {
    if (error instanceof AdulaError) return error
    throw error
  }
  throw new Error('Expected an AdulaError')
}
const messageOf = (action: () => unknown) => rejection(action).then((error) => error.message)

/** Removes the first central-directory record, so its entry exists only as a local header. */
function hideFirstEntry(zip: Uint8Array) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  const end = zip.byteLength - 22
  const count = view.getUint16(end + 10, true)
  const size = view.getUint32(end + 12, true)
  const start = view.getUint32(end + 16, true)
  const length =
    46 +
    view.getUint16(start + 28, true) +
    view.getUint16(start + 30, true) +
    view.getUint16(start + 32, true)
  const out = new Uint8Array(zip.byteLength - length)
  out.set(zip.subarray(0, start))
  out.set(zip.subarray(start + length), start)
  const outView = new DataView(out.buffer)
  const outEnd = out.byteLength - 22
  outView.setUint16(outEnd + 8, count - 1, true)
  outView.setUint16(outEnd + 10, count - 1, true)
  outView.setUint32(outEnd + 12, size - length, true)
  return out
}

/** Sets the encryption bit on every local and central header. */
function markEncrypted(zip: Uint8Array) {
  const copy = new Uint8Array(zip)
  const view = new DataView(copy.buffer)
  for (let at = 0; at + 4 <= copy.byteLength; at++) {
    const signature = view.getUint32(at, true)
    if (signature === 0x04034b50) view.setUint16(at + 6, view.getUint16(at + 6, true) | 1, true)
    if (signature === 0x02014b50) view.setUint16(at + 8, view.getUint16(at + 8, true) | 1, true)
  }
  return copy
}

test.group('xlsx import guard and adapter', () => {
  test('reads the first sheet of a real workbook as text cells', async ({ assert }) => {
    const bytes = await writeXlsxFile(
      [
        ['الاسم', 'الكمية', 'المبلغ', 'التاريخ', 'مفعل', 'ملاحظة', null],
        ['أحمد', 12, 1500.5, new Date('2026-11-05T00:00:00.000Z'), true, '=SUM(A1)', null],
        ['سارة', 1e21, -0.000001, new Date('2026-11-05T08:30:00.000Z'), false, null, null],
        [null, null, null, null, null, null, null],
      ],
      { rightToLeft: true, sheet: 'العملاء', dateFormat: 'yyyy-mm-dd' }
    ).toBuffer()
    const table = await readXlsxTable(bytes)
    assert.deepEqual(table.headers, ['الاسم', 'الكمية', 'المبلغ', 'التاريخ', 'مفعل', 'ملاحظة'])
    assert.deepEqual(table.rows, [
      ['أحمد', '12', '1500.5', '2026-11-05', 'نعم', '=SUM(A1)'],
      ['سارة', '1000000000000000000000', '-0.000001', '2026-11-05T08:30:00.000Z', 'لا', ''],
    ])
    // The adapter is chosen by extension or by the zip signature.
    assert.isTrue(xlsxImportAdapter.detect(importFile('book.xlsx', new Uint8Array([1]))))
    assert.isTrue(xlsxImportAdapter.detect(importFile('upload', bytes)))
    assert.isFalse(xlsxImportAdapter.detect(importFile('book.csv', strToU8('a,b'))))
  })

  test('a minimal workbook with inline strings parses; the reader sees only checked parts', async ({
    assert,
  }) => {
    const bytes = workbook(
      sheet(`<row r="1">${cell('A1', 'العنوان')}</row><row r="2">${cell('A2', 'س')}</row>`),
      {
        'xl/media/unused.bin': new Uint8Array(1000),
      }
    )
    const guarded = guardXlsx(bytes)
    assert.equal(guarded.sheetPath, 'xl/worksheets/sheet1.xml')
    assert.equal(guarded.maxRow, 2)
    assert.equal(guarded.maxColumn, 1)
    const names: string[] = []
    const view = new DataView(guarded.archive.buffer, guarded.archive.byteOffset)
    for (let at = 0; at + 30 < guarded.archive.byteLength;) {
      if (view.getUint32(at, true) !== 0x04034b50) break
      const nameLength = view.getUint16(at + 26, true)
      names.push(new TextDecoder().decode(guarded.archive.subarray(at + 30, at + 30 + nameLength)))
      at += 30 + nameLength + view.getUint16(at + 28, true) + view.getUint32(at + 18, true)
    }
    assert.notInclude(names, 'xl/media/unused.bin')
    assert.deepEqual(await readXlsxTable(bytes), { headers: ['العنوان'], rows: [['س']] })
  })

  test('a zip bomb is refused by counting inflated bytes, also in an unlisted entry', async ({
    assert,
  }) => {
    // 70 MiB of zeros compress to well under 1 MiB and pass the 5 MB upload limit.
    const bomb = workbook(sheet(''), { 'xl/media/bomb.xml': new Uint8Array(70 * 1024 * 1024) }, 9)
    assert.isBelow(bomb.byteLength, 1024 * 1024)
    const started = Date.now()
    const error = await rejection(() => guardXlsx(bomb))
    assert.equal(error.code, 'E_IMPORT_FILE')
    assert.equal(error.message, TOO_LARGE)
    assert.isBelow(Date.now() - started, 5000)
    // Several entries under the per-entry limit still exceed the total.
    const many = workbook(sheet(''), {
      'a.xml': new Uint8Array(40 * 1024),
      'b.xml': new Uint8Array(40 * 1024),
    })
    const total = await rejection(() =>
      guardXlsx(many, {
        ...XLSX_LIMITS,
        decompressedEntry: 64 * 1024,
        decompressedTotal: 64 * 1024,
      })
    )
    assert.equal(total.message, TOO_LARGE)
  })

  test('structure: encrypted, legacy, foreign, truncated, hidden and oversized archives', async ({
    assert,
  }) => {
    const valid = workbook(sheet(`<row r="1">${cell('A1', 'x')}</row>`))
    const cfb = new Uint8Array(64)
    cfb.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
    assert.include(await messageOf(() => guardXlsx(cfb)), ENCRYPTED)
    assert.include(await messageOf(() => guardXlsx(markEncrypted(valid))), ENCRYPTED)
    assert.equal(await messageOf(() => guardXlsx(strToU8('name,qty\nx,1\n'))), MALFORMED)
    assert.equal(
      await messageOf(() => guardXlsx(valid.subarray(0, valid.byteLength - 40))),
      MALFORMED
    )
    assert.equal(await messageOf(() => guardXlsx(hideFirstEntry(valid))), MALFORMED)
    const crowded: Record<string, Uint8Array> = {}
    for (let index = 0; index < 200; index++) crowded[`docProps/${index}.xml`] = strToU8('<a/>')
    assert.equal(await messageOf(() => guardXlsx(workbook(sheet(''), crowded))), MALFORMED)
    // A changed byte inside a stored entry fails its CRC.
    const stored = workbook(sheet(`<row r="1">${cell('A1', 'abc')}</row>`), {}, 0)
    const flipped = new Uint8Array(stored)
    flipped[new TextDecoder('latin1').decode(stored).indexOf('abc')] = 0x78
    assert.equal(await messageOf(() => guardXlsx(flipped)), MALFORMED)
    const tooBig = new Uint8Array(5 * 1024 * 1024 + 1)
    assert.include(await messageOf(() => guardXlsx(tooBig)), '5 ميغابايت')
  })

  test('parts: missing workbook, DTDs, other encodings and broken XML are refused', async ({
    assert,
  }) => {
    const noWorkbook = zipSync({ 'xl/worksheets/sheet1.xml': strToU8(sheet('')) })
    assert.equal(await messageOf(() => guardXlsx(noWorkbook)), MALFORMED)
    const entity = sheet('').replace(
      '<worksheet',
      '<!DOCTYPE lol [<!ENTITY a "aaaaaaaaaa">]><worksheet'
    )
    assert.equal(await messageOf(() => guardXlsx(workbook(entity))), MALFORMED)
    const utf16 = workbook(sheet('').replace('encoding="UTF-8"', 'encoding="UTF-16"'))
    assert.equal(await messageOf(() => guardXlsx(utf16)), MALFORMED)
    const unclosed = workbook(sheet(`<row r="1">${cell('A1', 'x')}`))
    assert.equal(await messageOf(() => guardXlsx(unclosed)), MALFORMED)
    // A sheet the workbook names but the archive lacks.
    const missingSheet = zipSync({
      'xl/workbook.xml': strToU8(WORKBOOK),
      'xl/_rels/workbook.xml.rels': strToU8(RELS),
    })
    assert.equal(await messageOf(() => guardXlsx(missingSheet)), MALFORMED)
  })

  test('rows, columns and shared strings are counted before the reader runs', async ({
    assert,
  }) => {
    // One sparse cell at the last Excel address: a dense reader would allocate the whole grid.
    const sparse = workbook(sheet(`<row r="1048576">${cell('XFD1048576', 'x')}</row>`))
    const started = Date.now()
    assert.equal(await messageOf(() => readXlsxTable(sparse)), SIZE)
    assert.isBelow(Date.now() - started, 2000)
    const wide = workbook(sheet(`<row r="1">${cell('CW1', 'x')}</row>`))
    assert.equal(await messageOf(() => guardXlsx(wide)), SIZE)
    // Rows and cells without r references are counted too.
    const unreferenced = workbook(
      sheet('<row>' + '<c t="inlineStr"><is><t>x</t></is></c>'.repeat(101) + '</row>')
    )
    assert.equal(await messageOf(() => guardXlsx(unreferenced)), SIZE)
    const tall = workbook(sheet('<row/>'.repeat(5002)))
    assert.equal(await messageOf(() => guardXlsx(tall)), SIZE)
    const strings = `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="${MAIN}">${'<si><t>x</t></si>'.repeat(6)}</sst>`
    const shared = workbook(sheet(''), { 'xl/sharedStrings.xml': strToU8(strings) })
    assert.equal(
      await messageOf(() => guardXlsx(shared, { ...XLSX_LIMITS, sharedStrings: 5 })),
      TOO_LARGE
    )
    assert.equal(guardXlsx(shared).sharedStrings, 6)
  })

  test('5000 data rows and 100 columns are accepted; one more row is refused', async ({
    assert,
  }) => {
    const header = Array.from({ length: 100 }, (_, index) => `ع${index + 1}`)
    const rows = Array.from({ length: 5000 }, (_, index) => [`صف ${index + 1}`])
    const largest = await writeXlsxFile([header, ...rows]).toBuffer()
    const table = await readXlsxTable(largest)
    assert.lengthOf(table.headers, 100)
    assert.lengthOf(table.rows, 5000)
    assert.equal(table.rows[4999][0], 'صف 5000')
    const over = await writeXlsxFile([header, ...rows, ['صف 5001']]).toBuffer()
    assert.equal(await messageOf(() => readXlsxTable(over)), SIZE)
  }).timeout(60000)
})

test.group('xlsx guard reads references as the parser does (2.3.0 review)', () => {
  const raw = (r: string, text = 'x') => `<c ${r} t="inlineStr"><is><t>${text}</t></is></c>`
  const prefixed = (rows: string) => sheet(rows).replace('<worksheet', '<worksheet xmlns:x="urn:x"')

  /** Expects the guard itself to refuse the file, quickly, before the parser runs. */
  async function refused(
    bytes: Uint8Array,
    message: string,
    assert: {
      equal(actual: unknown, expected: unknown): void
      isBelow(value: number, limit: number): void
    }
  ) {
    const started = Date.now()
    assert.equal(await messageOf(() => readXlsxTable(bytes)), message)
    assert.equal(await messageOf(() => guardXlsx(bytes)), message)
    assert.isBelow(Date.now() - started, 2000)
  }

  test('character references in r are decoded before the limits apply', async ({ assert }) => {
    // &#88; is X: the parser reads XFD1, column 16384.
    await refused(workbook(sheet(`<row r="1">${raw('r="&#88;FD1"')}</row>`)), SIZE, assert)
    await refused(workbook(sheet(`<row r="1">${raw('r="&#x58;FD1"')}</row>`)), SIZE, assert)
    // &#57; is 9: row 999999999 would be filled with empty rows.
    await refused(
      workbook(sheet(`<row r="&#57;99999999">${raw('r="A1"')}</row>`)),
      MALFORMED,
      assert
    )
    await refused(workbook(sheet(`<row r="&#54;000"></row>`)), SIZE, assert)
    // An ampersand that is not a reference, or an unknown entity, is refused.
    await refused(workbook(sheet(`<row r="1">${raw('r="A&1"')}</row>`)), MALFORMED, assert)
    await refused(workbook(sheet(`<row r="1">${raw('r="&nbsp;A1"')}</row>`)), MALFORMED, assert)
  })

  test('references outside the standard form are refused', async ({ assert }) => {
    for (const reference of ['AAAAAA1', 'a1', 'A01', 'A1 ', ' A1', 'A', '1', 'A-1', 'A99999999'])
      await refused(
        workbook(sheet(`<row r="1">${raw(`r="${reference}"`)}</row>`)),
        MALFORMED,
        assert
      )
    for (const reference of ['0', '01', '-1', '1.5', '1e3', ' 2', '99999999'])
      await refused(workbook(sheet(`<row r="${reference}"></row>`)), MALFORMED, assert)
    // A cell of another row, or cells and rows out of order.
    await refused(workbook(sheet(`<row r="1">${raw('r="A2"')}</row>`)), MALFORMED, assert)
    await refused(
      workbook(sheet(`<row r="1">${raw('r="B1"')}${raw('r="A1"')}</row>`)),
      MALFORMED,
      assert
    )
    await refused(workbook(sheet('<row r="2"></row><row r="1"></row>')), MALFORMED, assert)
  })

  test('namespace prefixes on r count, and a repeated r is refused', async ({ assert }) => {
    await refused(workbook(prefixed(`<row r="1">${raw('x:r="XFD1"')}</row>`)), SIZE, assert)
    await refused(workbook(prefixed(`<row x:r="6000"></row>`)), SIZE, assert)
    await refused(
      workbook(prefixed(`<row r="1">${raw('r="A1" x:r="XFD1"')}</row>`)),
      MALFORMED,
      assert
    )
    // A prefixed element name is the same element to the parser.
    await refused(workbook(prefixed(`<x:row r="6000"></x:row>`)), SIZE, assert)
  })

  test('comments, CDATA, processing instructions and stray brackets are refused', async ({
    assert,
  }) => {
    const hidden = `<row r="1">${raw('r="A1"')}<!-- </row> --></row><row r="6000"></row>`
    await refused(workbook(sheet(hidden)), MALFORMED, assert)
    await refused(workbook(sheet('<row r="1"><![CDATA[</row>]]></row>')), MALFORMED, assert)
    await refused(workbook(sheet('<?pi </row>?><row r="1"></row>')), MALFORMED, assert)
    // A > inside an attribute value cannot hide the r that follows it.
    await refused(workbook(sheet('<row spans=">" r="6000"></row>')), SIZE, assert)
    await refused(workbook(sheet('<row r="1"><c r="A1" t="</row>"></c></row>')), MALFORMED, assert)
    const workbookComment = WORKBOOK.replace('<sheets>', '<!-- note --><sheets>')
    const commented = zipSync({
      'xl/workbook.xml': strToU8(workbookComment),
      'xl/_rels/workbook.xml.rels': strToU8(RELS),
      'xl/worksheets/sheet1.xml': strToU8(sheet('')),
    })
    await refused(commented, MALFORMED, assert)
  })

  test('the guard measures the sheet and shared strings the parser will open', async ({
    assert,
  }) => {
    const twoSheets = `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${MAIN}" xmlns:r="${REL}"><sheets><sheet sheetId="1" r:id="rId2"/><sheet name="S" sheetId="2" r:id="rId1"/></sheets></workbook>`
    const twoRels = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/big.xml"/><Relationship Id="rId2" Type="${REL}/worksheet" Target="worksheets/small.xml"/></Relationships>`
    // The parser skips a <sheet> without a name, so the guard measures big.xml.
    const nameless = zipSync({
      'xl/workbook.xml': strToU8(twoSheets),
      'xl/_rels/workbook.xml.rels': strToU8(twoRels),
      'xl/worksheets/small.xml': strToU8(sheet('')),
      'xl/worksheets/big.xml': strToU8(sheet('<row r="6000"></row>')),
    })
    await refused(nameless, SIZE, assert)
    // The parser keeps the last relationship of a repeated id; the guard refuses the file.
    const repeatedRels = RELS.replace(
      '</Relationships>',
      `<Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/big.xml"/></Relationships>`
    )
    const repeated = zipSync({
      'xl/workbook.xml': strToU8(WORKBOOK),
      'xl/_rels/workbook.xml.rels': strToU8(repeatedRels),
      'xl/worksheets/sheet1.xml': strToU8(sheet('')),
      'xl/worksheets/big.xml': strToU8(sheet('<row r="6000"></row>')),
    })
    await refused(repeated, MALFORMED, assert)
    // Shared strings at a path the relationships name are counted too.
    const stringsRels = RELS.replace(
      '</Relationships>',
      `<Relationship Id="rId9" Type="${REL}/sharedStrings" Target="strings/table.xml"/></Relationships>`
    )
    const strings = `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="${MAIN}">${'<si><t>x</t></si>'.repeat(6)}</sst>`
    const elsewhere = zipSync({
      'xl/workbook.xml': strToU8(WORKBOOK),
      'xl/_rels/workbook.xml.rels': strToU8(stringsRels),
      'xl/worksheets/sheet1.xml': strToU8(sheet('')),
      'xl/strings/table.xml': strToU8(strings),
    })
    assert.equal(guardXlsx(elsewhere).sharedStrings, 6)
    assert.equal(
      await messageOf(() => guardXlsx(elsewhere, { ...XLSX_LIMITS, sharedStrings: 5 })),
      TOO_LARGE
    )
  })

  test('entities in ordinary values and prefixed workbooks still read normally', async ({
    assert,
  }) => {
    const bytes = workbook(
      prefixed(
        `<x:row r="1">${raw('x:r="A1"', 'أ &amp; ب')}</x:row><row r="2">${raw('r="A2"', '&#1587;')}</row>`
      )
    )
    assert.deepEqual(await readXlsxTable(bytes), { headers: ['أ & ب'], rows: [['س']] })
  })
})
