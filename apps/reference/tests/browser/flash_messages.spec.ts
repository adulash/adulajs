import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { seedActor, type UiActor } from '#tests/helpers/ui_fixtures'

/**
 * A flash message belongs to the page the write redirects to. A background JSON read that
 * the server answers in between (a dialog's related lists, a view fetched ahead of a click)
 * cannot show it, so it must leave it for that page: before, it took the message out of the
 * session and wrote the session back without it, and «تم تعيين كل الإشعارات كمقروءة» never
 * appeared (the write in flight under an open record, dialog_opening).
 */
test.group('Flash messages survive background reads', (group) => {
  let admin: UiActor
  group.setup(async () => {
    admin = await seedActor([{ subject: 'all', action: 'manage' }], { fullName: 'مدير الرسائل' })
  })

  test("a background read between a write and its redirect leaves the write's message", async ({
    browserContext,
    visit,
    assert,
  }) => {
    const knex = db.connection().getWriteClient()
    await knex('notifications').where({ user_id: admin.user.id }).delete()
    await knex('notifications').insert({
      user_id: admin.user.id,
      title: 'تنبيه للقراءة',
      body: 'نص',
    })
    await browserContext.loginAs(admin.user)
    const page = await visit('/notifications')
    await page.getByText('تنبيه للقراءة', { exact: true }).waitFor()
    await page.waitForLoadState('networkidle')
    // Every toast the page shows, however briefly.
    await page.evaluate(`(() => {
      window.__toasts = []
      new MutationObserver(() => {
        for (const toast of document.querySelectorAll('[data-sonner-toast]'))
          if (!window.__toasts.includes(toast.textContent)) window.__toasts.push(toast.textContent)
      }).observe(document.body, { childList: true, subtree: true, characterData: true })
    })()`)
    // The server stores the write's message and answers with its redirect; before the browser
    // follows it, a background JSON read (same session) reaches the server and is answered.
    let background = 0
    await page.route(/\/notifications\/read-all$/, async (route) => {
      const response = await route.fetch({ maxRedirects: 0 })
      background = await page.evaluate<number>(
        `fetch('/notifications', { headers: { Accept: 'application/json' } }).then((r) => r.status)`
      )
      await route.fulfill({ response })
    })
    await page.getByRole('button', { name: 'تعيين الكل كمقروء', exact: true }).click()
    await page.getByText('لا إشعارات غير مقروءة', { exact: true }).waitFor()
    await page.waitForTimeout(300)
    assert.isAbove(background, 0, 'the background read was answered')
    const toasts = (await page.evaluate('window.__toasts')) as string[]
    assert.isTrue(
      toasts.some((text) => text.includes('تم تعيين كل الإشعارات كمقروءة')),
      `the write's message: ${JSON.stringify(toasts)}`
    )
  }).timeout(60_000)
})
