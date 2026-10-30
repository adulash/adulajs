import { BaseSchema } from '@adonisjs/lucid/schema'
import { createResourceTable } from 'adula'
// Immutable initial schema snapshot. Later changes require a new migration.
export default class extends BaseSchema {
  async up() {
    await createResourceTable(this.db.getWriteClient(), {
      name: 'order_documents',
      scoped: true,
      fields: {
        title: {
          type: 'string',
          required: true,
          searchable: true,
          label: { ar: 'العنوان', en: 'Title' },
        },
        files: { type: 'attachment', multiple: true, label: { ar: 'الملفات', en: 'Files' } },
      },
    })
  }
  async down() {
    throw new Error('Use an expand/contract migration or restore a backup')
  }
}
