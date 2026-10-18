import type { HttpContext } from '@adonisjs/core/http'
import { AdulaError, type Actor as AdulaActor } from 'adula'
import { adula, requestActor } from '#services/adula'

/** Saved views are per-actor list presets; AdulaJS validates every query key. */
export default class SavedViewsController {
  async store(ctx: HttpContext) {
    return this.#run(ctx, async (actor, resource) => ({
      data: await adula().savedViews.save(resource, actor, {
        name: ctx.request.input('name'),
        query: ctx.request.input('query'),
        shared: ctx.request.input('shared') === true,
      }),
    }))
  }

  async destroy(ctx: HttpContext) {
    return this.#run(ctx, async (actor, resource) => {
      const id = Number(ctx.params.id)
      if (!Number.isSafeInteger(id) || id <= 0)
        throw new AdulaError(404, 'E_VIEW_NOT_FOUND', 'العرض المحفوظ غير موجود')
      await adula().savedViews.remove(resource, actor, id)
      return { data: { id } }
    })
  }

  async #run(ctx: HttpContext, action: (actor: AdulaActor, resource: string) => Promise<unknown>) {
    try {
      const actor = await requestActor(ctx)
      return await action(actor, ctx.params.resource)
    } catch (error) {
      if (error instanceof AdulaError)
        return ctx.response
          .status(error.status)
          .send({ error: { code: error.code, message: error.message } })
      throw error
    }
  }
}
