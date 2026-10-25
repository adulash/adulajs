import mail from '@adonisjs/mail/services/main'
import db from '@adonisjs/lucid/services/db'
import { deliverNotificationMail, type MailSender } from 'adula'
import env from '#start/env'

/** An absolute link to a notification's record, for messages read outside the application. */
export function recordLink(target: { resource: string; recordId: number }) {
  return new URL(`/resources/${target.resource}/${target.recordId}`, env.get('APP_URL')).toString()
}

/** Sends one notification e-mail through the configured mailer. */
export const sendNotificationMail: MailSender = async (message) => {
  await mail.send((email) => {
    email
      .to(message.to, message.name ?? undefined)
      .subject(message.subject)
      .text(message.target ? `${message.text}\n\n${recordLink(message.target)}` : message.text)
  })
}

/** Sends pending templated notification e-mails through the configured mailer. */
export function deliverNotificationEmails() {
  return deliverNotificationMail(db.connection().getWriteClient(), sendNotificationMail)
}
