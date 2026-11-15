import { test } from '@japa/runner'
import {
  AdulaError,
  SettingsAdmin,
  UserPreferences,
  definePreference,
  validateUiPreferences,
} from '../index.js'
import { db, setup } from './helpers.js'
import { failure } from './helpers/failure.js'

const theme = definePreference<'light' | 'dark' | 'system'>({
  key: 'shell.theme',
  default: 'light',
  validate(value) {
    if (value === 'light' || value === 'dark' || value === 'system') return value
    throw new AdulaError(422, 'E_PREFERENCE_VALUE', 'قيمة التفضيل غير صالحة')
  },
})
const order = definePreference<string[]>({
  key: 'shell.navOrder',
  default: [],
  validate(value) {
    if (!Array.isArray(value) || value.some((id) => typeof id !== 'string'))
      throw new AdulaError(422, 'E_PREFERENCE_VALUE', 'ترتيب القائمة غير صالح')
    return [...new Set(value as string[])]
  },
})

test.group('User preferences', (group) => {
  group.setup(async () => {
    await setup()
  })
  group.each.setup(async () => {
    await db('settings').where('scope', 'user').delete()
  })

  const preferences = (report?: (key: string, error: unknown) => void) =>
    new UserPreferences(db, [theme, order], report)

  test('returns defaults until the user stores a value', async ({ assert }) => {
    assert.deepEqual(await preferences().all(1), { 'shell.theme': 'light', 'shell.navOrder': [] })
    assert.equal(await preferences().get(1, 'shell.theme'), 'light')
  })

  test('stores the normalized value for one user only', async ({ assert }) => {
    assert.deepEqual(await preferences().set(1, 'shell.navOrder', ['a', 'b', 'a']), ['a', 'b'])
    await preferences().set(1, 'shell.theme', 'dark')
    assert.deepEqual(await preferences().all(1), {
      'shell.theme': 'dark',
      'shell.navOrder': ['a', 'b'],
    })
    // Another user keeps the defaults.
    assert.deepEqual(await preferences().all(2), { 'shell.theme': 'light', 'shell.navOrder': [] })
    const rows = await db('settings').where('scope', 'user').orderBy('key')
    assert.deepEqual(
      rows.map((row) => [row.key, row.scope_id]),
      [
        ['preference.shell.navOrder', '1'],
        ['preference.shell.theme', '1'],
      ]
    )
  })

  test('refuses unknown keys, invalid values and oversized values', async ({ assert }) => {
    const unknown = await failure(preferences().set(1, 'shell.unknown', 'x'))
    assert.equal(unknown.status, 404)
    assert.equal(unknown.code, 'E_PREFERENCE_UNKNOWN')
    const invalid = await failure(preferences().set(1, 'shell.theme', 'purple'))
    assert.equal(invalid.status, 422)
    assert.equal(invalid.code, 'E_PREFERENCE_VALUE')
    // The cap counts UTF-8 bytes: 2100 Arabic letters are 2100 characters but 4200 bytes.
    const large = await failure(preferences().set(1, 'shell.navOrder', ['ع'.repeat(2100)]))
    assert.equal(large.code, 'E_PREFERENCE_TOO_LARGE')
    assert.lengthOf(await db('settings').where('scope', 'user'), 0)
  })

  test('reset removes the stored value and returns the default', async ({ assert }) => {
    await preferences().set(1, 'shell.theme', 'dark')
    assert.equal(await preferences().reset(1, 'shell.theme'), 'light')
    assert.equal(await preferences().get(1, 'shell.theme'), 'light')
    assert.lengthOf(await db('settings').where('scope', 'user'), 0)
  })

  test('a stored value that no longer validates falls back to the default', async ({ assert }) => {
    await db('settings').insert({
      key: 'preference.shell.theme',
      scope: 'user',
      scope_id: '1',
      value: JSON.stringify('sepia'),
    })
    const reported: string[] = []
    assert.equal(await preferences((key) => reported.push(key)).get(1, 'shell.theme'), 'light')
    assert.deepEqual(reported, ['shell.theme'])
  })

  test('validates definitions at boot', ({ assert }) => {
    assert.throws(() =>
      definePreference({ key: 'Theme', default: 'x', validate: (value) => value as string })
    )
    assert.throws(() => UserPreferences.validate([theme, theme]), /Duplicate preference/)
    assert.throws(() =>
      UserPreferences.validate([
        definePreference({ key: 'shell.bad', default: 'x', validate: () => 'y' }),
      ])
    )
  })

  test('the settings screen neither lists nor edits preferences', async ({ assert }) => {
    await preferences().set(1, 'shell.theme', 'dark')
    await db('settings').insert({ key: 'note', scope: 'user', scope_id: '1', value: '"x"' })
    const settings = new SettingsAdmin(db)
    const listed = await settings.list('user', '1')
    assert.deepEqual(
      listed.map((row) => row.key),
      ['note']
    )
    const write = await failure(
      settings.upsert(1, {
        key: 'preference.shell.theme',
        scope: 'user',
        scopeId: '1',
        value: 'light',
      })
    )
    assert.equal(write.code, 'E_SETTING_RESERVED')
    const row = await db('settings').where('key', 'preference.shell.theme').first()
    const remove = await failure(settings.delete(1, row.id))
    assert.equal(remove.code, 'E_SETTING_RESERVED')
    assert.equal(await preferences().get(1, 'shell.theme'), 'dark')
  })

  test('the system layout default is optional and validated', ({ assert }) => {
    const base = { calendar: 'gregory', confirmDialogClose: true, pageTransitions: true }
    assert.deepEqual(validateUiPreferences(base), base)
    assert.deepEqual(validateUiPreferences({ ...base, layout: 'top', layoutUserChoice: true }), {
      ...base,
      layout: 'top',
      layoutUserChoice: true,
    })
    assert.throws(() => validateUiPreferences({ ...base, layout: 'bottom' }))
    assert.throws(() => validateUiPreferences({ ...base, layoutUserChoice: 'yes' }))
  })
})
