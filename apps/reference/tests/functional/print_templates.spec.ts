import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { adula } from '#services/adula'
import { seedActor, type UiActor } from '#tests/helpers/ui_fixtures'

const knex = () => db.connection().getWriteClient()
const json = { Accept: 'application/json' }

/** ADR 048: code and administrator print templates, authorized like the record page. */
test.group('Print templates', (group) => {
  let admin: UiActor
  let reader: UiActor
  let outsider: UiActor
  let id: number
  group.setup(async () => {
    // Versions are immutable (row triggers); TRUNCATE is the test reset.
    await knex().raw('TRUNCATE print_template_versions, print_templates RESTART IDENTITY CASCADE')
    admin = await seedActor([{ subject: 'all', action: 'manage' }], { fullName: 'مدير الطباعة' })
    reader = await seedActor(
      [
        { subject: 'orders', action: 'view' },
        { subject: 'order_lines', action: 'view' },
      ],
      { orgUnitId: admin.orgUnitId, level: 0 }
    )
    outsider = await seedActor([{ subject: 'orders', action: 'view' }], { level: 0 })
    const saved = await adula().resources.save('orders', await adula().actors.load(admin.user.id), {
      notes: 'طلب <script>alert(1)</script> للفوترة',
      total: '4500000',
      internalNote: 'هامش الربح سري',
      orgUnitId: admin.orgUnitId,
      lines: [
        { description: 'خادم', quantity: 2 },
        { description: 'ترخيص', quantity: 5 },
      ],
    })
    id = Number(saved.id)
  })

  test('the code invoice template prints lines and totals and omits fields the reader cannot read', async ({
    client,
    assert,
  }) => {
    const full = await client
      .get(`/resources/orders/${id}/print`)
      .qs({ template: 'invoice' })
      .loginAs(admin.user)
    full.assertStatus(200)
    assert.include(full.text(), 'فاتورة الطلب')
    assert.include(full.text(), 'هامش الربح سري')
    assert.include(full.text(), '45,000.00')
    assert.include(full.text(), '<th>إجمالي الكميات</th><td>7</td>')
    assert.include(full.text(), 'خادم')
    assert.include(full.text(), '&lt;script&gt;')
    assert.notInclude(full.text(), '<script>')
    assert.include(full.text(), "default-src 'none'")
    const limited = await client
      .get(`/resources/orders/${id}/print`)
      .qs({ template: 'invoice' })
      .loginAs(reader.user)
    limited.assertStatus(200)
    assert.include(limited.text(), 'خادم')
    assert.notInclude(limited.text(), 'هامش الربح سري')
    assert.notInclude(limited.text(), '45,000.00')
    assert.notInclude(limited.text(), 'إجمالي الطلب')
  })

  test('another organization’s record is refused for every template', async ({ client }) => {
    for (const template of ['invoice', 'default', 'missing']) {
      const response = await client
        .get(`/resources/orders/${id}/print`)
        .qs({ template })
        .loginAs(outsider.user)
        .header('Accept', 'application/json')
      response.assertStatus(404)
    }
  })

  test('non-administrators cannot list, create or edit print templates', async ({
    client,
    assert,
  }) => {
    const body = { resource: 'orders', key: 'note', label: 'مذكرة', body: '<p>{{field.notes}}</p>' }
    const as = <T extends { loginAs(user: UiActor['user']): T }>(request: T) =>
      request.loginAs(reader.user)
    const responses = [
      await as(client.get('/admin/print-templates')).headers(json).withCsrfToken(),
      await as(client.post('/admin/print-templates').json(body)).headers(json).withCsrfToken(),
      await as(client.put('/admin/print-templates/orders/note').json(body))
        .headers(json)
        .withCsrfToken(),
      await as(client.post('/admin/print-templates/preview').json(body))
        .headers(json)
        .withCsrfToken(),
    ]
    for (const response of responses) response.assertStatus(403)
    assert.lengthOf(await knex()('print_templates').where('key', 'note'), 0)
  })

  test('an administrator template names a hidden field and the reader still never sees it', async ({
    client,
    assert,
  }) => {
    const created = await client
      .post('/admin/print-templates')
      .json({
        resource: 'orders',
        key: 'delivery_note',
        label: 'إذن تسليم',
        paper: 'A5',
        orientation: 'landscape',
        body: '<h1 onclick="x()">إذن تسليم {{field.number}}</h1><p>{{field.notes}}</p><p class="secret">[{{field.internalNote}}][{{money field.total}}]</p><table>{{#each lines.lines}}<tr><td>{{row.description}}</td><td>{{number row.quantity}}</td></tr>{{/each}}</table>',
      })
      .loginAs(admin.user)
      .headers(json)
      .withCsrfToken()
    created.assertStatus(200)
    assert.deepEqual(created.body().data, { resource: 'orders', key: 'delivery_note', version: 1 })
    const refused = await client
      .post('/admin/print-templates')
      .json({ resource: 'orders', key: 'bad', label: 'سيئ', body: '{{secret field.notes}}' })
      .loginAs(admin.user)
      .headers(json)
      .withCsrfToken()
    refused.assertStatus(422)
    assert.include(refused.body().error.message, 'دالة غير مسموحة')
    const printed = await client
      .get(`/resources/orders/${id}/print`)
      .qs({ template: 'delivery_note' })
      .loginAs(reader.user)
    printed.assertStatus(200)
    assert.include(printed.text(), '@page { size: A5 landscape;')
    assert.include(printed.text(), 'ترخيص')
    assert.include(printed.text(), '[][]')
    assert.notInclude(printed.text(), 'هامش الربح سري')
    assert.notInclude(printed.text(), 'onclick')
    const options = await client
      .get('/resources/orders/print-templates')
      .loginAs(reader.user)
      .headers(json)
      .withCsrfToken()
    options.assertStatus(200)
    assert.deepEqual(
      options.body().data.templates.map((option: { key: string }) => option.key),
      ['default', 'invoice', 'delivery_note']
    )
  })

  test('editing creates version 2 and the print audit records the version used', async ({
    client,
    assert,
  }) => {
    const updated = await client
      .put('/admin/print-templates/orders/delivery_note')
      .json({
        label: 'إذن تسليم معدّل',
        body: '<p>النسخة الثانية {{field.notes}}</p>',
        paper: 'A4',
      })
      .loginAs(admin.user)
      .headers(json)
      .withCsrfToken()
    updated.assertStatus(200)
    assert.equal(updated.body().data.version, 2)
    const versions = await client
      .get('/admin/print-templates/orders/delivery_note/versions')
      .loginAs(admin.user)
      .headers(json)
      .withCsrfToken()
    assert.deepEqual(
      versions.body().data.map((version: { version: number }) => version.version),
      [2, 1]
    )
    assert.equal(versions.body().data[0].createdBy, 'مدير الطباعة')
    const printed = await client
      .get(`/resources/orders/${id}/print`)
      .qs({ template: 'delivery_note' })
      .loginAs(admin.user)
    printed.assertStatus(200)
    assert.include(printed.text(), 'النسخة الثانية')
    const [entry] = await knex()('activities')
      .where({ resource: 'orders', record_id: id, action: 'printed', actor_id: admin.user.id })
      .orderBy('id', 'desc')
      .limit(1)
    assert.deepEqual(entry.changes, { template: 'delivery_note', version: '2', format: 'html' })
    await client
      .get(`/resources/orders/${id}/print`)
      .qs({ template: 'invoice' })
      .loginAs(admin.user)
    const [code] = await knex()('activities')
      .where({ resource: 'orders', record_id: id, action: 'printed' })
      .orderBy('id', 'desc')
      .limit(1)
    assert.equal(code.changes.template, 'invoice')
    assert.match(code.changes.version, /^code:[0-9a-f]{12}$/)
    // A PDF that could not be produced is not recorded as printed.
    const before = await knex()('activities')
      .where({ action: 'printed', record_id: id })
      .count('* as count')
    const pdf = await client
      .get(`/resources/orders/${id}/print`)
      .qs({ template: 'invoice', format: 'pdf' })
      .loginAs(admin.user)
      .header('Accept', 'application/json')
    pdf.assertStatus(501)
    const after = await knex()('activities')
      .where({ action: 'printed', record_id: id })
      .count('* as count')
    assert.equal(Number(after[0].count), Number(before[0].count))
  })

  test('create refuses an existing key, update needs an existing one and keeps active', async ({
    client,
    assert,
  }) => {
    const duplicate = await client
      .post('/admin/print-templates')
      .json({ resource: 'orders', key: 'delivery_note', label: 'مكرر', body: '<p>x</p>' })
      .loginAs(admin.user)
      .headers(json)
      .withCsrfToken()
    duplicate.assertStatus(409)
    const missing = await client
      .put('/admin/print-templates/orders/nothing_here')
      .json({ label: 'غائب', body: '<p>x</p>' })
      .loginAs(admin.user)
      .headers(json)
      .withCsrfToken()
    missing.assertStatus(404)
    for (const body of [
      { label: 'إذن تسليم', body: '<p>{{field.notes}}</p>', active: false },
      { label: 'إذن تسليم', body: '<p>{{field.notes}} ثالثة</p>' },
    ]) {
      const saved = await client
        .put('/admin/print-templates/orders/delivery_note')
        .json(body)
        .loginAs(admin.user)
        .headers(json)
        .withCsrfToken()
      saved.assertStatus(200)
    }
    const [row] = await knex()('print_templates').where({
      resource: 'orders',
      key: 'delivery_note',
    })
    assert.isFalse(row.active)
    assert.equal(row.current_version, 4)
  })

  test('an administrator previews a draft against a record through the same authorization', async ({
    client,
    assert,
  }) => {
    const preview = await client
      .post('/admin/print-templates/preview')
      .json({
        resource: 'orders',
        label: 'مسودة',
        body: '<p>معاينة: {{field.internalNote}}</p>',
        recordId: id,
      })
      .loginAs(admin.user)
      .headers(json)
      .withCsrfToken()
    preview.assertStatus(200)
    assert.equal(preview.body().data.recordId, id)
    assert.include(preview.body().data.html, 'معاينة: هامش الربح سري')
    const missing = await client
      .post('/admin/print-templates/preview')
      .json({ resource: 'orders', label: 'مسودة', body: '<p>x</p>', recordId: 999999999 })
      .loginAs(admin.user)
      .headers(json)
      .withCsrfToken()
    missing.assertStatus(404)
    // An administrator of another organization unit previews an existing record outside
    // their scope: the same 404 as the record page, and nothing of the record leaks.
    const otherAdmin = await seedActor([{ subject: 'all', action: 'manage' }])
    const outside = await client
      .post('/admin/print-templates/preview')
      .json({
        resource: 'orders',
        label: 'مسودة',
        body: '<p>{{field.internalNote}}</p>',
        recordId: id,
      })
      .loginAs(otherAdmin.user)
      .headers(json)
      .withCsrfToken()
    outside.assertStatus(404)
    assert.notInclude(outside.text(), 'هامش الربح سري')
    const page = await client
      .get('/admin/print-templates')
      .loginAs(admin.user)
      .headers(json)
      .withCsrfToken()
    page.assertStatus(200)
    assert.isTrue(
      page
        .body()
        .data.some(
          (template: { key: string; source: string }) =>
            template.key === 'invoice' && template.source === 'code'
        )
    )
  })
})
