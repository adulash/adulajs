import { BaseSchema } from '@adonisjs/lucid/schema'
import { createSyncJobsSchema } from '../../src/database/schema.js'

export default class SyncJobs extends BaseSchema {
  async up() {
    await createSyncJobsSchema(this.db.getWriteClient())
  }
  async down() {
    throw new Error(
      'AdulaJS migrations are additive. Restore a tested backup instead of rolling back.'
    )
  }
}
