import { BaseSchema } from '@adonisjs/lucid/schema'
import { createResourceTable } from 'adula'
// Immutable initial schema snapshot. Later changes require a new migration
// (node ace adula:resource:migration <name>).
export default class extends BaseSchema {
  async up() {
    const db = this.db.getWriteClient()
    await createResourceTable(db, {
      name: 'supply_categories',
      scoped: true,
      unique: [['orgUnitId', 'name']],
      fields: {
        name: {
          type: 'string',
          label: { ar: 'الاسم', en: 'Name' },
          required: true,
          searchable: true,
        },
      },
    })
    await createResourceTable(db, {
      name: 'suppliers',
      scoped: true,
      unique: [['orgUnitId', 'code']],
      fields: {
        code: { type: 'string', label: { ar: 'رمز المورد', en: 'Supplier code' }, required: true },
        name: {
          type: 'string',
          label: { ar: 'اسم المورد', en: 'Supplier name' },
          required: true,
          searchable: true,
        },
        email: {
          type: 'email',
          label: { ar: 'البريد الإلكتروني', en: 'E-mail' },
          searchable: true,
        },
        phone: { type: 'phone', label: { ar: 'الهاتف', en: 'Phone' } },
        website: { type: 'url', label: { ar: 'الموقع الإلكتروني', en: 'Website' } },
        kind: {
          type: 'enum',
          label: { ar: 'نوع المورد', en: 'Supplier type' },
          required: true,
          default: 'local',
          options: [
            { value: 'local', label: { ar: 'محلي', en: 'Local' } },
            { value: 'international', label: { ar: 'دولي', en: 'International' } },
          ],
        },
        // Required only while visible (visibleWhen), so the columns stay nullable.
        commercialRegister: {
          type: 'string',
          label: { ar: 'السجل التجاري', en: 'Commercial register' },
          required: true,
          visibleWhen: { kind: 'local' },
        },
        country: {
          type: 'string',
          label: { ar: 'الدولة', en: 'Country' },
          required: true,
          visibleWhen: { kind: 'international' },
        },
        creditLimit: { type: 'money', label: { ar: 'حد الائتمان', en: 'Credit limit' } },
        paymentTermsDays: {
          type: 'integer',
          label: { ar: 'مدة السداد (يوم)', en: 'Payment terms (days)' },
          default: 30,
        },
        discountRate: {
          type: 'percent',
          label: { ar: 'نسبة الخصم', en: 'Discount rate' },
          precision: 7,
          scale: 2,
          default: '0.00',
        },
        rating: {
          type: 'decimal',
          label: { ar: 'التقييم', en: 'Rating' },
          precision: 3,
          scale: 1,
        },
        paymentMethods: {
          type: 'multiSelect',
          label: { ar: 'طرق الدفع', en: 'Payment methods' },
          options: [
            { value: 'bank', label: { ar: 'تحويل بنكي', en: 'Bank transfer' } },
            { value: 'cheque', label: { ar: 'شيك', en: 'Cheque' } },
            { value: 'cash', label: { ar: 'نقدًا', en: 'Cash' } },
          ],
        },
        categories: {
          type: 'manyToMany',
          label: { ar: 'فئات التوريد', en: 'Supply categories' },
          resource: 'supply_categories',
        },
      },
    })
  }
  async down() {
    throw new Error('Use an expand/contract migration or restore a backup')
  }
}
