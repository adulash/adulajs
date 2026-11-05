import { randomUUID } from 'node:crypto'
import { subject } from '@casl/ability'
import type { Knex } from 'knex'
import type { Actor } from '../auth/ability.js'
import { buildAbility } from '../auth/ability.js'
import type { ResourceRegistry } from '../resource/registry.js'
import type { ResourceService } from '../admin/resource_service.js'
import { AdulaError } from '../admin/errors.js'
import { logActivity } from '../core/activity.js'
import {
  parseResourceToolArgs,
  resourceToolError,
  runResourceTool,
  type ResourceToolCall,
} from '../admin/resource_tools.js'
import { AssistantError, type AssistantMessage, type ChatClient } from './client.js'
import {
  ASSISTANT_NOTICE_KEY,
  type AssistantSettings,
  type AssistantSettingsView,
} from './settings.js'
import {
  ASSISTANT_PREAMBLE,
  PROPOSE_TOOL,
  READ_TOOL,
  TOOL_ARGUMENT_LIMIT,
  resourceCatalogue,
  toolDefinitions,
  wrapToolResult,
} from './prompt.js'
import { remainingTokens, reserveTokens, settleTokens, usageDay } from './usage.js'

const RESOURCE = 'core.ai'
export const ASSISTANT_SUBJECT = 'core.ai'
export const MESSAGE_LIMIT = 4000
export const HISTORY_ENTRIES = 20
export const HISTORY_CHARACTERS = 24_000
export const LIST_ROW_LIMIT = 20
export const PROPOSAL_TTL_MINUTES = 10
const TURN_DEADLINE_MS = 90_000
const TOOL_CALLS_PER_STEP = 5
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export type AssistantProposal = {
  id: string
  resource: string
  resourceLabel: string
  action: string
  recordId: number | null
  recordTitle: string | null
  input: Record<string, unknown> | null
  before: Record<string, unknown> | null
  version: number | null
  expiresAt: string
}
export type AssistantTurnResult = {
  reply: string
  proposals: AssistantProposal[]
  usage: { remainingToday: number }
}
export type AssistantStatus = { available: boolean; noticeAccepted: boolean }

type HistoryItem = { role: 'user' | 'assistant'; content: string }
type TurnState = { conversationId: number; proposals: AssistantProposal[] }

const disabled = () => new AdulaError(404, 'E_AI_DISABLED', 'المساعد غير مفعّل')
const forbidden = () => new AdulaError(403, 'E_FORBIDDEN', 'لا تملك صلاحية استخدام المساعد')
const invalidInput = (message = 'الرسالة غير صالحة') => new AdulaError(422, 'E_AI_INPUT', message)

/** Validates a turn body: only the new message and prior user/assistant text. */
export function parseTurnInput(value: unknown): { message: string; history: HistoryItem[] } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidInput()
  const body = value as Record<string, unknown>
  if (Object.keys(body).some((key) => key !== 'message' && key !== 'history')) throw invalidInput()
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (!message || message.length > MESSAGE_LIMIT)
    throw invalidInput(`اكتب سؤالاً لا يتجاوز ${MESSAGE_LIMIT} حرف`)
  const raw = body.history === undefined ? [] : body.history
  if (!Array.isArray(raw) || raw.length > HISTORY_ENTRIES)
    throw invalidInput('سجل المحادثة غير صالح')
  let characters = message.length
  const history = raw.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      throw invalidInput('سجل المحادثة غير صالح')
    const entry = item as Record<string, unknown>
    const keys = Object.keys(entry)
    if (
      keys.length !== 2 ||
      !keys.includes('role') ||
      !keys.includes('content') ||
      (entry.role !== 'user' && entry.role !== 'assistant') ||
      typeof entry.content !== 'string' ||
      entry.content.length > MESSAGE_LIMIT
    )
      throw invalidInput('سجل المحادثة غير صالح')
    characters += entry.content.length
    return { role: entry.role, content: entry.content } as HistoryItem
  })
  if (characters > HISTORY_CHARACTERS) throw invalidInput('المحادثة طويلة؛ ابدأ محادثة جديدة')
  return { message, history }
}

function estimateTokens(messages: AssistantMessage[], maxOutput: number) {
  // Arabic text averages fewer characters per token than English; two is conservative.
  return Math.ceil(JSON.stringify(messages).length / 2) + maxOutput
}

/**
 * The built-in assistant (ADR 052). Every tool call runs through the shared resource tool
 * runner as the signed-in actor; the model can only propose writes, which run when the
 * user confirms them in a separate request.
 */
export class Assistant {
  constructor(
    private db: Knex,
    private registry: ResourceRegistry,
    private resources: ResourceService,
    private settings: AssistantSettings,
    private client: ChatClient,
    private options: { now?: () => Date } = {}
  ) {}

  private now() {
    return this.options.now?.() ?? new Date()
  }

  /** Whether the role rules grant `use` on `core.ai` (administrators always pass). */
  canUse(actor: Actor) {
    return buildAbility(actor.rules).can('use', subject(ASSISTANT_SUBJECT, {}))
  }

  async status(actor: Actor): Promise<AssistantStatus> {
    if (!this.canUse(actor)) return { available: false, noticeAccepted: false }
    const config = await this.settings.read()
    const available = config.enabled && config.hasKey && config.model !== ''
    return { available, noticeAccepted: available && (await this.noticeAccepted(actor.id)) }
  }

  private async noticeAccepted(userId: number) {
    const row = await this.db('settings')
      .where({ key: ASSISTANT_NOTICE_KEY, scope: 'user', scope_id: String(userId) })
      .first('id')
    return Boolean(row)
  }

  /** Permission, configuration and key; the provider key is returned for this call only. */
  private async usable(actor: Actor) {
    if (!this.canUse(actor)) throw forbidden()
    const { config, key } = await this.settings.runtime()
    if (!config.enabled || !key || !config.model) throw disabled()
    return { config, key }
  }

  /** Records that the user read the provider notice; an impersonator cannot accept it. */
  async acceptNotice(actor: Actor) {
    await this.usable(actor)
    if (actor.impersonatorId)
      throw new AdulaError(
        403,
        'E_AI_IMPERSONATION',
        'لا يمكن قبول تنبيه المساعد نيابة عن مستخدم آخر'
      )
    await this.db('settings')
      .insert({
        key: ASSISTANT_NOTICE_KEY,
        scope: 'user',
        scope_id: String(actor.id),
        value: JSON.stringify({ acceptedAt: this.now().toISOString() }),
      })
      .onConflict(['key', 'scope', 'scope_id'])
      .ignore()
  }

  async startConversation(actor: Actor): Promise<{ id: number }> {
    await this.usable(actor)
    const [row] = await this.db('ai_conversations')
      .insert({ user_id: actor.id, impersonator_id: actor.impersonatorId ?? null })
      .returning('id')
    return { id: Number(row.id) }
  }

  async turn(actor: Actor, conversationId: number, body: unknown): Promise<AssistantTurnResult> {
    const { message, history } = parseTurnInput(body)
    const { config, key } = await this.usable(actor)
    if (!(await this.noticeAccepted(actor.id)))
      throw new AdulaError(409, 'E_AI_NOTICE', 'اقرأ تنبيه المساعد ووافق عليه أولاً')
    await this.conversation(actor, conversationId)
    const persona = config.systemPrompt.trim()
    const messages: AssistantMessage[] = [
      {
        role: 'system',
        content: [
          ASSISTANT_PREAMBLE,
          `Today (UTC): ${usageDay(this.now())}.`,
          `Resources this user may read: ${JSON.stringify(resourceCatalogue(this.registry, actor))}`,
        ].join('\n'),
      },
      ...(persona ? [{ role: 'system' as const, content: persona }] : []),
      ...history,
      { role: 'user', content: message },
    ]
    const state: TurnState = { conversationId, proposals: [] }
    const deadline = AbortSignal.timeout(TURN_DEADLINE_MS)
    const day = usageDay(this.now())
    let reply = ''
    let spent = 0
    for (let step = 0; step <= config.maxToolIterations; step++) {
      // The last step offers no tools, so the model has to answer in text.
      const offerTools = step < config.maxToolIterations
      const estimate = estimateTokens(messages, config.maxOutputTokens)
      if (!(await reserveTokens(this.db, actor.id, day, estimate, config.dailyTokenBudget))) {
        if (step === 0)
          throw new AdulaError(429, 'E_AI_BUDGET', 'استنفدت حصتك اليومية من المساعد. حاول غداً.')
        reply = 'توقف المساعد لأن حصتك اليومية لا تكفي لمتابعة هذا السؤال.'
        break
      }
      let completion
      try {
        completion = await this.client({
          baseUrl: config.baseUrl,
          key,
          signal: AbortSignal.any([AbortSignal.timeout(config.timeoutSeconds * 1000), deadline]),
          body: {
            model: config.model,
            messages,
            max_tokens: config.maxOutputTokens,
            temperature: 0.2,
            ...(offerTools
              ? { tools: toolDefinitions(config.allowWriteProposals), tool_choice: 'auto' }
              : {}),
          },
        })
      } catch (error) {
        await settleTokens(this.db, actor.id, day, estimate, { prompt: 0, completion: 0 })
        throw error instanceof AdulaError ? error : new AssistantError('connect')
      }
      const used = completion.usage ?? {
        prompt: estimate - config.maxOutputTokens,
        completion: config.maxOutputTokens,
      }
      await settleTokens(this.db, actor.id, day, estimate, used)
      spent += used.prompt + used.completion
      if (!offerTools || !completion.toolCalls.length) {
        reply = completion.content ?? ''
        break
      }
      messages.push({
        role: 'assistant',
        content: completion.content,
        tool_calls: completion.toolCalls,
      })
      for (const [index, call] of completion.toolCalls.entries()) {
        const content =
          index < TOOL_CALLS_PER_STEP
            ? await this.runTool(actor, config, state, call.function.name, call.function.arguments)
            : wrapToolResult({
                ok: false,
                error: { code: 'E_AI_TOOL', message: 'Too many tool calls' },
              })
        messages.push({ role: 'tool', tool_call_id: call.id, content })
      }
    }
    await this.db('ai_conversations')
      .where({ id: conversationId, user_id: actor.id })
      .update({
        turns: this.db.raw('turns + 1'),
        tokens: this.db.raw('tokens + ?', [spent]),
        last_turn_at: this.now(),
      })
    return {
      reply: reply.trim() || 'لم يصل رد من المساعد.',
      proposals: state.proposals,
      usage: {
        remainingToday: await remainingTokens(this.db, actor.id, day, config.dailyTokenBudget),
      },
    }
  }

  private async conversation(actor: Actor, id: number) {
    if (!Number.isSafeInteger(id) || id < 1)
      throw new AdulaError(404, 'E_NOT_FOUND', 'المحادثة غير موجودة')
    const row = await this.db('ai_conversations').where({ id, user_id: actor.id }).first('id')
    if (!row) throw new AdulaError(404, 'E_NOT_FOUND', 'المحادثة غير موجودة')
  }

  private runtime(actor: Actor) {
    return { registry: this.registry, resources: this.resources, actor }
  }

  private async audit(actor: Actor, conversationId: number, action: string, changes: object) {
    await logActivity(this.db, {
      resource: RESOURCE,
      recordId: conversationId,
      actorId: actor.id,
      impersonatorId: actor.impersonatorId,
      action,
      changes: changes as never,
    })
  }

  /**
   * Runs one model tool call. Names, argument whitelist and the actor are fixed here;
   * nothing in the arguments or in earlier tool output can widen them.
   */
  private async runTool(
    actor: Actor,
    config: AssistantSettingsView,
    state: TurnState,
    name: string,
    rawArguments: string
  ): Promise<string> {
    const write = name === PROPOSE_TOOL
    if (name !== READ_TOOL && !(write && config.allowWriteProposals)) {
      await this.audit(actor, state.conversationId, 'tool.denied', {
        tool: name.slice(0, 60),
        outcome: { status: 404, code: 'E_AI_TOOL' },
      })
      return wrapToolResult({ ok: false, error: { code: 'E_AI_TOOL', message: 'Unknown tool' } })
    }
    let call: ResourceToolCall | null = null
    try {
      if (rawArguments.length > TOOL_ARGUMENT_LIMIT) throw invalidInput('Tool arguments too large')
      let args: unknown
      try {
        args = JSON.parse(rawArguments || '{}')
      } catch {
        throw invalidInput('Tool arguments are not JSON')
      }
      call = parseResourceToolArgs(this.runtime(actor), args, write)
      if (write) return await this.propose(actor, state, call)
      if (call.action === 'list')
        call.options = {
          ...call.options,
          limit: Math.min(Number(call.options?.limit ?? LIST_ROW_LIMIT), LIST_ROW_LIMIT),
        }
      const result = (await runResourceTool(this.runtime(actor), call)) as Record<string, any>
      await this.audit(actor, state.conversationId, 'tool.read', {
        tool: name,
        resource: call.resource,
        action: call.action,
        ids:
          call.action === 'list'
            ? (Array.isArray(result?.data) ? result.data : [])
                .map((row: Record<string, unknown>) => Number(row?.id))
                .filter(Number.isSafeInteger)
                .slice(0, LIST_ROW_LIMIT)
            : call.id
              ? [call.id]
              : [],
        outcome: { status: 200 },
      })
      return wrapToolResult({ ok: true, result })
    } catch (error) {
      const failure = resourceToolError(error)
      await this.audit(
        actor,
        state.conversationId,
        [401, 403, 404].includes(failure.status)
          ? 'tool.denied'
          : write
            ? 'tool.propose'
            : 'tool.read',
        {
          tool: name,
          resource: call?.resource ?? null,
          action: call?.action ?? null,
          ids: call?.id ? [call.id] : [],
          outcome: { status: failure.status, code: failure.code },
        }
      )
      return wrapToolResult({ ok: false, error: failure })
    }
  }

  /** Stores a proposal for the user to confirm. No ResourceService write happens here. */
  private async propose(actor: Actor, state: TurnState, call: ResourceToolCall) {
    if (state.proposals.length >= 1)
      throw new AdulaError(422, 'E_AI_ONE_PROPOSAL', 'Only one proposal per answer')
    const resource = this.registry.get(call.resource)
    let before: Record<string, unknown> | null = null
    let recordTitle: string | null = null
    if (call.action === 'create' || call.action === 'update') {
      // The editor applies the update (or create) permission and lists the writable fields.
      const editor = await this.resources.editor(call.resource, actor, call.id)
      const writable = new Set<string>(editor.fields.map((field: { key: string }) => field.key))
      writable.add('version')
      if (resource.scoped) writable.add('orgUnitId')
      const keys = Object.keys(call.input ?? {})
      if (!keys.length || keys.some((key) => !writable.has(key)))
        throw new AdulaError(422, 'E_AI_FIELDS', 'Input contains fields the user cannot write')
    }
    if (call.id) {
      const shown = (await this.resources.show(call.resource, call.id, actor)) as {
        data: Record<string, unknown>
      }
      recordTitle = typeof shown.data?._title === 'string' ? shown.data._title : `#${call.id}`
      if (call.action === 'update')
        before = Object.fromEntries(
          Object.keys(call.input ?? {})
            .filter((key) => key !== 'version')
            .map((key) => [key, shown.data?.[key] ?? null])
        )
    }
    const id = randomUUID()
    const expiresAt = new Date(this.now().getTime() + PROPOSAL_TTL_MINUTES * 60_000)
    const version = Number.isSafeInteger(call.version)
      ? Number(call.version)
      : Number.isSafeInteger(call.input?.version)
        ? Number(call.input?.version)
        : null
    await this.db('ai_pending_actions').insert({
      id,
      conversation_id: state.conversationId,
      user_id: actor.id,
      impersonator_id: actor.impersonatorId ?? null,
      resource: call.resource,
      action: call.action,
      record_id: call.id ?? null,
      input: call.input ? JSON.stringify(call.input) : null,
      version: Number.isSafeInteger(call.version) ? call.version : null,
      expires_at: expiresAt,
    })
    await this.audit(actor, state.conversationId, 'tool.propose', {
      tool: PROPOSE_TOOL,
      resource: call.resource,
      action: call.action,
      ids: call.id ? [call.id] : [],
      proposal: id,
      outcome: { status: 202 },
    })
    state.proposals.push({
      id,
      resource: call.resource,
      resourceLabel: resource.label.ar,
      action: call.action,
      recordId: call.id ?? null,
      recordTitle,
      input: call.input ?? null,
      before,
      version,
      expiresAt: expiresAt.toISOString(),
    })
    return wrapToolResult({ ok: true, proposalId: id, status: 'awaiting_user_confirmation' })
  }

  /** Atomically takes the user's own unexpired proposal; null when there is none. */
  private async take(actor: Actor, conversationId: number, id: string, outcome: string) {
    if (!UUID.test(id) || !Number.isSafeInteger(conversationId)) return null
    const result = await this.db.raw(
      `UPDATE ai_pending_actions SET consumed_at = now(), outcome = ?
       WHERE id = ? AND user_id = ? AND conversation_id = ?
         AND impersonator_id IS NOT DISTINCT FROM ?
         AND consumed_at IS NULL AND expires_at > ?
       RETURNING *`,
      [outcome, id, actor.id, conversationId, actor.impersonatorId ?? null, this.now()]
    )
    return (result.rows[0] as Record<string, any> | undefined) ?? null
  }

  /** Runs a proposal the user confirmed, through ResourceService as the user. */
  async confirm(actor: Actor, conversationId: number, id: string) {
    const { config } = await this.usable(actor)
    if (!config.allowWriteProposals)
      throw new AdulaError(409, 'E_AI_WRITES_OFF', 'اقتراح التعديلات غير مفعّل')
    const row = await this.take(actor, conversationId, id, 'confirmed')
    if (!row) throw new AdulaError(404, 'E_AI_PROPOSAL', 'المقترح غير موجود أو انتهت صلاحيته')
    await this.db('ai_pending_actions').where('id', id).update({ input: null })
    const args: Record<string, unknown> = { resource: row.resource, action: row.action }
    if (row.record_id !== null) args.id = Number(row.record_id)
    if (row.input) args.input = row.input
    if (row.version !== null && !['create', 'update'].includes(row.action))
      args.version = Number(row.version)
    try {
      const runtime = this.runtime(actor)
      const result = await runResourceTool(runtime, parseResourceToolArgs(runtime, args, true))
      await this.audit(actor, conversationId, 'tool.confirm', {
        tool: PROPOSE_TOOL,
        resource: row.resource,
        action: row.action,
        ids: row.record_id !== null ? [Number(row.record_id)] : [],
        proposal: id,
        outcome: { status: 200 },
      })
      return result
    } catch (error) {
      const failure = resourceToolError(error)
      await this.db('ai_pending_actions').where('id', id).update({ outcome: 'failed' })
      await this.audit(actor, conversationId, 'tool.confirm', {
        tool: PROPOSE_TOOL,
        resource: row.resource,
        action: row.action,
        ids: row.record_id !== null ? [Number(row.record_id)] : [],
        proposal: id,
        outcome: { status: failure.status, code: failure.code },
      })
      throw error
    }
  }

  async reject(actor: Actor, conversationId: number, id: string) {
    if (!this.canUse(actor)) throw forbidden()
    const row = await this.take(actor, conversationId, id, 'rejected')
    if (!row) throw new AdulaError(404, 'E_AI_PROPOSAL', 'المقترح غير موجود أو انتهت صلاحيته')
    await this.db('ai_pending_actions').where('id', id).update({ input: null })
    await this.audit(actor, conversationId, 'tool.reject', {
      tool: PROPOSE_TOOL,
      resource: row.resource,
      action: row.action,
      ids: row.record_id !== null ? [Number(row.record_id)] : [],
      proposal: id,
      outcome: { status: 200 },
    })
  }

  /** Sends one minimal request with the stored key; returns only a failure category. */
  async testConnection(): Promise<{ ok: boolean; category: string | null }> {
    const { config, key } = await this.settings.runtime()
    if (!key || !config.model)
      throw new AdulaError(409, 'E_AI_NOT_CONFIGURED', 'أدخل المفتاح والنموذج أولاً')
    try {
      await this.client({
        baseUrl: config.baseUrl,
        key,
        signal: AbortSignal.timeout(config.timeoutSeconds * 1000),
        body: { model: config.model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 },
      })
      return { ok: true, category: null }
    } catch (error) {
      return { ok: false, category: error instanceof AssistantError ? error.category : 'connect' }
    }
  }

  /** Retention: conversation metadata after 30 days, used proposals after a day, usage after 90. */
  async prune(now = this.now()) {
    const day = 24 * 60 * 60 * 1000
    const conversations = await this.db('ai_conversations')
      .where('created_at', '<', new Date(now.getTime() - 30 * day))
      .delete()
    const proposals = await this.db('ai_pending_actions')
      .where('expires_at', '<', new Date(now.getTime() - day))
      .delete()
    const usage = await this.db('ai_usage')
      .where('day', '<', usageDay(new Date(now.getTime() - 90 * day)))
      .delete()
    // Expired, never-used proposals lose their input right away.
    await this.db('ai_pending_actions')
      .where('expires_at', '<', now)
      .whereNotNull('input')
      .update({ input: null })
    return { conversations, proposals, usage }
  }
}
