import { test } from '@japa/runner'
import { join } from 'node:path'
import db from '@adonisjs/lucid/services/db'
import { adula } from '#services/adula'
import {
  installSampleResources,
  longDialogLayout,
  removeSampleResources,
  screenshotDir,
  seedActor,
  type UiActor,
} from '#tests/helpers/ui_fixtures'

const TOTAL = 'dashboard.orders_overview.ordersTotal'
const COUNT = 'dashboard.orders_overview.orders'

test.group('Personal overview browser acceptance (#159)', (group) => {
  let wide: UiActor
  let narrow: UiActor
  group.setup(async () => {
    wide = await seedActor([{ subject: 'all', action: 'manage' }], {
      fullName: 'هند الإدارية',
      level: 1,
    })
    narrow = await seedActor([{ subject: 'orders', action: 'view' }], {
      fullName: 'سامي المتابع',
      level: 0,
    })
  })
  group.each.setup(async () => {
    await db
      .connection()
      .getWriteClient()('settings')
      .where({ scope: 'user', key: 'preference.overview.layout' })
      .whereIn('scope_id', [String(wide.user.id), String(narrow.user.id)])
      .delete()
  })

  /** The `attribute` of every element the locator matches, in page order. */
  const attributes = async (locator: any, attribute: string): Promise<string[]> => {
    // `all()` does not wait, so wait for the first match before reading the list.
    await locator.first().waitFor()
    const values: string[] = []
    for (const element of await locator.all())
      values.push(String(await element.getAttribute(attribute)))
    return values
  }
  const rowsIn = (dialog: any) =>
    attributes(dialog.locator('[data-sortable-item]'), 'data-sortable-item')
  const shownIds = (page: any) =>
    attributes(page.locator('[data-testid="overview-widgets"] > [data-widget]'), 'data-widget')

  test('hide a widget, drag another, reload and find the arrangement', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(wide.user)
    const page = await visit('/')
    await page.getByRole('heading', { name: 'نظرة عامة' }).waitFor()
    const before = await shownIds(page)
    assert.include(before, 'core.welcome')
    assert.include(before, TOTAL)

    await page.getByRole('button', { name: 'تخصيص' }).click()
    const dialog = page.getByRole('dialog', { name: 'تخصيص النظرة العامة' })
    await dialog.getByRole('switch', { name: 'إظهار حسابي والإعدادات' }).click()
    // Drag «إجمالي الطلبات» by its handle above the first row.
    const handle = dialog.getByRole('button', { name: 'مقبض نقل إجمالي الطلبات' })
    const target = dialog.locator('[data-sortable-item]').first()
    const from = (await handle.boundingBox())!
    const to = (await target.boundingBox())!
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(from.x + from.width / 2, to.y + 4, { steps: 12 })
    await page.mouse.up()
    assert.equal(
      await dialog.locator('[data-sortable-item]').first().getAttribute('data-sortable-item'),
      TOTAL
    )
    await dialog.getByRole('button', { name: 'حفظ', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })

    await page.reload()
    await page.getByRole('heading', { name: 'نظرة عامة' }).waitFor()
    const after = await shownIds(page)
    assert.equal(after[0], TOTAL)
    assert.notInclude(after, 'core.welcome')
    await page.screenshot({ path: join(await screenshotDir(), 'overview-customized.png') })
  })

  test('reorder with the keyboard; Escape cancels a move without closing; reset restores', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(wide.user)
    const page = await visit('/')
    await page.getByRole('button', { name: 'تخصيص' }).click()
    const dialog = page.getByRole('dialog', { name: 'تخصيص النظرة العامة' })
    const rows = () => attributes(dialog.locator('[data-sortable-item]'), 'data-sortable-item')
    const first = await rows()

    // Escape during a move puts the row back and keeps the dialog open.
    await dialog.getByRole('button', { name: 'مقبض نقل حسابي والإعدادات' }).focus()
    await page.keyboard.press('Space')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Escape')
    await dialog
      .getByTestId('sortable-announcement')
      .getByText(/أُلغي النقل/)
      .waitFor()
    assert.isTrue(await dialog.isVisible())
    assert.deepEqual(await rows(), first)

    // Space picks up, the arrows move, Space drops; each step is announced.
    await page.keyboard.press('Space')
    await dialog
      .getByTestId('sortable-announcement')
      .getByText(/تم التقاط حسابي والإعدادات/)
      .waitFor()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Space')
    await dialog
      .getByTestId('sortable-announcement')
      .getByText(/وُضع حسابي والإعدادات في الموضع 3/)
      .waitFor()
    const moved = await rows()
    assert.equal(moved[2], 'core.welcome')
    await dialog.getByRole('button', { name: 'حفظ', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    const saved = await shownIds(page)
    assert.equal(saved[2], 'core.welcome')

    await page.getByRole('button', { name: 'تخصيص' }).click()
    await dialog.getByRole('button', { name: 'استعادة الافتراضي' }).click()
    await page
      .getByRole('alertdialog', { name: 'استعادة الترتيب الافتراضي؟' })
      .getByRole('button', { name: 'استعادة الافتراضي' })
      .click()
    await dialog.waitFor({ state: 'hidden' })
    await page.reload()
    await page.getByRole('heading', { name: 'نظرة عامة' }).waitFor()
    const restored = await shownIds(page)
    assert.deepEqual(restored.slice(0, 4), first.slice(0, 4))
  })

  test('hiding every widget leaves the page empty state with its dashed frame', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(wide.user)
    const page = await visit('/')
    await page.getByRole('heading', { name: 'نظرة عامة' }).waitFor()
    await page.getByRole('button', { name: 'تخصيص' }).click()
    const dialog = page.getByRole('dialog', { name: 'تخصيص النظرة العامة' })
    const switches = dialog.getByRole('switch', { checked: true })
    await switches.first().waitFor()
    while ((await switches.count()) > 0) await switches.first().click()
    const rows = await rowsIn(dialog)
    assert.isAbove(rows.length, 0)
    assert.equal(await dialog.getByRole('switch', { checked: false }).count(), rows.length)
    await dialog.getByRole('button', { name: 'حفظ', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })

    await page.reload()
    await page.getByRole('heading', { name: 'نظرة عامة' }).waitFor()
    const empty = page.getByTestId('overview-empty')
    await empty.waitFor()
    assert.include(await empty.innerText(), 'لا توجد عناصر ظاهرة')
    assert.equal(await page.locator('[data-testid="overview-widgets"]').count(), 0)
    // The page's shared empty state: a dashed, rounded frame with centred muted text.
    const frame = await empty.evaluate((node) => {
      const style = (globalThis as any).getComputedStyle(node)
      return {
        border: style.borderTopStyle,
        align: style.textAlign,
        radius: style.borderTopLeftRadius,
      }
    })
    assert.equal(frame.border, 'dashed')
    assert.equal(frame.align, 'center')
    assert.notEqual(frame.radius, '0px')
    await page.screenshot({ path: join(await screenshotDir(), 'overview-empty.png') })
  })

  test('a widget the user may not see never appears, on the page or in the dialog', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(narrow.user)
    const page = await visit('/')
    await page.getByRole('heading', { name: 'نظرة عامة' }).waitFor()
    const shown = await shownIds(page)
    assert.include(shown, COUNT)
    assert.notInclude(shown, TOTAL)
    await page.getByRole('button', { name: 'تخصيص' }).click()
    const dialog = page.getByRole('dialog', { name: 'تخصيص النظرة العامة' })
    await dialog.getByRole('button', { name: 'مقبض نقل عدد الطلبات' }).waitFor()
    assert.equal(await dialog.getByText('إجمالي الطلبات').count(), 0)

    await page.setViewportSize({ width: 390, height: 844 })
    await dialog.getByRole('button', { name: 'نقل عدد الطلبات للأعلى' }).click()
    await page.screenshot({ path: join(await screenshotDir(), 'overview-customize-mobile.png') })
  })

  test('on a phone the customize dialog keeps its footer on screen while the body scrolls', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(wide.user)
    const page = await visit('/')
    await page.setViewportSize({ width: 375, height: 812 })
    await page.getByRole('button', { name: 'تخصيص' }).click()
    const dialog = page.getByRole('dialog', { name: 'تخصيص النظرة العامة' })
    // Focus the last row's handle so the body scrolls to its end.
    await dialog
      .getByRole('button', { name: /^مقبض نقل / })
      .last()
      .focus()
    assert.deepEqual(await longDialogLayout(dialog, 812), {
      footerOnScreen: true,
      headerOnScreen: true,
      bodyScrolls: true,
    })
    // Nothing changed yet: «إلغاء» closes without asking.
    await dialog.getByRole('button', { name: 'إلغاء', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    assert.equal(await page.getByRole('dialog', { name: 'إغلاق النموذج؟' }).count(), 0)
    await page.getByRole('button', { name: 'تخصيص' }).click()
    // Secondary action first, then «إلغاء», then the primary «حفظ».
    const footer = dialog.locator('[data-slot="long-dialog-footer"]')
    const order = await attributes(footer.getByRole('button'), 'data-variant')
    assert.deepEqual(order, ['ghost', 'outline', 'default'])
    await page.screenshot({ path: join(await screenshotDir(), 'overview-customize-phone.png') })
    await footer.getByRole('button', { name: 'حفظ', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
  })

  test('the task counter shows the open tasks, and 0 rather than «غير متاح» without any', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await installSampleResources()
    try {
      const actor = await adula().actors.load(wide.user.id)
      const saved = await adula().resources.save('ui_samples', actor, {
        title: 'عينة عداد المهام',
        orgUnitId: wide.orgUnitId,
      })
      await db
        .connection()
        .getWriteClient()('assignments')
        .insert({
          resource: 'ui_samples',
          record_id: Number(saved.id),
          assignee_id: wide.user.id,
          assigned_by: wide.user.id,
          title: 'مهمة للعداد',
        })
      const counter = (page: any) =>
        page.locator('[data-widget="core.tasks"]').getByTestId('overview-counter-value')
      await browserContext.loginAs(wide.user)
      const page = await visit('/')
      // The count is deferred: the card waits for it instead of claiming it is unavailable.
      // `toLocaleString('ar')` gives Arabic-Indic or Western digits depending on the browser.
      await counter(page)
        .getByText(/^[1١]$/)
        .waitFor()
      assert.equal(await page.getByText('غير متاح').count(), 0)

      await browserContext.clearCookies()
      await browserContext.loginAs(narrow.user)
      const empty = await visit('/')
      await counter(empty)
        .getByText(/^[0٠]$/)
        .waitFor()
      assert.equal(await empty.getByText('غير متاح').count(), 0)
    } finally {
      await removeSampleResources()
    }
  })

  test('a failed task count says so and reloads only that count on «إعادة المحاولة»', async ({
    browserContext,
    visit,
    assert,
  }) => {
    // The deferred count request fails once, as on a dropped connection.
    let blocked = true
    const deferred = (request: any) =>
      String(request.headers()['x-inertia-partial-data'] ?? '').includes('openTasks')
    await browserContext.route('**/*', async (route: any) => {
      if (blocked && deferred(route.request())) return route.abort('failed')
      return route.fallback()
    })
    try {
      await browserContext.loginAs(narrow.user)
      const page = await visit('/')
      const card = page.locator('[data-widget="core.tasks"]')
      await card.getByRole('alert').getByText('تعذّر تحميل العدد').waitFor()
      // Failure is not loading: no loading status remains.
      assert.equal(await card.getByRole('status').count(), 0)
      blocked = false
      const reloads: string[] = []
      page.on('request', (request: any) => {
        const partial = request.headers()['x-inertia-partial-data']
        if (partial) reloads.push(partial)
      })
      await card.getByRole('button', { name: 'إعادة المحاولة' }).click()
      await card
        .getByTestId('overview-counter-value')
        .getByText(/^[0٠]$/)
        .waitFor()
      assert.deepEqual(reloads, ['openTasks'])
      assert.equal(await card.getByRole('alert').count(), 0)
    } finally {
      await browserContext.unroute('**/*')
    }
  })
})
