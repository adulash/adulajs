import { createHmac } from 'node:crypto'
import mail from '@adonisjs/mail/services/main'
import { MailDeliveryTest, type MailTestState } from 'adula'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import { mailReadiness, mailPresets, presetEnvLines, type MailValues } from '#services/mail_setup'
import { environmentMail, storedSettingsApply } from '#services/mail_transport'
import { adula } from '#services/adula'

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
/** The SMTP values in force: the stored settings when they apply, otherwise the environment. */
export async function mailValues(): Promise<MailValues & { source: 'settings' | 'environment' }> {
  const stored = storedSettingsApply() ? await adula().mailSettings.read() : null
  if (!stored?.configured) return { ...environmentMail(), source: 'environment' }
  return {
    source: 'settings',
    SMTP_HOST: stored.host,
    SMTP_PORT: stored.port,
    SMTP_SECURE: stored.security === 'tls',
    SMTP_REQUIRE_TLS: stored.security === 'starttls',
    SMTP_USERNAME: stored.username || undefined,
    // Readiness only asks whether a password exists; the value never leaves MailSettings.
    SMTP_PASSWORD: stored.hasPassword ? 'stored' : undefined,
    MAIL_FROM_NAME: stored.fromName || undefined,
    MAIL_FROM_ADDRESS: stored.fromAddress || undefined,
    NODE_ENV: env.get('NODE_ENV'),
  }
}
// Configuration changes invalidate old attestations; secrets never reach page props.
export async function mailFingerprint() {
  const stored = storedSettingsApply() ? await adula().mailSettings.read() : null
  return createHmac('sha256', env.get('APP_KEY').release())
    .update(
      JSON.stringify([
        Object.values(environmentMail()),
        env.get('MAIL_MAILER'),
        // updatedAt also changes when the stored password is set or removed.
        stored?.configured ? stored : null,
      ])
    )
    .digest('hex')
}
/** Page props for mail setup: readiness by field, the presets and the stored settings. */
export async function mailSetupProps() {
  const values = await mailValues()
  return {
    mailReadiness: { ...mailReadiness(values), source: values.source },
    mailPresets: mailPresets.map((preset) => ({ ...preset, env: presetEnvLines(preset) })),
    mailSettings: await adula().mailSettings.read(),
    mailSettingsApply: storedSettingsApply(),
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
