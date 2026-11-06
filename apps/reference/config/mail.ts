import env from '#start/env'
import { defineConfig } from '@adonisjs/mail'
import type { MailTransportContract, NodeMailerMessage } from '@adonisjs/mail/types'

/**
 * SMTP only: no external mail service. The `smtp` mailer reads the settings saved in the
 * administration at send time and falls back to the SMTP_* variables (ADR 020 amendment).
 * It loads lazily, because services are not ready while the configuration is read.
 */
class Smtp implements MailTransportContract {
  #inner?: Promise<MailTransportContract>

  #transport() {
    this.#inner ??= import('#services/mail_transport').then(
      ({ SettingsSmtpTransport }) => new SettingsSmtpTransport()
    )
    return this.#inner
  }

  async send(message: NodeMailerMessage) {
    return (await this.#transport()).send(message)
  }

  async close() {
    if (this.#inner) await (await this.#inner).close?.()
  }
}

const mailConfig = defineConfig({
  default: env.get('MAIL_MAILER') ?? 'smtp',
  from: {
    address: env.get('MAIL_FROM_ADDRESS') ?? 'no-reply@localhost',
    name: env.get('MAIL_FROM_NAME') ?? 'عدولة',
  },
  mailers: {
    smtp: (): MailTransportContract => new Smtp(),
  },
})

export default mailConfig

declare module '@adonisjs/mail/types' {
  export interface MailersList extends InferMailers<typeof mailConfig> {}
}
