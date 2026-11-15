import type { Knex } from 'knex'
import type { Actor } from '../auth/ability.js'
import type { SecretBox } from '../integrations/webhooks.js'
import { resolveOutboundTarget, type OutboundOptions } from '../integrations/outbound.js'
import { AdulaError } from '../admin/errors.js'
import { logActivity } from '../core/activity.js'

export const ASSISTANT_SETTING_KEY = 'ai.assistant'
export const ASSISTANT_NOTICE_KEY = 'ai.notice'
export const DEFAULT_ASSISTANT_BASE_URL = 'https://openrouter.ai/api/v1'
const RESOURCE = 'core.ai'

/** Each numeric limit: default, minimum and the hard cap no setting can exceed. */
export const ASSISTANT_LIMITS = {
  maxOutputTokens: [1024, 64, 4096],
  dailyTokenBudget: [50_000, 1_000, 2_000_000],
  requestsPerMinute: [10, 1, 60],
  maxToolIterations: [4, 0, 8],
  timeoutSeconds: [30, 5, 60],
} as const
type LimitKey = keyof typeof ASSISTANT_LIMITS

/** The assistant configuration as the administration shows it; the key never leaves. */
export type AssistantSettingsView = {
  enabled: boolean
  baseUrl: string
  model: string
  systemPrompt: string
  allowWriteProposals: boolean
  hasKey: boolean
  updatedAt: string | null
} & Record<LimitKey, number>
export type AssistantSettingsInput = Partial<Omit<AssistantSettingsView, 'hasKey' | 'updatedAt'>>

type Stored = Record<string, unknown>
type Who = Pick<Actor, 'id' | 'impersonatorId'>

function limit(value: unknown, key: LimitKey) {
  const [fallback, min, max] = ASSISTANT_LIMITS[key]
  const number = Number(value)
  if (value === undefined || value === null || !Number.isSafeInteger(number)) return fallback
  return Math.min(Math.max(number, min), max)
}

/**
 * The administrator-configured assistant, stored in the system setting `ai.assistant`.
 * The provider key is sealed like webhook secrets, is never returned and is cleared
 * whenever the provider address changes, so a stored key cannot be redirected.
 */
export class AssistantSettings {
  constructor(
    private db: Knex,
    private secrets: SecretBox,
    private options: OutboundOptions = {}
  ) {}

  async read(): Promise<AssistantSettingsView> {
    return this.present(await this.stored())
  }

  /** The configuration and the opened key, for the server-side client only. */
  async runtime(): Promise<{ config: AssistantSettingsView; key: string | null }> {
    const value = await this.stored()
    let key: string | null = null
    try {
      key = typeof value?.secret === 'string' ? this.secrets.open(value.secret) : null
    } catch {
      key = null
    }
    return { config: this.present(value), key: key || null }
  }

  private present(value: Stored | null): AssistantSettingsView {
    const v = value ?? {}
    return {
      enabled: v.enabled === true,
      baseUrl: typeof v.baseUrl === 'string' && v.baseUrl ? v.baseUrl : DEFAULT_ASSISTANT_BASE_URL,
      model: typeof v.model === 'string' ? v.model : '',
      systemPrompt: typeof v.systemPrompt === 'string' ? v.systemPrompt : '',
      allowWriteProposals: v.allowWriteProposals === true,
      maxOutputTokens: limit(v.maxOutputTokens, 'maxOutputTokens'),
      dailyTokenBudget: limit(v.dailyTokenBudget, 'dailyTokenBudget'),
      requestsPerMinute: limit(v.requestsPerMinute, 'requestsPerMinute'),
      maxToolIterations: limit(v.maxToolIterations, 'maxToolIterations'),
      timeoutSeconds: limit(v.timeoutSeconds, 'timeoutSeconds'),
      hasKey: typeof v.secret === 'string' && v.secret.length > 0,
      updatedAt: typeof v.updatedAt === 'string' ? v.updatedAt : null,
    }
  }

  /** Saves everything except the key. Changing the provider address clears the key. */
  async save(actor: Who, input: unknown): Promise<AssistantSettingsView> {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new AdulaError(422, 'E_AI_INPUT', 'بيانات الإعداد غير صالحة')
    const data = input as Record<string, unknown>
    const allowed = [
      'enabled',
      'baseUrl',
      'model',
      'systemPrompt',
      'allowWriteProposals',
      ...Object.keys(ASSISTANT_LIMITS),
    ]
    if (Object.keys(data).some((key) => !allowed.includes(key)))
      throw new AdulaError(422, 'E_AI_INPUT', 'حقل غير معروف في إعداد المساعد')
    const previous = (await this.stored()) ?? {}
    const current = this.present(previous)
    const next: Stored = { ...current }
    for (const key of ['enabled', 'allowWriteProposals'] as const)
      if (data[key] !== undefined) {
        if (typeof data[key] !== 'boolean')
          throw new AdulaError(422, 'E_AI_INPUT', 'قيمة التفعيل يجب أن تكون نعم أو لا')
        next[key] = data[key]
      }
    if (data.model !== undefined) {
      const model = typeof data.model === 'string' ? data.model.trim() : ''
      if (!/^[A-Za-z0-9._:/-]{1,120}$/.test(model))
        throw new AdulaError(
          422,
          'E_AI_MODEL',
          'اكتب معرّف النموذج كما يعرضه المزوّد، مثل openai/gpt-4o-mini'
        )
      next.model = model
    }
    if (data.systemPrompt !== undefined) {
      // An emptied field arrives as null (AdonisJS converts empty strings): no persona.
      const prompt = data.systemPrompt === null ? '' : data.systemPrompt
      if (typeof prompt !== 'string' || prompt.length > 4000)
        throw new AdulaError(422, 'E_AI_PROMPT', 'تعليمات المساعد نص لا يتجاوز 4000 حرف')
      next.systemPrompt = prompt
    }
    for (const key of Object.keys(ASSISTANT_LIMITS) as LimitKey[])
      if (data[key] !== undefined) {
        const [, min, max] = ASSISTANT_LIMITS[key]
        const number = Number(data[key])
        if (!Number.isSafeInteger(number) || number < min || number > max)
          throw new AdulaError(422, 'E_AI_LIMIT', `القيمة يجب أن تكون بين ${min} و${max}`)
        next[key] = number
      }
    let keyCleared = false
    if (data.baseUrl !== undefined) {
      const baseUrl =
        typeof data.baseUrl === 'string' ? data.baseUrl.trim().replace(/\/+$/, '') : ''
      await this.assertTarget(baseUrl)
      next.baseUrl = baseUrl
      keyCleared = baseUrl !== current.baseUrl && current.hasKey
    }
    if (next.enabled === true && !next.model)
      throw new AdulaError(422, 'E_AI_MODEL', 'اختر النموذج قبل تفعيل المساعد')
    delete next.hasKey
    next.updatedAt = new Date().toISOString()
    if (!keyCleared && typeof previous.secret === 'string') next.secret = previous.secret
    await this.write(actor, next, 'settings.update', {
      enabled: next.enabled as boolean,
      baseUrl: next.baseUrl as string,
      model: next.model as string,
      allowWriteProposals: next.allowWriteProposals as boolean,
      keyCleared,
    })
    return this.read()
  }

  /** Stores a new provider key; it is sealed and never returned. */
  async setKey(actor: Who, value: unknown): Promise<AssistantSettingsView> {
    const key = typeof value === 'string' ? value.trim() : ''
    if (key.length < 8 || key.length > 400 || /\s/.test(key))
      throw new AdulaError(422, 'E_AI_KEY', 'مفتاح المزوّد غير صالح')
    const previous = (await this.stored()) ?? {}
    const next: Stored = { ...this.present(previous), secret: this.secrets.seal(key) }
    delete next.hasKey
    next.updatedAt = new Date().toISOString()
    await this.write(actor, next, 'key.set', { keyChanged: true })
    return this.read()
  }

  async clearKey(actor: Who): Promise<AssistantSettingsView> {
    const previous = (await this.stored()) ?? {}
    const next: Stored = { ...this.present(previous), enabled: false }
    delete next.hasKey
    next.updatedAt = new Date().toISOString()
    await this.write(actor, next, 'key.clear', { keyChanged: true })
    return this.read()
  }

  private async write(actor: Who, value: Stored, action: string, changes: Record<string, unknown>) {
    await this.db.transaction(async (trx) => {
      const [row] = await trx('settings')
        .insert({
          key: ASSISTANT_SETTING_KEY,
          scope: 'system',
          scope_id: '0',
          value: JSON.stringify(value),
        })
        .onConflict(['key', 'scope', 'scope_id'])
        .merge(['value'])
        .returning('id')
      // Never the key: only what changed, as booleans and public settings.
      await logActivity(trx, {
        resource: RESOURCE,
        recordId: row.id,
        actorId: actor.id,
        impersonatorId: actor.impersonatorId,
        action,
        changes: changes as never,
      })
    })
  }

  private async stored(): Promise<Stored | null> {
    const row = await this.db('settings')
      .where({ key: ASSISTANT_SETTING_KEY, scope: 'system', scope_id: '0' })
      .first('value')
    return row?.value && typeof row.value === 'object' ? (row.value as Stored) : null
  }

  /** HTTPS only, no credentials or query, and no private address unless the policy allows. */
  private async assertTarget(value: string) {
    let url: URL
    try {
      url = new URL(value)
    } catch {
      throw new AdulaError(422, 'E_AI_URL', 'عنوان المزوّد غير صالح')
    }
    const allowPrivate = this.options.allowPrivateTargets === true
    if (url.protocol !== 'https:' && !(allowPrivate && url.protocol === 'http:'))
      throw new AdulaError(422, 'E_AI_URL', 'يجب أن يبدأ عنوان المزوّد بـ https://')
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      value.includes('?') ||
      value.includes('#') ||
      value.length > 500
    )
      throw new AdulaError(422, 'E_AI_URL', 'عنوان المزوّد غير مسموح')
    if (allowPrivate) return
    try {
      await resolveOutboundTarget(url, this.options)
    } catch {
      throw new AdulaError(422, 'E_AI_URL', 'لا يُسمح بعناوين الشبكة الداخلية')
    }
  }
}
