import type { ResourceRuntime } from './controller.js'
import type { ListOptions } from './resource_service.js'
import { AdulaError } from './errors.js'

/**
 * The resource tool surface shared by MCP and the built-in assistant: one argument
 * parser, one dispatcher and one error mapping, so both reach ResourceService through
 * the same path. Nothing here imports the optional MCP package.
 */
export type ResourceToolAction =
  'list' | 'show' | 'editor' | 'create' | 'update' | 'delete' | 'submit' | 'cancel'
export type ResourceToolCall = {
  write: boolean
  resource: string
  action: ResourceToolAction
  id?: number
  options?: ListOptions
  input?: Record<string, unknown>
  version?: unknown
}
export type ResourceToolError = {
  status: number
  code: string
  message?: string
  messages?: unknown
}

const READ_KEYS = ['resource', 'action', 'id', 'options']
const WRITE_KEYS = ['resource', 'action', 'id', 'input', 'version']
const LIST_KEYS = ['limit', 'cursor', 'search', 'sort', 'direction', 'filters', 'estimate']

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

/**
 * Validates tool arguments against a fixed whitelist. The actor never comes from the
 * arguments: unknown keys (an `actorId`, a role) are refused.
 */
export function parseResourceToolArgs(
  runtime: Pick<ResourceRuntime, 'registry'>,
  value: unknown,
  write: boolean
): ResourceToolCall {
  const args = object(value)
  const accepted = write ? WRITE_KEYS : READ_KEYS
  if (Object.keys(args).some((key) => !accepted.includes(key)))
    throw new AdulaError(422, 'E_INPUT', 'Unknown tool argument')
  if (
    typeof args.resource !== 'string' ||
    !runtime.registry.all().some((r) => r.name === args.resource)
  )
    throw new AdulaError(404, 'E_NOT_FOUND', 'الكيان غير موجود')
  const resource = args.resource
  if (!write && args.action === 'list') {
    const options = args.options === undefined ? {} : object(args.options)
    if (Object.keys(options).some((key) => !LIST_KEYS.includes(key)))
      throw new AdulaError(422, 'E_INPUT', 'Unknown list option')
    for (const key of ['cursor', 'search', 'sort'])
      if (options[key] !== undefined && typeof options[key] !== 'string')
        throw new AdulaError(422, 'E_INPUT', `Invalid ${key}`)
    if (
      (options.limit !== undefined && !Number.isSafeInteger(options.limit)) ||
      (options.direction !== undefined && !['asc', 'desc'].includes(String(options.direction))) ||
      (options.estimate !== undefined && typeof options.estimate !== 'boolean')
    )
      throw new AdulaError(422, 'E_INPUT', 'Invalid list options')
    if (options.filters !== undefined) object(options.filters)
    return { write, resource, action: 'list', options: options as ListOptions }
  }
  if (!write && args.action === 'show')
    return { write, resource, action: 'show', id: recordId(args.id) }
  if (!write && args.action === 'editor')
    return {
      write,
      resource,
      action: 'editor',
      ...(args.id === undefined ? {} : { id: recordId(args.id) }),
    }
  if (write && (args.action === 'create' || args.action === 'update')) {
    if (args.action === 'create' && args.id !== undefined)
      throw new AdulaError(422, 'E_INPUT', 'Create cannot specify an ID')
    return {
      write,
      resource,
      action: args.action,
      input: object(args.input),
      ...(args.action === 'update' ? { id: recordId(args.id) } : {}),
    }
  }
  if (write && (args.action === 'delete' || args.action === 'submit' || args.action === 'cancel'))
    return { write, resource, action: args.action, id: recordId(args.id), version: args.version }
  throw new AdulaError(422, 'E_ACTION', 'Unsupported resource action')
}

/** Runs a parsed call through ResourceService as `runtime.actor`. */
export async function runResourceTool(
  runtime: ResourceRuntime,
  call: ResourceToolCall
): Promise<unknown> {
  const { resources, actor } = runtime
  const name = call.resource
  switch (call.action) {
    case 'list':
      return resources.list(name, actor, call.options ?? {})
    case 'show':
      return resources.show(name, call.id!, actor)
    case 'editor':
      return resources.editor(name, actor, call.id)
    case 'create':
    case 'update':
      return {
        data: await resources.save(
          name,
          actor,
          call.input ?? {},
          call.action === 'update' ? call.id : undefined
        ),
      }
    default:
      return {
        data: await resources.transition(name, call.id!, actor, call.action, call.version),
      }
  }
}

/** Maps a failure to a wire-safe error: no SQL, credentials or stack traces. */
export function resourceToolError(error: unknown): ResourceToolError {
  if (error instanceof AdulaError)
    return { status: error.status, code: error.code, message: error.message }
  if ((error as { code?: string })?.code === 'E_VALIDATION_ERROR')
    return {
      status: 422,
      code: 'E_VALIDATION_ERROR',
      messages: (error as { messages?: unknown }).messages,
    }
  if (['23505', '23503', '23502'].includes((error as { code?: string })?.code ?? ''))
    return { status: 422, code: 'E_CONSTRAINT', message: 'تحقق من القيم والسجلات المرتبطة' }
  return { status: 500, code: 'E_INTERNAL', message: 'تعذر إتمام العملية' }
}

/** JSON Schema of the read tool's arguments. */
export const RESOURCE_READ_SCHEMA = {
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
} as const

/** JSON Schema of the write tool's arguments. */
export const RESOURCE_WRITE_SCHEMA = {
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
} as const
