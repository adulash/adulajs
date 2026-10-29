import { Tool } from '@jrmc/adonis-mcp'
import type { ToolContext } from '@jrmc/adonis-mcp/types/context'
import type { JSONSchema } from '@jrmc/adonis-mcp/types/method'
import type { ResourceRuntime } from '../admin/controller.js'
import type { ListOptions } from '../admin/resource_service.js'
import { AdulaError } from '../admin/errors.js'

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new AdulaError(422, 'E_INPUT', 'Expected an object')
  return value as Record<string, unknown>
}
function recordId(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 1)
    throw new AdulaError(422, 'E_ID', 'Expected a positive integer record ID')
  return Number(value)
}

/** Optional MCP adapter. Actor identity comes only from the host's authenticated context. */
export function createResourceTools(
  resolveRuntime: (context: ToolContext) => Promise<ResourceRuntime>
): { ResourceReadTool: new () => Tool; ResourceWriteTool: new () => Tool } {
  async function execute(context: ToolContext, write: boolean) {
    try {
      const args = object(context.args)
      const accepted = write
        ? ['resource', 'action', 'id', 'input', 'version']
        : ['resource', 'action', 'id', 'options']
      if (Object.keys(args).some((key) => !accepted.includes(key)))
        throw new AdulaError(422, 'E_INPUT', 'Unknown tool argument')
      const runtime = await resolveRuntime(context)
      if (
        typeof args.resource !== 'string' ||
        !runtime.registry.all().some((r) => r.name === args.resource)
      )
        throw new AdulaError(404, 'E_NOT_FOUND', 'الكيان غير موجود')
      const name = args.resource
      const { resources, actor } = runtime
      let result: unknown
      if (!write && args.action === 'list') {
        const options = args.options === undefined ? {} : object(args.options)
        if (
          Object.keys(options).some(
            (key) =>
              !['limit', 'cursor', 'search', 'sort', 'direction', 'filters', 'estimate'].includes(
                key
              )
          )
        )
          throw new AdulaError(422, 'E_INPUT', 'Unknown list option')
        for (const key of ['cursor', 'search', 'sort'])
          if (options[key] !== undefined && typeof options[key] !== 'string')
            throw new AdulaError(422, 'E_INPUT', `Invalid ${key}`)
        if (
          (options.limit !== undefined && !Number.isSafeInteger(options.limit)) ||
          (options.direction !== undefined &&
            !['asc', 'desc'].includes(String(options.direction))) ||
          (options.estimate !== undefined && typeof options.estimate !== 'boolean')
        )
          throw new AdulaError(422, 'E_INPUT', 'Invalid list options')
        if (options.filters !== undefined) object(options.filters)
        result = await resources.list(name, actor, options as ListOptions)
      } else if (!write && args.action === 'show') {
        result = await resources.show(name, recordId(args.id), actor)
      } else if (!write && args.action === 'editor') {
        result = await resources.editor(
          name,
          actor,
          args.id === undefined ? undefined : recordId(args.id)
        )
      } else if (write && (args.action === 'create' || args.action === 'update')) {
        if (args.action === 'create' && args.id !== undefined)
          throw new AdulaError(422, 'E_INPUT', 'Create cannot specify an ID')
        result = {
          data: await resources.save(
            name,
            actor,
            object(args.input),
            args.action === 'update' ? recordId(args.id) : undefined
          ),
        }
      } else if (
        write &&
        (args.action === 'delete' || args.action === 'submit' || args.action === 'cancel')
      ) {
        result = {
          data: await resources.transition(
            name,
            recordId(args.id),
            actor,
            args.action,
            args.version
          ),
        }
      } else throw new AdulaError(422, 'E_ACTION', 'Unsupported resource action')
      return context.response.text(JSON.stringify(result))
    } catch (error) {
      if (error instanceof AdulaError)
        return context.response.error(
          JSON.stringify({ status: error.status, code: error.code, message: error.message })
        )
      if ((error as { code?: string })?.code === 'E_VALIDATION_ERROR')
        return context.response.error(
          JSON.stringify({
            status: 422,
            code: 'E_VALIDATION_ERROR',
            messages: (error as { messages?: unknown }).messages,
          })
        )
      if (['23505', '23503', '23502'].includes((error as { code?: string })?.code ?? ''))
        return context.response.error(
          JSON.stringify({
            status: 422,
            code: 'E_CONSTRAINT',
            message: 'تحقق من القيم والسجلات المرتبطة',
          })
        )
      // Do not put database statements, credentials or stack traces on the wire.
      return context.response.error(
        JSON.stringify({ status: 500, code: 'E_INTERNAL', message: 'تعذر إتمام العملية' })
      )
    }
  }
  class ResourceReadTool extends Tool {
    name = 'adula_resource_read'
    title = 'Read authorized resources'
    description =
      'List or show records, or obtain an authorized editor schema. Organizational scope and field permissions always apply.'
    annotations = {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    }
    schema(): JSONSchema {
      return {
        type: 'object',
        additionalProperties: false,
        properties: {
          resource: { type: 'string' },
          action: { type: 'string', enum: ['list', 'show', 'editor'] },
          id: { type: 'integer', minimum: 1 },
          options: {
            type: 'object',
            properties: {
              limit: { type: 'integer', minimum: 1, maximum: 100 },
              cursor: { type: 'string' },
              search: { type: 'string' },
              sort: { type: 'string' },
              direction: { type: 'string', enum: ['asc', 'desc'] },
              filters: { type: 'object', properties: {}, additionalProperties: true },
              estimate: { type: 'boolean' },
            },
            additionalProperties: false,
          },
        },
        required: ['resource', 'action'],
      } as JSONSchema
    }
    async handle(context: ToolContext) {
      return execute(context, false)
    }
  }
  class ResourceWriteTool extends Tool {
    name = 'adula_resource_write'
    title = 'Change authorized resources'
    description =
      'Create, update, soft-delete, submit or cancel a record. Use editor metadata; update input must include the current version. Transition version is a top-level argument. Writes generate activity and outbox events atomically.'
    annotations = {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    }
    schema(): JSONSchema {
      return {
        type: 'object',
        additionalProperties: false,
        properties: {
          resource: { type: 'string' },
          action: { type: 'string', enum: ['create', 'update', 'delete', 'submit', 'cancel'] },
          id: { type: 'integer', minimum: 1 },
          input: { type: 'object', properties: {}, additionalProperties: true },
          version: { type: 'integer', minimum: 1 },
        },
        required: ['resource', 'action'],
      } as JSONSchema
    }
    async handle(context: ToolContext) {
      return execute(context, true)
    }
  }
  return { ResourceReadTool, ResourceWriteTool }
}
