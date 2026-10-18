import type { HttpContext } from '@adonisjs/core/http'
import { LookupsAdmin } from 'adula'
import { registry } from '#start/modules'
import { actorId, knex, mutate, text, wantsJson } from './support.js'

const lookups = () => new LookupsAdmin(knex(), registry)
const back = (group: unknown) =>
  typeof group === 'string' && /^[a-z][a-z0-9_]{0,99}$/.test(group)
    ? `/admin/lookups?group=${group}`
    : '/admin/lookups'

/** Lookup values used by resource fields: labels, order and availability; keys never change. */
export default class LookupsController {
  async index(ctx: HttpContext) {
    const admin = lookups()
    const groups = await admin.groups()
    const requested = text(ctx.request.input('group'))
    if (wantsJson(ctx))
      return requested ? { data: await admin.values(requested), group: requested } : { groups }
    const group = groups.find((entry) => entry.group === requested)?.group ?? groups[0]?.group
    return ctx.inertia.render('admin/lookups/index', {
      groups,
      group: group ?? null,
      values: group ? await admin.values(group) : [],
    })
  }

  async store(ctx: HttpContext) {
    const input = ctx.request.only(['group', 'key', 'labelAr', 'labelEn', 'sort'])
    return mutate(
      ctx,
      () => lookups().create(actorId(ctx), input),
      'تمت إضافة القيمة',
      back(input.group)
    )
  }

  async update(ctx: HttpContext) {
    return mutate(
      ctx,
      () =>
        lookups().update(
          actorId(ctx),
          ctx.params.id,
          ctx.request.only(['labelAr', 'labelEn', 'sort', 'key'])
        ),
      'تم حفظ القيمة'
    )
  }

  async reorder(ctx: HttpContext) {
    return mutate(
      ctx,
      () => lookups().reorder(actorId(ctx), ctx.params.group, ctx.request.input('ids')),
      'تم حفظ الترتيب'
    )
  }

  async disable(ctx: HttpContext) {
    return mutate(ctx, () => lookups().disable(actorId(ctx), ctx.params.id), 'تم تعطيل القيمة')
  }

  async enable(ctx: HttpContext) {
    return mutate(ctx, () => lookups().enable(actorId(ctx), ctx.params.id), 'تم تفعيل القيمة')
  }

  async destroy(ctx: HttpContext) {
    return mutate(ctx, () => lookups().delete(actorId(ctx), ctx.params.id), 'تم حذف القيمة')
  }
}
