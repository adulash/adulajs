import { BaseSchema } from '@adonisjs/lucid/schema'
import { createCloudBackupsSchema } from '../../src/database/schema.js'

export default class CloudBackups extends BaseSchema {
  async up() {
    await createCloudBackupsSchema(this.db.getWriteClient())
  }
  async down() {
    throw new Error(
      'AdulaJS migrations are additive. Restore a tested backup instead of rolling back.'
    )
  }
}
