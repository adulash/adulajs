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

  test('a plain form dialog without data-dirty asks only while a value differs from the opening one', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(admin.user)
    // The API token form is a plain form in a dialog: it reports no data-dirty of its own.
    const page = await visit('/account/tokens')
    await page.setViewportSize({ width: 1440, height: 900 })
    const dialog = page.getByRole('dialog', { name: 'إنشاء رمز API' })
    const confirm = page.getByRole('dialog', { name: 'إغلاق النموذج؟' })
    const open = async () => {
      await page.getByRole('button', { name: 'إنشاء رمز', exact: true }).click()
      await dialog.waitFor()
    }
    await open()
    // This form reports nothing; an untouched dialog still closes without a question.
    assert.equal(await dialog.locator('[data-dirty]').count(), 0)
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
    assert.equal(await confirm.count(), 0)
    // Typing a value and erasing it again leaves nothing unsaved: it closes at once.
    await open()
    const name = dialog.getByLabel('اسم الرمز')
    await name.fill('رمز التجربة')
    await name.fill('')
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
    assert.equal(await confirm.count(), 0)
    // A value that differs from the opening one asks before closing.
    await open()
    await name.fill('رمز التجربة')
    await page.keyboard.press('Escape')
    await confirm.waitFor()
    await page.getByRole('button', { name: 'إغلاق دون حفظ', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
  })

  test('a region that is not a form reports data-dirty for its own controls', async ({
    browserContext,
    visit,
    assert,
  }) => {
    const runtime = adula()
    const loaded = await runtime.actors.load(admin.user.id)
    const saved = await runtime.resources.save('ui_samples', loaded, {
      orgUnitId: admin.orgUnitId,
      title: `عينة المنطقة ${randomUUID().slice(0, 8)}`,
    })
    await browserContext.loginAs(admin.user)
    const page = await visit(`/resources/ui_samples/${saved.id}/edit`)
    await page.setViewportSize({ width: 1440, height: 900 })
    const dialog = page.getByRole('dialog', { name: 'تعديل عينة' })
    const confirm = page.getByRole('dialog', { name: 'إغلاق النموذج؟' })
    await dialog.waitFor()
    // A settings panel outside the record form (as in the mail provider dialog) compares its
    // own values and reports them on a plain element, not a form.
    await page.evaluate(`(() => {
      const body = document.querySelector('[role=dialog] [data-slot=long-dialog-body]')
      const region = document.createElement('div')
      region.setAttribute('data-dirty', 'false')
      region.setAttribute('data-testid', 'region')
      const input = document.createElement('input')
      input.setAttribute('aria-label', 'إعداد المنطقة')
      region.append(input)
      body.append(region)
    })()`)
    const region = dialog.getByTestId('region')
    // Typing inside the region is its own business: it still reports clean, so no question.
    await dialog.getByLabel('إعداد المنطقة').fill('قيمة')
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
    assert.equal(await confirm.count(), 0)
    // A region that reports a change makes the dialog ask, like a dirty form.
    await page.goto(`/resources/ui_samples/${saved.id}/edit`)
    await dialog.waitFor()
    await page.evaluate(`(() => {
      const region = document.createElement('div')
      region.setAttribute('data-dirty', 'true')
      region.setAttribute('data-testid', 'region')
      document.querySelector('[role=dialog] [data-slot=long-dialog-body]').append(region)
    })()`)
    await region.waitFor({ state: 'attached' })
    await page.keyboard.press('Escape')
    await confirm.waitFor()
    await page.getByRole('button', { name: 'إغلاق دون حفظ', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
  })
})
