import type { HttpContext } from '@adonisjs/core/http'
import drive from '@adonisjs/drive/services/main'
import { AdulaError, logoHeaders } from 'adula'
import { adula } from '#services/adula'
import { isAdministrator } from '#middleware/admin_middleware'

const notFound = () => new AdulaError(404, 'E_NOT_FOUND', 'الشعار غير موجود')

/**
 * Appearance logos (ADR 053) are public: the login and guest pages show them before sign-in.
 * A logo uploaded but not saved yet is a preview, so only an administrator may open it.
 */
export default class AppearanceLogosController {
  async show(ctx: HttpContext) {
    if (!/^\d{1,18}$/.test(String(ctx.params.id))) throw notFound()
    const logo = await adula().appearance.logo(Number(ctx.params.id))
    if (!logo) throw notFound()
    if (logo.recordId === null) {
      // silent_auth already ran, so a signed-in administrator is known here.
      const user = ctx.auth.user
      if (!user || !(await isAdministrator(user.id))) throw notFound()
    }
    const headers = logoHeaders(logo)
    if (ctx.request.header('if-none-match') === headers.ETag) {
      ctx.response.header('ETag', headers.ETag)
      ctx.response.header('Cache-Control', headers['Cache-Control'])
      return ctx.response.notModified()
    }
    const disk = drive.use(logo.disk as never)
    if (!(await disk.exists(logo.path))) throw notFound()
    // A preview may still be discarded, so it is not cached for good.
    if (logo.recordId === null) headers['Cache-Control'] = 'private, no-store'
    for (const [name, value] of Object.entries(headers)) ctx.response.header(name, value)
    return ctx.response.stream(await disk.getStream(logo.path))
  }
}
