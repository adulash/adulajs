import type { HttpContext } from '@adonisjs/core/http'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import drive from '@adonisjs/drive/services/main'
import logger from '@adonisjs/core/services/logger'
import env from '#start/env'
import {
  AVATAR_LIMITS,
  AdulaError,
  UserAvatars,
  avatarHeaders,
  sanitizeAvatarImage,
  type RemovedAvatarFile,
} from 'adula'
import { acting, activeImpersonation } from '#services/impersonation'
import { knex, mutate, positiveId } from '#controllers/admin/support'

const avatars = () => new UserAvatars(knex())
const notFound = () => new AdulaError(404, 'E_NOT_FOUND', 'الصورة غير موجودة')

/**
 * Profile pictures (ADR 050). Every signed-in user may see any user's picture, because
 * pictures appear beside names on shared records, comments and pickers. Only the user
 * (account page) and administrators (user page) change it; an administrator acting as the
 * user cannot, since the change outlives the session.
 */
export default class AvatarsController {
  async show({ params, request, response }: HttpContext) {
    if (!/^\d+$/.test(String(params.id))) throw notFound()
    const avatar = await avatars().find(Number(params.id))
    if (!avatar) throw notFound()
    const etag = `"avatar-${avatar.version}"`
    const immutable = String(request.qs().v ?? '') === String(avatar.version)
    if (request.header('if-none-match') === etag) {
      response.header('ETag', etag)
      response.header('Cache-Control', avatarHeaders(avatar, { immutable })['Cache-Control'])
      return response.notModified()
    }
    const disk = drive.use(avatar.disk as never)
    if (!(await disk.exists(avatar.path))) throw notFound()
    for (const [name, value] of Object.entries(avatarHeaders(avatar, { immutable })))
      response.header(name, value)
    return response.stream(await disk.getStream(avatar.path))
  }

  async storeOwn(ctx: HttpContext) {
    refuseImpersonation(ctx)
    return this.#store(ctx, ctx.auth.getUserOrFail().id, false, '/account/profile')
  }

  async destroyOwn(ctx: HttpContext) {
    refuseImpersonation(ctx)
    return this.#destroy(ctx, ctx.auth.getUserOrFail().id, false, '/account/profile')
  }

  async storeFor(ctx: HttpContext) {
    const userId = positiveId(ctx.params.id, 'المستخدم غير موجود')
    refuseImpersonation(ctx)
    return this.#store(ctx, userId, true, `/admin/users/${userId}`)
  }

  async destroyFor(ctx: HttpContext) {
    const userId = positiveId(ctx.params.id, 'المستخدم غير موجود')
    refuseImpersonation(ctx)
    return this.#destroy(ctx, userId, true, `/admin/users/${userId}`)
  }

  #store(ctx: HttpContext, userId: number, administered: boolean, back: string) {
    return mutate(
      ctx,
      async () => {
        // The body parser checks the type by the file's first bytes; the sanitizer checks
        // again and rewrites the file, so neither the name nor the declared type is trusted.
        const file = ctx.request.file('avatar', {
          size: AVATAR_LIMITS.maxBytes,
          extnames: ['png', 'webp'],
        })
        if (!file) throw new AdulaError(422, 'E_AVATAR_REQUIRED', 'اختر صورة للرفع')
        if (file.errors.some((error) => error.type === 'size'))
          throw new AdulaError(422, 'E_AVATAR_SIZE', 'حجم الصورة الشخصية يتجاوز ١ ميغابايت')
        if (!file.isValid || !file.tmpPath)
          throw new AdulaError(422, 'E_AVATAR_TYPE', 'الصورة الشخصية يجب أن تكون بصيغة PNG أو WebP')
        const image = sanitizeAvatarImage(await readFile(file.tmpPath))
        const diskName = env.get('DRIVE_DISK')
        const path = `avatars/${userId}/${randomUUID()}.${image.extname}`
        const disk = drive.use(diskName as never)
        await disk.put(path, image.bytes, { contentType: image.mimeType })
        let removed: RemovedAvatarFile[]
        try {
          ;({ removed } = await avatars().replace({
            userId,
            actorId: acting(ctx),
            administered,
            disk: diskName,
            path,
            image,
          }))
        } catch (error) {
          await disk.delete(path).catch(() => undefined)
          throw error
        }
        await deleteFiles(removed)
        return { userId, width: image.width, height: image.height }
      },
      'تم حفظ الصورة الشخصية.',
      back
    )
  }

  #destroy(ctx: HttpContext, userId: number, administered: boolean, back: string) {
    return mutate(
      ctx,
      async () => {
        const removed = await avatars().remove({ userId, actorId: acting(ctx), administered })
        await deleteFiles(removed)
        return { userId }
      },
      'تمت إزالة الصورة الشخصية.',
      back
    )
  }
}

/** After the commit: a failed delete leaves an orphan object with no row, never a broken row. */
async function deleteFiles(files: RemovedAvatarFile[]) {
  for (const file of files)
    await drive
      .use(file.disk as never)
      .delete(file.path)
      .catch((error: unknown) =>
        logger.warn({ err: error, path: file.path }, 'profile picture file was not deleted')
      )
}

function refuseImpersonation(ctx: HttpContext) {
  if (activeImpersonation(ctx))
    throw new AdulaError(
      403,
      'E_AVATAR_IMPERSONATING',
      'لا يمكن تغيير الصورة الشخصية أثناء انتحال الهوية'
    )
}
