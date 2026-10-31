import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import type { Knex } from 'knex'
import type { ResourceRegistry } from '../resource/registry.js'
import type { DomainEvent, Listener } from '../events/outbox.js'
import { AdulaError } from '../admin/errors.js'
import { notifyWithTemplate } from '../core/message_templates.js'
import {
  OutboundTargetError,
  createOutboundPoster,
  outboundErrorCategory,
  resolveOutboundTarget,
  type OutboundOptions,
  type OutboundRequest,
  type OutboundTarget,
} from './outbound.js'

/** Seals webhook secrets at rest; hosts pass their framework encryption service. */
export type SecretBox = { seal(value: string): string; open(value: string): string | null }

export type Webhook = {
  id: number
  name: string
  url: string
  events: string[]
  active: boolean
  createdAt: string
  lastDeliveryAt: string | null
  failing: number
}
export type WebhookDelivery = {
  id: string
  event: string
  status: 'pending' | 'delivered' | 'failed'
  attempts: number
  lastStatus: number | null
  lastError: string | null
  createdAt: string
  deliveredAt: string | null
  nextAttemptAt: string | null
}
/** Outbound target policy; private targets need an explicit opt-in. */
export type WebhookOptions = OutboundOptions
/**
 * Sends one POST. `init.target` is the address validated for this delivery;
 * a poster must connect to it (createOutboundPoster does) to defeat DNS rebinding.
 */
export type HttpPoster = (url: string, init: OutboundRequest) => Promise<{ status: number }>

const EVENT_VERBS = ['created', 'updated', 'deleted', 'submitted', 'cancelled', 'amended']
const BACKOFF_MINUTES = [1, 5, 30, 120, 720]
export const WEBHOOK_MAX_ATTEMPTS = BACKOFF_MINUTES.length + 1
const NAME_LIMIT = 100

/** Signature receivers verify: hex HMAC-SHA256 over `${timestamp}.${body}`. */
export function signWebhook(secret: string, timestamp: string, body: string) {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
}

/**
 * Outgoing webhooks: administrators subscribe HTTPS endpoints to domain events.
 * Deliveries are queued exactly once per event inside the listener transaction,
 * signed with a per-webhook secret and retried with backoff by the worker.
 * Payloads carry the event envelope only, never record fields.
 */
export class Webhooks {
  constructor(
    private db: Knex,
    private registry: ResourceRegistry,
    private secrets: SecretBox,
    private options: WebhookOptions = {}
  ) {}

  /** Events a webhook may subscribe to, derived from the registry. */
  events() {
    return this.registry.all().flatMap((resource) =>
      EVENT_VERBS.filter(
        (verb) =>
          !['submitted', 'cancelled', 'amended'].includes(verb) || Boolean(resource.submittable)
      ).map((verb) => ({
        key: `${this.registry.owner(resource.name)}.${resource.name}.${verb}`,
        resource: resource.label.ar,
        verb,
      }))
    )
  }

  async list(): Promise<Webhook[]> {
    const rows = await this.db('webhooks').orderBy('id')
    return rows.map((row) => this.present(row))
  }

  /** Creates a webhook and returns its signing secret once; it is never shown again. */
  async create(
    actorId: number,
    input: { name: unknown; url: unknown; events: unknown }
  ): Promise<{ webhook: Webhook; secret: string }> {
    const values = await this.validate(input)
    const secret = randomBytes(32).toString('base64url')
    const [row] = await this.db('webhooks')
      .insert({ ...values, secret: this.secrets.seal(secret), created_by: actorId })
      .returning('*')
    return { webhook: this.present(row), secret }
  }

  async update(
    id: number,
    input: { name: unknown; url: unknown; events: unknown; active?: unknown }
  ) {
    const values = await this.validate(input)
    const updated = await this.db('webhooks')
      .where('id', id)
      .update({ ...values, active: input.active !== false, updated_at: this.db.fn.now() })
    if (!updated) throw new AdulaError(404, 'E_WEBHOOK_NOT_FOUND', 'الـWebhook غير موجود')
  }

  async remove(id: number) {
    const removed = await this.db('webhooks').where('id', id).del()
    if (!removed) throw new AdulaError(404, 'E_WEBHOOK_NOT_FOUND', 'الـWebhook غير موجود')
  }

  async deliveries(id: number, limit = 50): Promise<WebhookDelivery[]> {
    if (!(await this.db('webhooks').where('id', id).first('id')))
      throw new AdulaError(404, 'E_WEBHOOK_NOT_FOUND', 'الـWebhook غير موجود')
    const rows = await this.db('webhook_deliveries')
      .where('webhook_id', id)
      .orderBy('created_at', 'desc')
      .limit(Math.min(100, Math.max(1, limit)))
    return rows.map((row) => ({
      id: String(row.id),
      event: String(row.event),
      status: row.status,
      attempts: Number(row.attempts),
      lastStatus: row.last_status === null ? null : Number(row.last_status),
      lastError: row.last_error === null ? null : String(row.last_error),
      createdAt: new Date(row.created_at).toISOString(),
      deliveredAt: row.delivered_at ? new Date(row.delivered_at).toISOString() : null,
      nextAttemptAt: row.status === 'pending' ? new Date(row.next_attempt_at).toISOString() : null,
    }))
  }

  /** Puts a failed delivery back in the queue for an immediate attempt. */
  async retry(deliveryId: string) {
    const updated = await this.db('webhook_deliveries')
      .where({ id: deliveryId, status: 'failed' })
      .update({ status: 'pending', attempts: 0, next_attempt_at: this.db.fn.now() })
    if (!updated)
      throw new AdulaError(404, 'E_DELIVERY_NOT_FOUND', 'لا توجد محاولة فاشلة بهذا المعرّف')
  }

  /** Catch-all listener that queues one delivery per matching active webhook. */
  listener(): Listener {
    return {
      name: 'adula.webhooks',
      event: '*',
      handle: async (event: DomainEvent, trx: Knex.Transaction) => {
        const hooks = await trx('webhooks')
          .where('active', true)
          .whereRaw('events @> ?::jsonb', [JSON.stringify([event.event])])
          .select('id')
        if (!hooks.length) return
        const payload = {
          id: event.id,
          event: event.event,
          resource: event.payload.resource ?? null,
          recordId: event.payload.id ?? null,
          actorId: event.payload.actorId ?? null,
          occurredAt: new Date().toISOString(),
        }
        await trx('webhook_deliveries')
          .insert(
            hooks.map((hook) => ({
              id: randomUUID(),
              webhook_id: hook.id,
              event_id: event.id,
              event: event.event,
              payload: JSON.stringify(payload),
            }))
          )
          .onConflict(['webhook_id', 'event_id'])
          .ignore()
      },
    }
  }

  /**
   * Sends due deliveries. Each row is claimed with SKIP LOCKED; a crash after the
   * HTTP call may repeat a delivery, so receivers deduplicate on X-Adula-Delivery.
   */
  async deliver(post: HttpPoster = createOutboundPoster(this.options), limit = 20) {
    const claimed = await this.db.transaction(async (trx) => {
      const rows = await trx('webhook_deliveries as d')
        .join('webhooks as w', 'w.id', 'd.webhook_id')
        .where('d.status', 'pending')
        .where('d.next_attempt_at', '<=', trx.fn.now())
        .where('w.active', true)
        .orderBy('d.next_attempt_at')
        .limit(limit)
        .forUpdate('d')
        .skipLocked()
        .select('d.*', 'w.url', 'w.secret', 'w.name', 'w.created_by')
      // Lease the rows so a parallel worker skips them while HTTP calls run.
      if (rows.length)
        await trx('webhook_deliveries')
          .whereIn(
            'id',
            rows.map((row) => row.id)
          )
          .update({ next_attempt_at: trx.raw("now() + interval '2 minutes'") })
      return rows
    })
    let delivered = 0
    let failed = 0
    for (const row of claimed) {
      const body = JSON.stringify(row.payload)
      const timestamp = String(Math.floor(Date.now() / 1000))
      const attempts = Number(row.attempts) + 1
      let status: number | null = null
      let error: string | null = null
      try {
        const secret = this.secrets.open(String(row.secret))
        if (!secret) {
          error = 'secret'
          throw new Error('Webhook secret cannot be opened with the current key')
        }
        // Resolve once; the poster connects to this validated address only.
        const target = await this.resolveTarget(String(row.url))
        const response = await post(String(row.url), {
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'adula-webhooks',
            'X-Adula-Event': String(row.event),
            'X-Adula-Delivery': String(row.id),
            'X-Adula-Timestamp': timestamp,
            'X-Adula-Signature': `sha256=${signWebhook(secret, timestamp, body)}`,
          },
          body,
          signal: AbortSignal.timeout(10000),
          target,
        })
        status = response.status
        if (status < 200 || status >= 300) error = `http-status:${status}`
      } catch (caught) {
        // Store a category only; raw messages may echo internal hosts or bodies.
        error ??= outboundErrorCategory(caught)
      }
      if (!error) {
        await this.db('webhook_deliveries').where('id', row.id).update({
          status: 'delivered',
          attempts,
          last_status: status,
          last_error: null,
          delivered_at: this.db.fn.now(),
        })
        await this.db('webhooks')
          .where('id', row.webhook_id)
          .update({ failing: 0, last_delivery_at: this.db.fn.now() })
        delivered++
        continue
      }
      failed++
      const exhausted = attempts >= WEBHOOK_MAX_ATTEMPTS
      await this.db.transaction(async (trx) => {
        await trx('webhook_deliveries')
          .where('id', row.id)
          .update({
            status: exhausted ? 'failed' : 'pending',
            attempts,
            last_status: status,
            last_error: error,
            next_attempt_at: exhausted
              ? trx.fn.now()
              : trx.raw(`now() + interval '${BACKOFF_MINUTES[attempts - 1]} minutes'`),
          })
        if (exhausted) {
          await trx('webhooks').where('id', row.webhook_id).increment('failing', 1)
          if (row.created_by)
            await notifyWithTemplate(trx, Number(row.created_by), 'webhook.failed', {
              name: row.name,
              event: row.event,
              error,
            })
        }
      })
    }
    return { delivered, failed }
  }

  private async validate(input: { name: unknown; url: unknown; events: unknown }) {
    const name = typeof input.name === 'string' ? input.name.trim() : ''
    if (!name || name.length > NAME_LIMIT)
      throw new AdulaError(422, 'E_WEBHOOK_NAME', 'الاسم مطلوب ولا يتجاوز 100 حرف')
    const url = typeof input.url === 'string' ? input.url.trim() : ''
    await this.assertTarget(url)
    const known = new Set(this.events().map((event) => event.key))
    if (
      !Array.isArray(input.events) ||
      !input.events.length ||
      input.events.length > 100 ||
      !input.events.every((event) => typeof event === 'string' && known.has(event))
    )
      throw new AdulaError(
        422,
        'E_WEBHOOK_EVENTS',
        'اختر حدثاً واحداً على الأقل من الأحداث المعروفة'
      )
    return { name, url, events: JSON.stringify([...new Set(input.events as string[])]) }
  }

  /** Refuses non-HTTPS URLs and hosts resolving to private addresses (SSRF). */
  private async assertTarget(value: string) {
    const url = this.parseTarget(value)
    if (this.options.allowPrivateTargets === true) return
    try {
      await resolveOutboundTarget(url, this.options)
    } catch {
      throw new AdulaError(422, 'E_WEBHOOK_URL', 'لا يُسمح بعناوين الشبكة الداخلية')
    }
  }

  /** Re-validates a stored URL at delivery time and returns the address to pin. */
  private async resolveTarget(value: string): Promise<OutboundTarget> {
    let url: URL
    try {
      url = this.parseTarget(value)
    } catch {
      throw new OutboundTargetError('blocked-target')
    }
    return resolveOutboundTarget(url, this.options)
  }

  private parseTarget(value: string) {
    let url: URL
    try {
      url = new URL(value)
    } catch {
      throw new AdulaError(422, 'E_WEBHOOK_URL', 'عنوان URL غير صالح')
    }
    const allowPrivate = this.options.allowPrivateTargets === true
    if (url.protocol !== 'https:' && !(allowPrivate && url.protocol === 'http:'))
      throw new AdulaError(422, 'E_WEBHOOK_URL', 'يجب أن يبدأ العنوان بـ https://')
    if (url.username || url.password || value.length > 2000)
      throw new AdulaError(422, 'E_WEBHOOK_URL', 'عنوان URL غير مسموح')
    return url
  }

  private present(row: Record<string, any>): Webhook {
    return {
      id: Number(row.id),
      name: String(row.name),
      url: String(row.url),
      events: Array.isArray(row.events) ? row.events.map(String) : [],
      active: Boolean(row.active),
      createdAt: new Date(row.created_at).toISOString(),
      lastDeliveryAt: row.last_delivery_at ? new Date(row.last_delivery_at).toISOString() : null,
      failing: Number(row.failing ?? 0),
    }
  }
}
