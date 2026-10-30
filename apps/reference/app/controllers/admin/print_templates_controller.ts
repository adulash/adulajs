import type { HttpContext } from '@adonisjs/core/http'
import { PRINT_HELPERS, PrintTemplates } from 'adula'
import adulaConfig from '#config/adula'
import { adula, requestActor } from '#services/adula'
import { printIdentity, printableResource } from '#controllers/print_controller'
import { actorId, knex, mutate, optionalId, wantsJson } from './support.js'

const input = (ctx: HttpContext) =>
  ctx.request.only(['key', 'label', 'body', 'paper', 'orientation', 'header', 'footer', 'active'])

/**
 * Administrators manage print templates per resource (ADR 048). Saving always adds a new
 * immutable version; code templates are listed read-only. The route group requires the
 * administrator middleware, like message templates.
 */
export default class PrintTemplatesController {
  async index(ctx: HttpContext) {
    const runtime = adula()
    const templates = await new PrintTemplates(knex(), runtime.registry).list()
    if (wantsJson(ctx)) return { data: templates }
    // The names each resource's templates may use, for the editor's reference panel.
    const resources = runtime.registry.all().map((resource) => ({
      name: resource.name,
      label: resource.label.ar,
      fields: Object.entries(resource.fields)
        .filter(([, field]) => field.type !== 'hasMany')
        .map(([key, field]) => ({ key, label: field.label.ar, type: field.type })),
      lines: Object.entries(resource.fields).flatMap(([key, field]) =>
        field.type === 'hasMany'
          ? [
              {
                key,
                label: field.label.ar,
                columns: Object.entries(runtime.registry.get(field.resource).fields)
                  .filter(([, column]) => column.type !== 'hasMany')
                  .map(([column, definition]) => ({
                    key: column,
                    label: definition.label.ar,
                    type: definition.type,
                  })),
              },
            ]
          : []
      ),
    }))
    return ctx.inertia.render('admin/print_templates/index', {
      templates,
      resources,
      helpers: [...PRINT_HELPERS],
      timeZone: adulaConfig.timeZone,
    })
  }

  async show(ctx: HttpContext) {
    const name = printableResource(ctx.params.resource)
    return {
      data: await new PrintTemplates(knex(), adula().registry).get(name, String(ctx.params.key)),
    }
  }

  async versions(ctx: HttpContext) {
    const name = printableResource(ctx.params.resource)
    return {
      data: await new PrintTemplates(knex(), adula().registry).versions(
        name,
        String(ctx.params.key)
      ),
    }
  }

  async store(ctx: HttpContext) {
    const name = printableResource(ctx.request.input('resource'))
    return mutate(
      ctx,
      () => new PrintTemplates(knex(), adula().registry).create(name, input(ctx), actorId(ctx)),
      'تم حفظ قالب الطباعة'
    )
  }

  async update(ctx: HttpContext) {
    const name = printableResource(ctx.params.resource)
    return mutate(
      ctx,
      () =>
        new PrintTemplates(knex(), adula().registry).update(
          name,
          String(ctx.params.key),
          input(ctx),
          actorId(ctx)
        ),
      'حُفظت نسخة جديدة من قالب الطباعة'
    )
  }

  /** Renders an unsaved draft against a record the administrator may read. */
  async preview(ctx: HttpContext) {
    const runtime = adula()
    const name = printableResource(ctx.request.input('resource'))
    const actor = await requestActor(ctx)
    const user = ctx.auth.getUserOrFail()
    const result = await new PrintTemplates(knex(), runtime.registry).preview(
      runtime.resources,
      name,
      input(ctx),
      actor,
      {
        recordId: optionalId(ctx.request.input('recordId')),
        identity: await printIdentity(),
        printedBy: user.fullName ?? user.email,
        timeZone: adulaConfig.timeZone,
      }
    )
    return { data: result }
  }
}
