import { isIP } from 'node:net'
import type { Knex } from 'knex'
import type { Actor } from '../auth/ability.js'
import type { SecretBox } from '../integrations/webhooks.js'
import {
  resolveOutboundTarget,
  type OutboundOptions,
  type OutboundTarget,
} from '../integrations/outbound.js'
import { AdulaError } from '../admin/errors.js'
import { logActivity } from './activity.js'

export const MAIL_SETTINGS_KEY = 'mail.smtp'
const RESOURCE = 'core.mail'

/** How the SMTP connection is protected: implicit TLS, STARTTLS upgrade, or none. */
export type MailSecurity = 'tls' | 'starttls' | 'none'
const SECURITIES: MailSecurity[] = ['tls', 'starttls', 'none']

/** The stored SMTP configuration as the administration shows it; the password never leaves. */
export type MailSettingsView = {
  configured: boolean
  preset: string
  host: string
  port: number
  security: MailSecurity
  username: string
  hasPassword: boolean
  fromName: string
  fromAddress: string
  updatedAt: string | null
}
export type MailSettingsInput = Partial<
  Pick<
    MailSettingsView,
    'preset' | 'host' | 'port' | 'security' | 'username' | 'fromName' | 'fromAddress'
  >
>

/** What the sending process needs: the options and the opened password, server side only. */
export type MailRuntime = {
  host: string
  port: number
  security: MailSecurity
  username: string
  password: string | null
  fromName: string
  fromAddress: string
}

type Stored = Record<string, unknown>
type Who = Pick<Actor, 'id' | 'impersonatorId'>

const FIELDS = [
  'preset',
  'host',
  'port',
  'security',
  'username',
  'fromName',
  'fromAddress',
] as const
// Control characters, including CR and LF, would let a value add mail or SMTP headers.
const CONTROL = {
  test: (value: string) =>
    [...value].some((char) => {
      const code = char.codePointAt(0)!
      return code < 0x20 || code === 0x7f
    }),
}
const HOSTNAME =
  /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/
const ADDRESS =
  /^[^\s@<>()",;:\\[\]]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?\.[A-Za-z]{2,}$/

const invalid = (code: string, message: string) => new AdulaError(422, code, message)

/**
 * SMTP settings kept in the system setting `mail.smtp` (ADR 020 amendment), so an administrator
 * configures mail from the interface without editing the environment or restarting. The password
 * is sealed like the assistant key, is never returned, and is cleared whenever the server
 * changes, so a stored password cannot be sent to another host. The host must resolve outside
 * private networks unless the outbound policy allows them.
 */
export class MailSettings {
  constructor(
    private db: Knex,
    private secrets: SecretBox,
    private options: OutboundOptions = {}
  ) {}

  async read(): Promise<MailSettingsView> {
    return this.present(await this.stored())
  }

  /** The stored options with the opened password, or null while nothing is stored. */
  async runtime(): Promise<MailRuntime | null> {
    const value = await this.stored()
    const view = this.present(value)
    if (!view.configured) return null
    let password: string | null = null
    try {
      password = typeof value?.secret === 'string' ? this.secrets.open(value.secret) : null
    } catch {
      password = null
    }
    return {
      host: view.host,
      port: view.port,
      security: view.security,
      username: view.username,
      password: password || null,
      fromName: view.fromName,
      fromAddress: view.fromAddress,
    }
  }

  /** The address a connection to `host` must use; refuses private targets per the policy. */
  async target(host: string): Promise<OutboundTarget> {
    return resolveOutboundTarget(
      new URL(`smtp://${isIP(host) === 6 ? `[${host}]` : host}`),
      this.options
    )
  }

  private present(value: Stored | null): MailSettingsView {
    const v = value ?? {}
    const host = typeof v.host === 'string' ? v.host : ''
    const security = SECURITIES.includes(v.security as MailSecurity)
      ? (v.security as MailSecurity)
      : 'tls'
    return {
      configured: host.length > 0,
      preset: typeof v.preset === 'string' ? v.preset : 'custom',
      host,
      port: Number.isSafeInteger(v.port) ? (v.port as number) : 465,
      security,
      username: typeof v.username === 'string' ? v.username : '',
      hasPassword: typeof v.secret === 'string' && v.secret.length > 0,
      fromName: typeof v.fromName === 'string' ? v.fromName : '',
      fromAddress: typeof v.fromAddress === 'string' ? v.fromAddress : '',
      updatedAt: typeof v.updatedAt === 'string' ? v.updatedAt : null,
    }
  }

  /** Saves everything except the password. Changing the server clears the stored password. */
  async save(actor: Who, input: unknown): Promise<MailSettingsView> {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw invalid('E_MAIL_SETTINGS_INPUT', 'بيانات إعداد البريد غير صالحة')
    const data = input as Record<string, unknown>
    if (Object.keys(data).some((key) => !(FIELDS as readonly string[]).includes(key)))
      throw invalid('E_MAIL_SETTINGS_INPUT', 'حقل غير معروف في إعداد البريد')
    // AdonisJS turns an emptied field into null.
    const text = (key: string) => (data[key] === null ? '' : data[key])
    const previous = (await this.stored()) ?? {}
    const current = this.present(previous)
    const next: Stored = { ...current }
    const changed: string[] = []
    const assign = (key: (typeof FIELDS)[number], value: unknown) => {
      if (value !== current[key]) changed.push(key)
      next[key] = value
    }

    if (data.preset !== undefined) {
      const preset = text('preset')
      if (typeof preset !== 'string' || !/^[a-z0-9_-]{1,32}$/.test(preset))
        throw invalid('E_MAIL_SETTINGS_INPUT', 'مزود البريد غير صالح')
      assign('preset', preset)
    }
    if (data.host !== undefined) {
      const host =
        typeof text('host') === 'string' ? (text('host') as string).trim().toLowerCase() : null
      if (host === null || !(HOSTNAME.test(host) || isIP(host)))
        throw invalid(
          'E_MAIL_HOST',
          'اكتب اسم خادم SMTP وحده، مثل smtp.gmail.com، دون بادئة أو منفذ أو مسار.'
        )
      await this.assertTarget(host)
      assign('host', host)
    }
    if (data.port !== undefined) {
      const port = Number(data.port)
      if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
        throw invalid('E_MAIL_PORT', 'المنفذ رقم بين 1 و65535')
      assign('port', port)
    }
    if (data.security !== undefined) {
      if (!SECURITIES.includes(data.security as MailSecurity))
        throw invalid('E_MAIL_SECURITY', 'اختر نوع الأمان: TLS أو STARTTLS أو بلا تشفير')
      assign('security', data.security)
    }
    if (data.username !== undefined) {
      const username = text('username')
      if (typeof username !== 'string' || username.length > 254 || CONTROL.test(username))
        throw invalid('E_MAIL_USERNAME', 'اسم المستخدم نص في سطر واحد لا يتجاوز 254 حرفًا')
      assign('username', username.trim())
    }
    if (data.fromName !== undefined) {
      const name = text('fromName')
      if (typeof name !== 'string' || name.length > 100 || CONTROL.test(name) || /[<>"]/.test(name))
        throw invalid(
          'E_MAIL_FROM_NAME',
          'اسم المرسل نص في سطر واحد لا يتجاوز 100 حرف، دون الرموز < > "'
        )
      assign('fromName', name.trim())
    }
    if (data.fromAddress !== undefined) {
      const address = text('fromAddress')
      if (typeof address !== 'string' || CONTROL.test(address) || !ADDRESS.test(address.trim()))
        throw invalid(
          'E_MAIL_FROM_ADDRESS',
          'اكتب عنوان مرسل واحدًا صحيحًا، مثل no-reply@example.com'
        )
      assign('fromAddress', address.trim())
    }
    if (!next.host) throw invalid('E_MAIL_HOST', 'اكتب اسم خادم SMTP')
    if (!next.fromAddress) throw invalid('E_MAIL_FROM_ADDRESS', 'اكتب عنوان المرسل')

    const passwordCleared = next.host !== current.host && current.hasPassword
    delete next.hasPassword
    delete next.configured
    next.updatedAt = new Date().toISOString()
    if (!passwordCleared && typeof previous.secret === 'string') next.secret = previous.secret
    await this.write(actor, next, 'settings.update', { changed, passwordCleared })
    return this.read()
  }

  /** Stores the SMTP password sealed; it is never returned. */
  async setPassword(actor: Who, value: unknown): Promise<MailSettingsView> {
    const password = typeof value === 'string' ? value : ''
    if (!password.length || password.length > 500 || /[\r\n]/.test(password))
      throw invalid('E_MAIL_PASSWORD', 'كلمة المرور مطلوبة، في سطر واحد لا يتجاوز 500 حرف')
    const previous = (await this.stored()) ?? {}
    if (!this.present(previous).configured)
      throw invalid('E_MAIL_HOST', 'احفظ خادم SMTP أولًا، ثم كلمة المرور')
    await this.write(
      actor,
      { ...previous, secret: this.secrets.seal(password), updatedAt: new Date().toISOString() },
      'password.set',
      { passwordChanged: true }
    )
    return this.read()
  }

  async clearPassword(actor: Who): Promise<MailSettingsView> {
    const previous = (await this.stored()) ?? {}
    const next: Stored = { ...previous, updatedAt: new Date().toISOString() }
    delete next.secret
    await this.write(actor, next, 'password.clear', { passwordChanged: true })
    return this.read()
  }

  private async write(actor: Who, value: Stored, action: string, changes: Record<string, unknown>) {
    await this.db.transaction(async (trx) => {
      const [row] = await trx('settings')
        .insert({
          key: MAIL_SETTINGS_KEY,
          scope: 'system',
          scope_id: '0',
          value: JSON.stringify(value),
        })
        .onConflict(['key', 'scope', 'scope_id'])
        .merge(['value'])
        .returning('id')
      // Never a value: which fields changed, and whether the password changed or was cleared.
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
      .where({ key: MAIL_SETTINGS_KEY, scope: 'system', scope_id: '0' })
      .first('value')
    return row?.value && typeof row.value === 'object' ? (row.value as Stored) : null
  }

  private async assertTarget(host: string) {
    try {
      await this.target(host)
    } catch (error) {
      if ((error as { category?: string }).category === 'dns')
        throw invalid('E_MAIL_HOST', 'تعذر العثور على خادم SMTP بهذا الاسم')
      throw invalid('E_MAIL_HOST', 'لا يُسمح بعناوين الشبكة الداخلية لخادم البريد')
    }
  }
}
