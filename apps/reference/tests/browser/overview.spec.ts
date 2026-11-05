import { test } from '@japa/runner'
import { join } from 'node:path'
import db from '@adonisjs/lucid/services/db'
import { screenshotDir, seedActor, type UiActor } from '#tests/helpers/ui_fixtures'

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

  const shownIds = (page: any) =>
    page
      .locator('[data-testid="overview-widgets"] > [data-widget]')
      .evaluateAll("(nodes) => nodes.map((node) => node.getAttribute('data-widget'))") as Promise<
      string[]
    >

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
    const rows = () =>
      dialog
        .locator('[data-sortable-item]')
        .evaluateAll(
          "(nodes) => nodes.map((node) => node.getAttribute('data-sortable-item'))"
        ) as Promise<string[]>
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
      .getByRole('dialog', { name: 'استعادة الترتيب الافتراضي؟' })
      .getByRole('button', { name: 'استعادة الافتراضي' })
      .click()
    await dialog.waitFor({ state: 'hidden' })
    await page.reload()
    const restored = await shownIds(page)
    assert.deepEqual(restored.slice(0, 4), first.slice(0, 4))
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
})
