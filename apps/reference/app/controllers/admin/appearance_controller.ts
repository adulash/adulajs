import type { HttpContext } from '@adonisjs/core/http'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import drive from '@adonisjs/drive/services/main'
import logger from '@adonisjs/core/services/logger'
import env from '#start/env'
import {
  AdulaError,
  APPEARANCE_TEXT_LIMITS,
  LOGO_LIMITS,
  prepareLogoImage,
  type AppearanceOccasion,
  type RemovedLogoFile,
} from 'adula'
import { adula, requestActor } from '#services/adula'
import { fileIdentity } from '#services/initial_setup'
import { logoUrl } from '#services/appearance'
import { positiveId } from '#controllers/admin/support'

/** JSON only, like the other administration sections that a dialog saves. */
function requireJson(ctx: HttpContext) {
  if (ctx.request.header('Content-Type')?.split(';', 1)[0] !== 'application/json')
    throw new AdulaError(415, 'E_APPEARANCE_JSON', 'أرسل الطلب بصيغة JSON')
}

/** After the commit: a failed delete leaves an orphan object with no row, never a broken row. */
async function deleteFiles(files: RemovedLogoFile[]) {
  for (const file of files)
    await drive
      .use(file.disk as never)
      .delete(file.path)
      .catch((error: unknown) =>
        logger.warn({ err: error, path: file.path }, 'appearance logo file was not deleted')
      )
}

function status(occasion: AppearanceOccasion, today: string) {
  if (occasion.endsOn < today) return 'ended'
  if (occasion.startsOn > today) return 'upcoming'
  return 'active'
}

/**
 * «المظهر والهوية» (ADR 053): the base identity, its logo and colour, and dated occasions.
 * The administration area already requires `all/manage`; every change is in the activity
 * log under `core.appearance`.
 */
export default class AppearanceController {
  async index(ctx: HttpContext) {
    const appearance = adula().appearance
    const [identity, occasions, base] = await Promise.all([
      appearance.identity(),
      appearance.occasions(),
      fileIdentity(),
    ])
    const today = appearance.today()
    return ctx.inertia.render('admin/appearance/index', {
      identity: { ...identity, logoUrl: identity.logoId ? logoUrl(identity.logoId) : null },
      occasions: occasions.map((occasion) => ({
        ...occasion,
        logoUrl: occasion.logoId ? logoUrl(occasion.logoId) : null,
        status: status(occasion, today),
      })),
      today,
      defaults: { company: base.company, logoUrl: base.logo },
      limits: APPEARANCE_TEXT_LIMITS,
    })
  }

  async updateIdentity(ctx: HttpContext) {
    requireJson(ctx)
    const { identity, removed } = await adula().appearance.saveIdentity(
      await requestActor(ctx),
      ctx.request.body()
    )
    await deleteFiles(removed)
    return { data: identity }
  }

  async resetIdentity(ctx: HttpContext) {
    await deleteFiles(await adula().appearance.resetIdentity(await requestActor(ctx)))
    return { data: true }
  }

  /** Stores a prepared logo as an unbound upload; saving the identity or an occasion binds it. */
  async uploadLogo(ctx: HttpContext) {
    const file = ctx.request.file('logo', {
      size: LOGO_LIMITS.maxBytes,
      extnames: ['png', 'jpg', 'jpeg', 'webp'],
    })
    if (!file) throw new AdulaError(422, 'E_LOGO_REQUIRED', 'اختر صورة الشعار')
    if (file.errors.some((error) => error.type === 'size'))
      throw new AdulaError(422, 'E_LOGO_SIZE', 'حجم الشعار يتجاوز ١ ميغابايت')
    if (!file.isValid || !file.tmpPath)
      throw new AdulaError(422, 'E_LOGO_TYPE', 'الشعار يجب أن يكون صورة PNG أو JPEG أو WebP')
    // The name and the declared type are not trusted: the bytes are checked and re-encoded.
    const image = await prepareLogoImage(await readFile(file.tmpPath))
    const diskName = env.get('DRIVE_DISK')
    const path = `appearance/${randomUUID()}.${image.extname}`
    const disk = drive.use(diskName as never)
    await disk.put(path, image.bytes, { contentType: image.mimeType })
    try {
      const logo = await adula().appearance.registerLogo(await requestActor(ctx), {
        disk: diskName,
        path,
        image,
      })
      return { data: { id: logo.id, url: logoUrl(logo.id) } }
    } catch (error) {
      await disk.delete(path).catch(() => undefined)
      throw error
    }
  }

  async storeOccasion(ctx: HttpContext) {
    requireJson(ctx)
    const { occasion, removed } = await adula().appearance.saveOccasion(
      await requestActor(ctx),
      ctx.request.body()
    )
    await deleteFiles(removed)
    return { data: occasion }
  }

  async updateOccasion(ctx: HttpContext) {
    requireJson(ctx)
    const id = positiveId(ctx.params.id, 'المناسبة غير موجودة')
    const { occasion, removed } = await adula().appearance.saveOccasion(
      await requestActor(ctx),
      ctx.request.body(),
      id
    )
    await deleteFiles(removed)
    return { data: occasion }
  }

  async destroyOccasion(ctx: HttpContext) {
    const id = positiveId(ctx.params.id, 'المناسبة غير موجودة')
    await deleteFiles(await adula().appearance.deleteOccasion(await requestActor(ctx), id))
    return { data: true }
  }
}
