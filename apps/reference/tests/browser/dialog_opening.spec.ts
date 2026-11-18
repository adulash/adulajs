import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { chromium, type BrowserContext, type Page, type Request, type Route } from 'playwright'
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
/**
 * Times the next click until an open dialog is in the page, measured in the page itself: in
 * milliseconds, and whether it was there at the first animation frame after the click.
 */
async function startStopwatch(page: Page) {
  await page.evaluate(`(() => {
    window.__opening = null
    document.addEventListener('click', () => {
      const clicked = performance.now()
      const opening = (window.__opening = { firstFrame: null, ms: null })
      requestAnimationFrame(() => {
        opening.firstFrame = !!document.querySelector('[role=dialog][data-state=open]')
      })
      const observer = new MutationObserver(() => {
        if (opening.ms !== null || !document.querySelector('[role=dialog][data-state=open]')) return
        opening.ms = performance.now() - clicked
        observer.disconnect()
      })
      observer.observe(document.body, { childList: true, subtree: true, attributes: true })
    }, { capture: true, once: true })
  })()`)
}

async function readStopwatch(page: Page) {
  return page.evaluate<{ firstFrame: boolean | null; ms: number | null }>('window.__opening')
}

/**
 * Records every element that takes the focus from the next click on, by its accessible name,
 * to check that the focus goes straight to the dialog's body.
 */
async function recordFocus(page: Page) {
  await page.evaluate(`(() => {
    window.__focus = []
    if (window.__focusing) return
    window.__focusing = true
    document.addEventListener('focusin', (event) => {
      const element = event.target
      const name = (element.getAttribute('aria-label') || element.innerText || '').trim()
      window.__focus.push({ tag: element.tagName, name: name.slice(0, 40) })
    }, true)
  })()`)
}

/** The focus's path since `recordFocus`, and whether it rests on the dialog's first field. */
async function readFocus(page: Page) {
  return page.evaluate<{
    visited: { tag: string; name: string }[]
    first: boolean
    active: string
  }>(`(() => {
    const dialog = document.querySelector('[role=dialog][data-state=open]')
    const first = [...dialog.querySelectorAll('button, input, select, textarea, [tabindex]')].find(
      (element) =>
        element.tabIndex >= 0 && !element.disabled && element.type !== 'hidden' &&
        element.getClientRects().length > 0
    )
    return {
      visited: window.__focus,
      first: !!first && first === document.activeElement,
      active: document.activeElement.outerHTML.slice(0, 300),
    }
  })()`)
}

/** Waits until the open dialog's body is mounted and holds the focus. */
async function waitForBody(page: Page) {
  await page.waitForFunction(`(() => {
    const dialog = document.querySelector('[role=dialog][data-state=open]')
    return !!dialog && !dialog.querySelector('[data-record-pending]')
      && dialog.contains(document.activeElement) && document.activeElement !== dialog
  })()`)
}

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
function watchRequests(page: Page | BrowserContext) {
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
 * The dialog's fixed footer is there while the body loads, with the close control it keeps;
 * the footer node is marked, so the caller can check the loaded body reused it (no shift).
 */
async function loadingFooter(page: Page, buttons: string[]) {
  const dialog = page.locator('[role=dialog][data-state=open]')
  await dialog.locator('[data-slot="record-loading"]').waitFor()
  const footer = dialog.locator('[data-slot="record-footer"]')
  const names = await footer.getByRole('button').allTextContents()
  await page.evaluate(
    `document.querySelector('[role=dialog][data-state=open] [data-slot="record-footer"]').setAttribute('data-test-kept', '')`
  )
  return { names: names.map((name) => name.trim()), buttons }
}

async function footerKept(page: Page) {
  return page
    .locator('[role=dialog][data-state=open] [data-slot="record-footer"][data-test-kept]')
    .count()
}

/**
 * Samples, every animation frame from the click on, the open dialog's layout box (its offset
 * size and position, which the opening zoom does not change), its final on-screen box, the
 * page's width without the scrollbar, and whether every list row is still the same node.
 */
async function startGeometry(page: Page) {
  await page.evaluate(`(() => {
    const rows = [...document.querySelectorAll('main table tbody tr')]
    const samples = (window.__geometry = [])
    const main = document.querySelector('main').getBoundingClientRect()
    window.__geometryMain = { left: main.left, right: main.right }
    document.addEventListener('click', () => {
      const frame = () => {
        const dialog = document.querySelector('[role=dialog][data-state=open]')
        const main = document.querySelector('main').getBoundingClientRect()
        samples.push({
          main: { left: main.left, right: main.right },
          dialog: dialog
            ? { width: dialog.offsetWidth, height: dialog.offsetHeight, top: dialog.offsetTop,
                loading: !!dialog.querySelector('[data-slot="record-loading"]') }
            : null,
          rows: rows.every((row) => row.isConnected),
        })
        if (!window.__geometryStop) requestAnimationFrame(frame)
      }
      window.__geometryStop = false
      requestAnimationFrame(frame)
    }, { capture: true, once: true })
  })()`)
}

type Geometry = {
  samples: {
    dialog: { width: number; height: number; top: number; loading: boolean } | null
    main: { left: number; right: number }
    rows: boolean
  }[]
  before: { left: number; right: number }
  final: { width: number; height: number; top: number }
}

async function stopGeometry(page: Page) {
  return page.evaluate<Geometry>(`(() => {
    window.__geometryStop = true
    const box = document.querySelector('[role=dialog][data-state=open]').getBoundingClientRect()
    return {
      samples: window.__geometry,
      before: window.__geometryMain,
      final: { width: box.width, height: box.height, top: box.top },
    }
  })()`)
}

/**
 * Holds the matching requests until released, so a test can see what is on screen while the
 * server has not answered yet.
 */
async function holdRequests(page: Page | BrowserContext, pattern: RegExp) {
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
    },
    /** Holds the next matching requests again. */
    async reset() {
      release = false
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
    // The list fetches its create form once idle (prefetch); held here from before the visit,
    // so the click finds it still on its way and the dialog opens with its loading body.
    const watch = watchRequests(browserContext)
    const hold = await holdRequests(browserContext, /\/resources\/ui_samples\/create\/view/)
    // Sorted by id ascending (newest first is the default, decision 27): the new record lands
    // on a page that is not loaded, so the list must pin it first itself.
    const page = await visit('/resources/ui_samples?sort=id')
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.locator('main h1').waitFor()
    await page.locator('main table').waitFor()
    for (const started = Date.now(); hold.held.length === 0;) {
      if (Date.now() - started > 10_000) assert.fail('the create form was not prefetched')
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    await markPage(page)
    const beforeClick = watch.sent.length
    await page.getByRole('link', { name: 'إضافة عينة' }).click()
    // The dialog's shell is on screen while the server has not answered.
    const dialog = page.getByRole('dialog', { name: 'إضافة عينة' })
    await dialog.waitFor({ timeout: 1_000 })
    assert.equal(new URL(page.url()).pathname, '/resources/ui_samples/create')
    assert.deepEqual(await samePage(page), { heading: true, table: true })
    // The footer bar is in place before the form arrives: «إلغاء» and a disabled «حفظ السجل».
    const footer = await loadingFooter(page, ['إلغاء', 'حفظ السجل'])
    assert.deepEqual(footer.names, footer.buttons)
    assert.isTrue(await dialog.getByRole('button', { name: 'حفظ السجل' }).isDisabled())
    await hold.release()
    await dialog.getByLabel('العنوان').waitFor()
    assert.equal(await footerKept(page), 1, 'the loaded form kept the same footer bar')
    assert.deepEqual(await samePage(page), { heading: true, table: true })
    watch.stop()
    assert.deepEqual(
      watch.sent.filter((request) => request.includes('/create/view')),
      ['GET /resources/ui_samples/create/view'],
      'one request, the prefetch, brings the form'
    )
    assert.deepEqual(
      watch.sent.slice(beforeClick).filter((request) => request.includes('/resources/ui_samples')),
      [],
      'the click sends none: no second view and no reload of the list'
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
      // Closing returns focus to «إضافة», which fetches the form ahead again (the save cleared
      // it): the next opening is complete. It is not the list.
      saving.sent.filter(
        (request) => !request.startsWith('POST') && !request.endsWith('/create/view')
      ),
      [`GET ${new URL(page.url()).pathname}/${await rowId(page)}/row`],
      `the list is not loaded again: only the new row is read: ${JSON.stringify(saving.sent)}`
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

    // A changed query lists the rows in their own order again: by id, the new record is far
    // down; by default (newest first) it leads on its own.
    await page.goto('/resources/ui_samples?sort=id')
    await page.locator('main table tbody tr[data-row-id]').first().waitFor()
    assert.notInclude(await firstText(page), title)
    await page.goto('/resources/ui_samples')
    await page.locator('main table tbody tr[data-row-id]').first().waitFor()
    assert.include(await firstText(page), title)

    // The address still works on its own, reloaded.
    await page.goto('/resources/ui_samples/create')
    await page.getByRole('dialog', { name: 'إضافة عينة' }).getByLabel('العنوان').waitFor()
  }).timeout(120_000)

  test('«مهامي» still loading when a dialog opens is never loaded for the dialog address', async ({
    browserContext,
    visit,
    assert,
  }) => {
    // CI failure on main, 2026-11-15: the list's deferred «مهامي» badge was still on its way
    // when «إضافة» pushed the dialog's address. Inertia copied the pending deferred prop into
    // that client visit and loaded it for /create, whose answer is the create page itself: it
    // replaced the list and the dialog, and the form's fields never appeared.
    await browserContext.loginAs(admin.user)
    const held: Route[] = []
    const deferredPaths: string[] = []
    await browserContext.route(/\/resources\/ui_samples(\/create)?(\?.*)?$/, (route) => {
      const request = route.request()
      if (!(request.headers()['x-inertia-partial-data'] ?? '').includes('openTasks'))
        return route.continue()
      const path = new URL(request.url()).pathname
      deferredPaths.push(path)
      if (path === '/resources/ui_samples') held.push(route)
      else return route.continue()
    })
    const page = await visit('/resources/ui_samples')
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.locator('main table').waitFor()
    for (const started = Date.now(); held.length === 0;) {
      if (Date.now() - started > 10_000) assert.fail('the list did not load «مهامي» deferred')
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    await markPage(page)
    await page.getByRole('link', { name: 'إضافة عينة' }).click()
    const dialog = page.getByRole('dialog', { name: 'إضافة عينة' })
    await dialog.getByLabel('العنوان').waitFor({ timeout: 10_000 })
    // The list's own answer arrives late (or was cancelled): the dialog stays over the list.
    for (const route of held.splice(0)) await route.continue().catch(() => {})
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {})
    assert.equal(new URL(page.url()).pathname, '/resources/ui_samples/create')
    assert.isTrue(await dialog.getByLabel('العنوان').isVisible())
    assert.deepEqual(await samePage(page), { heading: true, table: true })
    assert.deepEqual(
      deferredPaths.filter((path) => path !== '/resources/ui_samples'),
      [],
      'deferred props are never loaded for the dialog address'
    )
  })

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

  test('the dialog is on screen at the first frame after the click', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(admin.user)
    const page = await visit('/resources/ui_samples')
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.locator('main table tbody tr[data-row-id]').first().waitFor()
    await page.waitForLoadState('networkidle')
    const row = page.locator('main tbody a[href^="/resources/ui_samples/"]').first()
    // Its view not at hand yet (held): the dialog opens with its loading body, which needs no
    // request, so the page update that follows the click never delays it.
    const hold = await holdRequests(page, /\/resources\/ui_samples\/\d+\/view/)
    try {
      await startStopwatch(page)
      await row.click()
      await page.locator('[role=dialog][data-state=open]').waitFor()
      await page.waitForTimeout(100)
      const opening = await readStopwatch(page)
      console.log(`[opening] loading body: ${JSON.stringify(opening)}`)
      assert.isTrue(opening.firstFrame, `on screen at the first frame: ${JSON.stringify(opening)}`)
      assert.isBelow(opening.ms!, 150, `within 150 ms of the click: ${JSON.stringify(opening)}`)
    } finally {
      await hold.release()
    }
    await page.keyboard.press('Escape')
    await page.locator('[role=dialog]').waitFor({ state: 'detached' })
    // The view fetched ahead (the create form once the list is idle, a record on hover): the
    // dialog's first frame has its final size and footer with no skeleton, and its body follows
    // one frame later (`AfterFirstPaint`), with the focus on its first field.
    await row.hover()
    await page.waitForLoadState('networkidle')
    for (const opener of [page.getByRole('link', { name: 'إضافة عينة' }), row]) {
      await startStopwatch(page)
      await opener.click()
      const dialog = page.locator('[role=dialog][data-state=open]')
      await dialog.waitFor()
      await waitForBody(page)
      assert.equal(await dialog.locator('[data-slot="record-loading"]').count(), 0, 'complete')
      await page.waitForTimeout(100)
      const opening = await readStopwatch(page)
      console.log(`[opening] complete: ${JSON.stringify(opening)}`)
      assert.isTrue(opening.firstFrame, `on screen at the first frame: ${JSON.stringify(opening)}`)
      assert.isBelow(opening.ms!, 150, `within 150 ms of the click: ${JSON.stringify(opening)}`)
      await page.keyboard.press('Escape')
      await page.locator('[role=dialog]').waitFor({ state: 'detached' })
    }
  }).timeout(60_000)

  test('a prefetched dialog is on screen within 150 ms and focuses its first field, cold and warm', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(admin.user)
    const signedIn = await visit('/resources/ui_samples')
    const origin = new URL(signedIn.url()).origin
    const cookies = await browserContext.cookies()
    const openers = [
      {
        name: 'create',
        view: /\/resources\/ui_samples\/create\/view/,
        opener: (page: Page) => page.getByRole('link', { name: 'إضافة عينة' }),
        // The list fetches the form ahead once idle.
        prefetch: async () => {},
      },
      {
        name: 'record',
        view: /\/resources\/ui_samples\/\d+\/view/,
        opener: (page: Page) =>
          page.locator('main tbody a[href^="/resources/ui_samples/"]').first(),
        // A row link fetches its record ahead on hover.
        prefetch: async (page: Page) => {
          await page.mouse.move(0, 0)
          await page.locator('main tbody a[href^="/resources/ui_samples/"]').first().hover()
        },
      },
    ]
    for (const { name, view, opener, prefetch } of openers) {
      // A browser of its own: nothing in it has rendered this dialog yet, as for a user's first
      // opening of the day, with its view fetched ahead of the click.
      const browser = await chromium.launch()
      try {
        const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
        await context.addCookies(cookies)
        const page = await context.newPage()
        const listed = name === 'create' ? page.waitForResponse(view) : null
        await page.goto(origin + '/resources/ui_samples')
        await page.locator('main table tbody tr[data-row-id]').first().waitFor()
        await listed
        await page.waitForLoadState('networkidle')
        for (const run of ['cold', 'warm']) {
          const label = `${name}, ${run}`
          await prefetch(page)
          await page.waitForLoadState('networkidle')
          await startStopwatch(page)
          await recordFocus(page)
          await opener(page).click()
          const dialog = page.locator('[role=dialog][data-state=open]')
          await dialog.waitFor()
          await waitForBody(page)
          await page.waitForTimeout(100)
          const opening = await readStopwatch(page)
          const focus = await readFocus(page)
          console.log(`[opening] prefetched ${label}: ${JSON.stringify({ ...opening, focus })}`)
          assert.isTrue(opening.firstFrame, `${label}: on screen at the first frame`)
          assert.isBelow(opening.ms!, 150, `${label}: within 150 ms of the click`)
          assert.equal(
            await dialog.locator('[data-slot="record-loading"]').count(),
            0,
            'no skeleton'
          )
          // The focus never visits the footer's controls on its way to the body.
          for (const control of ['إلغاء', 'إغلاق'])
            assert.notInclude(
              focus.visited.map((f) => f.name),
              control,
              `${label}: «${control}» never takes the focus: ${JSON.stringify(focus.visited)}`
            )
          assert.isTrue(focus.first, `${label}: the first field has the focus: ${focus.active}`)
          if (name === 'create')
            assert.isTrue(
              await page.evaluate<boolean>(
                '!!document.activeElement?.closest("[role=dialog] form")'
              ),
              `${label}: the focus is in the form`
            )
          await page.keyboard.press('Escape')
          await page.locator('[role=dialog]').waitFor({ state: 'detached' })
          await page.waitForLoadState('networkidle')
        }
      } finally {
        await browser.close()
      }
    }
  }).timeout(120_000)

  test('the dialog keeps its size and place from the first frame while its body loads', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(admin.user)
    // Both bodies arrive late (held), the worst case: the loading body must take the final
    // size. Views fetched ahead of the click (create on idle, a record on hover) are held too.
    const hold = await holdRequests(browserContext, /\/resources\/ui_samples\/(create|\d+)\/view/)
    const page = await visit('/resources/ui_samples')
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.locator('main table tbody tr[data-row-id]').first().waitFor()
    try {
      for (const [opener, loaded] of [
        [page.getByRole('link', { name: 'إضافة عينة' }), 'العنوان'],
        [page.locator('main tbody a[href^="/resources/ui_samples/"]').first(), null],
      ] as const) {
        await startGeometry(page)
        await opener.click()
        const dialog = page.locator('[role=dialog][data-state=open]')
        await dialog.locator('[data-slot="record-loading"]').waitFor()
        await page.waitForTimeout(150)
        await hold.release()
        if (loaded) await dialog.getByLabel(loaded).waitFor()
        else await dialog.getByRole('button', { name: 'تعديل السجل' }).waitFor()
        // The related lists of a record load after its view: let them arrive, and the opening
        // animation (200 ms) end.
        await page.waitForLoadState('networkidle')
        await page.waitForTimeout(300)
        const geometry = await stopGeometry(page)
        const shown = geometry.samples.filter((sample) => sample.dialog)
        assert.isTrue(shown[0].dialog!.loading, 'it opened with its loading body')
        assert.isFalse(shown.at(-1)!.dialog!.loading, 'it ended with its loaded body')
        for (const sample of shown) {
          const box = sample.dialog!
          assert.approximately(box.width, geometry.final.width, 1, `width ${JSON.stringify(box)}`)
          assert.approximately(
            box.height,
            geometry.final.height,
            1,
            `height ${JSON.stringify(box)}`
          )
          assert.approximately(box.top, geometry.final.top, 1, `top ${JSON.stringify(box)}`)
        }
        assert.isTrue(
          geometry.samples.every((sample) => sample.rows),
          'no row is mounted again'
        )
        await page.keyboard.press('Escape')
        await page.locator('[role=dialog]').waitFor({ state: 'detached' })
        await hold.reset()
      }
    } finally {
      await hold.release()
    }
  }).timeout(90_000)

  test('opening and closing a dialog never moves the page sideways (RTL)', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(admin.user)
    const signedIn = await visit('/resources/ui_samples')
    const origin = new URL(signedIn.url()).origin
    // Classic scrollbars that take room, as on Windows. Playwright starts Chromium with
    // --hide-scrollbars, where no page loses width to a scrollbar and the shift this test is
    // about cannot happen; this test signs in to a browser of its own without it.
    const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] })
    const context = await browser.newContext()
    await context.addCookies(await browserContext.cookies())
    const page = await context.newPage()
    try {
      // Every frame from the click until the dialog has closed: the page's content, the header
      // and the content region's width inside its scrollbar.
      const watch = () =>
        page.evaluate(`(() => {
          const read = () => {
            const main = document.querySelector('main').getBoundingClientRect()
            const header = document.querySelector('[data-shell-header]').getBoundingClientRect()
            const region = document.querySelector('[scroll-region]')
            return {
              main: [main.left, main.right],
              header: [header.left, header.right],
              region: region ? region.clientWidth : null,
              locked: document.body.hasAttribute('data-scroll-locked'),
            }
          }
          window.__sideways = { before: read(), frames: [] }
          window.__sidewaysStop = false
          const frame = () => {
            window.__sideways.frames.push(read())
            if (!window.__sidewaysStop) requestAnimationFrame(frame)
          }
          requestAnimationFrame(frame)
        })()`)
      type Box = { main: number[]; header: number[]; region: number | null; locked: boolean }
      const stop = () =>
        page.evaluate<{ before: Box; frames: Box[] }>(
          '(() => { window.__sidewaysStop = true; return window.__sideways })()'
        )
      const cases = [
        // Below lg the page itself scrolls, with its scrollbar on the left.
        {
          name: '640 px, scrolling page',
          width: 640,
          height: 800,
          url: '/resources/ui_samples',
          scrolls: true,
        },
        // A page shorter than the window has no scrollbar: nothing to make room for.
        {
          name: '640 px, page without a scrollbar',
          width: 640,
          height: 1400,
          url: '/resources/ui_samples?search=لا-توجد-نتيجة',
          scrolls: false,
        },
        // From lg up the content region scrolls, and keeps its scrollbar while the dialog is open.
        {
          name: 'lg, content region scrolls',
          width: 1280,
          height: 800,
          url: '/resources/ui_samples',
          scrolls: false,
        },
      ]
      for (const { name, width, height, url, scrolls } of cases) {
        await page.setViewportSize({ width, height })
        await page.goto(origin + url)
        await page.locator('main h1').waitFor()
        await page.waitForLoadState('networkidle')
        assert.equal(
          await page.evaluate<boolean>(
            'document.documentElement.scrollHeight > document.documentElement.clientHeight'
          ),
          scrolls,
          `${name}: the page scrolls`
        )
        const gutters = await page.evaluate<{ page: number; region: number }>(`(() => {
          const region = document.querySelector('[scroll-region]')
          return {
            page: window.innerWidth - document.documentElement.clientWidth,
            region: region && region.scrollHeight > region.clientHeight ? region.offsetWidth - region.clientWidth : 0,
          }
        })()`)
        if (scrolls) assert.isAbove(gutters.page, 0, `${name}: the page's scrollbar takes room`)
        else assert.equal(gutters.page, 0, `${name}: the page has no scrollbar`)
        if (width >= 1024)
          assert.isAbove(gutters.region, 0, `${name}: the region's scrollbar takes room`)
        await watch()
        await page.getByRole('link', { name: 'إضافة عينة' }).click()
        await page.locator('[role=dialog][data-state=open]').waitFor()
        await page.waitForLoadState('networkidle')
        await page.waitForTimeout(300)
        await page.keyboard.press('Escape')
        await page.locator('[role=dialog]').waitFor({ state: 'detached' })
        await page.waitForTimeout(100)
        const { before, frames } = await stop()
        assert.isTrue(
          frames.some((frame) => frame.locked),
          `${name}: the dialog locked scrolling`
        )
        for (const frame of frames) {
          const at = `${name}: ${JSON.stringify(frame)} vs ${JSON.stringify(before)}`
          assert.approximately(frame.main[0], before.main[0], 0.5, `content left, ${at}`)
          assert.approximately(frame.main[1], before.main[1], 0.5, `content right, ${at}`)
          assert.approximately(frame.header[0], before.header[0], 0.5, `header left, ${at}`)
          assert.approximately(frame.header[1], before.header[1], 0.5, `header right, ${at}`)
          assert.equal(frame.region, before.region, `content region keeps its scrollbar, ${at}`)
        }
        if (!scrolls && width < 1024)
          assert.approximately(
            before.header[1] - before.header[0],
            width,
            0.5,
            `${name}: full-width header`
          )
      }

      // Which side the lock pads is measured, not taken from the direction. Chromium keeps the
      // page's scrollbar on the right in RTL (the case above); Firefox puts it on the left,
      // where the page's box starts after it. That geometry is reported here over a real
      // scrollbar's gap, so the left branch and its CSS run in this engine too.
      await page.setViewportSize({ width: 640, height: 800 })
      await page.goto(origin + '/resources/ui_samples')
      await page.locator('main h1').waitFor()
      await page.waitForLoadState('networkidle')
      const side = () =>
        page.evaluate<string | undefined>('document.documentElement.dataset.rootScrollbar')
      assert.equal(await side(), 'right', 'Chromium: the page scrollbar is on the right')
      const gap = await page.evaluate<number>(
        'window.innerWidth - document.documentElement.clientWidth'
      )
      assert.isAbove(gap, 0)
      await page.evaluate(`(() => {
        const root = document.documentElement
        const real = root.getBoundingClientRect.bind(root)
        root.getBoundingClientRect = () => {
          const box = real()
          const gap = window.innerWidth - root.clientWidth
          return new DOMRect(box.left + gap, box.top, box.width, box.height)
        }
      })()`)
      // A change of the page's width measures again (here, the window narrowed by a pixel).
      await page.setViewportSize({ width: 639, height: 800 })
      await page.waitForFunction('document.documentElement.dataset.rootScrollbar === "left"')
      await page.getByRole('link', { name: 'إضافة عينة' }).click()
      await page.locator('[role=dialog][data-state=open]').waitFor()
      const margins = await page.evaluate<{ left: string; right: string; gap: number }>(`(() => {
        const style = getComputedStyle(document.body)
        return {
          left: style.marginLeft,
          right: style.marginRight,
          gap: parseFloat(style.getPropertyValue('--removed-body-scroll-bar-size')),
        }
      })()`)
      assert.equal(margins.gap, gap, 'the lock removed the scrollbar it measured')
      assert.deepEqual(
        { left: margins.left, right: margins.right },
        { left: `${gap}px`, right: '0px' },
        'a left scrollbar: the room it took moves to the left'
      )
      await page.keyboard.press('Escape')
      await page.locator('[role=dialog]').waitFor({ state: 'detached' })
    } finally {
      await browser.close()
    }
  }).timeout(90_000)

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
    // The footer bar is in place before the details arrive, with «إغلاق».
    const footer = await loadingFooter(page, ['إغلاق'])
    assert.deepEqual(footer.names, footer.buttons)
    await hold.release()
    await dialog.getByRole('button', { name: 'تعديل السجل' }).waitFor()
    assert.equal(await footerKept(page), 1, 'the loaded details kept the same footer bar')
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

  test('opening a record never cancels a write in flight: its reply and message arrive', async ({
    browserContext,
    visit,
    assert,
  }) => {
    const knex = db.connection().getWriteClient()
    const [record] = await knex('ui_samples').select('id').orderBy('id').limit(1)
    await knex('notifications').where({ user_id: admin.user.id }).delete()
    await knex('notifications').insert([
      {
        user_id: admin.user.id,
        title: 'سجل للمراجعة',
        body: 'نص',
        resource: 'ui_samples',
        record_id: record.id,
      },
      { user_id: admin.user.id, title: 'تنبيه ثانٍ', body: 'نص' },
    ])
    await browserContext.loginAs(admin.user)
    const page = await visit('/notifications')
    await page.getByRole('link', { name: 'سجل للمراجعة' }).waitFor()
    await page.waitForLoadState('networkidle')
    // What the page sent and received, printed when the test fails.
    const log: string[] = []
    const path = (url: string) => new URL(url).pathname
    page.on('request', (request) => log.push(`→ ${request.method()} ${path(request.url())}`))
    page.on('response', (response) => log.push(`← ${response.status()} ${path(response.url())}`))
    page.on('requestfailed', (request) =>
      log.push(`✗ ${request.method()} ${path(request.url())} ${request.failure()?.errorText}`)
    )
    // «تعيين الكل كمقروء» is an Inertia POST: hold it while a record opens over the page. It is
    // always released, also when the test fails, and the release never waits long.
    const hold = await holdRequests(page, /\/notifications\/read-all$/)
    let released = false
    const release = async () => {
      if (released) return
      released = true
      await Promise.race([
        hold.release().catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ])
    }
    // Every toast the page shows, whenever it shows and however briefly.
    await page.evaluate(`(() => {
      window.__toasts = []
      new MutationObserver(() => {
        for (const toast of document.querySelectorAll('[data-sonner-toast]'))
          if (!window.__toasts.includes(toast.textContent)) window.__toasts.push(toast.textContent)
      }).observe(document.body, { childList: true, subtree: true, characterData: true })
    })()`)
    try {
      await page.getByRole('button', { name: 'تعيين الكل كمقروء', exact: true }).click()
      for (const started = Date.now(); hold.held.length === 0;) {
        if (Date.now() - started > 10_000) assert.fail('the write was not sent')
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      await page.getByRole('link', { name: 'سجل للمراجعة' }).click()
      await page.getByRole('dialog', { name: /^تفاصيل/ }).waitFor({ timeout: 10_000 })
      await release()
      // The write's reply arrives: its message shows and the inbox reads as read.
      await page.getByText('لا إشعارات غير مقروءة', { exact: true }).waitFor({ timeout: 10_000 })
      const toasts = (await page.evaluate('window.__toasts')) as string[]
      assert.isTrue(
        toasts.some((text) => text.includes('تم تعيين كل الإشعارات كمقروءة')),
        `the write's message: ${JSON.stringify(toasts)}`
      )
      const unread = await knex('notifications')
        .where({ user_id: admin.user.id })
        .whereNull('read_at')
      assert.lengthOf(unread, 0)
    } catch (error) {
      console.log(`[write in flight] ${page.url()}\n${log.join('\n')}`)
      const inbox = await page.locator('main').innerText()
      console.log(
        '[write in flight] state',
        JSON.stringify({
          toasts: await page.evaluate('window.__toasts'),
          dialogs: await page.locator('[role=dialog]').count(),
          inbox: inbox.replace(/\s+/g, ' ').slice(0, 200),
        })
      )
      throw error
    } finally {
      await release()
    }
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
