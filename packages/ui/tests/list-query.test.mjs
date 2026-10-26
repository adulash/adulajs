import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  bulkPayload,
  choiceFilter,
  clearFilter,
  exportHref,
  filterAllowed,
  filterMode,
  fromSavedFilter,
  inclusiveDatetime,
  normalizeFilter,
  readFilters,
  selectionState,
  serverMessage,
  singleChoice,
  toSavedFilter,
  toggleSelection,
  writeFilter,
} from '../registry/ui/list_query.ts'
import {
  compareDecimal,
  decimal,
  formatDecimal,
  normalizeDashboard,
  normalizeWidget,
  shares,
} from '../registry/ui/dashboard_data.ts'

const decoded = (params) => decodeURIComponent(params.toString())

test('each field type gets the filter control the server accepts for it (ADR 046)', () => {
  for (const type of ['lookup', 'belongsTo', 'user', 'string', 'text'])
    assert.equal(filterMode(type), 'choice', type)
  for (const type of ['integer', 'money', 'date', 'datetime'])
    assert.equal(filterMode(type), 'range', type)
  assert.equal(filterMode('boolean'), 'boolean')
  assert.equal(filterMode('json'), 'text')
})

test('filters are written in the documented query-string shapes', () => {
  const params = new URLSearchParams('search=نور&cursor=abc')
  writeFilter(params, 'status', { op: 'in', values: ['open', 'closed'] })
  writeFilter(params, 'total', { op: 'range', gte: '1000', lte: '9900' })
  writeFilter(params, 'notes', { op: 'empty', empty: true })
  writeFilter(params, 'active', { op: 'eq', value: 'true' })
  writeFilter(params, 'owner', { op: 'in', values: ['7'] })
  assert.equal(
    decoded(params),
    'search=نور&cursor=abc&filters[status][in]=open,closed&filters[total][gte]=1000' +
      '&filters[total][lte]=9900&filters[notes][empty]=true&filters[active]=true&filters[owner]=7'
  )
  // A value containing a comma cannot travel joined; it uses repeated [in][] instead.
  writeFilter(params, 'status', { op: 'in', values: ['a,b', 'c'] })
  assert.deepEqual(params.getAll('filters[status][in][]'), ['a,b', 'c'])
  assert.equal(params.get('filters[status][in]'), null)
})

test('reading the URL round-trips every operator and replacing a filter drops its old operator', () => {
  const params = new URLSearchParams(
    'filters[status][in]=open, closed&filters[total][gte]=10&filters[due][lte]=2026-10-01' +
      '&filters[notes][empty]=false&filters[active]=true&filters[tags][in][]=x,y&filters[tags][in][]=z'
  )
  const filters = readFilters(params, [
    'status',
    'total',
    'due',
    'notes',
    'active',
    'tags',
    'other',
  ])
  assert.deepEqual(filters, {
    status: { op: 'in', values: ['open', 'closed'] },
    total: { op: 'range', gte: '10' },
    due: { op: 'range', lte: '2026-10-01' },
    notes: { op: 'empty', empty: false },
    active: { op: 'eq', value: 'true' },
    tags: { op: 'in', values: ['x,y', 'z'] },
  })
  writeFilter(params, 'total', { op: 'empty', empty: true })
  assert.equal(params.get('filters[total][gte]'), null)
  assert.equal(params.get('filters[total][empty]'), 'true')
  clearFilter(params, 'tags')
  assert.equal(params.getAll('filters[tags][in][]').length, 0)
  writeFilter(params, 'status', null)
  assert.equal(
    [...params.keys()].some((key) => key.startsWith('filters[status]')),
    false
  )
})

test('an empty draft is no filter and a single choice stays plain equality', () => {
  assert.equal(normalizeFilter({ op: 'in', values: [] }), null)
  assert.equal(normalizeFilter({ op: 'range' }), null)
  assert.equal(normalizeFilter({ op: 'eq', value: '' }), null)
  assert.deepEqual(normalizeFilter({ op: 'in', values: ['a', 'a'] }), { op: 'eq', value: 'a' })
  assert.deepEqual(normalizeFilter({ op: 'range', gte: '5', lte: undefined }), {
    op: 'range',
    gte: '5',
  })
})

test('saved views store operator objects and restore them; unknown shapes are dropped', () => {
  const filters = [
    { op: 'eq', value: 'open' },
    { op: 'in', values: ['open', 'closed'] },
    { op: 'range', gte: '100', lte: '900' },
    { op: 'empty', empty: true },
  ]
  for (const filter of filters) assert.deepEqual(fromSavedFilter(toSavedFilter(filter)), filter)
  assert.deepEqual(toSavedFilter(filters[1]), { in: ['open', 'closed'] })
  assert.deepEqual(fromSavedFilter(42), { op: 'eq', value: '42' })
  assert.deepEqual(fromSavedFilter(false), { op: 'eq', value: 'false' })
  assert.equal(fromSavedFilter(null), null)
  assert.equal(fromSavedFilter({ like: '%a%' }), null)
  assert.equal(fromSavedFilter({ empty: 'maybe' }), null)
  assert.equal(fromSavedFilter([1, 2]), null)
})

test('the server export keeps the list query without its cursor or page size', () => {
  const params = new URLSearchParams(
    'search=a&filters[total][gte]=10&sort=total&cursor=xyz&limit=100'
  )
  assert.equal(
    decodeURIComponent(exportHref('invoices', params)),
    '/resources/invoices/export?search=a&filters[total][gte]=10&sort=total'
  )
  assert.equal(exportHref('invoices', new URLSearchParams()), '/resources/invoices/export')
  // The caller's parameters are not modified.
  assert.equal(params.get('cursor'), 'xyz')
})

test('server error messages are read from JSON objects, JSON text and blobs read as text', () => {
  const body = {
    error: { code: 'E_EXPORT_LIMIT', message: 'عدد السجلات المطابقة يتجاوز حد التصدير' },
  }
  assert.equal(serverMessage(body), 'عدد السجلات المطابقة يتجاوز حد التصدير')
  assert.equal(serverMessage(JSON.stringify(body)), 'عدد السجلات المطابقة يتجاوز حد التصدير')
  assert.equal(serverMessage('<html>'), null)
  assert.equal(serverMessage({ error: {} }), null)
  assert.equal(serverMessage(null), null)
})

test('bulk selection reports all, some or none and sends numeric ids with loaded versions', () => {
  let selected = new Set()
  selected = toggleSelection(selected, '1', true)
  assert.equal(selectionState(selected, ['1', '2']), 'indeterminate')
  selected = toggleSelection(selected, '2', true)
  assert.equal(selectionState(selected, ['1', '2']), true)
  assert.equal(selectionState(toggleSelection(selected, '1', false), ['1']), false)
  assert.equal(selectionState(new Set(), []), false)
  assert.deepEqual(
    bulkPayload(
      'delete',
      ['1', '3'],
      [
        { id: 1, version: 4 },
        { id: 2, version: 9 },
        { id: 3, version: null },
      ]
    ),
    { action: 'delete', ids: [1, 3], versions: { 1: 4 } }
  )
})

test('dashboard widgets are normalized, ranked and never invented', () => {
  const view = normalizeDashboard({
    name: 'orders_overview',
    label: 'لوحة الطلبات',
    description: null,
    widgets: [
      {
        key: 'open',
        label: 'الطلبات',
        href: '/resources/orders',
        measure: 'count',
        format: 'count',
        kind: 'total',
        groupBy: null,
        value: 12,
        truncated: false,
      },
      {
        key: 'amount',
        label: 'الإجمالي',
        href: '/resources/orders',
        measure: { sum: 'total' },
        format: 'money',
        kind: 'total',
        groupBy: null,
        value: '150050',
        truncated: false,
      },
      {
        key: 'none',
        label: 'بلا قيم',
        measure: { sum: 'total' },
        format: 'integer',
        kind: 'total',
        value: null,
        truncated: false,
      },
      {
        key: 'byStatus',
        label: 'حسب الحالة',
        measure: 'count',
        format: 'count',
        kind: 'grouped',
        groupBy: 'status',
        rows: [
          { value: 'draft', label: 'مسودة', measure: 2 },
          { value: 'paid', label: 'مدفوعة', measure: '8' },
          { value: null, label: 'غير محدد', measure: 1 },
          { value: 'empty', label: 'بلا مجموع', measure: null },
        ],
        truncated: true,
      },
      { label: 'بلا مفتاح', kind: 'total', value: 3 },
      { key: 'future', kind: 'chart', value: 3 },
      'garbage',
    ],
  })
  assert.deepEqual(
    view.widgets.map((widget) => widget.key),
    ['open', 'amount', 'none', 'byStatus']
  )
  assert.deepEqual(view.widgets[0], {
    key: 'open',
    label: 'الطلبات',
    href: '/resources/orders',
    format: 'count',
    kind: 'total',
    value: '12',
  })
  assert.equal(view.widgets[1].format, 'money')
  assert.equal(view.widgets[1].value, '150050')
  // A sum over no values stays empty; it is not shown as zero.
  assert.equal(view.widgets[2].value, null)
  const grouped = view.widgets[3]
  assert.equal(grouped.kind, 'grouped')
  assert.deepEqual(
    grouped.groups.map((group) => [group.label, group.value]),
    [
      ['مدفوعة', '8'],
      ['مسودة', '2'],
      ['غير محدد', '1'],
    ]
  )
  assert.equal(new Set(grouped.groups.map((group) => group.key)).size, 3)
  assert.equal(grouped.truncated, true)
  assert.deepEqual(normalizeDashboard(undefined), {
    name: '',
    label: '',
    description: null,
    widgets: [],
  })
  assert.equal(normalizeWidget({ key: 'x', kind: 'grouped' }).groups.length, 0)
})

test('proportional bars are relative to the largest value and keep small values visible', () => {
  assert.deepEqual(shares([8, 2, 0, 0.01]), [100, 25, 0, 2])
  assert.deepEqual(shares([]), [])
  assert.deepEqual(shares([0, 0]), [0, 0])
})

test('a datetime «إلى» bound includes the whole chosen day or minute; «من» starts it', () => {
  assert.equal(inclusiveDatetime('2026-10-01', 'lte'), '2026-10-01T23:59:59.999')
  assert.equal(inclusiveDatetime('2026-10-01', 'gte'), '2026-10-01T00:00:00.000')
  assert.equal(inclusiveDatetime('hijri:1448-04-09', 'lte'), 'hijri:1448-04-09T23:59:59.999')
  assert.equal(inclusiveDatetime('2026-10-01T17:30', 'lte'), '2026-10-01T17:30:59.999')
  assert.equal(inclusiveDatetime('2026-10-01T17:30', 'gte'), '2026-10-01T17:30:00.000')
  assert.equal(inclusiveDatetime('2026-10-01T17:30:15', 'lte'), '2026-10-01T17:30:15')
  assert.equal(inclusiveDatetime('', 'lte'), '')
  // The end-of-day bound sorts after every time of that day and before the next day.
  const end = new Date(inclusiveDatetime('2026-10-01', 'lte'))
  assert.ok(end > new Date('2026-10-01T23:59:00'))
  assert.ok(end < new Date('2026-10-02T00:00:00'))
})

test('money and integer sums keep every digit: no Number() rounding', () => {
  // 2^53 + 1 minor units: Number() would print ...992.
  assert.equal(decimal('9007199254740993'), '9007199254740993')
  assert.equal(formatDecimal('9007199254740993', 'money'), '90,071,992,547,409.93')
  assert.equal(formatDecimal('150050', 'money'), '1,500.50')
  assert.equal(formatDecimal('5', 'money'), '0.05')
  assert.equal(formatDecimal('-5', 'money'), '-0.05')
  assert.equal(formatDecimal('0', 'money'), '0.00')
  assert.equal(formatDecimal('12345678901234567890.25', 'integer'), '12,345,678,901,234,567,890.25')
  assert.equal(formatDecimal('1234', 'count'), '1,234')
  assert.equal(decimal('1e21'), null)
  assert.equal(decimal('abc'), null)
  assert.equal(decimal(42), '42')
  assert.equal(compareDecimal('9007199254740993', '9007199254740992'), 1)
  assert.equal(compareDecimal('1.5', '1.50'), 0)
  assert.equal(compareDecimal('-2', '1'), -1)
  const view = normalizeDashboard({
    widgets: [
      {
        key: 'sums',
        kind: 'grouped',
        format: 'money',
        rows: [
          { value: 'a', label: 'أ', measure: '9007199254740992' },
          { value: 'b', label: 'ب', measure: '9007199254740993' },
        ],
      },
    ],
  })
  assert.deepEqual(
    view.widgets[0].groups.map((group) => group.value),
    ['9007199254740993', '9007199254740992']
  )
  assert.deepEqual(shares(['8', '2']), [100, 25])
})

test('the field types of ADR 045 get the controls and operators the server accepts', () => {
  for (const type of ['enum', 'email', 'phone', 'url', 'multiSelect', 'manyToMany'])
    assert.equal(filterMode(type), 'choice', type)
  for (const type of ['decimal', 'percent']) assert.equal(filterMode(type), 'range', type)
  // Several-valued fields match one member: never «أيٌّ من» (in) and never a range.
  for (const type of ['multiSelect', 'manyToMany']) {
    assert.equal(singleChoice(type), true, type)
    assert.equal(filterAllowed(type, { op: 'in', values: ['a', 'b'] }), false, type)
    assert.equal(filterAllowed(type, { op: 'range', gte: '1' }), false, type)
    assert.equal(filterAllowed(type, { op: 'eq', value: 'a' }), true, type)
    assert.equal(filterAllowed(type, { op: 'empty', empty: true }), true, type)
  }
  for (const type of ['enum', 'email', 'phone', 'url', 'lookup', 'belongsTo']) {
    assert.equal(singleChoice(type), false, type)
    assert.equal(filterAllowed(type, { op: 'in', values: ['a', 'b'] }), true, type)
    assert.equal(filterAllowed(type, { op: 'range', gte: '1' }), false, type)
  }
  for (const type of ['decimal', 'percent']) {
    assert.equal(filterAllowed(type, { op: 'range', gte: '1.5' }), true, type)
    assert.equal(filterAllowed(type, { op: 'in', values: ['1', '2'] }), false, type)
  }
})

test('member choices emit one equality; other choices emit in', () => {
  // Choosing a second option replaces the first: the latest choice is the member.
  assert.deepEqual(choiceFilter('multiSelect', ['sms', 'call']), { op: 'eq', value: 'call' })
  assert.deepEqual(choiceFilter('manyToMany', ['7']), { op: 'eq', value: '7' })
  assert.equal(choiceFilter('manyToMany', []), null)
  assert.deepEqual(choiceFilter('enum', ['person', 'company']), {
    op: 'in',
    values: ['person', 'company'],
  })
  const params = new URLSearchParams()
  writeFilter(params, 'channels', normalizeFilter(choiceFilter('multiSelect', ['sms', 'call'])))
  writeFilter(params, 'tags', normalizeFilter(choiceFilter('manyToMany', ['7'])))
  writeFilter(params, 'kind', normalizeFilter(choiceFilter('enum', ['person', 'company'])))
  writeFilter(params, 'rate', { op: 'range', gte: '10.50', lte: '99.00' })
  writeFilter(params, 'discount', { op: 'range', lte: '7.10' })
  writeFilter(params, 'email', normalizeFilter(choiceFilter('email', ['a@x.test'])))
  writeFilter(params, 'label', { op: 'empty', empty: true })
  assert.equal(
    decoded(params),
    'filters[channels]=call&filters[tags]=7&filters[kind][in]=person,company' +
      '&filters[rate][gte]=10.50&filters[rate][lte]=99.00&filters[discount][lte]=7.10' +
      '&filters[email]=a@x.test&filters[label][empty]=true'
  )
  assert.deepEqual(readFilters(params, ['channels', 'tags', 'label']), {
    channels: { op: 'eq', value: 'call' },
    tags: { op: 'eq', value: '7' },
    label: { op: 'empty', empty: true },
  })
})

test('decimal and percent dashboard sums keep their fraction', () => {
  assert.equal(formatDecimal('12345.50', 'decimal'), '12,345.50')
  assert.equal(formatDecimal('-7.125', 'percent'), '-7.125')
  const view = normalizeDashboard({
    widgets: [
      { key: 'rate', kind: 'total', format: 'decimal', value: '37.60' },
      { key: 'share', kind: 'total', format: 'percent', value: '12.5' },
    ],
  })
  assert.deepEqual(
    view.widgets.map((widget) => [widget.format, widget.value]),
    [
      ['decimal', '37.60'],
      ['percent', '12.5'],
    ]
  )
})
