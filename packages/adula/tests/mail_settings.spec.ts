import { test } from '@japa/runner'
import { MailSettings, MAIL_SETTINGS_KEY, SettingsAdmin, type SecretBox } from '../index.js'
import { admin, db, setup } from './helpers.js'
import { failure } from './helpers/failure.js'

const PASSWORD = 'smtp-password-not-real'
const box: SecretBox = {
  seal: (value) => `sealed:${Buffer.from(value).toString('base64')}`,
  open: (value) =>
    value.startsWith('sealed:') ? Buffer.from(value.slice(7), 'base64').toString() : null,
}
// Public names resolve to a public address; internal names to a private one.
const resolve = async (host: string) =>
  host.endsWith('.internal') ? ['10.0.0.5'] : host === 'missing.example' ? [] : ['93.184.215.14']
const strict = () => new MailSettings(db, box, { resolve })
const valid = {
  preset: 'custom',
  host: 'smtp.example.com',
  port: 587,
  security: 'starttls',
  username: 'mailer@example.com',
  fromName: 'نظام الشركة',
  fromAddress: 'no-reply@example.com',
}
const code = async (promise: Promise<unknown>) => (await failure(promise)).code

test.group('Mail settings', (group) => {
  group.setup(async () => {
    await setup()
  })
  group.each.setup(async () => {
    await db('settings').where('key', MAIL_SETTINGS_KEY).delete()
    await db('activities').where('resource', 'core.mail').delete()
  })

  test('the password is sealed, never presented or logged, and cleared when the host changes', async ({
    assert,
  }) => {
    const settings = strict()
    assert.isFalse((await settings.read()).configured)
    assert.isNull(await settings.runtime())
    await settings.save(admin, valid)
    const view = await settings.setPassword(admin, PASSWORD)
    assert.isTrue(view.configured)
    assert.isTrue(view.hasPassword)
    assert.notProperty(view, 'secret')
    assert.notInclude(JSON.stringify(view), PASSWORD)
    const stored = await db('settings').where('key', MAIL_SETTINGS_KEY).first()
    assert.notInclude(JSON.stringify(stored.value), PASSWORD)
    const runtime = await settings.runtime()
    assert.equal(runtime?.password, PASSWORD)
    assert.equal(runtime?.security, 'starttls')
    assert.equal((await settings.target(valid.host)).address, '93.184.215.14')

    // The audit names the changed fields and never a value.
    const activities = await db('activities').where('resource', 'core.mail').orderBy('id')
    assert.deepEqual(
      activities.map((row) => row.action),
      ['settings.update', 'password.set']
    )
    assert.includeMembers(activities[0].changes.changed, ['host', 'fromAddress'])
    const audit = JSON.stringify(activities)
    for (const value of [PASSWORD, valid.host, valid.username, valid.fromAddress])
      assert.notInclude(audit, value)

    // The generic settings screen cannot read the sealed value or overwrite it.
    const row = (await new SettingsAdmin(db).list('system')).find(
      (entry) => entry.key === MAIL_SETTINGS_KEY
    )!
    assert.isTrue(row.readOnly)
    assert.notProperty(row.value as object, 'secret')
    assert.equal(
      (
        await failure(
          new SettingsAdmin(db).upsert(1, { key: MAIL_SETTINGS_KEY, scope: 'system', value: {} })
        )
      ).status,
      403
    )

    // Saving the same host keeps the password; a new host drops it.
    await settings.save(admin, { fromName: 'المبيعات' })
    assert.isTrue((await settings.read()).hasPassword)
    await settings.save(admin, { host: 'smtp.other.example' })
    assert.isFalse((await settings.read()).hasPassword)
    assert.isNull((await settings.runtime())?.password)
    const last = await db('activities').where('resource', 'core.mail').orderBy('id', 'desc').first()
    assert.isTrue(last.changes.passwordCleared)

    await settings.setPassword(admin, PASSWORD)
    await settings.clearPassword(admin)
    assert.isFalse((await settings.read()).hasPassword)
  })

  test('the host is a bare public name or address', async ({ assert }) => {
    const settings = strict()
    for (const host of [
      'smtp://smtp.example.com',
      'smtp.example.com:587',
      'smtp.example.com/path',
      'user@smtp.example.com',
      'smtp example.com',
      'smtp.example.com\r\nRCPT TO:<x@y.z>',
      '',
    ])
      assert.equal(await code(settings.save(admin, { ...valid, host })), 'E_MAIL_HOST', host)
    // Internal networks, loopback and metadata addresses (SSRF), unless the policy allows them.
    for (const host of ['127.0.0.1', '169.254.169.254', '10.1.2.3', 'relay.internal', '::1'])
      assert.equal(await code(settings.save(admin, { ...valid, host })), 'E_MAIL_HOST', host)
    assert.equal(
      (await failure(settings.save(admin, { ...valid, host: 'missing.example' }))).message,
      'تعذر العثور على خادم SMTP بهذا الاسم'
    )
    const allowed = new MailSettings(db, box, { resolve, allowPrivateTargets: true })
    assert.equal((await allowed.save(admin, { ...valid, host: '127.0.0.1' })).host, '127.0.0.1')
    // A stored host that later points inside is refused at send time as well.
    await assert.rejects(() => settings.target('relay.internal'))
  })

  test('headers cannot be injected through the account or the sender', async ({ assert }) => {
    const settings = strict()
    const cases: [Record<string, unknown>, string][] = [
      [{ fromName: 'A\r\nBcc: victim@example.com' }, 'E_MAIL_FROM_NAME'],
      [{ fromName: 'A <evil@example.com>' }, 'E_MAIL_FROM_NAME'],
      [{ fromName: 'x'.repeat(101) }, 'E_MAIL_FROM_NAME'],
      [{ fromAddress: 'a@example.com\nBcc: b@example.com' }, 'E_MAIL_FROM_ADDRESS'],
      [{ fromAddress: 'a@example.com, b@example.com' }, 'E_MAIL_FROM_ADDRESS'],
      [{ fromAddress: 'Name <a@example.com>' }, 'E_MAIL_FROM_ADDRESS'],
      [{ fromAddress: '' }, 'E_MAIL_FROM_ADDRESS'],
      [{ username: 'user\r\nAUTH PLAIN' }, 'E_MAIL_USERNAME'],
      [{ port: 70000 }, 'E_MAIL_PORT'],
      [{ port: 'abc' }, 'E_MAIL_PORT'],
      [{ security: 'ssl' }, 'E_MAIL_SECURITY'],
      [{ preset: '../x' }, 'E_MAIL_SETTINGS_INPUT'],
      [{ secret: 'sealed:eA==' }, 'E_MAIL_SETTINGS_INPUT'],
      [{ password: PASSWORD }, 'E_MAIL_SETTINGS_INPUT'],
    ]
    for (const [change, expected] of cases)
      assert.equal(
        await code(settings.save(admin, { ...valid, ...change })),
        expected,
        JSON.stringify(change)
      )
    assert.isUndefined(await db('settings').where('key', MAIL_SETTINGS_KEY).first())

    // The password needs a saved server, one line and a length limit.
    assert.equal(await code(settings.setPassword(admin, PASSWORD)), 'E_MAIL_HOST')
    await settings.save(admin, valid)
    assert.equal(await code(settings.setPassword(admin, 'a\r\nb')), 'E_MAIL_PASSWORD')
    assert.equal(await code(settings.setPassword(admin, '')), 'E_MAIL_PASSWORD')
    assert.equal(await code(settings.setPassword(admin, 'x'.repeat(501))), 'E_MAIL_PASSWORD')
    assert.isFalse((await settings.read()).hasPassword)
  })
})
