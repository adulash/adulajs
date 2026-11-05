import {
  OutboundResponseTooLarge,
  OutboundTargetError,
  createOutboundRequester,
  outboundErrorCategory,
  type OutboundOptions,
} from '../integrations/outbound.js'
import { AdulaError } from '../admin/errors.js'

export type AssistantToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}
export type AssistantMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: AssistantToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }
export type ChatRequest = {
  baseUrl: string
  key: string
  body: Record<string, unknown>
  signal: AbortSignal
}
export type ChatCompletion = {
  content: string | null
  toolCalls: AssistantToolCall[]
  usage: { prompt: number; completion: number } | null
}
export type ChatClient = (request: ChatRequest) => Promise<ChatCompletion>

/** A provider failure; only its category is kept, never the provider's message or body. */
export class AssistantError extends AdulaError {
  constructor(public category: string) {
    super(502, 'E_AI_PROVIDER', 'تعذر الحصول على رد من مزوّد المساعد. حاول لاحقاً.')
  }
}

export const ASSISTANT_RESPONSE_LIMIT = 1024 * 1024

function toolCalls(value: unknown): AssistantToolCall[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new AssistantError('invalid-response')
  return value.slice(0, 8).map((call) => {
    const c = call as Record<string, any>
    if (
      !c ||
      typeof c.id !== 'string' ||
      typeof c.function?.name !== 'string' ||
      typeof c.function?.arguments !== 'string'
    )
      throw new AssistantError('invalid-response')
    return {
      id: c.id.slice(0, 100),
      type: 'function',
      function: { name: c.function.name.slice(0, 100), arguments: c.function.arguments },
    }
  })
}

/**
 * An OpenAI-compatible chat-completions client (OpenRouter by default) over the guarded
 * outbound requester: pinned DNS, no redirects, public targets only unless allowed, and a
 * capped response body.
 */
export function createChatClient(options: OutboundOptions = {}): ChatClient {
  const request = createOutboundRequester(options)
  return async ({ baseUrl, key, body, signal }) => {
    let response
    try {
      response = await request(`${baseUrl}/chat/completions`, {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${key}`,
        },
        body: JSON.stringify(body),
        signal,
        maxBytes: ASSISTANT_RESPONSE_LIMIT,
      })
    } catch (error) {
      if (error instanceof OutboundResponseTooLarge) throw new AssistantError('too-large')
      if (error instanceof OutboundTargetError) throw new AssistantError(error.category)
      throw new AssistantError(outboundErrorCategory(error))
    }
    if (response.status !== 200) throw new AssistantError(`provider-status:${response.status}`)
    let parsed: Record<string, any>
    try {
      parsed = JSON.parse(response.body.toString('utf8'))
    } catch {
      throw new AssistantError('invalid-response')
    }
    const message = parsed?.choices?.[0]?.message
    if (!message || typeof message !== 'object') throw new AssistantError('invalid-response')
    const content = typeof message.content === 'string' ? message.content : null
    const usage = parsed.usage
    return {
      content,
      toolCalls: toolCalls(message.tool_calls),
      usage:
        usage &&
        Number.isSafeInteger(usage.prompt_tokens) &&
        Number.isSafeInteger(usage.completion_tokens) &&
        usage.prompt_tokens >= 0 &&
        usage.completion_tokens >= 0
          ? { prompt: usage.prompt_tokens, completion: usage.completion_tokens }
          : null,
    }
  }
}
