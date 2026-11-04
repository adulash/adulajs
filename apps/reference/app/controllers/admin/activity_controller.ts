import type { HttpContext } from '@adonisjs/core/http'
import { ActivityAdmin } from 'adula'
import { adula } from '#services/adula'
import { requestLanguage } from '#services/languages'
import { activityFacets, presentActivity } from '#services/activity_presentation'
import { actorId, knex, optionalId, text, wantsJson } from './support.js'

export default class ActivityController {
  async index(ctx: HttpContext) {
    const filters = {
      resource: text(ctx.request.input('resource')),
      action: text(ctx.request.input('action')),
      actorId: optionalId(ctx.request.input('actorId')) ?? undefined,
      from: text(ctx.request.input('from')),
      to: text(ctx.request.input('to')),
    }
    const service = new ActivityAdmin(knex())
    const language = requestLanguage(ctx)
    // Rows keep their stored keys and gain readable names, titles and changed fields.
    const activity = await presentActivity(
      { db: knex(), viewer: await adula().actors.load(actorId(ctx)), language },
      await service.list({
        ...filters,
        cursor: text(ctx.request.input('cursor')),
        limit: ctx.request.input('limit'),
      })
    )
    if (wantsJson(ctx)) return activity
    return ctx.inertia.render('admin/activity/index', {
      activity,
      facets: await activityFacets(knex(), await service.facets(), language),
      filters: {
        resource: filters.resource ?? '',
        action: filters.action ?? '',
        actorId: filters.actorId ? String(filters.actorId) : '',
        from: filters.from ?? '',
        to: filters.to ?? '',
      },
    })
  }
}
