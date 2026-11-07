import mail from '@adonisjs/mail/services/main'
import { SMTPTransport } from '@adonisjs/mail/transports/smtp'
import type { MailTransportContract, NodeMailerMessage } from '@adonisjs/mail/types'
import env from '#start/env'
import { adula } from '#services/adula'
import { smtpOptions, type MailValues } from '#services/mail_setup'

type SmtpOptions = ConstructorParameters<typeof SMTPTransport>[0]

/** The mail variables the running process has; the fallback when nothing is stored. */
export const environmentMail = (): MailValues => ({
  SMTP_HOST: env.get('SMTP_HOST'),
  SMTP_PORT: env.get('SMTP_PORT'),
  SMTP_SECURE: env.get('SMTP_SECURE'),
  SMTP_REQUIRE_TLS: env.get('SMTP_REQUIRE_TLS'),
  SMTP_USERNAME: env.get('SMTP_USERNAME'),
  SMTP_PASSWORD: env.get('SMTP_PASSWORD'),
  MAIL_FROM_NAME: env.get('MAIL_FROM_NAME'),
  MAIL_FROM_ADDRESS: env.get('MAIL_FROM_ADDRESS'),
  NODE_ENV: env.get('NODE_ENV'),
})

/** Whether the administration's stored settings may apply (MAIL_SETTINGS_SOURCE override). */
export const storedSettingsApply = () => env.get('MAIL_SETTINGS_SOURCE') !== 'environment'

export type EffectiveMail = {
  source: 'settings' | 'environment'
  options: SmtpOptions
  from: { name: string; address: string } | null
}

/**
 * The SMTP connection to use now: the settings saved in the administration, read at send time
 * so a change applies without a restart (web and worker alike), otherwise the SMTP_* variables.
 * A stored host is resolved again and the connection is pinned to an address the outbound
 * policy allows, with the certificate still checked against the host name.
 */
export async function effectiveMail(): Promise<EffectiveMail> {
  const stored = storedSettingsApply() ? await adula().mailSettings.runtime() : null
  if (!stored) return { source: 'environment', options: smtpOptions(environmentMail()), from: null }
  const target = await adula().mailSettings.target(stored.host, stored.security)
  return {
    source: 'settings',
    options: {
      host: target.address,
      port: stored.port,
      secure: stored.security === 'tls',
      requireTLS: stored.security === 'starttls',
      ignoreTLS: stored.security === 'none',
      tls: { servername: stored.host },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
      ...(stored.username && stored.password
        ? { auth: { type: 'login' as const, user: stored.username, pass: stored.password } }
        : {}),
    },
    from: { name: stored.fromName, address: stored.fromAddress },
  }
}

function addressOf(from: NodeMailerMessage['from'] | string | undefined) {
  if (!from) return null
  return typeof from === 'string' ? from.replace(/^.*<([^>]+)>$/, '$1') : from.address
}
/** The address config/mail.ts puts on messages that name no sender. */
const defaultFrom = () => addressOf(mail.config.from)

/**
 * The `smtp` mailer: resolves the effective configuration for every message, keeps one SMTP
 * transport per configuration, and replaces the default sender with the stored one.
 */
export class SettingsSmtpTransport implements MailTransportContract {
  #current: { key: string; transport: SMTPTransport } | null = null

  async send(message: NodeMailerMessage) {
    const effective = await effectiveMail()
    const key = JSON.stringify(effective.options)
    if (this.#current?.key !== key) {
      await this.#current?.transport.close()
      this.#current = { key, transport: new SMTPTransport(effective.options) }
    }
    if (effective.from && addressOf(message.from) === defaultFrom())
      message.from = effective.from.name
        ? { name: effective.from.name, address: effective.from.address }
        : effective.from.address
    return this.#current.transport.send(message)
  }

  async close() {
    await this.#current?.transport.close()
    this.#current = null
  }
}
