import { test } from '@japa/runner'
import {
  InitialSetup,
  MailDeliveryTest,
  MAIL_TEST_KEY,
  Settings,
  SettingsAdmin,
  AdulaError,
  classifyMailFailure,
} from '../index.js'
import { db, setup } from './helpers.js'

test.group('Initial setup evidence', (group) => {
  group.each.setup(setup)
  const mail = new MailDeliveryTest(db)
  const settings = new Settings(db)
  const email = 'admin@example.test'
  async function rejects(run: () => Promise<unknown>, code: string) {
    try {
      await run()
    } catch (error) {
      if (error instanceof AdulaError && error.code === code) return
      throw error
    }
    throw new Error(`Expected ${code}`)
  }
  test('SMTP acceptance requires a separate persisted receipt attestation', async ({ assert }) => {
    let reference = ''
    await mail.send(1, email, 'config-a', async (id) => {
      reference = id
    })
    const state = await mail.current(1, email, 'config-a')
    assert.equal(state?.status, 'pending')
    assert.equal(state?.id, reference)
    await mail.answer(1, email, 'config-a', reference, true)
    const confirmed = await mail.current(1, email, 'config-a')
    assert.equal(confirmed?.status, 'confirmed')
    assert.exists(confirmed?.answeredAt)
    assert.exists(await db('activities').where('action', 'receipt_confirmed').first())
    await rejects(() => mail.answer(1, email, 'config-a', reference, true), 'E_MAIL_TEST_STALE')
  })
  test('receipts cannot be forged across users, recipients, configurations or attempts', async ({
    assert,
  }) => {
    await mail.send(1, email, 'config-a', async () => {})
    const state = (await mail.current(1, email, 'config-a'))!
    for (const [actor, recipient, config, id] of [
      [2, email, 'config-a', state.id],
      [1, 'other@example.test', 'config-a', state.id],
      [1, email, 'config-b', state.id],
      [1, email, 'config-a', 'wrong'],
    ] as const)
      await rejects(() => mail.answer(actor, recipient, config, id, true), 'E_MAIL_TEST_STALE')
    assert.isNull(await mail.current(1, email, 'config-b'))
    await rejects(() => mail.answer(1, email, 'config-a', state.id, 'true'), 'E_MAIL_TEST_ANSWER')
    await mail.answer(1, email, 'config-a', state.id, false)
    const answered = await mail.current(1, email, 'config-a')
    assert.equal(answered?.status, 'not_received')
  })
  test('failed delivery is redacted, cannot be confirmed and has a retry cooldown', async ({
    assert,
  }) => {
    await rejects(
      () =>
        mail.send(1, email, 'a', async () => {
          throw new Error('private SMTP password')
        }),
      'E_MAIL_TEST_SEND'
    )
    const state = (await mail.current(1, email, 'a'))!
    assert.equal(state.status, 'failed')
    assert.notInclude(JSON.stringify(state), 'private')
    await rejects(() => mail.answer(1, email, 'a', state.id, true), 'E_MAIL_TEST_STALE')
    await rejects(() => mail.send(1, email, 'a', async () => {}), 'E_MAIL_TEST_COOLDOWN')
  })
  test('transport failures are classified into fixed, translatable reasons', ({ assert }) => {
    const smtp = (props: Record<string, unknown>, message = 'server said: secret-token') =>
      Object.assign(new Error(message), props)
    const cases: [unknown, string][] = [
      [smtp({ code: 'EAUTH', responseCode: 535, command: 'AUTH PLAIN' }), 'authentication'],
      [smtp({ responseCode: 535 }), 'authentication'],
      [smtp({ code: 'ECONNECTION' }, 'connect ECONNREFUSED'), 'connection'],
      [smtp({ code: 'ESOCKET', cause: smtp({ code: 'ECONNREFUSED' }) }), 'connection'],
      [smtp({ code: 'EDNS' }), 'host_not_found'],
      [smtp({ code: 'ESOCKET', cause: smtp({ code: 'ENOTFOUND' }) }), 'host_not_found'],
      [smtp({ code: 'ESOCKET' }, 'ssl3_get_record:wrong version number'), 'tls'],
      [smtp({ code: 'ERR_SSL_WRONG_VERSION_NUMBER' }), 'tls'],
      [smtp({ code: 'ETIMEDOUT' }), 'timeout'],
      [smtp({ code: 'EENVELOPE', responseCode: 550, command: 'MAIL FROM' }), 'sender_rejected'],
      [smtp({ code: 'EENVELOPE', responseCode: 550, command: 'RCPT TO' }), 'recipient_rejected'],
      [new Error('anything'), 'unknown'],
      ['not an error', 'unknown'],
    ]
    for (const [error, reason] of cases)
      assert.equal(classifyMailFailure(error).reason, reason, JSON.stringify(error))
    const failure = classifyMailFailure(
      smtp({ code: 'EAUTH', responseCode: 535, command: 'AUTH secret-payload' })
    )
    assert.deepEqual(failure, { reason: 'authentication', code: 'EAUTH', responseCode: 535 })
    assert.notInclude(JSON.stringify(failure), 'secret')
  })
  test('a classified failure reaches the administrator as a catalog sentence', async ({
    assert,
  }) => {
    let caught: unknown
    try {
      await mail.send(1, email, 'a', async () => {
        throw Object.assign(new Error('535 bad credentials for private-user'), {
          code: 'EAUTH',
          responseCode: 535,
          command: 'AUTH LOGIN',
        })
      })
    } catch (error) {
      caught = error
    }
    assert.instanceOf(caught, AdulaError)
    const error = caught as AdulaError
    assert.equal(error.status, 502)
    assert.equal(error.code, 'E_MAIL_TEST_SEND')
    assert.equal(error.messageKey, 'errors.E_MAIL_TEST_SEND.authentication')
    assert.include(error.message, 'SMTP_PASSWORD')
    assert.notInclude(error.message, 'private-user')
    const activity = await db('activities').where('action', 'test_send_failed').first()
    assert.equal(activity.changes.reason, 'authentication')
    assert.equal(activity.changes.command, 'AUTH LOGIN')
    assert.notInclude(JSON.stringify(activity.changes), 'private-user')
  })
  test('concurrent requests send only once and stale confirmations expire', async ({ assert }) => {
    let sends = 0
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        mail.send(1, email, 'a', async () => {
          sends++
        })
      )
    )
    assert.equal(sends, 1)
    assert.equal(results.filter((item) => item.status === 'rejected').length, 1)
    const state = (await mail.current(1, email, 'a'))!
    await settings.set(
      MAIL_TEST_KEY,
      { ...state, requestedAt: new Date(Date.now() - 90_000_000).toISOString() },
      'user',
      '1'
    )
    await rejects(() => mail.answer(1, email, 'a', state.id, true), 'E_MAIL_TEST_STALE')
  })
  test('interrupted attempts can be retried and old send completion cannot replace new evidence', async ({
    assert,
  }) => {
    let finish!: () => void
    let entered!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const first = mail.send(1, email, 'a', async () => {
      entered()
      await new Promise<void>((resolve) => {
        finish = resolve
      })
    })
    await started
    const old = (await mail.current(1, email, 'a'))!
    await settings.set(
      MAIL_TEST_KEY,
      { ...old, requestedAt: new Date(Date.now() - 400_000).toISOString() },
      'user',
      '1'
    )
    await mail.send(1, email, 'b', async () => {})
    finish()
    await first
    const latest = await mail.current(1, email, 'b')
    assert.equal(latest?.status, 'pending')
  })
  test('operational evidence cannot be edited or deleted through generic settings', async () => {
    const admin = new SettingsAdmin(db)
    for (const key of [
      MAIL_TEST_KEY,
      'setup.identity',
      'setup.check.storage',
      'setup.oauth.github',
    ]) {
      await rejects(
        () => admin.upsert(1, { key, scope: 'system', value: { status: 'passed' } }),
        'E_SETTING_READ_ONLY'
      )
      await settings.set(key, {})
      const row = await db('settings').where({ key, scope: 'system' }).first('id')
      await rejects(() => admin.delete(1, row.id), 'E_SETTING_READ_ONLY')
    }
  })
  test('storage probes persist failure without credentials and success only after a completed probe', async ({
    assert,
  }) => {
    const initial = new InitialSetup(db)
    await rejects(
      () =>
        initial.check(1, 'storage', 'a', async () => {
          throw new Error('secret endpoint')
        }),
      'E_SETUP_CHECK_FAILED'
    )
    const failed = await settings.get('setup.check.storage')
    assert.notInclude(JSON.stringify(failed), 'secret')
    await initial.check(1, 'infrastructure', 'a', async () => {})
    const infrastructure = await settings.get<{ status: string }>('setup.check.infrastructure')
    assert.equal(infrastructure?.status, 'passed')
  })
  test('notification tests target the actor and preserve real unread/read state', async ({
    assert,
  }) => {
    const id = await new InitialSetup(db).testNotification(1)
    const row = await db('notifications').where('id', id).first()
    assert.equal(row.user_id, 1)
    assert.isNull(row.read_at)
    await rejects(() => new InitialSetup(db).testNotification(1), 'E_SETUP_COOLDOWN')
  })
})
