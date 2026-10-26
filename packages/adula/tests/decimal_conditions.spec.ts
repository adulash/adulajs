import { test } from '@japa/runner'
import {
  accessibleBy,
  buildAbility,
  canRecord,
  conditionSql,
  createResourceTable,
  defineResource,
} from '../index.js'
import type { Rule } from '../index.js'
import { fromRow } from '../src/admin/contracts.js'
import { predicates } from '../src/auth/conditions.js'
import { admin, db, setup } from './helpers.js'

/**
 * Decimal and percent role rules evaluated in memory (CASL, canRecord) and in SQL
 * (accessibleBy on a real numeric column) must allow the same records. Text comparison
 * would get the boundaries wrong: '9.50' > '10.00' and '100.00' < '20.00' as strings.
 */
const resource = defineResource({
  name: 'decimal_rules',
  label: { ar: 'قواعد عشرية' },
  scoped: false,
  fields: {
    rate: { type: 'decimal', precision: 8, scale: 2, label: { ar: 'السعر' } },
    share: { type: 'percent', label: { ar: 'النسبة' } },
  },
  list: ['rate', 'share'],
  form: ['rate', 'share'],
  show: ['rate', 'share'],
  actions: ['view'],
})

const rows = [
  { id: 1, rate: '9.50', share: '9.50' },
  { id: 2, rate: '10.00', share: '10.00' },
  { id: 3, rate: '100.00', share: '100.00' },
  { id: 4, rate: '20.00', share: '20.00' },
  { id: 5, rate: '12.50', share: '12.50' },
  { id: 6, rate: '-3.25', share: '0.00' },
  { id: 7, rate: null, share: null },
]

const cases: [string, Rule[], number[]][] = [
  [
    '$gt 10',
    [{ action: 'view', subject: resource.name, conditions: { rate: { $gt: '10.00' } } }],
    [3, 4, 5],
  ],
  [
    '$lt 10',
    [{ action: 'view', subject: resource.name, conditions: { rate: { $lt: '10.00' } } }],
    [1, 6],
  ],
  [
    '$gt 20',
    [{ action: 'view', subject: resource.name, conditions: { rate: { $gt: '20.00' } } }],
    [3],
  ],
  [
    '$lt 100',
    [{ action: 'view', subject: resource.name, conditions: { rate: { $lt: '100.00' } } }],
    [1, 2, 4, 5, 6],
  ],
  ['$eq 12.50', [{ action: 'view', subject: resource.name, conditions: { rate: '12.50' } }], [5]],
  [
    '$ne 12.50',
    [{ action: 'view', subject: resource.name, conditions: { rate: { $ne: '12.50' } } }],
    [1, 2, 3, 4, 6, 7],
  ],
  [
    '$in with null',
    [
      {
        action: 'view',
        subject: resource.name,
        conditions: { rate: { $in: ['9.50', '100.00', null] } },
      },
    ],
    [1, 3, 7],
  ],
  [
    'percent $gt 9.50',
    [{ action: 'view', subject: resource.name, conditions: { share: { $gt: '9.50' } } }],
    [2, 3, 4, 5],
  ],
  [
    'percent $lt 20',
    [{ action: 'view', subject: resource.name, conditions: { share: { $lt: '20.00' } } }],
    [1, 2, 5, 6],
  ],
  [
    'inverted $gt 10',
    [
      { action: 'view', subject: resource.name },
      {
        action: 'view',
        subject: resource.name,
        inverted: true,
        conditions: { rate: { $gt: '10.00' } },
      },
    ],
    [1, 2, 6, 7],
  ],
  [
    'inverted $lt 100 on a range',
    [
      { action: 'view', subject: resource.name, conditions: { rate: { $gt: '9.50' } } },
      {
        action: 'view',
        subject: resource.name,
        inverted: true,
        conditions: { rate: { $lt: '20.00' } },
      },
    ],
    [3, 4],
  ],
]

test.group('Decimal and percent rules: CASL and PostgreSQL agree', (group) => {
  group.setup(async () => {
    await setup()
    await createResourceTable(db, resource)
    await db(resource.name).insert(rows.map((row) => ({ ...row, created_by: 1, updated_by: 1 })))
  })

  for (const [label, rules, expected] of cases)
    test(label, async ({ assert }) => {
      const ability = buildAbility(rules, [resource])
      const sql = await accessibleBy(db(`${resource.name} as r`), ability, admin, 'view', resource)
        .select('r.id')
        .orderBy('r.id')
      const stored = await db(resource.name).orderBy('id')
      const memory = stored
        .filter((row) => canRecord(ability, admin, resource, 'view', fromRow(row, resource)))
        .map((row) => row.id)
      assert.deepEqual(memory, expected, 'in memory')
      assert.deepEqual(
        sql.map((row: { id: number }) => row.id),
        expected,
        'in SQL'
      )
    })

  test('non-canonical operands and schema-less ordered rules are refused before SQL', ({
    assert,
  }) => {
    // '12.5' is a valid number but not the stored form "12.50": refused rather than guessed.
    for (const operand of ['12.5', '12.500', '1e1', ' 12.50', '123456789.00'])
      assert.throws(
        () => conditionSql({ rate: operand }, resource),
        /canonical decimal strings with 2 decimals/,
        operand
      )
    assert.throws(() => conditionSql({ rate: { $gt: 10 } }, resource), /expected string/)
    assert.doesNotThrow(() => conditionSql({ rate: { $gt: '-3.25' } }, resource))
    // Without resource schemas CASL would compare decimal strings as text.
    for (const field of ['rate', 'share']) {
      const untyped = buildAbility([
        { action: 'view', subject: resource.name, conditions: { [field]: { $gt: '10.00' } } },
      ])
      assert.throws(
        () => accessibleBy(db(`${resource.name} as r`), untyped, admin, 'view', resource),
        /require buildAbility\(rules, resourceSchemas\)/
      )
    }
    // Only the documented operators exist: $gte and $lte are refused, never ignored.
    for (const operator of ['$gte', '$lte'])
      assert.throws(
        () => predicates({ rate: { [operator]: '10.00' } }),
        /Unsupported condition operator/
      )
  })

  test('in-memory equality compares values, so 12.5 and 12.50 agree', ({ assert }) => {
    const ability = buildAbility(
      [{ action: 'view', subject: resource.name, conditions: { rate: '12.50' } }],
      [resource]
    )
    for (const rate of ['12.50', '12.5', '12.500'])
      assert.isTrue(canRecord(ability, admin, resource, 'view', { id: 1, rate }), rate)
    assert.isFalse(canRecord(ability, admin, resource, 'view', { id: 1, rate: '12.51' }))
  })
})
