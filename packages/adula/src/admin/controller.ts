import type { HttpContext } from '@adonisjs/core/http'
import type { Actor } from '../auth/ability.js'
import type { ResourceRegistry } from '../resource/registry.js'
import type { Resource } from '../resource/types.js'
import type { ResourceService } from './resource_service.js'
import { AdulaError } from './errors.js'
import { translate } from '../languages/catalog.js'
import { BulkActions } from '../lists/bulk_actions.js'
import type { ListOptions } from './resource/query.js'

export type ResourceRuntime = {
  registry: ResourceRegistry
  resources: ResourceService
  actor: Actor
  /** Bulk actions with the application's definitions; built-in actions only when absent. */
  bulk?: BulkActions
}
export type ResourceList = Awaited<ReturnType<ResourceService['list']>>
export type ResourceEditor = Awaited<ReturnType<ResourceService['editor']>>
export type ResourceShow = Awaited<ReturnType<ResourceService['show']>>
export type ResourceChildren = Awaited<ReturnType<ResourceService['children']>>
export type ResourceLookups = Awaited<ReturnType<ResourceService['lookups']>>
export type ResourceActivity = Awaited<ReturnType<ResourceService['activity']>>
export interface ResourceController {
  index(ctx: HttpContext): Promise<unknown>
  show(ctx: HttpContext): Promise<unknown>
  store(ctx: HttpContext): Promise<unknown>
  update(ctx: HttpContext): Promise<unknown>
  destroy(ctx: HttpContext): Promise<unknown>
  submit(ctx: HttpContext): Promise<unknown>
  cancel(ctx: HttpContext): Promise<unknown>
  amend(ctx: HttpContext): Promise<unknown>
  create(ctx: HttpContext): Promise<unknown>
  edit(ctx: HttpContext): Promise<unknown>
  options(ctx: HttpContext): Promise<unknown>
  aggregate(ctx: HttpContext): Promise<unknown>
  /** GET …/export: the filtered list as CSV (ADR 046). */
  export(ctx: HttpContext): Promise<unknown>
  /** GET …/trash: soft-deleted records for actors who may delete (ADR 046). */
  trash(ctx: HttpContext): Promise<unknown>
  /** POST …/:id/restore */
  restore(ctx: HttpContext): Promise<unknown>
  /** GET …/bulk: the bulk actions the actor may offer. */
  bulkActions(ctx: HttpContext): Promise<unknown>
  /** POST …/bulk: { action, ids, versions? } → { data: { succeeded, failed } }. */
  bulk(ctx: HttpContext): Promise<unknown>
}

/** The host supplies its authenticated actor; ResourceService authorizes every action. */
export function createResourceController(
  resolveRuntime: (ctx: HttpContext) => Promise<ResourceRuntime>,
  renderList?: (ctx: HttpContext, resource: Resource, result: ResourceList) => unknown,
  renderForm?: (ctx: HttpContext, resource: Resource, editor: ResourceEditor) => unknown,
  renderShow?: (ctx: HttpContext, resource: Resource, result: ResourceShow) => unknown,
  renderTrash?: (ctx: HttpContext, resource: Resource, result: ResourceList) => unknown
): new () => ResourceController {
  return class ResourcesController {
    async create(ctx: HttpContext) {
      return this.#execute(ctx, async ({ resources, actor }, resource) => {
        // `?defaults[field]=value` pre-fills the form; the service authorizes each value.
        const defaults = ctx.request.qs().defaults
        const editor = await resources.editor(resource.name, actor, undefined, {
          defaults:
            defaults && typeof defaults === 'object' && !Array.isArray(defaults)
              ? (defaults as Record<string, unknown>)
              : undefined,
        })
        return renderForm && ctx.request.accepts(['html', 'json']) === 'html'
          ? renderForm(ctx, resource, editor)
          : editor
      })
    }
    async edit(ctx: HttpContext) {
      return this.#execute(ctx, async ({ resources, actor }, resource) => {
        const editor = await resources.editor(resource.name, actor, this.#id(ctx))
        return renderForm && ctx.request.accepts(['html', 'json']) === 'html'
          ? renderForm(ctx, resource, editor)
          : editor
      })
    }
    async index(ctx: HttpContext) {
      return this.#execute(ctx, async ({ resources, actor }, resource) => {
        const result = await resources.list(resource.name, actor, this.#listOptions(ctx))
        return renderList && ctx.request.accepts(['html', 'json']) === 'html'
          ? renderList(ctx, resource, result)
          : result
      })
    }
    async trash(ctx: HttpContext) {
      return this.#execute(ctx, async ({ resources, actor }, resource) => {
        const result = await resources.list(resource.name, actor, {
          ...this.#listOptions(ctx),
          trashed: true,
        })
        return renderTrash && ctx.request.accepts(['html', 'json']) === 'html'
          ? renderTrash(ctx, resource, result)
          : result
      })
    }
    async export(ctx: HttpContext) {
      return this.#execute(ctx, async ({ resources, actor }, resource) => {
        const { search, sort, direction, filters, tag } = this.#listOptions(ctx)
        const file = await resources.export(resource.name, actor, {
          search,
          sort,
          direction,
          filters,
          tag,
          trashed: ctx.request.input('trashed') === 'true' || ctx.request.input('trashed') === true,
        })
        ctx.response.header('Content-Type', 'text/csv; charset=utf-8')
        ctx.response.header(
          'Content-Disposition',
          `attachment; filename="${file.asciiFilename}"; filename*=UTF-8''${rfc5987(file.filename)}`
        )
        ctx.response.header('Cache-Control', 'no-store')
        ctx.response.send(file.content)
      })
    }
    async restore(ctx: HttpContext) {
      return this.#execute(ctx, async ({ resources, actor }, resource) => ({
        data: await resources.restore(resource.name, this.#id(ctx), actor),
      }))
    }
    async bulkActions(ctx: HttpContext) {
      return this.#execute(ctx, async (runtime, resource) => ({
        data: this.#bulk(runtime).available(resource.name, runtime.actor),
      }))
    }
    async bulk(ctx: HttpContext) {
      return this.#execute(ctx, async (runtime, resource) => ({
        data: await this.#bulk(runtime).run(resource.name, runtime.actor, {
          action: ctx.request.input('action'),
          ids: ctx.request.input('ids'),
          versions: ctx.request.input('versions'),
        }),
      }))
    }
    #bulk(runtime: ResourceRuntime) {
      return runtime.bulk ?? new BulkActions(runtime.registry, runtime.resources)
    }
    #listOptions(ctx: HttpContext): ListOptions {
      return {
        limit: ctx.request.input('limit'),
        cursor: ctx.request.input('cursor'),
        search: ctx.request.input('search'),
        sort: ctx.request.input('sort'),
        direction: ctx.request.input('direction'),
        filters: ctx.request.input('filters'),
        tag: ctx.request.input('tag'),
        estimate:
          ctx.request.input('estimate') !== 'false' && ctx.request.input('estimate') !== false,
      }
    }
    async show(ctx: HttpContext) {
      return this.#execute(ctx, async ({ resources, actor }, resource) => {
        const result = await resources.show(resource.name, this.#id(ctx), actor)
        return renderShow && ctx.request.accepts(['html', 'json']) === 'html'
          ? renderShow(ctx, resource, result)
          : result
      })
    }
    async options(ctx: HttpContext) {
      return this.#execute(ctx, ({ resources, actor }, resource) =>
        resources.relationOptions(resource.name, ctx.params.field, actor, {
          id:
            ctx.request.input('id') === undefined
              ? undefined
              : this.#positiveId(ctx.request.input('id')),
          search: ctx.request.input('search'),
          cursor: ctx.request.input('cursor'),
          orgUnitId:
            ctx.request.input('orgUnitId') === undefined || ctx.request.input('orgUnitId') === ''
              ? undefined
              : this.#positiveId(ctx.request.input('orgUnitId')),
          purpose: ctx.request.input('purpose') === 'filter' ? 'filter' : 'form',
        })
      )
    }
    /**
     * GET …/aggregate?groupBy=status,priority&sum=total&filters[x]=…&where={json}
     * Counts and totals over the records the actor may view (ResourceService.aggregate).
     */
    async aggregate(ctx: HttpContext) {
      return this.#execute(ctx, async ({ resources, actor }, resource) => {
        const list = (value: unknown) =>
          value === undefined || value === ''
            ? []
            : Array.isArray(value)
              ? value.map(String)
              : String(value).split(',').filter(Boolean)
        let where: unknown
        const raw = ctx.request.input('where')
        if (typeof raw === 'string' && raw) {
          try {
            where = JSON.parse(raw)
          } catch {
            throw new AdulaError(422, 'E_FILTER', 'where must be a JSON object')
          }
        } else if (raw && typeof raw === 'object') where = raw
        return {
          data: await resources.aggregate(resource.name, actor, {
            groupBy: list(ctx.request.input('groupBy')),
            sum: list(ctx.request.input('sum')),
            count: ctx.request.input('count') !== 'false',
            filters: ctx.request.input('filters'),
            where: where as never,
            search: ctx.request.input('search'),
          }),
        }
      })
    }
    async store(ctx: HttpContext) {
      return this.#execute(ctx, async ({ resources, actor }, resource) =>
        ctx.response.created({
          data: await resources.save(resource.name, actor, ctx.request.body()),
        })
      )
    }
    async update(ctx: HttpContext) {
      return this.#execute(ctx, async ({ resources, actor }, resource) => ({
        data: await resources.save(resource.name, actor, ctx.request.body(), this.#id(ctx)),
      }))
    }
    async destroy(ctx: HttpContext) {
      return this.#transition(ctx, 'delete')
    }
    async submit(ctx: HttpContext) {
      return this.#transition(ctx, 'submit')
    }
    async cancel(ctx: HttpContext) {
      return this.#transition(ctx, 'cancel')
    }
    async amend(ctx: HttpContext) {
      return this.#execute(ctx, async ({ resources, actor }, resource) =>
        ctx.response.created({
          data: await resources.amend(resource.name, this.#id(ctx), actor),
        })
      )
    }
    #id(ctx: HttpContext) {
      return this.#positiveId(ctx.params.id)
    }
    #positiveId(value: unknown) {
      const id = Number(value)
      if (!Number.isSafeInteger(id) || id <= 0)
        throw new AdulaError(404, 'E_NOT_FOUND', 'السجل غير موجود')
      return id
    }
    async #transition(ctx: HttpContext, action: 'delete' | 'submit' | 'cancel') {
      return this.#execute(ctx, async ({ resources, actor }, resource) => ({
        data: await resources.transition(
          resource.name,
          this.#id(ctx),
          actor,
          action,
          ctx.request.input('version')
        ),
      }))
    }
    async #execute(
      ctx: HttpContext,
      action: (runtime: ResourceRuntime, resource: Resource) => Promise<unknown>
    ) {
      try {
        const runtime = await resolveRuntime(ctx)
        let resource: Resource
        try {
          resource = runtime.registry.get(ctx.params.resource)
        } catch {
          throw new AdulaError(404, 'E_NOT_FOUND', 'الكيان غير موجود')
        }
        return await action(runtime, resource)
      } catch (error) {
        if (error instanceof AdulaError)
          return ctx.response
            .status(error.status)
            .send({ error: { code: error.code, message: error.message } })
        if ((error as { code?: string })?.code === '23505')
          return ctx.response.conflict({
            error: { code: 'E_DUPLICATE', message: translate('errors.E_DUPLICATE') },
          })
        // A NOT NULL column the definition lets be empty (see adula:resource:migration).
        if ((error as { code?: string })?.code === '23502')
          return ctx.response.unprocessableEntity({
            error: { code: 'E_NOT_NULL', message: translate('errors.E_NOT_NULL') },
          })
        if ((error as { code?: string })?.code === '23503')
          return ctx.response.unprocessableEntity({
            error: { code: 'E_RELATION', message: translate('errors.E_RELATION') },
          })
        throw error
      }
    }
  }
}

/** RFC 5987 ext-value encoding of a UTF-8 file name. */
function rfc5987(value: string) {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  )
}
