import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  decimalDisplay,
  decimalInput,
  decimalScale,
  canonicalValue,
  emailHref,
  fieldApplies,
  hiddenFields,
  toLatinDigits,
  listInput,
  listValue,
  orderedSelection,
  parseDecimal,
  phoneHref,
  safeUrl,
} from '../registry/ui/field_values.ts'

test('decimal entry accepts Arabic-Indic digits and the Arabic separator, padded to the scale', () => {
  assert.equal(parseDecimal('١٢٫٥', 2), '12.50')
  assert.equal(parseDecimal('۴.۵', 1), '4.5')
  assert.equal(parseDecimal('1,234.5', 2), '1234.50')
  assert.equal(parseDecimal('.5', 2), '0.50')
  assert.equal(parseDecimal('-0', 2), '0.00')
  assert.equal(parseDecimal('-3.10', 1), '-3.1')
  assert.equal(parseDecimal('7', 0), '7')
  // Trailing zeros beyond the scale are not extra precision.
  assert.equal(parseDecimal('2.500', 2), '2.50')
  assert.throws(() => parseDecimal('1.234', 2), /المنازل العشرية/)
  assert.throws(() => parseDecimal('12.5', 0), /المنازل العشرية/)
  for (const invalid of ['abc', '.', '1.2.3', '--1', '1e3'])
    assert.throws(() => parseDecimal(invalid, 2), /رقماً عشرياً/, invalid)
  assert.equal(decimalInput('9.5', 2), '9.50')
  assert.equal(decimalInput(null, 2), '')
  assert.equal(decimalScale({ key: 'rate', type: 'decimal', scale: 1, label: { ar: 'م' } }), 1)
  assert.equal(decimalScale({ key: 'rate', type: 'percent', label: { ar: 'م' } }), 2)
})

test('decimal display keeps every digit of large values and the interface language', () => {
  assert.equal(decimalDisplay('1234567890123456.55', 2, 'en'), '1,234,567,890,123,456.55')
  assert.equal(decimalDisplay('4.5', 1, 'ar'), '4.5')
  assert.match(decimalDisplay('12.5', 2, 'ar'), /^12.50$/)
  assert.equal(decimalDisplay(null, 2), '')
})

test('multi-value state is a JSON list stored in option order', () => {
  assert.deepEqual(listValue(''), [])
  assert.deepEqual(listValue('not json'), [])
  assert.deepEqual(listValue(listInput([3, 7, 3])), ['3', '7'])
  assert.equal(listInput([]), '')
  const options = [{ value: 'bank' }, { value: 'cheque' }, { value: 'cash' }]
  assert.deepEqual(orderedSelection(options, ['cash', 'bank', 'unknown']), ['bank', 'cash'])
})

test('visibleWhen compares sibling values as strings, lists and multiSelect membership', () => {
  const local = { visibleWhen: { kind: 'local' } }
  assert.equal(fieldApplies({}, {}), true)
  assert.equal(fieldApplies(local, { kind: 'local' }), true)
  assert.equal(fieldApplies(local, { kind: 'international' }), false)
  assert.equal(fieldApplies(local, {}), false)
  assert.equal(fieldApplies({ visibleWhen: { kind: ['a', 'b'] } }, { kind: 'b' }), true)
  assert.equal(fieldApplies({ visibleWhen: { active: true } }, { active: 'true' }), true)
  assert.equal(fieldApplies({ visibleWhen: { active: true } }, { active: 'false' }), false)
  assert.equal(fieldApplies({ visibleWhen: { days: 30 } }, { days: '30' }), true)
  assert.equal(fieldApplies({ visibleWhen: { note: null } }, { note: '' }), true)
  // Every condition must hold.
  assert.equal(
    fieldApplies({ visibleWhen: { kind: 'local', active: true } }, { kind: 'local', active: 'false' }),
    false
  )
  const multi = { methods: { type: 'multiSelect' } }
  const cash = { visibleWhen: { methods: 'cash' } }
  assert.equal(fieldApplies(cash, { methods: '["bank","cash"]' }, multi), true)
  assert.equal(fieldApplies(cash, { methods: '["bank"]' }, multi), false)
})

test('links are built only for safe http(s) URLs, plain addresses and phone numbers', () => {
  assert.equal(safeUrl('https://united.example/path'), 'https://united.example/path')
  assert.equal(safeUrl('HTTP://Example.com'), 'http://example.com/')
  for (const unsafe of ['javascript:alert(1)', 'data:text/html,x', '/relative', '//host', 'ftp://x', 42])
    assert.equal(safeUrl(unsafe), null, String(unsafe))
  assert.equal(emailHref('sales@united.example'), 'mailto:sales@united.example')
  assert.equal(emailHref('a@b@c'), null)
  assert.equal(emailHref('x@y.z?cc=evil@x'), null)
  assert.equal(phoneHref('+966551234567'), 'tel:+966551234567')
  assert.equal(phoneHref('٠٥٠ ١٢٣ ٤٥٦٧'), 'tel:0501234567')
  assert.equal(phoneHref('call me'), null)
})

test('visibleWhen compares canonically, as the server does', () => {
  const siblings = {
    rate: { type: 'decimal', scale: 2 },
    share: { type: 'percent' },
    days: { type: 'integer' },
    code: { type: 'string' },
  }
  // A decimal typed or stored as 12.5 matches the canonical rule value "12.50", and back.
  assert.equal(fieldApplies({ visibleWhen: { rate: '12.50' } }, { rate: '12.5' }, siblings), true)
  assert.equal(fieldApplies({ visibleWhen: { rate: 12.5 } }, { rate: '12.50' }, siblings), true)
  assert.equal(fieldApplies({ visibleWhen: { rate: '12.50' } }, { rate: '١٢٫٥' }, siblings), true)
  assert.equal(fieldApplies({ visibleWhen: { rate: '12.50' } }, { rate: '12.51' }, siblings), false)
  assert.equal(fieldApplies({ visibleWhen: { share: ['5.00', '10.00'] } }, { share: '10' }, siblings), true)
  assert.equal(fieldApplies({ visibleWhen: { days: 30 } }, { days: '030' }, siblings), true)
  // Text compares as typed: the server does not trim it either.
  assert.equal(fieldApplies({ visibleWhen: { code: 'A1' } }, { code: '  A1 ' }, siblings), false)
  assert.equal(fieldApplies({ visibleWhen: { code: 'A1' } }, { code: 'A1' }, siblings), true)
  // Whitespace only is empty.
  assert.equal(fieldApplies({ visibleWhen: { code: null } }, { code: '   ' }, siblings), true)
  // An unparsable decimal compares as its trimmed text instead of throwing.
  assert.equal(canonicalValue(' 1.2.3 ', siblings.rate), '1.2.3')
  assert.equal(canonicalValue('4.5', { type: 'decimal', scale: 1 }), '4.5')
})

test('a visibleWhen chain hides to a fixed point, like the server', () => {
  // C depends on B, B on A: hiding B hides C even though C's own condition reads B's value.
  const fields = [
    { key: 'a', type: 'enum' },
    { key: 'b', type: 'enum', visibleWhen: { a: 'yes' } },
    { key: 'c', type: 'string', visibleWhen: { b: 'on' } },
    { key: 'd', type: 'string', visibleWhen: { c: null } },
  ]
  assert.deepEqual([...hiddenFields(fields, { a: 'yes', b: 'on', c: 'x' })], ['d'])
  // b keeps its typed value 'on' while hidden; c must still hide, and d (c empty) shows.
  assert.deepEqual([...hiddenFields(fields, { a: 'no', b: 'on', c: 'x' })].sort(), ['b', 'c'])
  assert.deepEqual([...hiddenFields(fields, { a: 'no', b: 'on', c: '' })].sort(), ['b', 'c'])
})

test('visibleWhen null on a multiSelect sibling means no selection', () => {
  const siblings = { channels: { type: 'multiSelect' } }
  const none = { visibleWhen: { channels: null } }
  assert.equal(fieldApplies(none, { channels: '' }, siblings), true)
  assert.equal(fieldApplies(none, { channels: '[]' }, siblings), true)
  assert.equal(fieldApplies(none, { channels: '["mail"]' }, siblings), false)
})

test('sibling values are canonical like the server: e-mail, phone, URL and string formats', () => {
  const siblings = {
    email: { type: 'email' },
    phone: { type: 'phone' },
    site: { type: 'url' },
    contact: { type: 'string', format: 'email' },
  }
  const applies = (key, rule, raw) =>
    fieldApplies({ visibleWhen: { [key]: rule } }, { [key]: raw }, siblings)
  assert.equal(applies('email', 'sales@x.example', ' Sales@X.Example '), true)
  assert.equal(applies('contact', 'sales@x.example', 'SALES@x.example'), true)
  assert.equal(applies('phone', '+966551234567', '+966 55-123 (4567)'), true)
  assert.equal(applies('phone', '0501234567', '٠٥٠ ١٢٣ ٤٥٦٧'), true)
  assert.equal(applies('phone', '0501234567', '+0501234567'), false)
  assert.equal(applies('site', 'https://x.example', ' https://x.example '), true)
})

test('commas count only as thousands grouping', () => {
  assert.equal(toLatinDigits('1,234.5'), '1234.5')
  assert.equal(toLatinDigits('١٬٢٣٤٫٥'), '1234.5')
  assert.equal(toLatinDigits('12,345,678'), '12345678')
  assert.equal(toLatinDigits('1,5'), '1,5')
  assert.equal(parseDecimal('1,234.5', 2), '1234.50')
  for (const invalid of ['1,5', '12,34', '1,2345', ',123', '1,,234'])
    assert.throws(() => parseDecimal(invalid, 2), /رقماً عشرياً/, invalid)
})
