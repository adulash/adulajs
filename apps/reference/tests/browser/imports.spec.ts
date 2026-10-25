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
    await page.getByRole('button', { name: 'استيراد CSV' }).click()
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
})
