import { BaseSchema } from '@adonisjs/lucid/schema'
import { createImportLeasesSchema } from '../../src/database/schema.js'

export default class ImportLeases extends BaseSchema {
  async up() {
    await createImportLeasesSchema(this.db.getWriteClient())
  }
  async down() {
    throw new Error(
      'AdulaJS migrations are additive. Restore a tested backup instead of rolling back.'
    )
  }
}
