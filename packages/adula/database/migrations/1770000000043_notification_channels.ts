import { BaseSchema } from '@adonisjs/lucid/schema'
import { createNotificationChannelsSchema } from '../../src/database/schema.js'

export default class NotificationChannels extends BaseSchema {
  async up() {
    await createNotificationChannelsSchema(this.db.getWriteClient())
  }
  async down() {
    throw new Error(
      'AdulaJS migrations are additive. Restore a tested backup instead of rolling back.'
    )
  }
}
