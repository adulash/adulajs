import { BaseSchema } from '@adonisjs/lucid/schema'
import { createWorkflowDelegationSlaSchema } from '../../src/database/schema.js'

export default class WorkflowDelegationSla extends BaseSchema {
  async up() {
    await createWorkflowDelegationSlaSchema(this.db.getWriteClient())
  }
  async down() {
    throw new Error(
      'AdulaJS migrations are additive. Restore a tested backup instead of rolling back.'
    )
  }
}
