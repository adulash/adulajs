import type { HttpContext } from '@adonisjs/core/http'
import type { Actor } from '../auth/ability.js'
import type { ResourceRegistry } from '../resource/registry.js'
import type { Resource } from '../resource/types.js'
import type { ResourceService } from './resource_service.js'
import { AdulaError } from './errors.js'
import { translate } from '../languages/catalog.js'

export type ResourceRuntime = {
  registry: ResourceRegistry
  resources: ResourceService
  actor: Actor
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
}

/** The host supplies its authenticated actor; ResourceService authorizes every action. */
export function createResourceController(
  resolveRuntime: (ctx: HttpContext) => Promise<ResourceRuntime>,
  renderList?: (ctx: HttpContext, resource: Resource, result: ResourceList) => unknown,
  renderForm?: (ctx: HttpContext, resource: Resource, editor: ResourceEditor) => unknown,
  renderShow?: (ctx: HttpContext, resource: Resource, result: ResourceShow) => unknown
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
        const result = await resources.list(resource.name, actor, {
          limit: ctx.request.input('limit'),
          cursor: ctx.request.input('cursor'),
          search: ctx.request.input('search'),
          sort: ctx.request.input('sort'),
          direction: ctx.request.input('direction'),
          filters: ctx.request.input('filters'),
          tag: ctx.request.input('tag'),
          estimate:
            ctx.request.input('estimate') !== 'false' && ctx.request.input('estimate') !== false,
        })
        return renderList && ctx.request.accepts(['html', 'json']) === 'html'
          ? renderList(ctx, resource, result)
          : result
      })
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
        if ((error as { code?: string })?.code === '23503')
          return ctx.response.unprocessableEntity({
            error: { code: 'E_RELATION', message: translate('errors.E_RELATION') },
          })
        throw error
      }
    }
  }
}
