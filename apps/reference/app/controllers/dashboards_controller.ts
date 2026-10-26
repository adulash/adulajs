import type { HttpContext } from '@adonisjs/core/http'
import { AdulaError, type Actor } from 'adula'
import { adula, requestActor } from '#services/adula'

/**
 * Indicator pages (ADR 046). Every widget is computed as the viewer through
 * ResourceService.aggregate, so a number never counts records the viewer cannot see.
 */
export default class DashboardsController {
  /** JSON: the dashboards the viewer may open. HTML: the first of them. */
  async index(ctx: HttpContext) {
    return this.#run(ctx, async (actor) => {
      const dashboards = adula().dashboards.list(actor)
      if (ctx.request.accepts(['html', 'json']) !== 'html') return { data: dashboards }
      if (!dashboards.length) throw new AdulaError(404, 'E_NOT_FOUND', 'لوحة المؤشرات غير موجودة')
      return ctx.response.redirect(`/dashboards/${dashboards[0].name}`)
    })
  }

  async show(ctx: HttpContext) {
    return this.#run(ctx, async (actor) => {
      const dashboard = await adula().dashboards.render(String(ctx.params.name), actor)
      if (ctx.request.accepts(['html', 'json']) !== 'html') return { data: dashboard }
      // The list of dashboards reaches the page as the shared `dashboards` prop.
      return ctx.inertia.render('dashboards/show', { dashboard })
    })
  }

  async #run(ctx: HttpContext, action: (actor: Actor) => Promise<unknown>) {
    try {
      return await action(await requestActor(ctx))
    } catch (error) {
      if (error instanceof AdulaError)
        return ctx.response
          .status(error.status)
          .send({ error: { code: error.code, message: error.message } })
      throw error
    }
  }
}
