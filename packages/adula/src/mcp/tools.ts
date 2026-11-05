import { Tool } from '@jrmc/adonis-mcp'
import type { ToolContext } from '@jrmc/adonis-mcp/types/context'
import type { JSONSchema } from '@jrmc/adonis-mcp/types/method'
import type { ResourceRuntime } from '../admin/controller.js'
import { AdulaError } from '../admin/errors.js'
import {
  RESOURCE_READ_SCHEMA,
  RESOURCE_WRITE_SCHEMA,
  parseResourceToolArgs,
  resourceToolError,
  runResourceTool,
} from '../admin/resource_tools.js'

/** Optional MCP adapter. Actor identity comes only from the host's authenticated context. */
export function createResourceTools(
  resolveRuntime: (context: ToolContext) => Promise<ResourceRuntime>
): { ResourceReadTool: new () => Tool; ResourceWriteTool: new () => Tool } {
  async function execute(context: ToolContext, write: boolean) {
    try {
      // Argument shape is refused before the runtime (and the actor) is resolved.
      const args = context.args
      if (!args || typeof args !== 'object' || Array.isArray(args))
        throw new AdulaError(422, 'E_INPUT', 'Expected an object')
      const accepted = write
        ? ['resource', 'action', 'id', 'input', 'version']
        : ['resource', 'action', 'id', 'options']
      if (Object.keys(args).some((key) => !accepted.includes(key)))
        throw new AdulaError(422, 'E_INPUT', 'Unknown tool argument')
      const runtime = await resolveRuntime(context)
      const result = await runResourceTool(runtime, parseResourceToolArgs(runtime, args, write))
      return context.response.text(JSON.stringify(result))
    } catch (error) {
      // Do not put database statements, credentials or stack traces on the wire.
      return context.response.error(JSON.stringify(resourceToolError(error)))
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
      return structuredClone(RESOURCE_READ_SCHEMA) as unknown as JSONSchema
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
      return structuredClone(RESOURCE_WRITE_SCHEMA) as unknown as JSONSchema
    }
    async handle(context: ToolContext) {
      return execute(context, true)
    }
  }
  return { ResourceReadTool, ResourceWriteTool }
}
