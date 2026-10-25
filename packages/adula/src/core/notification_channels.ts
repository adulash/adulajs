import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import type { Knex } from 'knex'
import { AdulaError } from '../admin/errors.js'
import { logActivity } from './activity.js'
import {
  IN_APP_CHANNEL,
  MAIL_CHANNEL,
  deliverNotificationMail,
  type MailSender,
} from './message_templates.js'
import { signWebhook, type HttpPoster, type SecretBox } from '../integrations/webhooks.js'
import {
  createOutboundPoster,
  outboundErrorCategory,
  resolveOutboundTarget,
  type OutboundOptions,
} from '../integrations/outbound.js'
import type { NotificationTarget } from '../services/settings.js'

export { IN_APP_CHANNEL, MAIL_CHANNEL }

export type ChannelLabel = { ar: string; en?: string }
/** The notification as a channel sends it. */
export type ChannelMessage = {
  id: number
  subject: string
  text: string
  target: NotificationTarget | null
}
export type ChannelRecipient = {
  userId: number
  email: string
  name: string | null
  /** The address the user entered for the channel (a phone number); null for e-mail. */
  address: string | null
}
export type ChannelContext = {
  /** Stable across retries; receivers deduplicate on it. */
  deliveryId: string
  attempt: number
  signal: AbortSignal
}
/**
 * When a channel receives a notification:
 * - 'always': in-app, the notification row itself; it cannot be turned off.
 * - 'template': templates with external delivery (their mail flag), unless the user turned it off.
 * - 'opt-in': the same templates, once the user enables the channel with an address.
 */
export type ChannelDelivery = 'always' | 'template' | 'opt-in'

export interface NotificationChannel {
  key: string
  label: ChannelLabel
  delivery: ChannelDelivery
  /** Normalizes the per-user address of an opt-in channel; throws AdulaError when invalid. */
  address?(value: unknown): string
  /**
   * Sends one message. Throw ChannelDeliveryError to name the failure category; other
   * errors are categorized by outboundErrorCategory. Messages are never stored.
   */
  deliver(
    message: ChannelMessage,
    recipient: ChannelRecipient,
    context: ChannelContext
  ): Promise<void>
  /**
   * How the channel claims pending work. Without it, the dispatcher claims the channel's
   * notification_deliveries rows (SKIP LOCKED and leased), calls deliver and retries
   * failures with backoff. A channel with its own queue drains it here instead
   * (e-mail: notifications.mail_state through deliverNotificationMail).
   */
  drain?(db: Knex, limit: number): Promise<{ sent: number; failed: number }>
}

export type ChannelPreference = {
  key: string
  label: ChannelLabel
  delivery: ChannelDelivery
  enabled: boolean
  address: string | null
  /** In-app notifications cannot be turned off. */
  locked: boolean
}
export type ChannelPreferenceInput = { key: unknown; enabled: unknown; address?: unknown }
export type ChannelDispatchResult = { sent: number; failed: number; skipped: number }

/** A failed delivery with the category stored for it (for example `http-status:503`). */
export class ChannelDeliveryError extends Error {
  constructor(public category: string) {
    super(`Notification channel delivery failed: ${category}`)
  }
}

const CHANNEL_KEY = /^[a-z][a-z0-9_]{1,39}$/
const BACKOFF_MINUTES = [1, 5, 30, 120]
/** Upper bound of one provider call; leases cover every call of a claimed batch. */
const CALL_TIMEOUT_SECONDS = 15
const LEASE_MARGIN_SECONDS = 60
const CODE_MINUTES = 10
const CODE_ATTEMPTS = 5
const CODE_WAIT_SECONDS = 60
const CODE_WINDOW_HOURS = 24
const CODE_DAILY_LIMIT = 5
/** Pending deliveries older than this are dropped rather than sent late. */
const DELIVERY_MAX_AGE_HOURS = 24
/** Spent confirmation rows (and their numbers) are kept this long after expiry. */
const CONFIRMATION_RETENTION_DAYS = 1

function codeHash(salt: string, code: string) {
  return createHash('sha256').update(`${salt}:${code}`).digest('hex')
}
export const CHANNEL_MAX_ATTEMPTS = BACKOFF_MINUTES.length + 1

/** The in-app channel: the notifications row itself, listed and read in the bell. */
export function inAppChannel(): NotificationChannel {
  return {
    key: IN_APP_CHANNEL,
    label: { ar: 'داخل التطبيق', en: 'In-app' },
    delivery: 'always',
    deliver: async () => {},
    drain: async () => ({ sent: 0, failed: 0 }),
  }
}

/** The e-mail channel over the existing notifications.mail_state queue. */
export function mailChannel(send: MailSender): NotificationChannel {
  return {
    key: MAIL_CHANNEL,
    label: { ar: 'البريد الإلكتروني', en: 'E-mail' },
    delivery: 'template',
    deliver: (message, recipient) =>
      send({
        to: recipient.email,
        name: recipient.name,
        subject: message.subject,
        text: message.text,
        target: message.target,
      }),
    drain: (db, limit) => deliverNotificationMail(db, send, limit),
  }
}

/** An international phone number: an optional + and 8–15 digits; spaces and dashes are dropped. */
export function phoneAddress(value: unknown) {
  const text = typeof value === 'string' ? value.replace(/[\s\-().]/g, '') : ''
  if (!/^\+?[1-9][0-9]{7,14}$/.test(text))
    throw new AdulaError(
      422,
      'E_CHANNEL_ADDRESS',
      'رقم الهاتف غير صالح؛ اكتبه بالصيغة الدولية مثل +966500000000'
    )
  return text.startsWith('+') ? text : `+${text}`
}

export type HttpChannelOptions = {
  key: string
  label?: ChannelLabel
  url: string
  /** The signing secret; null when it cannot be opened (deliveries fail with `secret`). */
  secret: string | null
  /** The guarded outbound client; defaults to createOutboundPoster() (public HTTPS only). */
  post?: HttpPoster
  /** An absolute link to the notification's record, when it has one. */
  link?: (target: NotificationTarget) => string | null
  timeoutMs?: number
}

/**
 * A pluggable HTTP provider channel (SMS, WhatsApp or any gateway): POSTs a JSON body
 * `{ id, channel, to, subject, text, link?, timestamp }` signed like webhooks
 * (X-Adula-Signature: sha256=hex HMAC-SHA256 over `${timestamp}.${body}`). A 2xx answer
 * is sent; anything else is retried. Response bodies are never read.
 */
export function httpNotificationChannel(options: HttpChannelOptions): NotificationChannel {
  if (!CHANNEL_KEY.test(options.key) || [IN_APP_CHANNEL, MAIL_CHANNEL].includes(options.key))
    throw new Error(`Invalid notification channel key: ${options.key}`)
  const post = options.post ?? createOutboundPoster()
  return {
    key: options.key,
    label: options.label ?? CHANNEL_KIND_LABELS[options.key] ?? { ar: options.key },
    delivery: 'opt-in',
    address: phoneAddress,
    async deliver(message, recipient, context) {
      if (!options.secret) throw new ChannelDeliveryError('secret')
      if (!recipient.address) throw new ChannelDeliveryError('address')
      const timestamp = String(Math.floor(Date.now() / 1000))
      const link = message.target && options.link ? options.link(message.target) : null
      const body = JSON.stringify({
        id: context.deliveryId,
        channel: options.key,
        to: recipient.address,
        subject: message.subject,
        text: message.text,
        ...(link ? { link } : {}),
        timestamp,
      })
      const response = await post(options.url, {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'adula-notifications',
          'X-Adula-Channel': options.key,
          'X-Adula-Delivery': context.deliveryId,
          'X-Adula-Timestamp': timestamp,
          'X-Adula-Signature': `sha256=${signWebhook(options.secret, timestamp, body)}`,
        },
        body,
        signal: AbortSignal.any([context.signal, AbortSignal.timeout(options.timeoutMs ?? 10000)]),
      })
      if (response.status < 200 || response.status >= 300)
        throw new ChannelDeliveryError(`http-status:${response.status}`)
    },
  }
}

/**
 * The channel registry and dispatcher. The worker calls deliver() on every tick; the
 * profile screen reads and writes the signed-in user's preferences through it.
 * In-app is always registered.
 */
export class NotificationChannels {
  private channels = new Map<string, NotificationChannel>()
  private retired: Set<string>

  constructor(
    private db: Knex,
    channels: NotificationChannel[] = [],
    /**
     * `retired`: channel keys a successful configuration read proved are off (the
     * provider is disabled or set to another kind). Their pending deliveries are skipped;
     * pending rows of any other unregistered channel wait, so a failed read drops nothing.
     */
    options: { retired?: string[] } = {}
  ) {
    this.retired = new Set(options.retired ?? [])
    for (const channel of [inAppChannel(), ...channels]) {
      if (this.channels.has(channel.key) && channel.key !== IN_APP_CHANNEL)
        throw new Error(`Notification channel registered twice: ${channel.key}`)
      this.channels.set(channel.key, channel)
    }
    for (const key of this.channels.keys()) this.retired.delete(key)
  }

  list() {
    return [...this.channels.values()].map(({ key, label, delivery }) => ({ key, label, delivery }))
  }

  get(key: string) {
    return this.channels.get(key)
  }

  /** The user's choice per registered channel; absent rows are the defaults. */
  async preferences(userId: number, db: Knex = this.db): Promise<ChannelPreference[]> {
    const rows = await db('user_notification_channels').where('user_id', userId)
    const stored = new Map(rows.map((row) => [String(row.channel), row]))
    return [...this.channels.values()].map((channel) => {
      const row = stored.get(channel.key)
      // An opt-in number counts only once confirmed by its one-time code.
      const address =
        row?.address && (channel.delivery !== 'opt-in' || row.confirmed_at)
          ? String(row.address)
          : null
      return {
        key: channel.key,
        label: channel.label,
        delivery: channel.delivery,
        enabled:
          channel.delivery === 'always'
            ? true
            : channel.delivery === 'template'
              ? row
                ? Boolean(row.enabled)
                : true
              : Boolean(row?.enabled) && Boolean(address),
        address,
        locked: channel.delivery === 'always',
      }
    })
  }

  /** Replaces the user's choices for the channels named in the input. */
  async update(userId: number, input: unknown): Promise<ChannelPreference[]> {
    if (!Array.isArray(input) || input.length > 20)
      throw new AdulaError(422, 'E_CHANNEL_INPUT', 'قائمة القنوات غير صالحة')
    const existing = await this.db('user_notification_channels').where('user_id', userId)
    // Only confirmed numbers count; a row written before confirmations existed has none.
    const stored = new Map(
      existing.map((row) => [
        String(row.channel),
        row.address && row.confirmed_at ? String(row.address) : null,
      ])
    )
    const confirmedAt = new Map(existing.map((row) => [String(row.channel), row.confirmed_at]))
    const values = (input as ChannelPreferenceInput[]).map((item) => {
      const key = typeof item?.key === 'string' ? item.key : ''
      const channel = this.channels.get(key)
      if (!channel) throw new AdulaError(422, 'E_CHANNEL_UNKNOWN', 'قناة الإشعار غير معروفة')
      if (typeof item.enabled !== 'boolean')
        throw new AdulaError(422, 'E_CHANNEL_INPUT', 'حدد تفعيل القناة أو إيقافها')
      if (channel.delivery === 'always') {
        if (!item.enabled)
          throw new AdulaError(422, 'E_CHANNEL_LOCKED', 'الإشعارات داخل التطبيق لا يمكن إيقافها')
        return null
      }
      // The stored number is always a confirmed one: an omitted (or equal) address keeps
      // it, an empty one removes it, and a different number needs confirmCode() first.
      let address: string | null = item.address === undefined ? (stored.get(key) ?? null) : null
      const raw = typeof item.address === 'string' ? item.address.trim() : ''
      if (channel.address && raw) {
        address = channel.address(raw)
        if (address !== stored.get(key))
          throw new AdulaError(422, 'E_CHANNEL_CONFIRM', 'أكّد الرقم الجديد برمز التحقق أولاً')
      }
      if (!channel.address) address = null
      if (channel.delivery === 'opt-in' && item.enabled && !address)
        throw new AdulaError(422, 'E_CHANNEL_ADDRESS', 'أدخل رقم الهاتف لتفعيل هذه القناة')
      return {
        user_id: userId,
        channel: key,
        enabled: item.enabled,
        address,
        confirmed_at: address ? (confirmedAt.get(key) ?? null) : null,
      }
    })
    const rows = values.filter((value) => value !== null)
    if (new Set(rows.map((row) => row.channel)).size !== rows.length)
      throw new AdulaError(422, 'E_CHANNEL_INPUT', 'كررت القناة نفسها أكثر من مرة')
    return this.db.transaction(async (trx) => {
      if (rows.length)
        await trx('user_notification_channels')
          .insert(rows.map((row) => ({ ...row, updated_at: trx.fn.now() })))
          .onConflict(['user_id', 'channel'])
          .merge(['enabled', 'address', 'confirmed_at', 'updated_at'])
      return this.preferences(userId, trx)
    })
  }

  /**
   * Sends a one-time code to `address` through the channel itself. The number is enabled
   * only by confirmCode(). One code per user and channel at a time, a new one after 60
   * seconds and at most five in 24 hours; the wait and the cap are enforced by the upsert
   * itself, so two parallel requests send one code.
   */
  async requestCode(userId: number, key: string, address: unknown) {
    const channel = this.optIn(key)
    const normalized = channel.address!(address)
    const user = await this.db('users').where('id', userId).first()
    if (!user) throw new AdulaError(404, 'E_NOT_FOUND', 'المستخدم غير موجود')
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
    const salt = randomBytes(16).toString('hex')
    const window = `interval '${CODE_WINDOW_HOURS} hours'`
    const result = await this.db.raw(
      `INSERT INTO notification_channel_confirmations AS c
         (user_id, channel, address, salt, code_hash, attempts, expires_at, created_at,
          sent_count, window_started_at)
       VALUES (?, ?, ?, ?, ?, 0, now() + interval '${CODE_MINUTES} minutes', now(), 1, now())
       ON CONFLICT (user_id, channel) DO UPDATE SET
         address = EXCLUDED.address, salt = EXCLUDED.salt, code_hash = EXCLUDED.code_hash,
         attempts = 0, expires_at = EXCLUDED.expires_at, created_at = now(),
         sent_count = CASE WHEN c.window_started_at <= now() - ${window} THEN 1
                           ELSE c.sent_count + 1 END,
         window_started_at = CASE WHEN c.window_started_at <= now() - ${window} THEN now()
                                  ELSE c.window_started_at END
       WHERE c.created_at <= now() - interval '${CODE_WAIT_SECONDS} seconds'
         AND (c.window_started_at <= now() - ${window} OR c.sent_count < ${CODE_DAILY_LIMIT})
       RETURNING id, expires_at`,
      [userId, key, normalized, salt, codeHash(salt, code)]
    )
    const [row] = result.rows
    if (!row) {
      const current = await this.db('notification_channel_confirmations')
        .where({ user_id: userId, channel: key })
        .whereRaw(`window_started_at > now() - ${window}`)
        .where('sent_count', '>=', CODE_DAILY_LIMIT)
        .first('id')
      if (current)
        throw new AdulaError(
          429,
          'E_CHANNEL_CODE_LIMIT',
          'بلغت الحد اليومي لرموز التحقق؛ حاول غداً'
        )
      throw new AdulaError(429, 'E_CHANNEL_CODE_WAIT', 'انتظر دقيقة قبل طلب رمز جديد')
    }
    try {
      await channel.deliver(
        {
          id: 0,
          subject: 'رمز التأكيد',
          text: `رمز تأكيد رقم هاتفك: ${code}. ينتهي خلال ${CODE_MINUTES} دقائق.`,
          target: null,
        },
        {
          userId,
          email: String(user.email ?? ''),
          name: user.full_name ? String(user.full_name) : null,
          address: normalized,
        },
        {
          deliveryId: randomUUID(),
          attempt: 1,
          signal: AbortSignal.timeout(CALL_TIMEOUT_SECONDS * 1000),
        }
      )
    } catch {
      // The code never arrived: void it and lift the wait, but it still counts for the day.
      await this.db('notification_channel_confirmations')
        .where('id', row.id)
        .update({
          attempts: CODE_ATTEMPTS,
          expires_at: this.db.fn.now(),
          created_at: this.db.raw(`now() - interval '${CODE_WAIT_SECONDS} seconds'`),
        })
      throw new AdulaError(502, 'E_CHANNEL_CODE_SEND', 'تعذر إرسال رمز التحقق؛ حاول بعد قليل')
    }
    return { expiresAt: new Date(row.expires_at).toISOString() }
  }

  /**
   * Checks the code (five attempts, ten minutes) and enables the channel with its number.
   * A used or exhausted code is voided, not deleted, so the wait and the daily cap remain.
   */
  async confirmCode(userId: number, key: string, code: unknown): Promise<ChannelPreference[]> {
    this.optIn(key)
    const text = typeof code === 'string' ? code.trim() : ''
    const confirmed = await this.db.transaction(async (trx) => {
      const row = await trx('notification_channel_confirmations')
        .where({ user_id: userId, channel: key })
        .where('expires_at', '>', trx.fn.now())
        .where('attempts', '<', CODE_ATTEMPTS)
        .forUpdate()
        .first()
      if (!row) return null
      const expected = Buffer.from(String(row.code_hash), 'hex')
      const actual = Buffer.from(codeHash(String(row.salt), text), 'hex')
      if (!/^\d{6}$/.test(text) || !timingSafeEqual(expected, actual)) {
        // The fifth wrong attempt voids the code (attempts reaches the limit).
        await trx('notification_channel_confirmations').where('id', row.id).increment('attempts', 1)
        return false
      }
      await trx('user_notification_channels')
        .insert({
          user_id: userId,
          channel: key,
          enabled: true,
          address: row.address,
          confirmed_at: trx.fn.now(),
          updated_at: trx.fn.now(),
        })
        .onConflict(['user_id', 'channel'])
        .merge(['enabled', 'address', 'confirmed_at', 'updated_at'])
      await trx('notification_channel_confirmations')
        .where('id', row.id)
        .update({ attempts: CODE_ATTEMPTS, expires_at: trx.fn.now() })
      return true
    })
    if (confirmed === null)
      throw new AdulaError(422, 'E_CHANNEL_CODE', 'رمز التحقق منتهٍ أو مستنفد؛ اطلب رمزاً جديداً')
    if (!confirmed) throw new AdulaError(422, 'E_CHANNEL_CODE', 'رمز التحقق غير صحيح')
    return this.preferences(userId)
  }

  /** Deletes spent confirmation rows a day after they expired, with their numbers. */
  async cleanupConfirmations() {
    return this.db('notification_channel_confirmations')
      .whereRaw(`expires_at < now() - interval '${CONFIRMATION_RETENTION_DAYS} days'`)
      .delete()
  }

  private optIn(key: string) {
    const channel = this.channels.get(key)
    if (!channel || channel.delivery !== 'opt-in' || !channel.address)
      throw new AdulaError(409, 'E_CHANNEL_UNAVAILABLE', 'هذه القناة غير متاحة الآن')
    return channel
  }

  /**
   * Delivers pending work on every registered channel. Pending rows of a retired channel
   * (its provider was turned off) are skipped, never sent later; rows of a channel that is
   * merely unregistered on this tick stay pending.
   * `limit` bounds the claimed notification_deliveries rows, `drainLimit` each own queue
   * (the e-mail worker sends up to 50 per tick, as before).
   */
  async deliver(limit = 20, drainLimit = 50): Promise<ChannelDispatchResult> {
    const result = { sent: 0, failed: 0, skipped: 0 }
    const queued: NotificationChannel[] = []
    for (const channel of this.channels.values()) {
      if (!channel.drain) {
        queued.push(channel)
        continue
      }
      const drained = await channel.drain(this.db, drainLimit)
      result.sent += drained.sent
      result.failed += drained.failed
    }
    const keys = queued.map((channel) => channel.key)
    // A message that waited a day (an outage, an unregistered channel) is stale: drop it.
    result.skipped += await this.db('notification_deliveries')
      .where('state', 'pending')
      .whereRaw(`created_at < now() - interval '${DELIVERY_MAX_AGE_HOURS} hours'`)
      .update({ state: 'skipped', error_category: 'expired' })
    await this.cleanupConfirmations()
    if (this.retired.size)
      result.skipped += await this.db('notification_deliveries')
        .where('state', 'pending')
        .whereIn('channel', [...this.retired])
        .update({ state: 'skipped', error_category: 'channel-unavailable' })
    if (!keys.length) return result
    const lease = randomUUID()
    const claimed = await this.db.transaction(async (trx) => {
      const rows = await trx('notification_deliveries as d')
        .join('notifications as n', 'n.id', 'd.notification_id')
        .join('users as u', 'u.id', 'n.user_id')
        .leftJoin('user_notification_channels as p', (join) =>
          join.on('p.user_id', 'n.user_id').andOn('p.channel', 'd.channel')
        )
        .where('d.state', 'pending')
        .whereIn('d.channel', keys)
        .where('d.next_attempt_at', '<=', trx.fn.now())
        .orderBy('d.next_attempt_at')
        .limit(limit)
        .forUpdate('d')
        .skipLocked()
        .select(
          'd.id',
          'd.channel',
          'd.attempts',
          'n.id as notification_id',
          'n.user_id',
          'n.title',
          'n.body',
          'n.resource',
          'n.record_id',
          'u.email',
          'u.full_name',
          'u.disabled_at',
          'p.enabled',
          'p.address',
          'p.confirmed_at'
        )
      // Lease the rows long enough for every call in this batch; the lease id makes each
      // later write conditional, so a worker whose lease was taken over writes nothing.
      if (rows.length)
        await trx('notification_deliveries')
          .whereIn(
            'id',
            rows.map((row) => row.id)
          )
          .update({
            lease_id: lease,
            next_attempt_at: trx.raw('now() + make_interval(secs => ?)', [
              rows.length * CALL_TIMEOUT_SECONDS + LEASE_MARGIN_SECONDS,
            ]),
          })
      return rows
    })
    const held = () =>
      this.db('notification_deliveries').where({ state: 'pending', lease_id: lease })
    for (const row of claimed) {
      const channel = this.channels.get(String(row.channel))!
      // Renew this row's lease right before the call; if another worker took it over
      // (the lease expired), leave the row to that worker and do not send it again.
      const renewed = await held()
        .where('id', row.id)
        .update({
          next_attempt_at: this.db.raw('now() + make_interval(secs => ?)', [
            CALL_TIMEOUT_SECONDS + LEASE_MARGIN_SECONDS,
          ]),
        })
      if (!renewed) continue
      // The user may have turned the channel off, or been disabled, since it was queued;
      // an unconfirmed number never receives messages.
      if (row.disabled_at || !row.enabled || !row.address || !row.confirmed_at) {
        await held()
          .where('id', row.id)
          .update({ state: 'skipped', error_category: row.disabled_at ? 'user-disabled' : null })
        result.skipped++
        continue
      }
      const attempts = Number(row.attempts) + 1
      try {
        await channel.deliver(
          {
            id: Number(row.notification_id),
            subject: String(row.title),
            text: String(row.body),
            target:
              row.resource && row.record_id !== null
                ? { resource: String(row.resource), recordId: Number(row.record_id) }
                : null,
          },
          {
            userId: Number(row.user_id),
            email: String(row.email),
            name: row.full_name ? String(row.full_name) : null,
            address: String(row.address),
          },
          {
            deliveryId: String(row.id),
            attempt: attempts,
            signal: AbortSignal.timeout(CALL_TIMEOUT_SECONDS * 1000),
          }
        )
        const written = await held().where('id', row.id).update({
          state: 'sent',
          attempts,
          error_category: null,
          sent_at: this.db.fn.now(),
        })
        if (written) result.sent++
      } catch (error) {
        // Store a category only; raw messages may echo provider hosts or bodies.
        const category =
          error instanceof ChannelDeliveryError ? error.category : outboundErrorCategory(error)
        const exhausted = attempts >= CHANNEL_MAX_ATTEMPTS
        const written = await held()
          .where('id', row.id)
          .update({
            state: exhausted ? 'failed' : 'pending',
            attempts,
            error_category: category.slice(0, 40),
            next_attempt_at: exhausted
              ? this.db.fn.now()
              : this.db.raw(`now() + interval '${BACKOFF_MINUTES[attempts - 1]} minutes'`),
          })
        if (written) result.failed++
      }
    }
    return result
  }
}

export const HTTP_CHANNEL_SETTING_KEY = 'channels.http'
export const HTTP_CHANNEL_KINDS = ['sms', 'whatsapp'] as const
export type HttpChannelKind = (typeof HTTP_CHANNEL_KINDS)[number]
export const CHANNEL_KIND_LABELS: Record<string, ChannelLabel> = {
  sms: { ar: 'رسالة نصية', en: 'SMS' },
  whatsapp: { ar: 'واتساب', en: 'WhatsApp' },
}
/** The provider configuration as the settings screen shows it; the secret never leaves. */
export type HttpChannelConfig = {
  enabled: boolean
  kind: HttpChannelKind
  url: string
  hasSecret: boolean
  updatedAt: string | null
}
export type HttpChannelInput = { enabled: unknown; kind: unknown; url: unknown }

const RESOURCE = 'core.settings'

/**
 * The administrator-configured HTTP provider channel, stored in the system setting
 * `channels.http` as `{ enabled, kind, url, secret, updatedAt }` with the signing secret
 * sealed like webhook secrets. The secret is generated on first save and on rotation,
 * returned once and never again; the settings screen lists the key without it.
 */
export class HttpChannelSettings {
  constructor(
    private db: Knex,
    private secrets: SecretBox,
    private options: OutboundOptions = {}
  ) {}

  async read(): Promise<HttpChannelConfig | null> {
    return this.present(await this.stored())
  }

  private present(value: Record<string, any> | null): HttpChannelConfig | null {
    if (!value) return null
    return {
      enabled: value.enabled === true,
      kind: HTTP_CHANNEL_KINDS.includes(value.kind) ? value.kind : 'sms',
      url: String(value.url ?? ''),
      hasSecret: typeof value.secret === 'string' && value.secret.length > 0,
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null,
    }
  }

  /** Saves the provider; returns the new secret when one was generated (first save or rotate). */
  async save(
    actorId: number,
    input: HttpChannelInput,
    options: { rotate?: boolean } = {}
  ): Promise<{ config: HttpChannelConfig; secret: string | null }> {
    if (!HTTP_CHANNEL_KINDS.includes(input.kind as HttpChannelKind))
      throw new AdulaError(422, 'E_CHANNEL_KIND', 'اختر نوع القناة: رسالة نصية أو واتساب')
    if (typeof input.enabled !== 'boolean')
      throw new AdulaError(422, 'E_CHANNEL_INPUT', 'حدد تفعيل القناة أو إيقافها')
    const url = typeof input.url === 'string' ? input.url.trim() : ''
    await this.assertTarget(url)
    const previous = await this.stored()
    const generate = options.rotate === true || typeof previous?.secret !== 'string'
    const secret = generate ? randomBytes(32).toString('base64url') : null
    const value = {
      enabled: input.enabled,
      kind: input.kind as HttpChannelKind,
      url,
      secret: secret ? this.secrets.seal(secret) : String(previous!.secret),
      updatedAt: new Date().toISOString(),
    }
    await this.db.transaction(async (trx) => {
      const [row] = await trx('settings')
        .insert({
          key: HTTP_CHANNEL_SETTING_KEY,
          scope: 'system',
          scope_id: '0',
          value: JSON.stringify(value),
        })
        .onConflict(['key', 'scope', 'scope_id'])
        .merge(['value'])
        .returning('id')
      await logActivity(trx, {
        resource: RESOURCE,
        recordId: row.id,
        actorId,
        action: 'upsert',
        changes: {
          key: HTTP_CHANNEL_SETTING_KEY,
          scope: 'system',
          scopeId: '0',
          value: { enabled: value.enabled, kind: value.kind, url, secretRotated: generate },
        },
      })
    })
    return { config: (await this.read())!, secret }
  }

  /** Replaces the signing secret and returns the new one once. */
  async rotate(actorId: number) {
    const current = await this.read()
    if (!current) throw new AdulaError(404, 'E_CHANNEL_NOT_CONFIGURED', 'لم تُضبط قناة الرسائل بعد')
    return this.save(actorId, current, { rotate: true })
  }

  /** The configured channel while it is enabled; null otherwise. */
  async channel(
    options: { post?: HttpPoster; link?: HttpChannelOptions['link']; force?: boolean } = {}
  ): Promise<NotificationChannel | null> {
    return this.build(await this.stored(), options)
  }

  /**
   * One read for the worker: the active channel (or null) and the HTTP channel kinds this
   * read proves are off (no provider or disabled: every kind; enabled: the other kinds).
   * Pass `retired` to NotificationChannels only after this call succeeded.
   */
  async resolve(
    options: { post?: HttpPoster; link?: HttpChannelOptions['link'] } = {}
  ): Promise<{ channel: NotificationChannel | null; retired: string[] }> {
    const value = await this.stored()
    const channel = this.build(value, options)
    return {
      channel,
      retired: HTTP_CHANNEL_KINDS.filter((kind) => kind !== channel?.key),
    }
  }

  private build(
    value: Record<string, any> | null,
    options: { post?: HttpPoster; link?: HttpChannelOptions['link']; force?: boolean }
  ): NotificationChannel | null {
    const config = this.present(value)
    if (!value || !config || !config.url || (!config.enabled && !options.force)) return null
    let secret: string | null = null
    try {
      secret = typeof value.secret === 'string' ? this.secrets.open(value.secret) : null
    } catch {
      secret = null
    }
    return httpNotificationChannel({
      key: config.kind,
      url: config.url,
      secret,
      post: options.post ?? createOutboundPoster(this.options),
      link: options.link,
    })
  }

  /**
   * Sends one test message to `to` through the configured provider (enabled or not) and
   * returns the failure category, or null when the provider accepted it.
   */
  async test(to: unknown, options: { post?: HttpPoster } = {}): Promise<string | null> {
    const channel = await this.channel({ ...options, force: true })
    if (!channel) throw new AdulaError(404, 'E_CHANNEL_NOT_CONFIGURED', 'لم تُضبط قناة الرسائل بعد')
    const address = phoneAddress(to)
    try {
      await channel.deliver(
        { id: 0, subject: 'رسالة تجريبية', text: 'رسالة تجريبية من إعدادات النظام.', target: null },
        { userId: 0, email: '', name: null, address },
        { deliveryId: randomUUID(), attempt: 1, signal: AbortSignal.timeout(15000) }
      )
      return null
    } catch (error) {
      return error instanceof ChannelDeliveryError ? error.category : outboundErrorCategory(error)
    }
  }

  private async stored(): Promise<Record<string, any> | null> {
    const row = await this.db('settings')
      .where({ key: HTTP_CHANNEL_SETTING_KEY, scope: 'system', scope_id: '0' })
      .first('value')
    return row?.value && typeof row.value === 'object' ? row.value : null
  }

  /** HTTPS only, and no host resolving to a private address unless the policy allows it. */
  private async assertTarget(value: string) {
    let url: URL
    try {
      url = new URL(value)
    } catch {
      throw new AdulaError(422, 'E_CHANNEL_URL', 'عنوان URL غير صالح')
    }
    const allowPrivate = this.options.allowPrivateTargets === true
    if (url.protocol !== 'https:' && !(allowPrivate && url.protocol === 'http:'))
      throw new AdulaError(422, 'E_CHANNEL_URL', 'يجب أن يبدأ العنوان بـ https://')
    if (url.username || url.password || value.length > 2000)
      throw new AdulaError(422, 'E_CHANNEL_URL', 'عنوان URL غير مسموح')
    // The URL is shown and logged; credentials belong in the signing secret, not the URL.
    if (url.search || url.hash || value.includes('?') || value.includes('#'))
      throw new AdulaError(
        422,
        'E_CHANNEL_URL',
        'لا يُقبل عنوان يحوي معاملات استعلام أو جزءاً بعد #؛ المزوّد يتحقق بسر التوقيع'
      )
    if (allowPrivate) return
    try {
      await resolveOutboundTarget(url, this.options)
    } catch {
      throw new AdulaError(422, 'E_CHANNEL_URL', 'لا يُسمح بعناوين الشبكة الداخلية')
    }
  }
}
