import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Additive: each user's interface language. Arabic is the base language of every
 * system; another code takes effect only while config/adula.ts enables it.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('users', (table) => {
      table.string('language', 16).notNullable().defaultTo('ar')
    })
  }
  async down() {
    throw new Error('Use an expand/contract migration')
  }
}
