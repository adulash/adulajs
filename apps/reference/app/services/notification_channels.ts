import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'
import { NotificationChannels, mailChannel } from 'adula'
import { adula } from '#services/adula'
import { recordLink, sendNotificationMail } from '#services/notification_mail'

/**
 * The registered notification channels: in-app, e-mail through the mailer and, while an
 * administrator has enabled it in the settings, the HTTP provider channel (SMS or WhatsApp).
 */
export async function notificationChannels() {
  // A broken provider setting must not stop e-mail: log it and run without the provider.
  // Only a successful read names retired kinds, so a failed read drops no queued message.
  let provider = null
  let retired: string[] = []
  try {
    ;({ channel: provider, retired } = await adula().channelSettings.resolve({ link: recordLink }))
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error) },
      'notification provider channel unavailable'
    )
  }
  return new NotificationChannels(
    db.connection().getWriteClient(),
    [mailChannel(sendNotificationMail), ...(provider ? [provider] : [])],
    { retired }
  )
}

/** The worker step: e-mail (notifications.mail_state) and the provider channel's deliveries. */
export async function deliverNotificationChannels() {
  const channels = await notificationChannels()
  return channels.deliver()
}

/** The user's own channel choices, for the profile screen. */
export async function channelPreferences(userId: number) {
  const channels = await notificationChannels()
  return channels.preferences(userId)
}
