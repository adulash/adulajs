import type { HttpContext } from '@adonisjs/core/http'
import { SequencesAdmin } from 'adula'
import { registry } from '#start/modules'
import { actorId, knex, mutate, wantsJson } from './support.js'

const sequences = () => new SequencesAdmin(knex(), registry)

/** Document numbering: view each sequence and move its next number forward. */
export default class SequencesController {
  async index(ctx: HttpContext) {
    const rows = await sequences().list()
    if (wantsJson(ctx)) return { data: rows }
    return ctx.inertia.render('admin/sequences/index', { sequences: rows })
  }

  async update(ctx: HttpContext) {
    return mutate(
      ctx,
      () => sequences().setNext(actorId(ctx), ctx.params.key, ctx.request.input('next')),
      'تم ضبط الرقم التالي'
    )
  }
}
