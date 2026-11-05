import type { Knex } from 'knex'
import { AdulaError } from '../admin/errors.js'
import { logActivity } from './activity.js'
import { registerUpload, isAttachmentId } from '../attachments/attachment_service.js'
import type { AvatarImage } from './avatar_image.js'

/**
 * A profile picture is one `attachments` row bound to this owner (ADR 050). The name is not
 * a registered resource, so `/attachments/:id` never serves it, pruning never removes it,
 * and backups and `adula:storage:migrate` carry it like every other bound file.
 */
export const AVATAR_OWNER = Object.freeze({ resource: 'core_users', field: 'avatar' })

/**
 * What happens to the previous picture when a user replaces or removes it. 'delete' removes
 * the row and the file (a personal photo does not outlive its removal); 'keep' soft-deletes
 * the row and keeps the file, as field attachments do (ADR 047).
 */
const REMOVED_PICTURES: 'delete' | 'keep' = 'delete'

export type AvatarRecord = {
  userId: number
  /** The attachment row id; it changes with every upload and is never reused. */
  version: number
  disk: string
  path: string
  size: number
  mimeType: string
  width: number
  height: number
}
/** A file the host deletes from its disk after the transaction committed. */
export type RemovedAvatarFile = { disk: string; path: string }

type Change = {
  userId: number
  actorId: number
  impersonatorId?: number | null
  /** True on the administration page: the actor manages another user's picture. */
  administered?: boolean
}

/** The URL of a user's picture; with a version, the response may be cached for good. */
export function avatarUrl(userId: number, version?: number | null) {
  return version ? `/users/${userId}/avatar?v=${version}` : `/users/${userId}/avatar`
}

/**
 * Response headers of a profile picture: the stored, allow-listed type only, no sniffing and
 * no script. A versioned URL never changes its bytes, so it is cached privately for a year;
 * the plain URL is revalidated after five minutes with the version as its ETag.
 */
export function avatarHeaders(avatar: AvatarRecord, options: { immutable?: boolean } = {}) {
  return {
    'Content-Type': avatar.mimeType === 'image/webp' ? 'image/webp' : 'image/png',
    'Content-Length': String(avatar.size),
    'Content-Disposition': 'inline',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cross-Origin-Resource-Policy': 'same-origin',
    'ETag': `"avatar-${avatar.version}"`,
    'Cache-Control': options.immutable
      ? 'private, max-age=31536000, immutable'
      : 'private, max-age=300',
  } as Record<string, string>
}

const live = (db: Knex) =>
  db('attachments')
    .where('resource', AVATAR_OWNER.resource)
    .where('field', AVATAR_OWNER.field)
    .whereNull('deleted_at')

function fromRow(row: Record<string, unknown>): AvatarRecord {
  const data = (row.data ?? {}) as { width?: unknown; height?: unknown }
  return {
    userId: Number(row.record_id),
    version: Number(row.id),
    disk: String(row.disk),
    path: String(row.path),
    size: Number(row.size),
    mimeType: String(row.mime_type),
    width: Number(data.width ?? 0),
    height: Number(data.height ?? 0),
  }
}

export class UserAvatars {
  constructor(private db: Knex) {}

  async find(userId: number): Promise<AvatarRecord | null> {
    if (!isAttachmentId(userId)) return null
    const row = await live(this.db).where('record_id', userId).orderBy('id', 'desc').first()
    return row ? fromRow(row) : null
  }

  /** The current picture version of each user that has one, in one query. */
  async versions(userIds: readonly number[]): Promise<Map<number, number>> {
    const ids = [...new Set(userIds.filter(isAttachmentId))]
    const versions = new Map<number, number>()
    if (!ids.length) return versions
    const rows = await live(this.db)
      .whereIn('record_id', ids)
      .groupBy('record_id')
      .select('record_id')
      .max<{ record_id: number; max: number }[]>('id as max')
    for (const row of rows) versions.set(Number(row.record_id), Number(row.max))
    return versions
  }

  /**
   * Records a stored, sanitized picture as the user's avatar and retires the previous one in
   * the same transaction. The host has already written `path` to `disk`; it deletes the
   * returned files after the commit.
   */
  async replace(
    change: Change & { disk: string; path: string; image: AvatarImage }
  ): Promise<{ avatar: AvatarRecord; removed: RemovedAvatarFile[] }> {
    return this.db.transaction(async (trx) => {
      await this.#lock(trx, change)
      const row = await registerUpload(trx, {
        disk: change.disk,
        path: change.path,
        name: change.path.split('/').at(-1) ?? '',
        originalName: `avatar.${change.image.extname}`,
        size: change.image.bytes.length,
        mimeType: change.image.mimeType,
        extname: change.image.extname,
        data: { width: change.image.width, height: change.image.height },
        uploadedBy: change.actorId,
        impersonatorId: change.impersonatorId,
        resource: AVATAR_OWNER.resource,
        field: AVATAR_OWNER.field,
      })
      const [bound] = await trx('attachments')
        .where('id', row.id)
        .update({ record_id: change.userId })
        .returning('*')
      const { removed } = await this.#retire(trx, change.userId, row.id)
      await this.#log(trx, change, 'avatar_updated', {
        version: row.id,
        width: change.image.width,
        height: change.image.height,
      })
      return { avatar: fromRow(bound), removed }
    })
  }

  /** Removes the user's picture; nothing happens when there is none. */
  async remove(change: Change): Promise<RemovedAvatarFile[]> {
    return this.db.transaction(async (trx) => {
      await this.#lock(trx, change)
      const { count, removed } = await this.#retire(trx, change.userId)
      if (count) await this.#log(trx, change, 'avatar_removed', {})
      return removed
    })
  }

  /** One change per user at a time; the row lock also proves the user exists. */
  async #lock(trx: Knex.Transaction, change: Change) {
    if (!isAttachmentId(change.userId) || !isAttachmentId(change.actorId))
      throw new AdulaError(404, 'E_USER_NOT_FOUND', 'المستخدم غير موجود')
    if (!change.administered && change.actorId !== change.userId)
      throw new AdulaError(403, 'E_FORBIDDEN', 'ليس لديك صلاحية لهذا الإجراء')
    const user = await trx('users').where('id', change.userId).forUpdate().first('id')
    if (!user) throw new AdulaError(404, 'E_USER_NOT_FOUND', 'المستخدم غير موجود')
  }

  async #retire(trx: Knex.Transaction, userId: number, exceptId?: number) {
    const previous = live(trx).where('record_id', userId)
    if (exceptId) previous.whereNot('id', exceptId)
    const rows = await previous.select('id', 'disk', 'path')
    const count = rows.length
    if (!count) return { count, removed: [] as RemovedAvatarFile[] }
    const ids = rows.map((row) => Number(row.id))
    if (REMOVED_PICTURES === 'keep') {
      await trx('attachments').whereIn('id', ids).update({ deleted_at: trx.fn.now() })
      return { count, removed: [] as RemovedAvatarFile[] }
    }
    await trx('attachments').whereIn('id', ids).delete()
    return {
      count,
      removed: rows.map((row) => ({ disk: String(row.disk), path: String(row.path) })),
    }
  }

  #log(trx: Knex.Transaction, change: Change, action: string, changes: Record<string, unknown>) {
    return logActivity(trx, {
      // The user's own changes sit with their account activity, like profile_updated.
      resource: change.administered ? 'core.users' : 'users',
      recordId: change.userId,
      actorId: change.actorId,
      impersonatorId: change.impersonatorId,
      action,
      changes,
    })
  }
}
