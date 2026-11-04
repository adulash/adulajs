import env from '#start/env'
import { defineConfig, transports } from '@adonisjs/mail'
import { smtpOptions } from '#services/mail_setup'

/**
 * SMTP only: no external mail service. Tests fake the mailer, and a local
 * relay on 127.0.0.1:1025 is the development default.
 */
const mailConfig = defineConfig({
  default: env.get('MAIL_MAILER') ?? 'smtp',
  from: {
    address: env.get('MAIL_FROM_ADDRESS') ?? 'no-reply@localhost',
    name: env.get('MAIL_FROM_NAME') ?? 'عدولة',
  },
  mailers: {
    smtp: transports.smtp(
      smtpOptions({
        SMTP_HOST: env.get('SMTP_HOST'),
        SMTP_PORT: env.get('SMTP_PORT'),
        SMTP_SECURE: env.get('SMTP_SECURE'),
        SMTP_REQUIRE_TLS: env.get('SMTP_REQUIRE_TLS'),
        SMTP_USERNAME: env.get('SMTP_USERNAME'),
        SMTP_PASSWORD: env.get('SMTP_PASSWORD'),
        NODE_ENV: env.get('NODE_ENV'),
      })
    ),
  },
})

export default mailConfig

declare module '@adonisjs/mail/types' {
  export interface MailersList extends InferMailers<typeof mailConfig> {}
}
