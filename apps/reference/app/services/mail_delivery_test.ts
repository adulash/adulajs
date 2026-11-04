import { createHmac } from 'node:crypto'
import mail from '@adonisjs/mail/services/main'
import { MailDeliveryTest, type MailTestState } from 'adula'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import { mailReadiness, mailPresets, presetEnvLines } from '#services/mail_setup'

export const mailTest = () => new MailDeliveryTest(db.connection().getWriteClient())
export function publicMailTest(
  state: MailTestState | null
): Omit<MailTestState, 'fingerprint'> | null {
  if (!state) return null
  return {
    id: state.id,
    recipient: state.recipient,
    status: state.status,
    requestedAt: state.requestedAt,
    answeredAt: state.answeredAt,
  }
}
// Configuration changes invalidate old attestations; secrets never reach page props.
export function mailFingerprint() {
  return createHmac('sha256', env.get('APP_KEY').release())
    .update(
      JSON.stringify([
        env.get('SMTP_HOST'),
        env.get('SMTP_PORT'),
        env.get('SMTP_SECURE'),
        env.get('SMTP_REQUIRE_TLS'),
        env.get('SMTP_USERNAME'),
        env.get('SMTP_PASSWORD'),
        env.get('MAIL_FROM_ADDRESS'),
        env.get('MAIL_FROM_NAME'),
        env.get('MAIL_MAILER'),
      ])
    )
    .digest('hex')
}
/** The mail variables the running process uses; only `mailReadiness` reads their values. */
export const mailValues = () => ({
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
/** Page props for the guided mail setup: readiness by variable name and the presets. */
export function mailSetupProps() {
  return {
    mailReadiness: mailReadiness(mailValues()),
    mailPresets: mailPresets.map((preset) => ({ ...preset, env: presetEnvLines(preset) })),
  }
}
export async function sendMailTest(recipient: string, id: string) {
  await mail.send((message) => {
    message
      .to(recipient)
      .subject('تجربة البريد — تأكيد الاستلام')
      .text(
        `هذه رسالة تجريبية طلبتها من إعدادات النظام.\nمرجع التجربة: ${id}\nارجع إلى إعدادات البريد واختر «وصلت الرسالة» لتأكيد استلام هذه التجربة.\nقبول خادم البريد للإرسال لا يعني تأكيد وصولها.`
      )
  })
}
