import { BaseSchema } from '@adonisjs/lucid/schema'
import { createCommentNotificationsSchema } from '../../src/database/schema.js'

export default class CommentNotifications extends BaseSchema {
  async up() {
    await createCommentNotificationsSchema(this.db.getWriteClient())
  }
  async down() {
    throw new Error(
      'AdulaJS migrations are additive. Restore a tested backup instead of rolling back.'
    )
  }
}
