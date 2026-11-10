import { test } from '@japa/runner'
import type { Page, Request, Route } from 'playwright'
import { adula } from '#services/adula'
import {
  installSampleResources,
  removeSampleResources,
  seedActor,
  type UiActor,
} from '#tests/helpers/ui_fixtures'

/**
 * Owner's defect (2.3.0): opening a dialog re-rendered the page behind it and broke the opening
 * animation. A dialog opens over the mounted page: the page's heading and table stay the same
 * DOM nodes, the dialog's shell is on screen before the server answers (its body loads inside
 * it), and one click sends at most one request.
 */

/** Remembers the page's heading and table, to check later that they were never replaced. */
async function markPage(page: Page) {
  await page.evaluate(`(() => {
    window.__heading = document.querySelector('main h1')
    window.__table = document.querySelector('main table')
  })()`)
}

async function samePage(page: Page) {
  return page.evaluate<{ heading: boolean; table: boolean }>(`(() => ({
    heading: !!window.__heading && window.__heading.isConnected
      && window.__heading === document.querySelector('main h1'),
    table: !!window.__table && window.__table.isConnected
      && window.__table === document.querySelector('main table'),
  }))()`)
}

/** The id of the list's first row. */
async function rowId(page: Page) {
  return page.locator('main table tbody tr[data-row-id]').first().getAttribute('data-row-id')
}

/** Requests to this application's pages and JSON, not assets or the HMR socket. */
function watchRequests(page: Page) {
  const sent: string[] = []
  const listener = (request: Request) => {
    const type = request.resourceType()
    if (type !== 'document' && type !== 'xhr' && type !== 'fetch') return
    const url = new URL(request.url())
    if (url.pathname.startsWith('/@') || url.pathname.startsWith('/node_modules')) return
    sent.push(`${request.method()} ${url.pathname}${url.search}`)
  }
  page.on('request', listener)
  return { sent, stop: () => page.off('request', listener) }
}

/**
 * Holds the matching requests until released, so a test can see what is on screen while the
 * server has not answered yet.
 */
async function holdRequests(page: Page, pattern: RegExp) {
  const held: Route[] = []
  let release = false
  const handler = (route: Route) => {
    if (release) return route.continue()
    held.push(route)
  }
  await page.route(pattern, handler)
  return {
    held,
    async release() {
      release = true
      for (const route of held.splice(0)) await route.continue()
      await page.unroute(pattern, handler)
    },
  }
}

test.group('Dialogs open over the mounted page', (group) => {
  let admin: UiActor
  group.setup(async () => {
    admin = await seedActor([{ subject: 'all', action: 'manage' }], { fullName: 'مدير الفتح' })
    await installSampleResources()
    // More rows than one page of the list (100), so a new record sorted by id lands on a page
    // that is not loaded yet.
    const actor = await adula().actors.load(admin.user.id)
    for (let index = 0; index < 130; index++)
      await adula().resources.save('ui_samples', actor, {
        orgUnitId: admin.orgUnitId,
        title: `عينة القائمة ${String(index).padStart(3, '0')}`,
      })
    return () => removeSampleResources()
  })

  async function firstText(page: Page) {
    const first = await firstRow(page)
    return first.text
  }

  /** The first row of the list's table and whether it is highlighted as just created. */
  async function firstRow(page: Page) {
    const row = page.locator('main table tbody tr[data-row-id]').first()
    return {
      text: await row.innerText(),
      created: (await row.getAttribute('data-created')) !== null,
    }
  }

  test('«إضافة» opens the create form over the list, at once, with one request', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(admin.user)
    const page = await visit('/resources/ui_samples')
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.locator('main h1').waitFor()
    await page.locator('main table').waitFor()
    await page.waitForLoadState('networkidle')
    await markPage(page)

    const watch = watchRequests(page)
    const hold = await holdRequests(page, /\/resources\/ui_samples\/create/)
    await page.getByRole('link', { name: 'إضافة عينة' }).click()
    // The dialog's shell is on screen while the server has not answered.
    const dialog = page.getByRole('dialog', { name: 'إضافة عينة' })
    await dialog.waitFor({ timeout: 1_000 })
    assert.equal(new URL(page.url()).pathname, '/resources/ui_samples/create')
    assert.deepEqual(await samePage(page), { heading: true, table: true })
    await hold.release()
    await dialog.getByLabel('العنوان').waitFor()
    assert.deepEqual(await samePage(page), { heading: true, table: true })
    watch.stop()
    assert.deepEqual(
      watch.sent.filter((request) => request.includes('/resources/ui_samples')),
      ['GET /resources/ui_samples/create/view'],
      'one request opens the form'
    )

    // Back closes it and Forward opens it again, both from history with no request. Inertia
    // renders a history entry afresh (preserveState: false), so the nodes are marked again.
    const history = watchRequests(page)
    await page.goBack()
    await dialog.waitFor({ state: 'hidden' })
    assert.equal(new URL(page.url()).pathname, '/resources/ui_samples')
    await page.locator('main table').waitFor()
    await page.goForward()
    await dialog.getByLabel('العنوان').waitFor()
    await page.waitForLoadState('networkidle')
    history.stop()
    assert.deepEqual(history.sent, [], 'Back and Forward read the history')
    await markPage(page)

    // Saving closes the dialog and returns to the mounted list (owner, 2.3.0): the new record
    // is the first row, highlighted, though the list is sorted by id over more than one page.
    const title = `عينة الفتح ${Date.now()}`
    await dialog.getByLabel('العنوان').fill(title)
    const saving = watchRequests(page)
    await dialog.getByRole('button', { name: 'حفظ السجل', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    assert.equal(await page.locator('[role=dialog]').count(), 0, 'no dialog is open')
    assert.equal(new URL(page.url()).pathname, '/resources/ui_samples')
    await page.locator('main table tbody tr[data-created]').waitFor()
    const first = await firstRow(page)
    assert.include(first.text, title)
    assert.isTrue(first.created, 'the new row is highlighted')
    assert.deepEqual(await samePage(page), { heading: true, table: true })
    await page.waitForLoadState('networkidle')
    saving.stop()
    assert.deepEqual(
      saving.sent.filter((request) => !request.startsWith('POST')),
      [`GET ${new URL(page.url()).pathname}/${await rowId(page)}/row`],
      'the list is not loaded again: only the new row is read'
    )
    // The highlight fades; the row stays first.
    await page.locator('main table tbody tr[data-created]').waitFor({ state: 'detached' })
    assert.include(await firstText(page), title)

    // The toast offers the new record.
    await page.getByRole('button', { name: 'عرض', exact: true }).click()
    const details = page.getByRole('dialog', { name: /^تفاصيل/ })
    await details.waitFor()
    await page.keyboard.press('Escape')
    await details.waitFor({ state: 'hidden' })
    assert.deepEqual(await samePage(page), { heading: true, table: true })
    assert.include(await firstText(page), title)

    // A changed query lists the rows in their own order again.
    await page.goto('/resources/ui_samples')
    await page.locator('main table tbody tr[data-row-id]').first().waitFor()
    assert.notInclude(await firstText(page), title)

    // The address still works on its own, reloaded.
    await page.goto('/resources/ui_samples/create')
    await page.getByRole('dialog', { name: 'إضافة عينة' }).getByLabel('العنوان').waitFor()
  }).timeout(120_000)

  test('the standalone create page returns to the list with the new record first', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(admin.user)
    const page = await visit('/resources/ui_samples/create')
    await page.setViewportSize({ width: 1440, height: 900 })
    const dialog = page.getByRole('dialog', { name: 'إضافة عينة' })
    const title = `عينة الصفحة ${Date.now()}`
    await dialog.getByLabel('العنوان').fill(title)
    await dialog.getByRole('button', { name: 'حفظ السجل', exact: true }).click()
    await page.locator('main table tbody tr[data-created]').waitFor()
    assert.equal(new URL(page.url()).pathname, '/resources/ui_samples')
    assert.equal(await page.locator('[role=dialog]').count(), 0, 'no dialog is open')
    const first = await firstRow(page)
    assert.include(first.text, title)
    assert.isTrue(first.created)
  }).timeout(60_000)

  test('closing an untouched create dialog returns to the list without a request', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(admin.user)
    const page = await visit('/resources/ui_samples')
    await page.locator('main table').waitFor()
    await page.waitForLoadState('networkidle')
    await markPage(page)
    await page.getByRole('link', { name: 'إضافة عينة' }).click()
    const dialog = page.getByRole('dialog', { name: 'إضافة عينة' })
    await dialog.getByLabel('العنوان').waitFor()
    const watch = watchRequests(page)
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
    await page.waitForLoadState('networkidle')
    watch.stop()
    assert.equal(new URL(page.url()).pathname, '/resources/ui_samples')
    assert.deepEqual(watch.sent, [])
    assert.deepEqual(await samePage(page), { heading: true, table: true })
  }).timeout(60_000)

  test('a record row opens its details at once, before the server answers', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(admin.user)
    const page = await visit('/resources/ui_samples')
    await page.locator('main table tbody tr[data-row-id]').first().waitFor()
    await page.waitForLoadState('networkidle')
    await markPage(page)
    const id = await rowId(page)
    const hold = await holdRequests(page, new RegExp(`/resources/ui_samples/${id}/view`))
    await page.locator(`main a[href="/resources/ui_samples/${id}"]`).first().click()
    const dialog = page.getByRole('dialog', { name: /^تفاصيل/ })
    await dialog.waitFor({ timeout: 1_000 })
    assert.deepEqual(await samePage(page), { heading: true, table: true })
    await hold.release()
    await dialog.getByRole('button', { name: 'تعديل السجل' }).waitFor()
    assert.deepEqual(await samePage(page), { heading: true, table: true })
  }).timeout(60_000)

  test('a dialog opened while the page still loads its deferred props stays open', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(admin.user)
    // Hold the list's deferred props (the «مهامي» badge) until the dialog is open: their late
    // answer must not replace the page's props, dialog and all. (The race this guards opened
    // within a few milliseconds of the push; full runs showed it, this test keeps the outcome.)
    const held: Route[] = []
    const deferred = (route: Route) =>
      (route.request().headers()['x-inertia-partial-data'] ?? '').includes('openTasks')
    await browserContext.route(/\/resources\/ui_samples(\?|$)/, (route) =>
      deferred(route) && held.length === 0 ? void held.push(route) : route.continue()
    )
    const page = await visit('/resources/ui_samples')
    await page.locator('main table tbody tr[data-row-id]').first().waitFor()
    for (const started = Date.now(); held.length === 0;) {
      if (Date.now() - started > 10_000) assert.fail('the deferred props were not requested')
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    await page.getByRole('link', { name: 'إضافة عينة' }).click()
    const dialog = page.getByRole('dialog', { name: 'إضافة عينة' })
    await dialog.getByLabel('العنوان').waitFor()
    // The held answer arrives late (or was cancelled by the opening): the dialog stays.
    await held[0].continue().catch(() => {})
    await page.waitForTimeout(500)
    assert.isTrue(await dialog.isVisible())
    assert.equal(new URL(page.url()).pathname, '/resources/ui_samples/create')
    // Closing returns to the list, with the badge's deferred props loaded for it.
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
    assert.equal(new URL(page.url()).pathname, '/resources/ui_samples')
  }).timeout(60_000)

  test('«دعوة مستخدم» opens over the users list at once, without a request', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(admin.user)
    const page = await visit('/admin/users')
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.locator('main table').waitFor()
    await page.waitForLoadState('networkidle')
    await markPage(page)
    const watch = watchRequests(page)
    await page.locator('main').getByRole('link', { name: 'دعوة مستخدم' }).click()
    const dialog = page.getByRole('dialog', { name: 'دعوة مستخدم' })
    await dialog.waitFor({ timeout: 1_000 })
    assert.equal(new URL(page.url()).search, '?invite=1')
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
    await page.waitForLoadState('networkidle')
    watch.stop()
    assert.deepEqual(watch.sent, [], 'opening and closing the invitation sends nothing')
    assert.equal(new URL(page.url()).search, '')
    assert.deepEqual(await samePage(page), { heading: true, table: true })

    // The address still opens it on its own.
    await page.goto('/admin/users?invite=1')
    await dialog.waitFor()
  }).timeout(60_000)
})
