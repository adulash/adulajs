import { test } from '@japa/runner'
import {
  MessageTemplates,
  deliverNotificationMail,
  notifyWithTemplate,
  renderTemplate,
  listenForNotifications,
} from '../index.js'
import { db, setup } from './helpers.js'
import { failure } from './helpers/failure.js'
import { addUserProfileColumns, seedActor } from './helpers/actors.js'

test.group('Message templates and notification delivery', (group) => {
  group.setup(async () => {
    await setup()
    await addUserProfileColumns()
    await seedActor({ id: 3 }, { email: 'off@example.test', disabled: true })
  })
  group.each.setup(async () => {
    await db('message_templates').del()
    await db('notifications').del()
  })

  test('renders defaults and project overrides without touching the defaults', async ({
    assert,
  }) => {
    const templates = new MessageTemplates(db)
    const original = await templates.render('assignment.created', {
      title: 'مراجعة',
      resource: 'الطلبات',
      id: 7,
    })
    assert.equal(original.subject, 'مهمة جديدة مسندة إليك')
    assert.equal(original.body, 'مراجعة — الطلبات #7')
    assert.isTrue(original.mail)

    await templates.update(
      'assignment.created',
      { subject: 'لديك مهمة: {{title}}', body: 'تستحق في {{due}}', mail: false },
      1
    )
    const edited = await templates.render('assignment.created', { title: 'مراجعة', due: 'غداً' })
    assert.deepEqual(edited, { subject: 'لديك مهمة: مراجعة', body: 'تستحق في غداً', mail: false })
    const listed = await templates.list()
    const entry = listed.find((item) => item.key === 'assignment.created')!
    assert.isTrue(entry.customized)

    await templates.reset('assignment.created')
    const restored = await templates.render('assignment.created', { title: 'x' })
    assert.equal(restored.subject, 'مهمة جديدة مسندة إليك')
  })

  test('refuses unknown placeholders, unknown keys and oversized text', async ({ assert }) => {
    const templates = new MessageTemplates(db)
    const unknown = await failure(() =>
      templates.update('assignment.created', { subject: '{{password}}', body: 'x' }, 1)
    )
    assert.equal(unknown.code, 'E_TEMPLATE_VARIABLE')
    const missing = await failure(() => templates.render('no.such', {}))
    assert.equal(missing.status, 404)
    const long = await failure(() =>
      templates.update('assignment.created', { subject: 'x'.repeat(201), body: 'x' }, 1)
    )
    assert.equal(long.code, 'E_TEMPLATE_SUBJECT')
    const prototype = await failure(() => templates.render('constructor', {}))
    assert.equal(prototype.status, 404)
    assert.equal(renderTemplate('{{a}}-{{ b }}-{{c}}', { a: 1, b: 'x' }), '1-x-')
  })

  test('mail delivery sends once, retries failures and skips disabled users', async ({
    assert,
  }) => {
    await notifyWithTemplate(db, 1, 'assignment.created', { title: 'أ', resource: 'ط', id: 1 })
    await notifyWithTemplate(db, 3, 'assignment.created', { title: 'ب', resource: 'ط', id: 2 })
    await notifyWithTemplate(db, 2, 'comment.created', { author: 'x', resource: 'ط', id: 3 })
    const sent: string[] = []
    const first = await deliverNotificationMail(db, async (message) => {
      sent.push(`${message.to}:${message.subject}`)
    })
    assert.deepEqual(first, { sent: 1, failed: 0 })
    assert.deepEqual(sent, ['admin@example.test:مهمة جديدة مسندة إليك'])
    const states = await db('notifications').orderBy('user_id').pluck('mail_state')
    // The comment template has mail disabled, so its row never enters the queue.
    assert.deepEqual(states, ['sent', null, 'skipped'])
    const again = await deliverNotificationMail(db, async () => {
      throw new Error('should not resend')
    })
    assert.deepEqual(again, { sent: 0, failed: 0 })

    await notifyWithTemplate(db, 1, 'assignment.created', { title: 'ج', resource: 'ط', id: 4 })
    for (let attempt = 0; attempt < 3; attempt++)
      await deliverNotificationMail(db, async () => {
        throw new Error('SMTP down')
      })
    const failed = await db('notifications').where('mail_state', 'failed').first()
    assert.equal(failed.mail_attempts, 3)
    assert.equal(failed.mail_error, 'SMTP down')
  })

  test('a committed notification emits the realtime signal; a rolled back one does not', async ({
    assert,
  }) => {
    // A dedicated pooled connection, as the web process holds one for LISTEN.
    const listener = await db.client.acquireConnection()
    const received: { userId: number; id: number }[] = []
    listener.on('notification', (message: { payload: string }) =>
      received.push(JSON.parse(message.payload))
    )
    await listener.query('LISTEN adula_notifications')
    try {
      await db
        .transaction(async (trx) => {
          await notifyWithTemplate(trx, 2, 'comment.created', { author: 'x' })
          throw new Error('rollback')
        })
        .catch(() => {})
      await notifyWithTemplate(db, 2, 'comment.created', { author: 'y' })
      const deadline = Date.now() + 3000
      while (!received.length && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 50))
      assert.lengthOf(received, 1)
      assert.equal(received[0].userId, 2)
    } finally {
      await listener.query('UNLISTEN *')
      listener.removeAllListeners('notification')
      await db.client.releaseConnection(listener)
    }
  })

  test('listenForNotifications forwards committed signals until stopped', async ({ assert }) => {
    const received: number[] = []
    const stop = listenForNotifications(db, (signal) => received.push(signal.userId))
    try {
      await new Promise((resolve) => setTimeout(resolve, 200))
      await notifyWithTemplate(db, 1, 'comment.created', { author: 'z' })
      const deadline = Date.now() + 3000
      while (!received.length && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 50))
      assert.deepEqual(received, [1])
    } finally {
      await stop()
    }
    await notifyWithTemplate(db, 1, 'comment.created', { author: 'z' })
    await new Promise((resolve) => setTimeout(resolve, 300))
    assert.deepEqual(received, [1])
  })
})
