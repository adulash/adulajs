import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Session ids a rotation replaced (sign-in, starting or ending impersonation, two-factor
 * sign-in), so that a request still carrying one, answered after the rotation, does not hand
 * the browser the old cookie again. Each row holds the id's handle (sessionHandle, as
 * user_sessions shows them), never the id itself, and the handle of the id that replaced it,
 * so a sign-out still in flight across the rotation can end its successor too. Rows older
 * than ten minutes are pruned.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('session_rotations', (table) => {
      table.string('id', 255).primary()
      table.string('successor', 255).nullable()
      table.timestamp('rotated_at', { useTz: true }).notNullable().defaultTo(this.now())
      table.index(['rotated_at'])
    })
  }
  async down() {
    throw new Error('Use an expand/contract migration')
  }
}
