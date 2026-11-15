import { BaseSchema } from '@adonisjs/lucid/schema'
import { createAppearanceSchema } from '../../src/database/schema.js'

export default class Appearance extends BaseSchema {
  async up() {
    await createAppearanceSchema(this.db.getWriteClient())
  }
  async down() {
    throw new Error(
      'AdulaJS migrations are additive. Restore a tested backup instead of rolling back.'
    )
  }
}
