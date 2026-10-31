import type { HttpContext } from '@adonisjs/core/http'
import { AdulaError } from 'adula'
import { adula, requestActor } from '#services/adula'
import { positiveId } from '#controllers/admin/support'
import { childDescriptions, pageFor } from '#controllers/resources_controller'
import { localizeResource, requestLanguage } from '#services/languages'

/**
 * A record's view or edit form as JSON, so the generic list opens it in a dialog over
 * itself instead of navigating away (#31). The record is read once. Resources with a
 * page override answer 409 and the list navigates to their own page instead.
 */
export default class RecordViewsController {
  async show(ctx: HttpContext) {
    const runtime = adula()
    const actor = await requestActor(ctx)
    const id = positiveId(ctx.params.id)
    try {
      let resource
      try {
        resource = runtime.registry.get(ctx.params.resource)
      } catch {
        throw new AdulaError(404, 'E_NOT_FOUND', 'الكيان غير موجود')
      }
      const edit = ctx.request.input('mode') === 'edit'
      if (pageFor(resource.name, edit ? 'form' : 'show') !== 'resources/page')
        throw new AdulaError(409, 'E_PAGE_OVERRIDE', 'لهذا الكيان صفحة مخصصة')
      if (edit) {
        const editor = await runtime.resources.editor(resource.name, actor, id)
        const shown = await runtime.resources.show(resource.name, id, actor)
        return {
          view: {
            mode: 'form' as const,
            editor: localizeResource(editor, requestLanguage(ctx)),
            permissions: shown.permissions,
          },
        }
      }
      const { children, activity, ...result } = await runtime.resources.record(
        resource.name,
        id,
        actor
      )
      const language = requestLanguage(ctx)
      const description = localizeResource(
        runtime.resources.describe(resource.name, actor),
        language
      )
      return {
        view: {
          mode: 'show' as const,
          resource: description,
          result,
          lookups: await runtime.resources.lookups(resource.name, actor),
          childResources: childDescriptions(description, actor, language),
        },
        childrenData: children,
        activity,
      }
    } catch (error) {
      if (error instanceof AdulaError)
        return ctx.response
          .status(error.status)
          .send({ error: { code: error.code, message: error.message } })
      throw error
    }
  }
}
