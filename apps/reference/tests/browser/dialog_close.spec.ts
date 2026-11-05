import { test } from '@japa/runner'
import { randomUUID } from 'node:crypto'
import { adula } from '#services/adula'
import {
  installSampleResources,
  removeSampleResources,
  seedActor,
  type UiActor,
} from '#tests/helpers/ui_fixtures'

/**
 * Dialogs ask before closing only when there are unsaved changes (ADR 016, owner's decision
 * for 2.3.0): an untouched form closes at once by every way out.
 */
test.group('Dialog close: ask only for unsaved changes', (group) => {
  let admin: UiActor
  group.setup(async () => {
    admin = await seedActor([{ subject: 'all', action: 'manage' }], { fullName: 'مدير الإغلاق' })
    await installSampleResources()
    return () => removeSampleResources()
  })

  test('an untouched record form closes at once by every way out; a real change asks first', async ({
    browserContext,
    visit,
    assert,
  }) => {
    const runtime = adula()
    const loaded = await runtime.actors.load(admin.user.id)
    const stamp = randomUUID().slice(0, 8)
    const title = `عينة الإغلاق ${stamp}`
    const saved = await runtime.resources.save('ui_samples', loaded, {
      orgUnitId: admin.orgUnitId,
      title,
    })
    await browserContext.loginAs(admin.user)
    const page = await visit(`/resources/ui_samples?search=${stamp}`)
    await page.setViewportSize({ width: 1440, height: 900 })
    const listUrl = page.url()
    const dialog = page.getByRole('dialog', { name: 'تعديل عينة' })
    const confirm = page.getByRole('dialog', { name: 'إغلاق النموذج؟' })
    const open = async () => {
      await page.getByRole('link', { name: `تعديل السجل ${saved.id}`, exact: true }).click()
      await dialog.waitFor()
    }
    const closedWithoutAsking = async () => {
      await dialog.waitFor({ state: 'hidden' })
      assert.equal(await confirm.count(), 0)
    }
    // Escape, the close button and a click outside close an untouched form at once.
    await open()
    await page.keyboard.press('Escape')
    await closedWithoutAsking()
    await page.waitForURL(listUrl)
    await open()
    await dialog.getByRole('button', { name: 'إغلاق', exact: true }).last().click()
    await closedWithoutAsking()
    await open()
    await page.mouse.click(8, 450)
    await closedWithoutAsking()
    // «إلغاء» in the footer leaves an untouched form without asking (back to the details).
    await open()
    await dialog.getByRole('button', { name: 'إلغاء', exact: true }).click()
    await page.getByRole('dialog', { name: 'تفاصيل · عينات الواجهة' }).waitFor()
    assert.equal(await confirm.count(), 0)
    await page.keyboard.press('Escape')
    await page.waitForURL(listUrl)

    // A typed change asks; typing the original value back closes at once again.
    await open()
    const field = dialog.getByLabel('العنوان', { exact: true })
    await field.fill(`${title} معدل`)
    await page.keyboard.press('Escape')
    await confirm.waitFor()
    await page.getByRole('button', { name: 'متابعة التحرير', exact: true }).click()
    await confirm.waitFor({ state: 'hidden' })
    await field.fill(title)
    await page.mouse.click(8, 450)
    await closedWithoutAsking()
  })

  test('a plain form dialog without data-dirty closes at once until the user changes a field', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(admin.user)
    const page = await visit('/users/invite')
    await page.setViewportSize({ width: 1440, height: 900 })
    const dialog = page.getByRole('dialog', { name: 'إضافة مستخدم بدعوة بريدية' })
    const confirm = page.getByRole('dialog', { name: 'إغلاق النموذج؟' })
    await dialog.waitFor()
    // This form reports nothing; an untouched dialog still closes without a question.
    assert.isNull(await dialog.locator('form').first().getAttribute('data-dirty'))
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
    assert.equal(await confirm.count(), 0)
    // After typing, closing asks.
    await page.goto('/users/invite')
    await dialog.waitFor()
    await dialog.getByLabel('الاسم الكامل').fill('مستخدم مدعو')
    await page.keyboard.press('Escape')
    await confirm.waitFor()
    await page.getByRole('button', { name: 'إغلاق دون حفظ', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
  })
})
