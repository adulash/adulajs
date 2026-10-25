import { BaseSchema } from '@adonisjs/lucid/schema'
import { createChannelConfirmationsSchema } from '../../src/database/schema.js'

export default class ChannelConfirmations extends BaseSchema {
  async up() {
    await createChannelConfirmationsSchema(this.db.getWriteClient())
  }
  async down() {
    throw new Error(
      'AdulaJS migrations are additive. Restore a tested backup instead of rolling back.'
    )
  }
}
