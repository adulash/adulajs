import { test } from '@japa/runner'
import { randomUUID } from 'node:crypto'
import type { ApiRequest } from '@japa/api-client'
import db from '@adonisjs/lucid/services/db'
import { seedActor, type UiActor } from '#tests/helpers/ui_fixtures'

/**
 * The suppliers fixture declares every 2.2 field type and no validator (ADR 045): the
 * HTTP API validates through the definition, stores canonical values and reads them back.
 */
test.group('Field types through the HTTP API', (group) => {
  const knex = () => db.connection().getWriteClient()
  const asJson = (request: ApiRequest) =>
    request.withCsrfToken().header('Accept', 'application/json')
  let admin: UiActor
  let outsider: UiActor
  let local: { id: number; name: string }
  let foreign: { id: number; name: string }
  let sequence = 0
  // Codes are unique per organization unit, and seedActor gives every run fresh units, so
  // a per-run counter never collides, even on a reused database (a clock-derived code
  // wraps and can repeat within one run).
  const code = () => {
    if (++sequence > 9999) throw new Error('The SUP-#### pattern allows 9999 codes per run')
    return `SUP-${String(sequence).padStart(4, '0')}`
  }

  group.setup(async () => {
    admin = await seedActor([{ subject: 'all', action: 'manage' }], { fullName: 'مدير الموردين' })
    // Works in its own unit only: categories of the administrator's unit are out of reach.
    outsider = await seedActor([
      { subject: 'suppliers', action: 'view' },
      { subject: 'suppliers', action: 'create' },
      { subject: 'supply_categories', action: 'view' },
    ])
    const category = async (orgUnitId: number, name: string) => {
      const [row] = await knex()('supply_categories')
        .insert({
          name,
          org_unit_id: orgUnitId,
          created_by: admin.user.id,
          updated_by: admin.user.id,
        })
        .returning(['id', 'name'])
      return { id: Number(row.id), name: String(row.name) }
    }
    local = await category(admin.orgUnitId, `مواد خام ${randomUUID().slice(0, 6)}`)
    foreign = await category(outsider.orgUnitId, `خدمات ${randomUUID().slice(0, 6)}`)
  })

  test('creates with defaults and canonical values, then filters by the new types', async ({
    client: http,
    assert,
  }) => {
    const created = await asJson(http.post('/resources/suppliers').loginAs(admin.user)).json({
      code: code(),
      name: 'شركة التوريد المتحدة',
      commercialRegister: '1010123456',
      email: ' Sales@United.Example ',
      phone: '٠٥٠ ١٢٣ ٤٥٦٧',
      website: 'https://united.example',
      creditLimit: '500000',
      rating: '4.5',
      paymentMethods: ['cash', 'bank'],
      categories: [String(local.id)],
      orgUnitId: admin.orgUnitId,
    })
    assert.equal(created.status(), 201, JSON.stringify(created.body()))
    const data = created.body().data
    assert.include(data, {
      email: 'sales@united.example',
      phone: '0501234567',
      kind: 'local',
      paymentTermsDays: 30,
      discountRate: '0.00',
      rating: '4.5',
      creditLimit: '500000',
      country: null,
    })
    assert.deepEqual(data.paymentMethods, ['bank', 'cash'])
    assert.deepEqual(data.categories, [local.id])
    const listed = await asJson(
      http
        .get('/resources/suppliers')
        .qs({ 'filters[categories]': local.id, 'filters[paymentMethods]': 'cash' })
        .loginAs(admin.user)
    )
    listed.assertStatus(200)
    assert.deepEqual(
      listed.body().data.map((row: { id: number }) => row.id),
      [data.id]
    )
    assert.equal(listed.body().related.categories[0]._title, local.name)
  })

  test('the derived validator answers in Arabic and visibleWhen decides required', async ({
    client: http,
    assert,
  }) => {
    const invalid = await asJson(http.post('/resources/suppliers').loginAs(admin.user)).json({
      code: 'X-1',
      name: 'م',
      kind: 'local',
      commercialRegister: '1010123456',
      orgUnitId: admin.orgUnitId,
    })
    invalid.assertStatus(422)
    const body = JSON.stringify(invalid.body())
    assert.include(body, 'صيغة القيمة غير صحيحة')
    assert.include(body, 'عدد الأحرف أقل من الحد المطلوب (2)')
    const international = await asJson(http.post('/resources/suppliers').loginAs(admin.user)).json({
      code: code(),
      name: 'Global Parts',
      kind: 'international',
      orgUnitId: admin.orgUnitId,
    })
    international.assertStatus(422)
    assert.equal(international.body().error.code, 'E_REQUIRED')
    const saved = await asJson(http.post('/resources/suppliers').loginAs(admin.user)).json({
      code: code(),
      name: 'Global Parts',
      kind: 'international',
      country: 'ألمانيا',
      commercialRegister: '9999999999',
      orgUnitId: admin.orgUnitId,
    })
    saved.assertStatus(201)
    // The hidden local register was ignored.
    assert.isNull(saved.body().data.commercialRegister)
  })

  test('the editor carries options, constraints, defaults and visibility', async ({
    client: http,
    assert,
  }) => {
    const editor = await asJson(http.get('/resources/suppliers/create').loginAs(admin.user))
    editor.assertStatus(200)
    const form = editor.body()
    assert.deepInclude(form.defaults, {
      kind: 'local',
      paymentTermsDays: 30,
      discountRate: '0.00',
      paymentMethods: ['bank'],
    })
    assert.deepEqual(form.options.kind, [
      { value: 'local', label: 'محلي' },
      { value: 'international', label: 'دولي' },
    ])
    const field = (key: string) => form.fields.find((entry: { key: string }) => entry.key === key)
    assert.deepEqual(field('country').visibleWhen, { kind: 'international' })
    assert.include(field('rating'), { type: 'decimal', precision: 3, scale: 1, min: 0, max: 5 })
    assert.isTrue(
      form.options.categories.some((option: { value: string }) => option.value === String(local.id))
    )
  })

  test('a duplicate code per unit is 409 naming the fields', async ({ client: http, assert }) => {
    const value = code()
    const input = { code: value, name: 'مورد مكرر', commercialRegister: '1010123456' }
    const first = await asJson(http.post('/resources/suppliers').loginAs(admin.user)).json({
      ...input,
      orgUnitId: admin.orgUnitId,
    })
    first.assertStatus(201)
    const duplicate = await asJson(http.post('/resources/suppliers').loginAs(admin.user)).json({
      ...input,
      orgUnitId: admin.orgUnitId,
    })
    duplicate.assertStatus(409)
    assert.equal(duplicate.body().error.code, 'E_DUPLICATE')
    assert.include(duplicate.body().error.message, 'رمز المورد')
    // Another unit may reuse the code.
    const elsewhere = await asJson(http.post('/resources/suppliers').loginAs(outsider.user)).json({
      ...input,
      orgUnitId: outsider.orgUnitId,
    })
    elsewhere.assertStatus(201)
  })

  test('an outsider cannot link a category they cannot view', async ({ client: http, assert }) => {
    const denied = await asJson(http.post('/resources/suppliers').loginAs(outsider.user)).json({
      code: code(),
      name: 'مورد الوحدة',
      commercialRegister: '1010123456',
      categories: [local.id],
      orgUnitId: outsider.orgUnitId,
    })
    denied.assertStatus(404)
    const allowed = await asJson(http.post('/resources/suppliers').loginAs(outsider.user)).json({
      code: code(),
      name: 'مورد الوحدة',
      commercialRegister: '1010123456',
      categories: [foreign.id],
      orgUnitId: outsider.orgUnitId,
    })
    allowed.assertStatus(201)
    const links = await knex()('suppliers_categories')
      .where('suppliers_id', allowed.body().data.id)
      .pluck('supply_categories_id')
    assert.deepEqual(links, [foreign.id])
  })
})
