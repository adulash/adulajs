import type { Knex } from 'knex'
import { AdulaError } from '../admin/errors.js'
import { identifier } from '../resource/define_resource.js'
import type { Field, JsonValue } from '../resource/types.js'
import { logActivity } from '../core/activity.js'

/** How a file can be previewed inline (ADR 047); every other file only downloads. */
export type AttachmentPreview = 'image' | 'pdf' | 'text'
export type AttachmentSummary = {
  id: number
  name: string
  size: number
  mimeType: string
  url: string
  /**
   * Set for allow-listed images, PDF and plain text: `${url}?preview=1` renders inline.
   * Missing or null means the file only downloads.
   */
  preview?: AttachmentPreview | null
}
/**
 * Deployment settings of attachment previews (ADR 047). `pdfPreview` (default true) turns
 * inline PDF previews off: PDFs then report no preview and `?preview=1` downloads them.
 */
export type AttachmentPreviewOptions = { pdfPreview?: boolean }
export type AttachmentRecord = {
  id: number
  disk: string
  path: string
  name: string
  originalName: string
  size: number
  mimeType: string
  extname: string
  data: Record<string, JsonValue>
  uploadedBy: number
  orgUnitId: number | null
  resource: string | null
  recordId: number | null
  field: string | null
  createdAt: string
  deletedAt: string | null
}
export type UploadInput = {
  disk: string
  path: string
  name: string
  originalName: string
  size: number
  mimeType: string
  extname: string
  data: Record<string, unknown>
  uploadedBy: number
  /** The administrator impersonating uploadedBy, recorded with the upload and its activity. */
  impersonatorId?: number | null
  orgUnitId?: number | null
  resource?: string | null
  field?: string | null
  /**
   * The redeemed upload grant that authorized this upload instead of a role rule. The upload
   * takes the grant's resource, field and unit, can bind to the granted record only, and is
   * recorded in that record's activity log.
   */
  grant?: {
    id: number
    resource: string
    recordId: number
    field: string
    orgUnitId: number | null
  } | null
}
export type ClaimInput = {
  attachmentId: number
  actor: { id: number }
  resource: string
  field: string
  /** Omitted while a record is being created: the upload is verified but not bound yet. */
  recordId?: number
  orgUnitId?: number | null
  scoped: boolean
}

const MAX_ID = 2147483647
const REJECTED = 'المرفق غير موجود أو لا يخصك'

/** Business documents, images and archives; a field widens or narrows it with `accept`. */
export const DEFAULT_ATTACHMENT_EXTENSIONS = Object.freeze([
  'pdf',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'txt',
  'csv',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'odt',
  'ods',
  'odp',
  'rtf',
  'zip',
])
/** Unbound uploads one user may hold at once; each is removed by pruning after a day. */
export const PENDING_UPLOAD_LIMIT = 50
/** Uploads never bound to a record are removed after this age. */
export const UNBOUND_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000

/** Upload constraints of an attachment field: accepted extensions (undefined = any) and size. */
export function attachmentPolicy(field: Field): { extnames?: string[]; size: string } {
  if (field.type !== 'attachment')
    throw new AdulaError(422, 'E_FIELD_INVALID', 'الحقل ليس حقل مرفقات')
  const accept = field.accept ?? DEFAULT_ATTACHMENT_EXTENSIONS
  return {
    extnames:
      accept === 'any'
        ? undefined
        : accept.map((extname) => extname.toLowerCase().replace(/^\./, '')),
    size: field.maxSize ?? '20mb',
  }
}

/** Unbound uploads of one user; hosts refuse new uploads beyond PENDING_UPLOAD_LIMIT. */
export async function pendingUploadCount(db: Knex, userId: number) {
  const [{ count }] = await db('attachments')
    .where('uploaded_by', userId)
    .whereNull('record_id')
    .whereNull('deleted_at')
    .count<{ count: string }[]>('* as count')
  return Number(count)
}

/** Uploads that were never bound to a record and are older than the cutoff. */
export async function staleUploads(db: Knex, olderThan: Date, limit = 500) {
  const rows = await db('attachments')
    .whereNull('record_id')
    .where('created_at', '<', olderThan)
    .orderBy('id')
    .limit(limit)
  return rows.map(fromRow)
}

/** Deletes the row of an upload that is still unbound; the host removes the file first. */
export async function forgetUpload(db: Knex, id: number) {
  if (!isAttachmentId(id)) return false
  return (await db('attachments').where('id', id).whereNull('record_id').delete()) > 0
}

export function attachmentUrl(id: number) {
  return `/attachments/${id}`
}

/**
 * Files that may render inline, by extension: the stored content type must be the listed
 * one too, and the response then carries the listed type, never the uploader's. SVG, HTML
 * and every other type can run script or be mistaken for a page, so they only download.
 */
const PREVIEWABLE: Readonly<
  Record<string, { preview: AttachmentPreview; contentType: string; mimeTypes: string[] }>
> = Object.freeze({
  png: { preview: 'image', contentType: 'image/png', mimeTypes: ['image/png'] },
  jpg: { preview: 'image', contentType: 'image/jpeg', mimeTypes: ['image/jpeg'] },
  jpeg: { preview: 'image', contentType: 'image/jpeg', mimeTypes: ['image/jpeg'] },
  gif: { preview: 'image', contentType: 'image/gif', mimeTypes: ['image/gif'] },
  webp: { preview: 'image', contentType: 'image/webp', mimeTypes: ['image/webp'] },
  pdf: { preview: 'pdf', contentType: 'application/pdf', mimeTypes: ['application/pdf'] },
  txt: { preview: 'text', contentType: 'text/plain; charset=utf-8', mimeTypes: ['text/plain'] },
})

function previewEntry(
  file: { extname: string; mimeType: string },
  options: AttachmentPreviewOptions = {}
) {
  const extname = String(file.extname).toLowerCase()
  const entry = Object.hasOwn(PREVIEWABLE, extname) ? PREVIEWABLE[extname] : undefined
  const mimeType = String(file.mimeType).split(';')[0].trim().toLowerCase()
  if (!entry || !entry.mimeTypes.includes(mimeType)) return undefined
  return entry.preview === 'pdf' && options.pdfPreview === false ? undefined : entry
}

/** How a stored file previews inline, or null when it can only be downloaded. */
export function attachmentPreview(
  file: { extname: string; mimeType: string },
  options: AttachmentPreviewOptions = {}
): AttachmentPreview | null {
  return previewEntry(file, options)?.preview ?? null
}

/** RFC 5987: an ASCII fallback plus the UTF-8 name so Arabic titles survive every browser. */
function disposition(kind: 'inline' | 'attachment', name: string) {
  const fallback = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'file'
  const encoded = encodeURIComponent(name).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  )
  return `${kind}; filename="${fallback}"; filename*=UTF-8''${encoded}`
}

/**
 * Response headers of an authorized download. With `preview`, an allow-listed file is
 * served inline with its listed type and may be framed by this origin only (the preview
 * dialog); any other file is still sent as a download. Every response forbids sniffing and
 * script: images and text are sandboxed, PDFs are not (browsers refuse to show sandboxed
 * PDFs) but may run no page script either.
 */
export function attachmentHeaders(
  file: Pick<AttachmentRecord, 'originalName' | 'mimeType' | 'extname' | 'size'>,
  options: { preview?: boolean } & AttachmentPreviewOptions = {}
): Record<string, string> {
  const entry = options.preview ? previewEntry(file, options) : undefined
  const common = {
    'Content-Length': String(file.size),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
  }
  if (!entry)
    return {
      ...common,
      'Content-Type': file.mimeType || 'application/octet-stream',
      'Content-Disposition': disposition('attachment', file.originalName),
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; sandbox",
      'X-Frame-Options': 'DENY',
    }
  return {
    ...common,
    'Content-Type': entry.contentType,
    'Content-Disposition': disposition('inline', file.originalName),
    'Content-Security-Policy':
      entry.preview === 'pdf'
        ? "default-src 'none'; object-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'"
        : "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'; sandbox",
    'X-Frame-Options': 'SAMEORIGIN',
  }
}
export function isAttachmentId(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= MAX_ID
}
/** Disk keys stay relative and slash-separated so files move between disks unchanged. */
export function isRelativeDiskPath(path: unknown): path is string {
  return (
    typeof path === 'string' &&
    path.length > 0 &&
    path.length <= 1024 &&
    !path.startsWith('/') &&
    !path.includes('\\') &&
    !path.includes('\0') &&
    !/^[a-zA-Z]:/.test(path) &&
    path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
  )
}
function text(value: unknown, max: number) {
  return (
    typeof value === 'string' && value.length > 0 && value.length <= max && !value.includes('\0')
  )
}
export function summarizeAttachment(
  row: Record<string, unknown>,
  options: AttachmentPreviewOptions = {}
): AttachmentSummary {
  return {
    id: Number(row.id),
    name: String(row.original_name),
    size: Number(row.size),
    mimeType: String(row.mime_type),
    url: attachmentUrl(Number(row.id)),
    preview: attachmentPreview(
      { extname: String(row.extname ?? ''), mimeType: String(row.mime_type) },
      options
    ),
  }
}
function fromRow(row: Record<string, unknown>): AttachmentRecord {
  const stamp = (value: unknown) => (value instanceof Date ? value.toISOString() : value)
  return {
    id: Number(row.id),
    disk: String(row.disk),
    path: String(row.path),
    name: String(row.name),
    originalName: String(row.original_name),
    size: Number(row.size),
    mimeType: String(row.mime_type),
    extname: String(row.extname),
    data: (row.data ?? {}) as Record<string, JsonValue>,
    uploadedBy: Number(row.uploaded_by),
    orgUnitId:
      row.org_unit_id === null || row.org_unit_id === undefined ? null : Number(row.org_unit_id),
    resource: row.resource === null || row.resource === undefined ? null : String(row.resource),
    recordId: row.record_id === null || row.record_id === undefined ? null : Number(row.record_id),
    field: row.field === null || row.field === undefined ? null : String(row.field),
    createdAt: String(stamp(row.created_at)),
    deletedAt:
      row.deleted_at === null || row.deleted_at === undefined
        ? null
        : String(stamp(row.deleted_at)),
  }
}

/** Records a stored file. The host performs the Drive write; AdulaJS only keeps verified metadata. */
export async function registerUpload(db: Knex, input: UploadInput): Promise<AttachmentRecord> {
  if (!text(input.disk, 100) || !/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(input.disk))
    throw new AdulaError(422, 'E_ATTACHMENT_INPUT', 'Invalid disk name')
  if (!isRelativeDiskPath(input.path))
    throw new AdulaError(422, 'E_ATTACHMENT_INPUT', 'Attachment paths must be relative disk keys')
  if (
    !text(input.name, 255) ||
    input.name.includes('/') ||
    input.name !== input.path.split('/').at(-1)
  )
    throw new AdulaError(422, 'E_ATTACHMENT_INPUT', 'Attachment name must be the last path segment')
  if (!text(input.originalName, 255) || /[/\\]/.test(input.originalName))
    throw new AdulaError(422, 'E_ATTACHMENT_INPUT', 'Invalid original file name')
  if (!Number.isSafeInteger(input.size) || input.size < 0)
    throw new AdulaError(422, 'E_ATTACHMENT_INPUT', 'Invalid file size')
  if (
    typeof input.mimeType !== 'string' ||
    input.mimeType.length > 255 ||
    /[\r\n\0]/.test(input.mimeType)
  )
    throw new AdulaError(422, 'E_ATTACHMENT_INPUT', 'Invalid content type')
  if (typeof input.extname !== 'string' || !/^[a-z0-9]{0,32}$/.test(input.extname))
    throw new AdulaError(422, 'E_ATTACHMENT_INPUT', 'Invalid file extension')
  if (!input.data || typeof input.data !== 'object' || Array.isArray(input.data))
    throw new AdulaError(422, 'E_ATTACHMENT_INPUT', 'Attachment data must be an object')
  if (!isAttachmentId(input.uploadedBy))
    throw new AdulaError(422, 'E_ATTACHMENT_INPUT', 'Invalid uploader')
  if (
    input.impersonatorId !== undefined &&
    input.impersonatorId !== null &&
    !isAttachmentId(input.impersonatorId)
  )
    throw new AdulaError(422, 'E_ATTACHMENT_INPUT', 'Invalid impersonator')
  if (input.orgUnitId !== undefined && input.orgUnitId !== null && !isAttachmentId(input.orgUnitId))
    throw new AdulaError(422, 'E_ATTACHMENT_INPUT', 'Invalid organization unit')
  for (const key of ['resource', 'field'] as const) {
    const value = input[key]
    if (
      value !== undefined &&
      value !== null &&
      (typeof value !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(value))
    )
      throw new AdulaError(422, 'E_ATTACHMENT_INPUT', `Invalid ${key}`)
  }
  if (input.resource) identifier(input.resource)
  const grant = input.grant
  if (
    grant &&
    (!isAttachmentId(grant.id) ||
      !isAttachmentId(grant.recordId) ||
      grant.resource !== input.resource ||
      grant.field !== input.field)
  )
    throw new AdulaError(422, 'E_ATTACHMENT_INPUT', 'The upload grant names another field')
  // Only a redeemed grant may mark an upload as granted.
  const data: Record<string, unknown> = { ...input.data }
  delete data.uploadGrant
  delete data.impersonatedBy
  if (grant) data.uploadGrant = { id: grant.id, recordId: grant.recordId }
  if (input.impersonatorId) data.impersonatedBy = input.impersonatorId
  const [row] = await db('attachments')
    .insert({
      disk: input.disk,
      path: input.path,
      name: input.name,
      original_name: input.originalName,
      size: input.size,
      mime_type: input.mimeType || 'application/octet-stream',
      extname: input.extname,
      data: JSON.stringify(data),
      uploaded_by: input.uploadedBy,
      org_unit_id: grant ? grant.orgUnitId : (input.orgUnitId ?? null),
      resource: input.resource ?? null,
      field: input.field ?? null,
    })
    .returning('*')
  if (grant)
    await logActivity(db, {
      resource: grant.resource,
      recordId: grant.recordId,
      actorId: input.uploadedBy,
      impersonatorId: input.impersonatorId,
      action: 'upload_via_grant',
      changes: { field: grant.field, attachmentId: Number(row.id), grantId: grant.id },
    })
  return fromRow(row)
}

export async function findAttachment(db: Knex, id: unknown): Promise<AttachmentRecord | undefined> {
  if (!isAttachmentId(id)) return undefined
  const row = await db('attachments').where('id', id).whereNull('deleted_at').first()
  return row ? fromRow(row) : undefined
}

/** One query per resource page: callers collect every attachment id first. */
export async function loadAttachments(
  db: Knex,
  ids: readonly number[],
  options: AttachmentPreviewOptions = {}
) {
  const summaries = new Map<number, AttachmentSummary>()
  const valid = [...new Set(ids.filter(isAttachmentId))]
  if (!valid.length) return summaries
  const rows = await db('attachments')
    .whereIn('id', valid)
    .whereNull('deleted_at')
    .select('id', 'original_name', 'size', 'mime_type', 'extname')
  for (const row of rows) summaries.set(Number(row.id), summarizeAttachment(row, options))
  return summaries
}

/**
 * Ownership is decided inside the caller's transaction: a rejected claim rolls
 * the whole record write back. Only the uploader may bind an upload, and an
 * upload binds to exactly one record field.
 */
export async function claimAttachment(trx: Knex.Transaction, input: ClaimInput) {
  if (!isAttachmentId(input.attachmentId)) throw new AdulaError(422, 'E_ATTACHMENT', REJECTED)
  const row = await trx('attachments').where('id', input.attachmentId).forUpdate().first()
  if (!row || row.deleted_at !== null || Number(row.uploaded_by) !== Number(input.actor.id))
    throw new AdulaError(422, 'E_ATTACHMENT', REJECTED)
  if (
    (row.resource !== null && row.resource !== input.resource) ||
    (row.field !== null && row.field !== input.field)
  )
    throw new AdulaError(422, 'E_ATTACHMENT', 'المرفق مخصص لحقل آخر')
  // An upload authorized by a grant binds to the granted record only, never to a new one.
  const granted = (row.data as { uploadGrant?: { recordId?: unknown } } | null)?.uploadGrant
  if (
    granted &&
    (input.recordId === undefined || Number(granted.recordId) !== Number(input.recordId))
  )
    throw new AdulaError(422, 'E_ATTACHMENT', 'المرفق مخصص لسجل آخر')
  const bound = row.record_id !== null
  const sameRecord =
    bound &&
    input.recordId !== undefined &&
    Number(row.record_id) === Number(input.recordId) &&
    row.resource === input.resource &&
    row.field === input.field
  if (bound && !sameRecord) throw new AdulaError(422, 'E_ATTACHMENT', 'المرفق مرتبط بسجل آخر')
  const orgUnitId =
    input.scoped && input.orgUnitId !== undefined && input.orgUnitId !== null
      ? Number(input.orgUnitId)
      : null
  if (
    input.scoped &&
    !sameRecord &&
    row.org_unit_id !== null &&
    (orgUnitId === null || Number(row.org_unit_id) !== orgUnitId)
  )
    throw new AdulaError(422, 'E_ATTACHMENT', 'المرفق يتبع وحدة تنظيمية أخرى')
  if (input.recordId === undefined) return fromRow(row)
  const [updated] = await trx('attachments')
    .where('id', input.attachmentId)
    .update({
      resource: input.resource,
      field: input.field,
      record_id: input.recordId,
      org_unit_id: input.scoped ? orgUnitId : row.org_unit_id,
    })
    .returning('*')
  return fromRow(updated)
}

/**
 * Moves a file the record already holds to the record's new organization unit, inside the
 * record write's transaction. Unlike claimAttachment there is no uploader check: the file
 * is bound to exactly this record field already, and the record's own move was authorized.
 * Anything else (unbound, released, another record or field) is refused.
 */
export async function rebindAttachment(
  trx: Knex.Transaction,
  input: {
    attachmentId: number
    resource: string
    field: string
    recordId: number
    orgUnitId: number
  }
) {
  if (!isAttachmentId(input.attachmentId)) throw new AdulaError(422, 'E_ATTACHMENT', REJECTED)
  const row = await trx('attachments').where('id', input.attachmentId).forUpdate().first()
  if (
    !row ||
    row.deleted_at !== null ||
    row.resource !== input.resource ||
    row.field !== input.field ||
    row.record_id === null ||
    Number(row.record_id) !== Number(input.recordId)
  )
    throw new AdulaError(422, 'E_ATTACHMENT', 'المرفق مرتبط بسجل آخر')
  await trx('attachments').where('id', input.attachmentId).update({ org_unit_id: input.orgUnitId })
}

/** Unbinding keeps the file and its metadata for restore drills; only the row is soft-deleted. */
export async function releaseAttachment(db: Knex, id: number) {
  if (!isAttachmentId(id)) return false
  const changed = await db('attachments')
    .where('id', id)
    .whereNull('deleted_at')
    .update({ deleted_at: db.fn.now() })
  return changed > 0
}
