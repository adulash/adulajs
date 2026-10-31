import { BaseSchema } from '@adonisjs/lucid/schema'
import { createTwoFactorSchema } from '../../src/database/schema.js'

export default class TwoFactor extends BaseSchema {
  async up() {
    await createTwoFactorSchema(this.db.getWriteClient())
  }
  async down() {
    throw new Error(
      'AdulaJS migrations are additive. Restore a tested backup instead of rolling back.'
    )
  }
}
