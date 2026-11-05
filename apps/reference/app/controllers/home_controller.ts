import type { HttpContext } from '@adonisjs/core/http'
import { runWithLanguage } from 'adula'
import { requestActor } from '#services/adula'
import { requestLanguage } from '#services/languages'
import { overviewFor } from '#services/overview'

/** The home page: the personal overview for signed-in users (ADR 050), the start page for guests. */
export default class HomeController {
  async show(ctx: HttpContext) {
    if (!ctx.auth.user) return ctx.inertia.render('home', {})
    const actor = await requestActor(ctx)
    const overview = await runWithLanguage(requestLanguage(ctx), () => overviewFor(actor))
    return ctx.inertia.render('home', { overview })
  }
}
