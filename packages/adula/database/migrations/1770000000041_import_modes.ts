import { BaseSchema } from '@adonisjs/lucid/schema'
import { createImportModesSchema } from '../../src/database/schema.js'

export default class ImportModes extends BaseSchema {
  async up() {
    await createImportModesSchema(this.db.getWriteClient())
  }
  async down() {
    throw new Error(
      'AdulaJS migrations are additive. Restore a tested backup instead of rolling back.'
    )
  }
}
