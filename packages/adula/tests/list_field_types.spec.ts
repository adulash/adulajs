import { test } from '@japa/runner'
import {
  Dashboards,
  ResourceRegistry,
  ResourceService,
  createResourceTable,
  defineDashboard,
  defineResource,
} from '../index.js'
import type { RecordData } from '../index.js'
import { admin, db, setup } from './helpers.js'
import { failure } from './helpers/failure.js'

// The list layer (ADR 046) over the field types of ADR 045: deals with labels, channels and rates.
const label = defineResource({
  name: 'lf_labels',
  label: { ar: 'التصنيفات' },
  scoped: false,
  fields: { name: { type: 'string', required: true, label: { ar: 'الاسم' } } },
  list: ['name'],
  form: ['name'],
  show: ['name'],
  title: ['name'],
  actions: ['view', 'create', 'update', 'delete'],
})
const deal = defineResource({
  name: 'lf_deals',
  label: { ar: 'الصفقات' },
  scoped: false,
  fields: {
    title: { type: 'string', required: true, sortable: true, label: { ar: 'العنوان' } },
    kind: {
      type: 'enum',
      filterable: true,
      options: [
        { value: 'new', label: { ar: 'جديدة', en: 'New' } },
        { value: 'renewal', label: { ar: 'تجديد', en: 'Renewal' } },
        { value: 'upsell', label: { ar: 'توسعة', en: 'Upsell' } },
      ],
      label: { ar: 'النوع' },
    },
    channels: {
      type: 'multiSelect',
      filterable: true,
      options: [
        { value: 'email', label: { ar: 'بريد' } },
        { value: 'sms', label: { ar: 'رسالة' } },
        { value: 'call', label: { ar: 'اتصال' } },
      ],
      label: { ar: 'القنوات' },
    },
    labels: {
      type: 'manyToMany',
      resource: 'lf_labels',
      filterable: true,
      label: { ar: 'التصنيفات' },
    },
    rate: { type: 'decimal', precision: 10, scale: 2, filterable: true, label: { ar: 'السعر' } },
    share: { type: 'percent', filterable: true, label: { ar: 'الحصة' } },
    email: { type: 'email', filterable: true, label: { ar: 'البريد' } },
  },
  list: ['title', 'kind', 'channels', 'labels', 'rate', 'share', 'email'],
  form: ['title', 'kind', 'channels', 'labels', 'rate', 'share', 'email'],
  show: ['title', 'kind', 'channels', 'labels', 'rate', 'share', 'email'],
  actions: ['view', 'create', 'update', 'delete'],
})
const registry = new ResourceRegistry().register([
  { name: 'lf', label: { ar: 'قوائم الأنواع' }, dependsOn: [], resources: [label, deal] },
])
const service = new ResourceService(db, registry)

async function titles(filters: Record<string, unknown>) {
  const page = await service.list(deal.name, admin, { filters, sort: 'title' })
  return page.data.map((row) => row.title)
}

test.group('List filters over the field types of ADR 045', (group) => {
  let vip: RecordData
  let local: RecordData
  group.setup(async () => {
    await setup()
    await createResourceTable(db, label)
    await createResourceTable(db, deal)
    vip = await service.save(label.name, admin, { name: '=مميز' })
    local = await service.save(label.name, admin, { name: 'محلي' })
    const rows: RecordData[] = [
      {
        title: 'Alpha',
        kind: 'new',
        channels: ['email', 'sms'],
        labels: [Number(vip.id), Number(local.id)],
        rate: '10.50',
        share: '5.25',
        email: 'a@example.test',
      },
      {
        title: 'Beta',
        kind: 'renewal',
        channels: ['call'],
        labels: [Number(local.id)],
        rate: '-3.00',
        share: '20.00',
      },
      { title: 'Gamma', kind: 'upsell', channels: [], labels: [], rate: '99.99' },
      { title: 'Delta' },
    ]
    for (const row of rows) await service.save(deal.name, admin, row)
  })

  test('multiSelect filters by one member, or by having none', async ({ assert }) => {
    assert.deepEqual(await titles({ channels: 'sms' }), ['Alpha'])
    assert.deepEqual(await titles({ channels: 'call' }), ['Beta'])
    // No channel at all: an empty array and NULL alike.
    assert.deepEqual(await titles({ channels: { empty: true } }), ['Delta', 'Gamma'])
    assert.deepEqual(await titles({ channels: { empty: 'false' } }), ['Alpha', 'Beta'])
  })

  test('manyToMany filters by one linked id, or by having no links', async ({ assert }) => {
    assert.deepEqual(await titles({ labels: String(vip.id) }), ['Alpha'])
    assert.deepEqual(await titles({ labels: Number(local.id) }), ['Alpha', 'Beta'])
    assert.deepEqual(await titles({ labels: { empty: 'true' } }), ['Delta', 'Gamma'])
    assert.deepEqual(await titles({ labels: { empty: false } }), ['Alpha', 'Beta'])
  })

  test('decimal and percent take inclusive ranges; enum and email take in', async ({ assert }) => {
    assert.deepEqual(await titles({ rate: { gte: '10.5' } }), ['Alpha', 'Gamma'])
    assert.deepEqual(await titles({ rate: { gte: -5, lte: '10.50' } }), ['Alpha', 'Beta'])
    assert.deepEqual(await titles({ share: { lte: '5.25' } }), ['Alpha'])
    assert.deepEqual(await titles({ kind: { in: 'new,upsell' } }), ['Alpha', 'Gamma'])
    assert.deepEqual(await titles({ kind: { in: ['renewal'] } }), ['Beta'])
    assert.deepEqual(await titles({ kind: { empty: true } }), ['Delta'])
    // Probes are normalized like stored values: e-mail addresses are lowercase.
    assert.deepEqual(await titles({ email: { in: ['A@Example.test', 'b@example.test'] } }), [
      'Alpha',
    ])
  })

  test('operators the field type does not support are 422 E_FILTER', async ({ assert }) => {
    for (const filters of [
      { channels: { in: 'email,sms' } },
      { channels: 'fax' },
      { labels: { in: [String(vip.id)] } },
      { labels: { gte: '1' } },
      { labels: 'x' },
      { kind: { gte: 'new' } },
      { kind: { in: 'new,other' } },
      { rate: { in: '1,2' } },
      { rate: { gte: '1.005' } },
      { share: { lte: 'half' } },
    ]) {
      const error = await failure(() => service.list(deal.name, admin, { filters }))
      assert.equal(error.code, 'E_FILTER', JSON.stringify(filters))
    }
  })

  test('aggregate sums decimal and percent and filters by a manyToMany member', async ({
    assert,
  }) => {
    const { rows } = await service.aggregate(deal.name, admin, {
      filters: { labels: Number(local.id) },
      sum: ['rate', 'share'],
    })
    assert.deepEqual(rows, [{ group: {}, count: 2, sum: { rate: '7.50', share: '25.25' } }])
  })

  test('dashboards total decimal and percent fields with their format', async ({ assert }) => {
    const overview = defineDashboard({
      name: 'deals',
      label: { ar: 'الصفقات' },
      widgets: [
        {
          key: 'rates',
          label: { ar: 'الأسعار' },
          resource: deal.name,
          measure: { sum: 'rate' },
          filters: { labels: Number(local.id) },
        },
        {
          key: 'shares',
          label: { ar: 'الحصص' },
          resource: deal.name,
          measure: { sum: 'share' },
          groupBy: 'kind',
        },
      ],
    })
    const result = await new Dashboards(db, registry, service, [overview]).render('deals', admin)
    const [rates, shares] = result.widgets
    assert.deepInclude(rates, { kind: 'total', format: 'decimal', value: '7.50' })
    assert.equal(shares.format, 'percent')
    // Enum groups read as their option labels.
    assert.deepEqual(
      shares.rows?.slice(0, 3).map((row) => [row.label, row.measure]),
      [
        ['جديدة', '5.25'],
        ['تجديد', '20.00'],
        ['توسعة', null],
      ]
    )
    assert.lengthOf(shares.rows ?? [], 4)
    const grouped = defineDashboard({
      name: 'bad',
      label: { ar: 'x' },
      widgets: [
        {
          key: 'a',
          label: { ar: 'أ' },
          resource: deal.name,
          measure: 'count',
          groupBy: 'labels',
        },
      ],
    })
    assert.throws(() => Dashboards.validate(registry, [grouped]), /cannot be grouped/)
  })

  test('the export shows option labels and linked titles, numbers unguarded', async ({
    assert,
  }) => {
    const file = await service.export(deal.name, admin, { sort: 'title' })
    const [header, alpha, beta, delta] = file.content
      .replace(String.fromCharCode(0xfeff), '')
      .split('\r\n')
      .filter(Boolean)
    assert.equal(header, '"العنوان","النوع","القنوات","التصنيفات","السعر","الحصة","البريد"')
    // A title starting with = is still guarded inside a list of titles.
    assert.equal(
      alpha,
      `"Alpha","جديدة","بريد، رسالة","'=مميز، محلي","10.50","5.25","a@example.test"`
    )
    // A negative decimal is a number, not a formula.
    assert.equal(beta, '"Beta","تجديد","اتصال","محلي","-3.00","20.00",""')
    assert.equal(delta, '"Delta","","","","","",""')
  })
})
