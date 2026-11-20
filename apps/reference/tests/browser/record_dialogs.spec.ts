import { test } from '@japa/runner'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { Locator, Page } from 'playwright'
import { adula } from '#services/adula'
import {
  installSampleResources,
  removeSampleResources,
  screenshotDir,
  seedActor,
  type UiActor,
} from '#tests/helpers/ui_fixtures'

/**
 * Saving a new record returns to the list with the new row first and highlighted (owner,
 * 2.3.0); the record's own page opens from that row.
 */
async function openCreatedRecord(page: Page, resource: string) {
  await page.waitForURL(new RegExp(`/resources/${resource}$`))
  const row = page.locator('main tr[data-created]')
  await row.waitFor({ state: 'attached' })
  const id = await row.getAttribute('data-row-id')
  await page.goto(`/resources/${resource}/${id}`)
  return id
}

const sizes = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'phone', width: 375, height: 812 },
] as const

/** The footer's controls (buttons, and links drawn as buttons), in order, with their variants. */
async function footerButtons(dialog: Locator) {
  const buttons = dialog.locator('[data-slot="record-footer"]').locator('button, a')
  const found: { name: string; variant: string | null }[] = []
  for (let index = 0; index < (await buttons.count()); index++) {
    const button = buttons.nth(index)
    if (!(await button.isVisible())) continue
    const text = await button.innerText()
    found.push({ name: text.trim(), variant: await button.getAttribute('data-variant') })
  }
  return found
}

/** «إلغاء» (outline) right before the primary save («حفظ السجل», or an override's «حفظ …»). */
function assertFormFooter(
  buttons: { name: string; variant: string | null }[],
  name: string,
  assert: any
) {
  const [cancel, save] = buttons.slice(-2)
  assert.deepEqual(cancel, { name: 'إلغاء', variant: 'outline' }, name)
  assert.equal(save?.variant, 'default', name)
  assert.match(save?.name ?? '', /^حفظ/, name)
}

/**
 * The long dialog layout (ADR 016): the title sits at the top of the dialog, the footer is
 * entirely on screen, and the body between them is the only scroller, before and after it
 * scrolls to its end.
 */
async function assertLongDialog(page: Page, dialog: Locator, height: number, assert: any) {
  const footer = dialog.locator('[data-slot="long-dialog-footer"]')
  await footer.waitFor({ timeout: 10_000 }).catch(() => {
    throw new Error(`No fixed footer in the dialog at ${page.url()}`)
  })
  // Measure after the opening zoom, when the dialog has its settled box.
  await dialog.evaluate(async (element: { getAnimations(): { finished: Promise<unknown> }[] }) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished))
  })
  const body = dialog.locator('[data-long-dialog-body] [data-slot="scroll-area-viewport"]')
  const title = dialog.locator('[data-slot="dialog-title"]')
  const check = async () => {
    const box = (await footer.boundingBox())!
    assert.isAtLeast(box.y, 0)
    assert.isAtMost(box.y + box.height, height + 0.5)
    const content = (await dialog.boundingBox())!
    const heading = (await title.boundingBox())!
    assert.isAtLeast(heading.y, content.y)
    assert.isBelow(heading.y, box.y)
  }
  await check()
  const top = (await title.boundingBox())!.y
  await body.evaluate('(element) => { element.scrollTop = element.scrollHeight }')
  await check()
  // Up to 1px: the -50% centring transform leaves sub-pixel positions that round differently
  // after the body scrolls; a header that scrolled with it would move by its whole height.
  assert.isAtMost(Math.abs((await title.boundingBox())!.y - top), 1)
  assert.equal(
    await page.evaluate<string>(
      'getComputedStyle(document.querySelector("[role=dialog] [data-long-dialog-body] [data-slot=scroll-area-viewport]")).overflowY'
    ),
    'scroll'
  )
}

/** Record dialogs keep their actions in a fixed footer (ADR 016, owner's decision for 2.3.0). */
test.group('Record dialogs: fixed footer', (group) => {
  let admin: UiActor
  // Seeded records, opened directly: some lists (the orders override) link records their own way.
  const seeded: Record<string, string> = {}
  group.setup(async () => {
    admin = await seedActor([{ subject: 'all', action: 'manage' }], { fullName: 'مدير النوافذ' })
    await installSampleResources()
    const runtime = adula()
    const loaded = await runtime.actors.load(admin.user.id)
    const stamp = randomUUID().slice(0, 8)
    const customer = await runtime.resources.save('customers', loaded, {
      name: `عميل التذييل ${stamp}`,
    })
    const order = await runtime.resources.save('orders', loaded, {
      orgUnitId: admin.orgUnitId,
      notes: `طلب التذييل ${stamp}`,
    })
    const sample = await runtime.resources.save('ui_samples', loaded, {
      orgUnitId: admin.orgUnitId,
      title: `عينة التذييل ${stamp}`,
    })
    seeded.customers = `/resources/customers/${customer.id}`
    seeded.orders = `/resources/orders/${order.id}`
    seeded.ui_samples = `/resources/ui_samples/${sample.id}`
    return () => removeSampleResources()
  })

  for (const size of sizes)
    test(`every resource's create, details and edit dialogs keep their actions on screen (${size.name})`, async ({
      browserContext,
      visit,
      assert,
    }) => {
      const actor = await adula().actors.load(admin.user.id)
      const resources = [
        ...new Set(
          adula()
            .resources.navigation(actor)
            .map((entry) => entry.name)
        ),
      ]
      assert.isAbove(resources.length, 3)
      await browserContext.loginAs(admin.user)
      const page = await visit('/')
      await page.setViewportSize({ width: size.width, height: size.height })
      const counts = { create: 0, show: 0, edit: 0 }
      const shownNames: string[] = []
      for (const name of resources) {
        // Create, where the resource allows it.
        await page.setViewportSize({ width: size.width, height: size.height })
        const created = await page.goto(`/resources/${name}/create`)
        if (created?.ok()) {
          const dialog = page.getByRole('dialog').first()
          await dialog.waitFor()
          await assertLongDialog(page, dialog, size.height, assert)
          const buttons = await footerButtons(dialog)
          assertFormFooter(buttons, name, assert)
          counts.create++
        }
        // Details and edit of the first record the list shows.
        // Read the list at desktop width (the phone list renders cards), then open at size.
        await page.setViewportSize({ width: 1440, height: 900 })
        await page.goto(`/resources/${name}`)
        // The rows render after the page; an empty list shows no record link.
        await page.waitForLoadState('networkidle')
        await page.locator('main').getByRole('heading').first().waitFor()
        const view = page.getByRole('link', { name: /^عرض السجل/ }).first()
        const href = seeded[name] ?? ((await view.count()) ? await view.getAttribute('href') : null)
        if (!href) continue
        await page.setViewportSize({ width: size.width, height: size.height })
        await page.goto(href)
        const details = page.getByRole('dialog').first()
        await details.waitFor()
        await assertLongDialog(page, details, size.height, assert)
        const shown = await footerButtons(details)
        const close = shown.findIndex((button) => button.name === 'إغلاق')
        assert.isAtLeast(close, 0, `${name}: «إغلاق» in the footer`)
        assert.equal(shown[close].variant, 'outline')
        const edit = shown.findIndex((button) => button.name === 'تعديل السجل')
        if (edit >= 0) {
          // The primary action comes last, after «إغلاق».
          assert.equal(edit, shown.length - 1)
          assert.equal(shown[edit].variant, 'default')
        }
        counts.show++
        shownNames.push(name)
        const edited = await page.goto(`${href}/edit`)
        if (edited?.ok()) {
          const editor = page.getByRole('dialog').first()
          await editor.waitFor()
          await assertLongDialog(page, editor, size.height, assert)
          const buttons = await footerButtons(editor)
          assertFormFooter(buttons, name, assert)
          counts.edit++
        }
      }
      // The seeded customers, orders and samples are among the checked records.
      assert.isAtLeast(counts.create, 3)
      assert.isAtLeast(counts.show, 3, shownNames.join(', '))
      assert.isAtLeast(counts.edit, 3)
    })

  for (const size of sizes)
    test(`a refused save from the footer shows the errors beside their fields and focuses the first (${size.name})`, async ({
      browserContext,
      visit,
      assert,
    }) => {
      await browserContext.loginAs(admin.user)
      const page = await visit('/resources/ui_samples/create')
      await page.setViewportSize({ width: size.width, height: size.height })
      const dialog = page.getByRole('dialog', { name: 'إضافة عينة' })
      await dialog.waitFor()
      // Inline rows are part of the scrolling body; the footer stays below them.
      await assertLongDialog(page, dialog, size.height, assert)
      await dialog.getByRole('button', { name: 'حفظ السجل', exact: true }).click()
      await page.assertVisible(dialog.getByText('تعذر الحفظ', { exact: true }))
      // The first invalid field has focus, and its message is next to it (#118).
      assert.equal(
        await page.evaluate<string>(
          '(document.activeElement?.id ?? "") + ":" + document.activeElement?.getAttribute("aria-invalid")'
        ),
        'title:true'
      )
      const field = dialog.getByLabel('العنوان', { exact: true })
      const message = dialog.locator('#title').locator('xpath=ancestor::*[.//p][1]').locator('p', {
        hasText: 'هذا الحقل مطلوب',
      })
      await page.assertVisible(message)
      const fieldBox = (await field.boundingBox())!
      const messageBox = (await message.boundingBox())!
      assert.isAtMost(Math.abs(messageBox.y - (fieldBox.y + fieldBox.height)), 40)
      // The footer is still on screen with the errors shown.
      const footer = (await dialog.locator('[data-slot="long-dialog-footer"]').boundingBox())!
      assert.isAtMost(footer.y + footer.height, size.height + 0.5)
      // Enter in a field submits the form through the footer's save button too.
      await field.fill(`عينة التذييل ${randomUUID().slice(0, 8)}`)
      await field.press('Enter')
      await openCreatedRecord(page, 'ui_samples')
      await page.getByRole('link', { name: 'تعديل السجل', exact: true }).waitFor()
      await page.screenshot({
        path: join(
          await screenshotDir(),
          `record-footer-${size.name}-${process.env.ADULA_TEST_THEME ?? 'light'}.png`
        ),
      })
    })
})
