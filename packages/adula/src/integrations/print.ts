import type { ResourceDescription } from '../admin/presentation.js'
import type { JsonValue, SerializedRecord } from '../resource/types.js'

/**
 * `logoUrl` must be a base64 image data URI (see imageDataUri). Any other URL is
 * dropped: the PDF renderer would fetch it from inside the deployment network.
 */
export type PrintIdentity = { name: string; logoUrl?: string | null }

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
}
const DATA_IMAGE = /^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/
/** Largest logo inlined into printed documents. */
export const PRINT_LOGO_LIMIT = 512 * 1024

/** Inlines a logo file as a data URI for printing; null for unknown types or oversize files. */
export function imageDataUri(bytes: Uint8Array, fileName: string): string | null {
  const type = IMAGE_TYPES[fileName.split('.').pop()?.toLowerCase() ?? '']
  if (!type || !bytes.byteLength || bytes.byteLength > PRINT_LOGO_LIMIT) return null
  return `data:${type};base64,${Buffer.from(bytes).toString('base64')}`
}
export type PrintInput = {
  identity: PrintIdentity
  resource: ResourceDescription
  record: SerializedRecord
  related?: Record<string, SerializedRecord[]>
  lookups?: Record<string, { value: string; label: string }[]>
  children?: Record<string, { rows: SerializedRecord[]; fields: ResourceDescription['fields'] }>
  printedBy: string
  printedAt?: Date
}

/** HTML-escapes text for printed documents (&, <, >, " and '). */
export const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

const RELATION_META = new Set(['id', 'version', 'docStatus', 'orgUnitId'])

/**
 * The label of a related record, as the UI's relationLabel: the server's `_title`, else
 * (user rows) the first non-meta text value, else `#id`.
 */
export function relationTitle(rows: SerializedRecord[] | undefined, value: JsonValue | undefined) {
  const fallback = value === null || value === undefined ? '—' : `#${String(value)}`
  const row = rows?.find((entry) => String(entry.id) === String(value))
  if (!row) return fallback
  if ('_title' in row) return typeof row._title === 'string' && row._title ? row._title : fallback
  const label = Object.entries(row).find(
    ([key, entry]) => !RELATION_META.has(key) && typeof entry === 'string' && entry
  )
  return label ? String(label[1]) : fallback
}

function text(
  field: ResourceDescription['fields'][number],
  value: JsonValue | undefined,
  input: Pick<PrintInput, 'related' | 'lookups'>
): string {
  if (value === null || value === undefined || value === '') return '—'
  switch (field.type) {
    case 'boolean':
      return value ? 'نعم' : 'لا'
    case 'money': {
      // Same presentation as the UI: Latin digits, grouped, two minor digits.
      if (!/^-?\d+$/.test(String(value))) return String(value)
      const minor = BigInt(String(value))
      const abs = minor < 0n ? -minor : minor
      return `${minor < 0n ? '-' : ''}${new Intl.NumberFormat('ar-u-nu-latn').format(abs / 100n)}.${String(abs % 100n).padStart(2, '0')}`
    }
    case 'lookup':
      return (
        input.lookups?.[field.key]?.find((option) => option.value === value)?.label ?? String(value)
      )
    case 'user':
    case 'belongsTo':
      return relationTitle(input.related?.[field.key], value)
    case 'attachment': {
      const name = (entry: unknown) =>
        entry && typeof entry === 'object' && !Array.isArray(entry) && 'name' in entry
          ? String(entry.name)
          : 'مرفق'
      return Array.isArray(value) ? value.map(name).join('، ') : name(value)
    }
    case 'datetime':
      return new Date(String(value)).toLocaleString('ar-u-nu-latn-ca-gregory', { timeZone: 'UTC' })
    case 'json':
      return JSON.stringify(value)
    default:
      return String(value)
  }
}

/**
 * The `<img>` of an inlined logo, or '' for anything that is not a bounded base64 image
 * data URI: the PDF renderer must never fetch a URL (SSRF from its network).
 */
export function printLogoHtml(identity: PrintIdentity) {
  const logoUrl = identity.logoUrl
  return logoUrl && logoUrl.length <= PRINT_LOGO_LIMIT * 2 && DATA_IMAGE.test(logoUrl)
    ? `<img class="logo" src="${escapeHtml(logoUrl)}" alt="">`
    : ''
}

/**
 * The generic printable view of one record: RTL A4 HTML, every value escaped.
 * Only fields already serialized for the caller are printed, so printing can
 * never reveal more than the detail page.
 */
export function renderPrintHtml(input: PrintInput) {
  const printedAt = input.printedAt ?? new Date()
  const fields = input.resource.fields.filter(
    (field) =>
      input.resource.show.includes(field.key) &&
      field.type !== 'hasMany' &&
      field.key in input.record
  )
  const status =
    input.resource.submittable && typeof input.record.docStatus === 'number'
      ? ['مسودة', 'معتمد', 'ملغي'][input.record.docStatus]
      : null
  const rows = fields
    .map(
      (field) =>
        `<tr><th scope="row">${escapeHtml(field.label.ar)}</th><td>${escapeHtml(text(field, input.record[field.key], input))}</td></tr>`
    )
    .join('')
  const children = Object.entries(input.children ?? {})
    .map(([key, group]) => {
      const label = input.resource.fields.find((field) => field.key === key)?.label.ar ?? key
      const columns = group.fields.filter((field) => field.type !== 'hasMany')
      return `<section><h2>${escapeHtml(label)}</h2><table class="lines"><thead><tr>${columns
        .map((column) => `<th scope="col">${escapeHtml(column.label.ar)}</th>`)
        .join('')}</tr></thead><tbody>${group.rows
        .map(
          (row) =>
            `<tr>${columns.map((column) => `<td>${escapeHtml(text(column, row[column.key], input))}</td>`).join('')}</tr>`
        )
        .join('')}</tbody></table></section>`
    })
    .join('')
  const logo = printLogoHtml(input.identity)
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:">
<title>${escapeHtml(input.resource.label)} #${escapeHtml(String(input.record.id))}</title>
<style>
@page { size: A4; margin: 18mm 16mm; }
* { box-sizing: border-box; }
body { font-family: "Noto Sans Arabic", "Segoe UI", Tahoma, sans-serif; color: #1c1917; font-size: 12pt; margin: 0; }
header { display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #1c1917; padding-bottom: 8mm; margin-bottom: 8mm; }
header h1 { font-size: 18pt; margin: 0; }
header p { margin: 2mm 0 0; color: #57534e; font-size: 10pt; }
.logo { max-height: 18mm; max-width: 50mm; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: start; padding: 2.5mm 3mm; border-bottom: 1px solid #e7e5e4; vertical-align: top; }
.fields th { width: 35%; color: #57534e; font-weight: 600; }
.lines thead th { background: #f5f5f4; font-size: 10pt; }
h2 { font-size: 13pt; margin: 8mm 0 3mm; }
.status { display: inline-block; border: 1px solid #1c1917; border-radius: 3mm; padding: 1mm 3mm; font-size: 10pt; }
footer { margin-top: 10mm; color: #78716c; font-size: 9pt; }
@media screen { body { max-width: 210mm; margin: 10mm auto; padding: 0 10mm; } }
</style>
</head>
<body>
<header>
<div>
<h1>${escapeHtml(input.resource.label)} #${escapeHtml(String(input.record.id))}</h1>
<p>${escapeHtml(input.identity.name)}</p>
</div>
<div>${status ? `<span class="status">${escapeHtml(status)}</span>` : ''}${logo}</div>
</header>
<table class="fields"><tbody>${rows}</tbody></table>
${children}
<footer>طُبع بواسطة ${escapeHtml(input.printedBy)} في ${escapeHtml(printedAt.toISOString().slice(0, 16).replace('T', ' '))} UTC</footer>
</body>
</html>`
}

/**
 * Converts printable HTML to PDF with an optional Gotenberg service
 * (POST /forms/chromium/convert/html). Without it, pages use the browser's print.
 */
export async function htmlToPdf(
  html: string,
  options: { gotenbergUrl: string; timeoutMs?: number; fetch?: typeof fetch }
) {
  const form = new FormData()
  form.append('files', new Blob([html], { type: 'text/html' }), 'index.html')
  form.append('printBackground', 'true')
  form.append('preferCssPageSize', 'true')
  const response = await (options.fetch ?? fetch)(
    `${options.gotenbergUrl.replace(/\/$/, '')}/forms/chromium/convert/html`,
    { method: 'POST', body: form, signal: AbortSignal.timeout(options.timeoutMs ?? 30000) }
  )
  if (!response.ok) throw new Error(`PDF conversion failed with HTTP ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-')))
    throw new Error('PDF conversion returned a non-PDF response')
  return bytes
}
