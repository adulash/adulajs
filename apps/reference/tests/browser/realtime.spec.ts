import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { notifyWithTemplate } from 'adula'
import { seedActor, type UiActor } from '#tests/helpers/ui_fixtures'

test.group('Realtime notification bell', (group) => {
  let member: UiActor
  let other: UiActor
  group.setup(async () => {
    member = await seedActor([{ subject: 'customers', action: 'view' }], {
      fullName: 'متلقي الإشعارات',
      level: 0,
    })
    other = await seedActor([{ subject: 'customers', action: 'view' }], {
      fullName: 'مستخدم آخر',
      level: 0,
    })
  })

  test('a committed notification updates the bell without a page reload', async ({
    browserContext,
  }) => {
    await browserContext.loginAs(member.user)
    const page = await browserContext.newPage()
    // Registered before navigation so the accepted subscription cannot be missed.
    const subscribed = page.waitForResponse(
      (response) => response.url().includes('/__transmit/subscribe') && response.ok()
    )
    await page.goto('/notifications')
    await page.getByRole('heading', { name: 'الإشعارات' }).waitFor()
    await subscribed
    const knex = db.connection().getWriteClient()
    // Another user's notification must not reach this tab.
    await notifyWithTemplate(knex, other.user.id, 'comment.created', { author: 'x' })
    await notifyWithTemplate(knex, member.user.id, 'assignment.created', {
      title: 'مراجعة فورية',
      resource: 'الطلبات',
      id: 1,
    })
    await page.getByText('وصلك إشعار جديد').waitFor()
    await page.getByTestId('unread-count').filter({ hasText: '1' }).waitFor()
  })

  test('a hidden tab releases its stream and catches up when it becomes visible', async ({
    browserContext,
  }) => {
    await db.from('notifications').where('user_id', member.user.id).delete()
    await browserContext.loginAs(member.user)
    const page = await browserContext.newPage()
    // Track every EventSource the page opens.
    await page.addInitScript(`{
      const Native = window.EventSource
      window.__streams = []
      window.EventSource = class extends Native {
        constructor(...args) { super(...args); window.__streams.push(this) }
      }
    }`)
    const subscribed = page.waitForResponse(
      (response) => response.url().includes('/__transmit/subscribe') && response.ok()
    )
    await page.goto('/notifications')
    await subscribed
    const visibility = (state: 'hidden' | 'visible') =>
      page.evaluate(`{
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => '${state}' })
        document.dispatchEvent(new Event('visibilitychange'))
      }`)
    // The page CSP forbids string evaluation inside waitForFunction; poll through evaluate.
    const until = async (condition: string) => {
      for (const started = Date.now(); Date.now() - started < 20_000;) {
        if (await page.evaluate<boolean>(condition)) return
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
      throw new Error(`Timed out waiting for ${condition}`)
    }
    // Browsers allow six HTTP/1.1 connections per host; hidden tabs must not hold one (#36).
    await visibility('hidden')
    await until('window.__streams.length === 1 && window.__streams[0].readyState === 2')
    await notifyWithTemplate(
      db.connection().getWriteClient(),
      member.user.id,
      'assignment.created',
      {
        title: 'أثناء الإخفاء',
        resource: 'الطلبات',
        id: 1,
      }
    )
    await visibility('visible')
    await page.getByTestId('unread-count').filter({ hasText: '1' }).waitFor()
    await until('window.__streams.length === 2 && window.__streams[1].readyState !== 2')
  })

  test('tabs share one stream; another tab takes over when the leader closes', async ({
    browserContext,
    assert,
  }) => {
    await db.from('notifications').where('user_id', member.user.id).delete()
    await browserContext.loginAs(member.user)
    const track = `{
      const Native = window.EventSource
      window.__streams = []
      window.EventSource = class extends Native {
        constructor(...args) { super(...args); window.__streams.push(this) }
      }
    }`
    const openStreams = (target: typeof first) =>
      target.evaluate<number>('window.__streams.filter((s) => s.readyState !== 2).length')
    const until = async (check: () => Promise<boolean>, label: string) => {
      for (const started = Date.now(); Date.now() - started < 20_000;) {
        if (await check()) return
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
      throw new Error(`Timed out waiting for ${label}`)
    }
    const first = await browserContext.newPage()
    await first.addInitScript(track)
    const subscribed = first.waitForResponse(
      (response) => response.url().includes('/__transmit/subscribe') && response.ok()
    )
    await first.goto('/notifications')
    await subscribed
    const second = await browserContext.newPage()
    await second.addInitScript(track)
    await second.goto('/notifications')
    await second.getByRole('heading', { name: 'الإشعارات' }).waitFor()
    // Seven tabs would otherwise hold seven HTTP/1.1 connections (#36).
    await until(async () => (await openStreams(first)) === 1, 'the leader stream')
    assert.equal(await openStreams(second), 0)
    const knex = db.connection().getWriteClient()
    await notifyWithTemplate(knex, member.user.id, 'assignment.created', {
      title: 'للتبويبين',
      resource: 'الطلبات',
      id: 1,
    })
    // The leader relays the signal: both bells update.
    await first.getByTestId('unread-count').filter({ hasText: '1' }).waitFor()
    await second.getByTestId('unread-count').filter({ hasText: '1' }).waitFor()
    await first.close()
    await until(async () => (await openStreams(second)) === 1, 'the stream to move over')
    await notifyWithTemplate(knex, member.user.id, 'assignment.created', {
      title: 'بعد إغلاق القائد',
      resource: 'الطلبات',
      id: 1,
    })
    await second.getByTestId('unread-count').filter({ hasText: '2' }).waitFor()
  })

  test('a notification during the leader handover reaches every open tab', async ({
    browserContext,
    assert,
  }) => {
    await db.from('notifications').where('user_id', member.user.id).delete()
    await browserContext.loginAs(member.user)
    const pendingLocks = 'navigator.locks.query().then((locks) => locks.pending.length)'
    const first = await browserContext.newPage()
    const subscribed = first.waitForResponse(
      (response) => response.url().includes('/__transmit/subscribe') && response.ok()
    )
    await first.goto('/notifications')
    await subscribed
    const second = await browserContext.newPage()
    await second.goto('/notifications')
    await second.getByRole('heading', { name: 'الإشعارات' }).waitFor()
    const third = await browserContext.newPage()
    await third.goto('/notifications')
    await third.getByRole('heading', { name: 'الإشعارات' }).waitFor()
    // Both tabs must wait in the lock queue, so that the second one leads next.
    for (const started = Date.now(); Date.now() - started < 20_000;) {
      if ((await first.evaluate<number>(pendingLocks)) === 2) break
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    assert.equal(await first.evaluate<number>(pendingLocks), 2)
    // Holding the subscription keeps the handover open.
    let release = () => {}
    let arrive = () => {}
    const held = new Promise<void>((resolve) => (release = resolve))
    const reached = new Promise<void>((resolve) => (arrive = resolve))
    await second.route('**/__transmit/subscribe', async (route) => {
      arrive()
      await held
      await route.continue()
    })
    await first.close()
    await reached
    await notifyWithTemplate(
      db.connection().getWriteClient(),
      member.user.id,
      'assignment.created',
      {
        title: 'أثناء انتقال القيادة',
        resource: 'الطلبات',
        id: 1,
      }
    )
    release()
    await second.getByTestId('unread-count').filter({ hasText: '1' }).waitFor({ timeout: 10_000 })
    await third.getByTestId('unread-count').filter({ hasText: '1' }).waitFor({ timeout: 10_000 })
  })
})
