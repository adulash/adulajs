import type { HttpContext } from '@adonisjs/core/http'
import drive from '@adonisjs/drive/services/main'
import { AdulaError, BASE_LOGO_RECORD, logoHeaders } from 'adula'
import { adula } from '#services/adula'
import { isAdministrator } from '#middleware/admin_middleware'

const notFound = () => new AdulaError(404, 'E_NOT_FOUND', 'الشعار غير موجود')

/**
 * Appearance logos (ADR 053): the login and guest pages show them before sign-in, so the base
 * identity's logo and the logo of today's occasion are public. Any other logo (an upload not
 * saved yet, or the logo of an upcoming or ended occasion) is visible only to an
 * administrator and never cached, so an unannounced occasion does not leak early.
 */
export default class AppearanceLogosController {
  async show(ctx: HttpContext) {
    if (!/^\d{1,18}$/.test(String(ctx.params.id))) throw notFound()
    const appearance = adula().appearance
    const logo = await appearance.logo(Number(ctx.params.id))
    if (!logo) throw notFound()
    const today = await appearance.resolve()
    const visible = logo.recordId === BASE_LOGO_RECORD || today.logoId === logo.id
    const headers = logoHeaders(logo)
    if (!visible) {
      // silent_auth already ran, so a signed-in administrator is known here.
      const user = ctx.auth.user
      if (!user || !(await isAdministrator(user.id))) throw notFound()
      headers['Cache-Control'] = 'private, no-store'
    }
    if (ctx.request.header('if-none-match') === headers.ETag) {
      ctx.response.header('ETag', headers.ETag)
      ctx.response.header('Cache-Control', headers['Cache-Control'])
      return ctx.response.notModified()
    }
    const disk = drive.use(logo.disk as never)
    if (!(await disk.exists(logo.path))) throw notFound()
    for (const [name, value] of Object.entries(headers)) ctx.response.header(name, value)
    return ctx.response.stream(await disk.getStream(logo.path))
  }
}
