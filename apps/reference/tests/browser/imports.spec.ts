import { test } from '@japa/runner'
import { join } from 'node:path'
import { adula } from '#services/adula'
import {
  installSampleResources,
  removeSampleResources,
  screenshotDir,
  seedActor,
  type UiActor,
} from '#tests/helpers/ui_fixtures'

test.group('CSV import browser acceptance', (group) => {
  let clerk: UiActor
  group.setup(async () => {
    clerk = await seedActor([{ subject: 'all', action: 'manage' }], { fullName: 'مستورد العينات' })
    await installSampleResources()
    return () => removeSampleResources()
  })

  test('upload a CSV, map columns, dry-run it and follow the import to completion', async ({
    browserContext,
    visit,
  }) => {
    await browserContext.loginAs(clerk.user)
    const page = await visit('/resources/ui_samples')
    await page.getByRole('button', { name: 'استيراد من ملف' }).click()
    const dialog = page.getByRole('dialog', { name: 'استيراد إلى عينات الواجهة' })
    const template = dialog.getByRole('link', { name: 'تنزيل قالب CSV' })
    if ((await template.getAttribute('href')) !== '/resources/ui_samples/imports/template')
      throw new Error('The template link points elsewhere')
    await dialog.getByLabel('الملف').setInputFiles({
      name: 'samples.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(`البيان,الوحدة\nمن المتصفح,${clerk.orgUnitId}\n`),
    })
    await dialog.getByRole('button', { name: 'رفع الملف' }).click()
    await dialog.getByRole('combobox', { name: 'حقل العمود البيان' }).click()
    await page.getByRole('option', { name: 'العنوان *' }).click()
    await dialog.getByRole('combobox', { name: 'حقل العمود الوحدة' }).click()
    await page.getByRole('option', { name: 'الوحدة التنظيمية (رقم) *' }).click()
    // Validate without saving, read the per-row report, then import the same batch.
    await dialog.getByRole('button', { name: 'تحقق دون حفظ' }).click()
    await dialog.getByText('جارٍ التحقق').waitFor()
    await adula().imports.process()
    const report = dialog.getByRole('table', { name: 'تقرير التحقق' })
    await report.getByText('إضافة').waitFor({ timeout: 10000 })
    await dialog.getByRole('button', { name: 'بدء الاستيراد' }).click()
    await page.waitForURL(/\/imports$/)
    await page.getByText('samples.csv').waitFor()
    await adula().imports.process()
    await page.getByText('نجح 1').waitFor({ timeout: 10000 })
    await page.screenshot({ path: join(await screenshotDir(), 'imports.png') })
  })

  test('the import dialog keeps its title and actions on screen while the mapping scrolls', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(clerk.user)
    const page = await visit('/resources/ui_samples')
    await page.getByRole('button', { name: 'استيراد من ملف' }).click()
    const dialog = page.getByRole('dialog', { name: 'استيراد إلى عينات الواجهة' })
    // Thirty columns: the mapping step is taller than the screen on desktop and phone.
    const headers = Array.from({ length: 30 }, (_, index) => `عمود ${index + 1}`)
    await dialog.getByLabel('الملف').setInputFiles({
      name: 'wide.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(`${headers.join(',')}
${headers.map(() => 'قيمة').join(',')}
`),
    })
    await dialog.getByRole('button', { name: 'رفع الملف' }).click()
    await dialog.getByRole('combobox', { name: 'حقل العمود عمود 30' }).waitFor()
    const body = dialog.locator('[data-slot="long-dialog-body"]')
    const footer = dialog.locator('[data-slot="long-dialog-footer"]')
    const title = dialog.getByRole('heading', { name: 'استيراد إلى عينات الواجهة' })
    // The footer order: the secondary action, «إلغاء», then the primary action.
    const actions = await footer.getByRole('button').allInnerTexts()
    assert.deepEqual(
      actions.map((text) => text.trim()),
      ['تحقق دون حفظ', 'إلغاء', 'بدء الاستيراد']
    )
    type Box = { scrollTop: number; scrollHeight: number; clientHeight: number }
    const metrics = () =>
      body.evaluate((element) => {
        const box = element as unknown as Box
        return {
          scrollTop: box.scrollTop,
          scrollHeight: box.scrollHeight,
          clientHeight: box.clientHeight,
        }
      })
    /** The box once the opening animation or a resize has stopped moving it. */
    const settled = async (locator: typeof footer) => {
      let previous = JSON.stringify(await locator.boundingBox())
      for (let attempt = 0; attempt < 50; attempt++) {
        await page.waitForTimeout(50)
        const next = JSON.stringify(await locator.boundingBox())
        if (next === previous) return JSON.parse(next) as { y: number; height: number }
        previous = next
      }
      throw new Error('the dialog kept moving')
    }
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 375, height: 812 },
    ]) {
      const label = `${viewport.width}×${viewport.height}`
      await page.setViewportSize(viewport)
      await body.evaluate((element) => {
        ;(element as unknown as Box).scrollTop = 0
      })
      const before = await metrics()
      assert.isAbove(before.scrollHeight, before.clientHeight, `${label}: the body scrolls`)
      const footerBefore = await settled(footer)
      assert.isAtMost(footerBefore.y + footerBefore.height, viewport.height, `${label}: footer`)
      await body.hover()
      await page.mouse.wheel(0, 3000)
      let after = await metrics()
      for (let attempt = 0; attempt < 20 && after.scrollTop === 0; attempt++) {
        await page.waitForTimeout(50)
        after = await metrics()
      }
      assert.isAbove(after.scrollTop, 0, `${label}: the body moved`)
      // Only the body moved: the title and the actions stay where they were, on screen.
      const footerAfter = await settled(footer)
      const titleAfter = await settled(title)
      assert.equal(footerAfter.y, footerBefore.y, `${label}: footer fixed`)
      assert.isAtLeast(titleAfter.y, 0, `${label}: title on screen`)
      await footer.getByRole('button', { name: 'بدء الاستيراد' }).waitFor({ state: 'visible' })
      await page.screenshot({
        path: join(await screenshotDir(), `import-dialog-${viewport.width}.png`),
      })
    }
  })

  test('the import dialog closes at once until something is chosen or changed', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(clerk.user)
    const page = await visit('/resources/ui_samples')
    const open = page.getByRole('button', { name: 'استيراد من ملف' })
    const dialog = page.getByRole('dialog', { name: 'استيراد إلى عينات الواجهة' })
    const confirm = page.getByRole('dialog', { name: 'إغلاق النموذج؟' })
    const closedClean = async (how: string) => {
      await dialog.waitFor({ state: 'hidden' })
      assert.equal(await confirm.count(), 0, `${how}: asked to confirm a clean dialog`)
    }
    // Nothing chosen yet: Escape, the close button, «إلغاء» and a click outside all close.
    await open.click()
    await dialog.waitFor()
    await page.keyboard.press('Escape')
    await closedClean('Escape')
    await open.click()
    await dialog.getByRole('button', { name: 'إغلاق', exact: true }).click()
    await closedClean('close button')
    await open.click()
    await dialog.getByRole('button', { name: 'إلغاء', exact: true }).click()
    await closedClean('إلغاء')
    await open.click()
    await dialog.waitFor()
    await page.mouse.click(5, 5)
    await closedClean('outside click')

    // A chosen file is a change: every way out asks first, and «متابعة التحرير» keeps it.
    await open.click()
    await dialog.getByLabel('الملف').setInputFiles({
      name: 'samples.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(`البيان,الوحدة
إغلاق,${clerk.orgUnitId}
`),
    })
    await page.keyboard.press('Escape')
    await confirm.waitFor()
    await confirm.getByRole('button', { name: 'متابعة التحرير' }).click()
    await confirm.waitFor({ state: 'hidden' })
    await dialog.getByText('samples.csv').waitFor()
    await dialog.getByRole('button', { name: 'إلغاء', exact: true }).click()
    await confirm.waitFor()
    await confirm.getByRole('button', { name: 'متابعة التحرير' }).click()

    // The mapping the upload suggested is clean; a change asks, and undoing it is clean again.
    await dialog.getByRole('button', { name: 'رفع الملف' }).click()
    const column = dialog.getByRole('combobox', { name: 'حقل العمود البيان' })
    await column.waitFor()
    const shown = await column.innerText()
    const suggested = shown.trim()
    const other = suggested === 'تجاهل العمود' ? 'العنوان *' : 'تجاهل العمود'
    await column.click()
    await page.getByRole('option', { name: other, exact: true }).click()
    // Escape goes to the dialog only once the option list has closed.
    await page.getByRole('listbox').waitFor({ state: 'hidden' })
    const form = dialog.locator('form#import-mapping')
    assert.equal(await form.getAttribute('data-dirty'), 'true')
    await page.keyboard.press('Escape')
    await confirm.waitFor()
    await confirm.getByRole('button', { name: 'متابعة التحرير' }).click()
    await confirm.waitFor({ state: 'hidden' })
    await column.click()
    await page.getByRole('option', { name: suggested, exact: true }).click()
    await page.getByRole('listbox').waitFor({ state: 'hidden' })
    assert.equal(await form.getAttribute('data-dirty'), 'false')
    await page.keyboard.press('Escape')
    await closedClean('mapping restored')
  })
})
