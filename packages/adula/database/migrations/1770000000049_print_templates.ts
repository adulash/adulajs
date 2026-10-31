import { BaseSchema } from '@adonisjs/lucid/schema'
import { createPrintTemplatesSchema } from '../../src/database/schema.js'

export default class PrintTemplates extends BaseSchema {
  async up() {
    await createPrintTemplatesSchema(this.db.getWriteClient())
  }
  async down() {
    throw new Error(
      'AdulaJS migrations are additive. Restore a tested backup instead of rolling back.'
    )
  }
}
