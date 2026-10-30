import { test } from '@japa/runner'
import { BaseModel } from '@adonisjs/lucid/orm'
import {
  PrintTemplates,
  ResourceRegistry,
  ResourceService,
  createResourceTable,
  defineResource,
  parseTemplate,
  renderTemplateDocument,
  sanitizePrintHtml,
} from '../index.js'
import type { Actor, RecordData } from '../index.js'
import { db, setup } from './helpers.js'

const bill = defineResource({
  name: 'pt_bills',
  label: { ar: 'الفواتير', en: 'Bills' },
  model: BaseModel,
  scoped: true,
  submittable: true,
  fields: {
    customer: { type: 'string', required: true, label: { ar: 'العميل', en: 'Customer' } },
    amount: { type: 'money', permissionLevel: 1, label: { ar: 'المبلغ', en: 'Amount' } },
    issuedOn: { type: 'date', label: { ar: 'تاريخ الإصدار', en: 'Issued on' } },
    note: { type: 'text', label: { ar: 'ملاحظة', en: 'Note' } },
    lines: {
      type: 'hasMany',
      resource: 'pt_bill_lines',
      foreignKey: 'billId',
      inline: true,
      label: { ar: 'البنود', en: 'Lines' },
    },
    // Not in list or show and in no code template: no print may read it.
    payments: {
      type: 'hasMany',
      resource: 'pt_bill_payments',
      foreignKey: 'billId',
      label: { ar: 'الدفعات', en: 'Payments' },
    },
  },
  list: ['customer', 'amount', 'issuedOn'],
  form: ['customer', 'amount', 'issuedOn', 'note', 'lines'],
  show: ['customer', 'amount', 'issuedOn', 'note', 'lines'],
  actions: ['view', 'create', 'update', 'submit', 'cancel'],
  printTemplates: [
    {
      key: 'invoice',
      label: { ar: 'فاتورة ضريبية', en: 'Tax invoice' },
      paper: 'A5',
      orientation: 'landscape',
      header: 'فاتورة رقم {{id}} — {{field.customer}}',
      footer: 'شكرًا لتعاملكم',
      fields: ['customer', 'issuedOn', 'amount'],
      lines: { lines: ['item', 'qty', 'price'] },
      totals: [
        { label: { ar: 'إجمالي الكمية' }, lines: 'lines', column: 'qty' },
        { label: { ar: 'إجمالي السعر' }, lines: 'lines', column: 'price' },
        { label: { ar: 'المبلغ المستحق' }, field: 'amount' },
      ],
    },
  ],
  validator: { validate: async (data) => data as RecordData },
})
const billLine = defineResource({
  name: 'pt_bill_lines',
  label: { ar: 'بنود الفواتير', en: 'Bill lines' },
  model: BaseModel,
  scoped: true,
  fields: {
    billId: { type: 'belongsTo', resource: 'pt_bills', required: true, label: { ar: 'الفاتورة' } },
    item: { type: 'string', required: true, label: { ar: 'الصنف', en: 'Item' } },
    qty: { type: 'integer', label: { ar: 'الكمية', en: 'Quantity' } },
    price: { type: 'money', label: { ar: 'السعر', en: 'Price' } },
    unit: { type: 'lookup', group: 'pt_units', label: { ar: 'الوحدة', en: 'Unit' } },
    productId: {
      type: 'belongsTo',
      resource: 'pt_products',
      label: { ar: 'المنتج', en: 'Product' },
    },
  },
  list: ['billId', 'item', 'qty', 'price', 'unit', 'productId'],
  form: ['billId', 'item', 'qty', 'price', 'unit', 'productId'],
  show: ['billId', 'item', 'qty', 'price', 'unit', 'productId'],
  actions: ['view', 'create', 'update', 'delete'],
  validator: { validate: async (data) => data as RecordData },
})
const product = defineResource({
  name: 'pt_products',
  label: { ar: 'المنتجات', en: 'Products' },
  model: BaseModel,
  scoped: false,
  fields: { name: { type: 'string', required: true, label: { ar: 'الاسم', en: 'Name' } } },
  list: ['name'],
  form: ['name'],
  show: ['name'],
  actions: ['view', 'create'],
  validator: { validate: async (data) => data as RecordData },
})
const payment = defineResource({
  name: 'pt_bill_payments',
  label: { ar: 'الدفعات', en: 'Payments' },
  model: BaseModel,
  scoped: true,
  fields: {
    billId: { type: 'belongsTo', resource: 'pt_bills', required: true, label: { ar: 'الفاتورة' } },
    paid: { type: 'money', label: { ar: 'المدفوع', en: 'Paid' } },
  },
  list: ['billId', 'paid'],
  form: ['billId', 'paid'],
  show: ['billId', 'paid'],
  actions: ['view', 'create'],
  validator: { validate: async (data) => data as RecordData },
})
const registry = new ResourceRegistry().register([
  {
    name: 'pt',
    label: { ar: 'الفوترة' },
    dependsOn: [],
    resources: [product, bill, billLine, payment],
  },
])
const owner: Actor = {
  id: 1,
  orgPaths: ['1'],
  permissionLevel: 1,
  rules: [{ subject: 'all', action: 'manage' }],
}
const clerk: Actor = {
  id: 2,
  orgPaths: ['1.2'],
  permissionLevel: 0,
  rules: [
    { subject: 'pt_bills', action: 'view' },
    { subject: 'pt_bill_lines', action: 'view' },
  ],
}
const outsider: Actor = { ...clerk, orgPaths: ['1.3'] }
const identity = { name: 'شركة الاختبار' }
const printedAt = new Date('2026-10-01T09:00:00Z')

async function rejectsWith(run: () => unknown, pattern: RegExp, status = 422) {
  try {
    await run()
  } catch (error) {
    const failure = error as { status?: number; message: string }
    if (failure.status !== status)
      throw new Error(`expected ${status}, got ${failure.status}: ${failure.message}`)
    if (!pattern.test(failure.message)) throw new Error(`unexpected message: ${failure.message}`)
    return
  }
  throw new Error('expected a rejection')
}

test.group('Print template language and sanitizer', () => {
  test('script and style tags are removed with their contents', ({ assert }) => {
    const clean = sanitizePrintHtml(
      '<p>قبل</p><script>alert(1)</script><SCRIPT src="x.js"></SCRIPT><style>body{background:url(http://evil)}</style><p>بعد</p>'
    )
    assert.equal(clean, '<p>قبل</p><p>بعد</p>')
    // A close tag with whitespace before `>` still ends the dropped element.
    assert.equal(
      sanitizePrintHtml('<p>قبل</p><script>alert(1)</script ><style>x</style\n><p>بعد</p>'),
      '<p>قبل</p><p>بعد</p>'
    )
    // A split tag leaves only escaped, inert text.
    assert.equal(
      sanitizePrintHtml('<scr<script>x</script>ipt>alert(1)</p>'),
      '&lt;script&gt;alert(1)'
    )
  })

  test('event handlers and URL-bearing tags and attributes are dropped', ({ assert }) => {
    assert.equal(sanitizePrintHtml('<img src="http://evil/x.png" onerror="alert(1)">'), '')
    assert.equal(
      sanitizePrintHtml('<div onclick="alert(1)" class="end" data-x="1">نص</div>'),
      '<div class="end">نص</div>'
    )
    assert.equal(
      sanitizePrintHtml(
        '<a href="javascript:alert(1)">رابط</a><a href="https://evil.example">ب</a>'
      ),
      'رابطب'
    )
    for (const tag of ['iframe', 'object', 'embed', 'svg', 'form'])
      assert.equal(sanitizePrintHtml(`<${tag} src="https://evil.example">x</${tag}>ok`), 'ok', tag)
    for (const tag of [
      'link rel="stylesheet" href="https://evil.example/a.css"',
      'meta http-equiv="refresh" content="0;url=https://evil"',
      'base href="https://evil"',
    ])
      assert.equal(sanitizePrintHtml(`<${tag}>ok`), 'ok', tag)
    assert.equal(
      sanitizePrintHtml('<td colspan="2" rowspan="x" dir="rtl">1</td>'),
      '<td colspan="2" dir="rtl">1</td>'
    )
  })

  test('styles keep plain properties and lose url(), @import, expression() and remote references', ({
    assert,
  }) => {
    assert.equal(
      sanitizePrintHtml('<p style="color: #333; font-weight: 700; position: fixed">x</p>'),
      '<p style="color: #333; font-weight: 700">x</p>'
    )
    for (const style of [
      'background-color: url(https://evil.example/x)',
      'color: expression(alert(1))',
      '@import "https://evil.example/a.css"',
      'width: 10px; background: u&#114;l(http://evil)',
      'color: \\75 rl(http://evil)',
      'border: 1px solid red /* x */',
      'color: {{field.note}}',
    ])
      assert.notInclude(sanitizePrintHtml(`<p style="${style}">x</p>`), 'style', style)
    assert.equal(
      sanitizePrintHtml('<p style="color: rgb(10, 20, 30)">x</p>'),
      '<p style="color: rgb(10, 20, 30)">x</p>'
    )
  })

  test('comments, doctype and stray angle brackets cannot smuggle markup', ({ assert }) => {
    assert.equal(sanitizePrintHtml('<!-- <script>alert(1)</script> -->ok<!doctype html>'), 'ok')
    assert.equal(sanitizePrintHtml('1 < 2 and <b>bold'), '1 &lt; 2 and <b>bold</b>')
    assert.equal(sanitizePrintHtml('</table><p>x</div></p>'), '<p>x</p>')
  })

  test('the grammar refuses raw output, unclosed blocks, nested each and expressions', ({
    assert,
  }) => {
    for (const source of [
      '{{{field.note}}}',
      '{{#if field.note}}x',
      '{{/each}}',
      '{{#each lines.lines}}{{#each lines.lines}}{{/each}}{{/each}}',
      '{{field.note + 1}}',
      '{{field.note.length}}',
      '{{constructor.prototype}}',
      '{{> partial}}',
      '{{note',
    ])
      assert.throws(() => parseTemplate(source), /.+/)
    assert.lengthOf(
      parseTemplate('<p>{{field.note}}</p>{{#each lines.lines}}{{row.item}}{{/each}}'),
      4
    )
  })

  test('code templates naming unknown fields are definition errors', ({ assert }) => {
    const base = {
      name: 'pt_broken',
      label: { ar: 'تجربة' },
      model: BaseModel,
      scoped: false,
      fields: { title: { type: 'string' as const, label: { ar: 'العنوان' } } },
      list: ['title'] as const,
      form: ['title'] as const,
      show: ['title'] as const,
      actions: ['view'] as const,
    }
    assert.throws(
      () =>
        defineResource({
          ...base,
          printTemplates: [{ key: 'x', label: { ar: 'س' }, fields: ['missing'] }],
        }),
      /unknown or line field missing/
    )
    assert.throws(
      () =>
        defineResource({
          ...base,
          printTemplates: [
            { key: 'x', label: { ar: 'س' }, fields: [], header: '{{field.secret}}' },
          ],
        }),
      /field\.secret/
    )
    assert.throws(
      () =>
        defineResource({
          ...base,
          printTemplates: [{ key: 'default', label: { ar: 'س' }, fields: [] }],
        }),
      /generic layout/
    )
    assert.throws(
      () =>
        new ResourceRegistry().register([
          {
            name: 'pt2',
            label: { ar: 'تجربة' },
            dependsOn: [],
            resources: [
              defineResource({
                ...base,
                name: 'pt2_bills',
                fields: {
                  title: base.fields.title,
                  lines: {
                    type: 'hasMany',
                    resource: 'pt2_lines',
                    foreignKey: 'billId',
                    label: { ar: 'البنود' },
                  },
                },
                printTemplates: [
                  { key: 'x', label: { ar: 'س' }, fields: [], lines: { lines: ['nope'] } },
                ],
              }),
              defineResource({
                ...base,
                name: 'pt2_lines',
                fields: {
                  title: base.fields.title,
                  billId: { type: 'belongsTo', resource: 'pt2_bills', label: { ar: 'الفاتورة' } },
                },
              }),
            ],
          },
        ]),
      /unknown column lines\.nope/
    )
  })
})

test.group('Print templates', (group) => {
  const service = new ResourceService(db, registry)
  const templates = new PrintTemplates(db, registry)
  let id: number
  group.setup(async () => {
    await setup()
    for (const resource of registry.all()) await createResourceTable(db, resource)
    const saved = await service.save('pt_bills', owner, {
      customer: '<script>alert("x")</script> مؤسسة النور',
      amount: '1234500',
      issuedOn: '2026-03-20',
      note: 'ملاحظة للعميل',
      orgUnitId: 2,
      lines: [
        { item: 'قلم', qty: 3, price: '250' },
        { item: 'دفتر', qty: 2, price: '1000' },
      ],
    })
    id = Number(saved.id)
  })

  test('a code template prints declared fields, lines and totals for the reader, escaped', async ({
    assert,
  }) => {
    const { html, template } = await templates.print(service, 'pt_bills', id, owner, {
      template: 'invoice',
      identity,
      printedBy: 'المدقق',
      printedAt,
      calendar: 'gregory',
      digits: 'latn',
    })
    assert.equal(template.source, 'code')
    assert.match(template.version, /^code:[0-9a-f]{12}$/)
    assert.include(html, '@page { size: A5 landscape;')
    assert.include(html, "default-src 'none'")
    assert.include(html, '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; مؤسسة النور')
    assert.notInclude(html, '<script>')
    assert.include(html, 'فاتورة رقم')
    assert.include(html, 'شكرًا لتعاملكم')
    assert.include(html, '12,345.00')
    // Sum of the line columns: 3 + 2 and 2.50 + 10.00.
    assert.include(html, '<th>إجمالي الكمية</th><td>5</td>')
    assert.include(html, '<th>إجمالي السعر</th><td>12.50</td>')
    assert.include(html, 'قلم')
    // The clerk cannot read amount (permission level 1): it is left out, total too.
    const limited = await templates.print(service, 'pt_bills', id, clerk, {
      template: 'invoice',
      identity,
      printedBy: 'الموظف',
      calendar: 'gregory',
      digits: 'latn',
    })
    assert.notInclude(limited.html, '12,345.00')
    assert.notInclude(limited.html, 'المبلغ')
    assert.include(limited.html, 'قلم')
    await templates.recordPrinted('pt_bills', id, owner, template, 'html')
    const activity = await db('activities')
      .where({ resource: 'pt_bills', record_id: id, action: 'printed' })
      .orderBy('id')
    assert.deepEqual(activity[0].changes, {
      template: 'invoice',
      version: template.version,
      format: 'html',
    })
  })

  test('an out-of-scope record is refused before any template is resolved', async () => {
    await rejectsWith(
      () =>
        templates.print(service, 'pt_bills', id, outsider, {
          template: 'invoice',
          identity,
          printedBy: 'x',
        }),
      /.+/,
      404
    )
    await rejectsWith(
      () =>
        templates.print(service, 'pt_bills', id, outsider, {
          template: 'nope',
          identity,
          printedBy: 'x',
        }),
      /.+/,
      404
    )
  })

  test('saving refuses unknown helpers and names, and stores sanitized markup', async ({
    assert,
  }) => {
    const draft = { key: 'receipt', label: 'إيصال', paper: 'A4', orientation: 'portrait' }
    await rejectsWith(
      () => templates.create('pt_bills', { ...draft, body: '{{eval field.note}}' }, 1),
      /دالة غير مسموحة في القالب: eval/
    )
    await rejectsWith(
      () => templates.create('pt_bills', { ...draft, body: '{{field.password}}' }, 1),
      /اسم غير معروف في القالب: field\.password/
    )
    await rejectsWith(
      () => templates.create('pt_bills', { ...draft, body: '{{row.item}}' }, 1),
      /داخل/
    )
    await rejectsWith(
      () => templates.create('pt_bills', { ...draft, key: 'invoice', body: 'x' }, 1),
      /مستخدم/
    )
    await rejectsWith(
      () => templates.create('pt_bills', { ...draft, paper: 'A3', body: 'x' }, 1),
      /مقاس/
    )
    const saved = await templates.create(
      'pt_bills',
      {
        ...draft,
        body: '<h1 onclick="steal()">{{label "customer"}}: {{field.customer}}</h1><script>alert(1)</script><table>{{#each lines.lines}}<tr><td>{{rowNumber}}</td><td>{{row.item}}</td><td>{{number row.qty}}</td></tr>{{/each}}</table><p>{{date field.issuedOn}} · {{money field.amount}} · {{total lines.lines.price}}</p>{{#if field.note}}<p>{{field.note}}</p>{{else}}<p>بلا ملاحظة</p>{{/if}}',
      },
      1
    )
    assert.equal(saved.version, 1)
    const stored = await templates.get('pt_bills', 'receipt')
    assert.notInclude(stored.body, 'script')
    assert.notInclude(stored.body, 'onclick')
    assert.include(stored.body, '<h1>{{label "customer"}}')
  })

  test('editing creates version 2, keeps version 1 and prints record the version used', async ({
    assert,
  }) => {
    const saved = await templates.update(
      'pt_bills',
      'receipt',
      {
        label: 'إيصال مختصر',
        body: '<p>{{field.customer}} — {{digits id}} — {{date field.issuedOn}} — {{money field.amount}}</p>',
        paper: 'A5',
        orientation: 'portrait',
        footer: 'نسخة {{company}}',
      },
      1
    )
    assert.equal(saved.version, 2)
    const versions = await templates.versions('pt_bills', 'receipt')
    assert.deepEqual(
      versions.map((version) => version.version),
      [2, 1]
    )
    assert.include(versions[1].body, '{{#each lines.lines}}')
    await assert.rejects(() =>
      db('print_template_versions').where('version', 1).update({ body: 'x' })
    )
    await assert.rejects(() => db('print_template_versions').where('version', 1).del())
    const printed = await templates.print(service, 'pt_bills', id, owner, {
      template: 'receipt',
      identity,
      printedBy: 'المدقق',
      calendar: 'islamic-umalqura',
      digits: 'arab',
    })
    assert.deepEqual(printed.template, { key: 'receipt', version: '2', source: 'custom' })
    assert.include(printed.html, '@page { size: A5 portrait;')
    assert.include(printed.html, 'نسخة شركة الاختبار')
    // Arabic-Indic digits and the Umm al-Qura calendar (20 March 2026 is 1 Shawwal 1447).
    assert.include(printed.html, `— ${String(id).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)])} —`)
    assert.include(printed.html, '١٤٤٧')
    assert.include(printed.html, '١٢٬٣٤٥٫٠٠')
    await templates.recordPrinted('pt_bills', id, owner, printed.template, 'pdf')
    const [activity] = await db('activities')
      .where({ resource: 'pt_bills', record_id: id, action: 'printed' })
      .orderBy('id', 'desc')
      .limit(1)
    assert.deepEqual(activity.changes, { template: 'receipt', version: '2', format: 'pdf' })
  })

  test('a reader without the field sees it empty although the template names it', async ({
    assert,
  }) => {
    const printed = await templates.print(service, 'pt_bills', id, clerk, {
      template: 'receipt',
      identity,
      printedBy: 'الموظف',
      calendar: 'gregory',
      digits: 'latn',
    })
    assert.notInclude(printed.html, '12,345.00')
    assert.notInclude(printed.html, '1234500')
    assert.include(printed.html, 'مؤسسة النور')
  })

  test('preview renders a draft against a readable record without saving or auditing', async ({
    assert,
  }) => {
    const before = await db('activities').count('* as count').first()
    const preview = await templates.preview(
      service,
      'pt_bills',
      { label: 'مسودة', body: '<p>معاينة {{field.note}}</p>' },
      owner,
      { identity, printedBy: 'المدير' }
    )
    assert.equal(preview.recordId, id)
    assert.include(preview.html, 'معاينة ملاحظة للعميل')
    const after = await db('activities').count('* as count').first()
    assert.equal(Number(after?.count), Number(before?.count))
    await rejectsWith(
      () =>
        templates.preview(service, 'pt_bills', { label: 'مسودة', body: '{{nope}}' }, owner, {
          identity,
          printedBy: 'x',
        }),
      /nope/
    )
    const options = await templates.available(service, 'pt_bills', clerk)
    assert.deepEqual(
      options.map((option) => [option.key, option.source]),
      [
        ['default', 'generic'],
        ['invoice', 'code'],
        ['receipt', 'custom'],
      ]
    )
  })
})

test.group('Print template hardening', (group) => {
  const service = new ResourceService(db, registry)
  const templates = new PrintTemplates(db, registry)
  const options = { identity, printedBy: 'المدقق', calendar: 'gregory', digits: 'latn' } as const
  let id: number
  let productId: number
  group.setup(async () => {
    await setup()
    for (const resource of registry.all()) await createResourceTable(db, resource)
    await db('lookups').insert([
      { group: 'pt_units', key: 'box', label_ar: 'صندوق', label_en: 'Box' },
      { group: 'pt_units', key: 'piece', label_ar: 'قطعة', label_en: 'Piece' },
    ])
    const created = await service.save('pt_products', owner, { name: 'ورق تصوير A4' })
    productId = Number(created.id)
    const saved = await service.save('pt_bills', owner, {
      customer: 'عميل البنود الكثيرة',
      amount: '100',
      orgUnitId: 2,
      lines: [{ item: 'أول', qty: 1, price: '100', unit: 'box', productId }],
    })
    id = Number(saved.id)
    // 119 more lines through SQL, so the bill holds 120 lines.
    await db('pt_bill_lines').insert(
      Array.from({ length: 119 }, (_, index) => ({
        bill_id: id,
        item: `بند ${index + 2}`,
        qty: 1,
        price: '100',
        org_unit_id: 2,
        created_by: 1,
        updated_by: 1,
      }))
    )
  })

  test('more than 100 lines print in full with an untruncated total; over the limit is refused', async ({
    assert,
  }) => {
    const { html } = await templates.print(service, 'pt_bills', id, owner, {
      ...options,
      template: 'invoice',
    })
    assert.include(html, 'بند 120')
    assert.include(html, '<th>إجمالي الكمية</th><td>120</td>')
    assert.include(html, '<th>إجمالي السعر</th><td>120.00</td>')
    const generic = await templates.print(service, 'pt_bills', id, owner, options)
    assert.include(generic.html, 'بند 120')
    await db('pt_bill_lines').insert(
      Array.from({ length: 881 }, () => ({
        bill_id: id,
        item: 'زائد',
        qty: 1,
        price: '1',
        org_unit_id: 2,
        created_by: 1,
        updated_by: 1,
      }))
    )
    await rejectsWith(
      () => templates.print(service, 'pt_bills', id, owner, { ...options, template: 'invoice' }),
      /حد الطباعة/
    )
    await rejectsWith(() => templates.print(service, 'pt_bills', id, owner, options), /حد الطباعة/)
    await db('pt_bill_lines').where({ bill_id: id, item: 'زائد' }).del()
  })

  test('lines show their own lookup labels and related record titles', async ({ assert }) => {
    await templates.create(
      'pt_bills',
      {
        key: 'units',
        label: 'وحدات',
        body: '{{#each lines.lines}}{{#if row.unit}}<p>[{{row.unit}}|{{row.productId}}]</p>{{/if}}{{/each}}',
      },
      1
    )
    const { html } = await templates.print(service, 'pt_bills', id, owner, {
      ...options,
      template: 'units',
    })
    assert.include(html, '[صندوق|ورق تصوير A4]')
  })

  test('lines from another organization unit and unreadable line groups are absent', async ({
    assert,
  }) => {
    // A line of the bill stored in another unit (for example after the unit moved).
    await db('pt_bill_lines').insert({
      bill_id: id,
      item: 'بند وحدة أخرى',
      qty: 50,
      price: '5000',
      org_unit_id: 3,
      created_by: 1,
      updated_by: 1,
    })
    const ownerCopy = await templates.print(service, 'pt_bills', id, owner, {
      ...options,
      template: 'invoice',
    })
    assert.include(ownerCopy.html, 'بند وحدة أخرى')
    const clerkCopy = await templates.print(service, 'pt_bills', id, clerk, {
      ...options,
      template: 'invoice',
    })
    assert.notInclude(clerkCopy.html, 'بند وحدة أخرى')
    assert.include(clerkCopy.html, '<th>إجمالي الكمية</th><td>120</td>')
    // A reader whose rule leaves out the lines field reads no line group at all.
    const noLines: Actor = {
      ...clerk,
      rules: [
        { subject: 'pt_bills', action: 'view', fields: ['customer', 'issuedOn', 'note'] },
        { subject: 'pt_bill_lines', action: 'view' },
      ],
    }
    const fieldless = await templates.print(service, 'pt_bills', id, noLines, {
      ...options,
      template: 'invoice',
    })
    assert.include(fieldless.html, 'عميل البنود الكثيرة')
    assert.notInclude(fieldless.html, 'بند 2')
    assert.notInclude(fieldless.html, 'إجمالي الكمية')
    // A group the record does not expose (not in list, show or a code template) is refused.
    await rejectsWith(
      () =>
        templates.create(
          'pt_bills',
          {
            key: 'payments',
            label: 'دفعات',
            body: '{{#each lines.payments}}{{row.paid}}{{/each}}',
          },
          1
        ),
      /lines\.payments/
    )
  })

  test('digits and the time zone apply to document values and the printed line', async ({
    assert,
  }) => {
    await templates.create(
      'pt_bills',
      {
        key: 'meta',
        label: 'قيم',
        body: '<p>[{{id}}]</p>{{#each lines.lines}}{{#if row.unit}}<p>[{{rowNumber}}]</p>{{/if}}{{/each}}<p>[{{printedAt}}]</p>',
      },
      1
    )
    const { html } = await templates.print(service, 'pt_bills', id, owner, {
      ...options,
      template: 'meta',
      digits: 'arab',
      timeZone: 'Asia/Riyadh',
      printedAt: new Date('2026-10-01T09:05:00Z'),
    })
    const arab = (text: string) => text.replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)])
    assert.include(html, `[${arab(String(id))}]`)
    assert.include(html, `[${arab('1')}]`)
    // 09:05 UTC is 12:05 in Riyadh.
    assert.include(html, arab('12:05'))
    assert.include(html, '(Asia/Riyadh)')
    assert.notInclude(html, 'UTC')
  })

  test('create refuses an existing key, update needs one and keeps the stored active flag', async ({
    assert,
  }) => {
    await rejectsWith(
      () => templates.create('pt_bills', { key: 'meta', label: 'مكرر', body: '<p>x</p>' }, 1),
      /يوجد قالب/,
      409
    )
    await rejectsWith(
      () => templates.update('pt_bills', 'missing', { label: 'غائب', body: '<p>x</p>' }, 1),
      /غير موجود/,
      404
    )
    await templates.update('pt_bills', 'meta', { label: 'قيم', body: '<p>x</p>', active: false }, 1)
    await templates.update('pt_bills', 'meta', { label: 'قيم', body: '<p>y</p>' }, 1)
    const stored = await templates.get('pt_bills', 'meta')
    assert.isFalse(stored.active)
  })

  test('the renderer prints only fields of the reader description, whatever the record holds', ({
    assert,
  }) => {
    const description = service.describe('pt_bills', clerk)
    assert.isFalse(description.fields.some((field) => field.key === 'amount'))
    const html = renderTemplateDocument(
      {
        resource: description,
        // A record object carrying a value the description does not grant.
        record: { id: 7, customer: 'مرئي', amount: '999900' },
      },
      {
        title: 'اختبار',
        paper: 'A4',
        orientation: 'portrait',
        body: '<p>{{field.customer}}|{{field.amount}}|{{money field.amount}}|{{label "amount"}}</p>',
      },
      options
    )
    assert.include(html, '<p>مرئي|||</p>')
    assert.notInclude(html, '9,999.00')
  })

  test('the sanitizer stays linear on pathological markup', ({ assert }) => {
    for (const input of [
      '<a'.repeat(10000),
      '<p title="'.repeat(10000),
      '<b>'.repeat(20000),
      '<script>'.repeat(10000),
      '<div style="'.repeat(10000),
    ]) {
      const started = performance.now()
      sanitizePrintHtml(input)
      assert.isBelow(performance.now() - started, 200, input.slice(0, 10))
    }
  })
})
