import { BaseSchema } from '@adonisjs/lucid/schema'
import { createAssistantSchema } from '../../src/database/schema.js'

export default class AiAssistant extends BaseSchema {
  async up() {
    await createAssistantSchema(this.db.getWriteClient())
  }
  async down() {
    throw new Error(
      'AdulaJS migrations are additive. Restore a tested backup instead of rolling back.'
    )
  }
}
