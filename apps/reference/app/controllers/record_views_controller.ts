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
  /**
   * The create form as JSON, so «إضافة» opens it over the mounted list. `?defaults[field]=`
   * pre-fills it as on the create page; the service authorizes each value.
   */
  async create(ctx: HttpContext) {
    const runtime = adula()
    const actor = await requestActor(ctx)
    try {
      let resource
      try {
        resource = runtime.registry.get(ctx.params.resource)
      } catch {
        throw new AdulaError(404, 'E_NOT_FOUND', 'الكيان غير موجود')
      }
      const defaults = ctx.request.qs().defaults
      // Authorized first (the editor checks the create permission): who may not create learns
      // nothing about the resource's pages.
      const editor = await runtime.resources.editor(resource.name, actor, undefined, {
        defaults:
          defaults && typeof defaults === 'object' && !Array.isArray(defaults)
            ? (defaults as Record<string, unknown>)
            : undefined,
      })
      if (pageFor(resource.name, 'form') !== 'resources/page')
        throw new AdulaError(409, 'E_PAGE_OVERRIDE', 'لهذا الكيان صفحة مخصصة')
      return {
        view: {
          mode: 'form' as const,
          editor: localizeResource(editor, requestLanguage(ctx)),
          permissions: {},
        },
      }
    } catch (error) {
      if (error instanceof AdulaError)
        return ctx.response
          .status(error.status)
          .send({ error: { code: error.code, message: error.message } })
      throw error
    }
  }

  /**
   * One record as a row of the generic list (its values, permissions and related titles), so
   * a record created in the dialog over the list is pinned at the top of the mounted list
   * without loading it again. The list's own authorization applies; a record the actor's
   * list does not reach answers 404.
   */
  async row(ctx: HttpContext) {
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
      const result = await runtime.resources.list(resource.name, actor, {
        ids: [id],
        limit: 1,
        estimate: false,
      })
      if (result.data.length === 0) throw new AdulaError(404, 'E_NOT_FOUND', 'السجل غير موجود')
      return result
    } catch (error) {
      if (error instanceof AdulaError)
        return ctx.response
          .status(error.status)
          .send({ error: { code: error.code, message: error.message } })
      throw error
    }
  }

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
