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

test.group('Record collaboration browser acceptance', (group) => {
  let owner: UiActor
  let colleague: UiActor
  let id: number
  group.setup(async () => {
    owner = await seedActor([{ subject: 'all', action: 'manage' }], { fullName: 'نورة المشرفة' })
    colleague = await seedActor([{ subject: 'ui_samples', action: 'view' }], {
      orgUnitId: owner.orgUnitId,
      fullName: 'فهد المراجع',
      level: 0,
    })
    await installSampleResources()
    const actor = await adula().actors.load(owner.user.id)
    const saved = await adula().resources.save('ui_samples', actor, {
      title: 'عينة التعليقات',
      orgUnitId: owner.orgUnitId,
    })
    id = Number(saved.id)
    return () => removeSampleResources()
  })

  test('comment with a mention, tag the record and follow it from the detail view', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(owner.user)
    const page = await visit(`/resources/ui_samples/${id}`)
    const panel = page.getByRole('region', { name: 'التعاون حول السجل' })
    await panel.getByRole('button', { name: 'متابعة السجل' }).waitFor()

    await panel.getByRole('button', { name: 'إشارة إلى زميل' }).click()
    await page.getByPlaceholder('ابحث بالاسم…').fill('فهد')
    await page.getByRole('option', { name: 'فهد المراجع' }).click()
    await panel.getByLabel('تعليق جديد').fill('يرجى مراجعة العنوان قبل الاعتماد')
    await panel.getByRole('button', { name: 'إضافة تعليق' }).click()
    await panel.getByText('يرجى مراجعة العنوان قبل الاعتماد').waitFor()
    await panel.getByText('إشارة إلى: فهد المراجع').waitFor()
    // Commenting follows the record.
    await panel.getByRole('button', { name: 'إلغاء المتابعة' }).waitFor()

    await panel.getByRole('button', { name: 'تعديل الوسوم' }).click()
    await panel.getByLabel('الوسوم مفصولة بفواصل').fill('عاجل، مراجعة')
    await panel.getByRole('button', { name: 'حفظ الوسوم' }).click()
    await panel.getByText('مراجعة', { exact: true }).waitFor()

    const direction = await page.evaluate<string>('document.documentElement.dir')
    assert.equal(direction, 'rtl')
    await page.screenshot({ path: join(await screenshotDir(), 'record-collaboration.png') })

    const inbox = await adula().collaboration.state(
      'ui_samples',
      id,
      await adula().actors.load(colleague.user.id)
    )
    assert.lengthOf(inbox.comments, 1)
    assert.deepEqual(inbox.tags, ['عاجل', 'مراجعة'])
  })

  test('assign a task in a dialog and complete it from my tasks', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(owner.user)
    const page = await visit(`/resources/ui_samples/${id}`)
    const section = page.getByRole('region', { name: 'المهام المسندة' })
    await section.getByRole('button', { name: 'إسناد مهمة' }).click()
    const dialog = page.getByRole('dialog', { name: 'إسناد مهمة' })
    await dialog.getByRole('combobox', { name: 'المكلف' }).click()
    await page.getByRole('option', { name: 'فهد المراجع' }).click()
    await dialog.getByLabel('عنوان المهمة').fill('تدقيق العينة')
    await dialog.getByLabel('تاريخ الاستحقاق').fill('2026-12-31')
    await dialog.getByRole('button', { name: 'إسناد', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    await section.getByText('تدقيق العينة').waitFor()
    await section.getByText('31/12/2026', { exact: true }).waitFor()

    await browserContext.clearCookies()
    await browserContext.loginAs(colleague.user)
    const tasks = await visit('/my-tasks')
    await tasks.getByRole('heading', { name: 'مهامي' }).waitFor()
    await tasks.getByText('تدقيق العينة').waitFor()
    // The record is named by its title, not its database id (issue #32).
    await tasks.getByRole('link', { name: 'عينات الواجهة: عينة التعليقات' }).waitFor()
    // The due date uses the shared calendar formatter, not the raw ISO string (issue #33).
    await tasks.getByText('31/12/2026', { exact: true }).waitFor()
    await tasks.screenshot({ path: join(await screenshotDir(), 'my-tasks.png') })
    // The button opens a closing-note dialog; nothing closes until it is confirmed.
    await tasks.getByRole('button', { name: 'تم الإنجاز' }).click()
    await tasks.getByRole('dialog').getByLabel('ملاحظة الإغلاق').fill('تم التدقيق')
    await tasks.getByRole('button', { name: 'تأكيد الإنجاز' }).click()
    await tasks.getByText('لا مهام ولا موافقات مفتوحة.').waitFor()
    const [row] = await adula().assignments.forRecord(
      'ui_samples',
      id,
      await adula().actors.load(owner.user.id)
    )
    assert.equal(row.status, 'done')
    assert.equal(row.closeReason, 'تم التدقيق')
  })

  test('a record opened from my tasks closes back to my tasks with its tab and scroll', async ({
    browserContext,
    visit,
    assert,
  }) => {
    // A colleague of its own, so the other tests' task lists are unaffected.
    const reader = await seedActor([{ subject: 'ui_samples', action: 'view' }], {
      orgUnitId: owner.orgUnitId,
      fullName: 'سلمى القارئة',
      level: 0,
    })
    const actor = await adula().actors.load(owner.user.id)
    try {
      for (let index = 1; index <= 12; index++)
        await adula().assignments.assign('ui_samples', id, actor, {
          assigneeId: reader.user.id,
          title: `مهمة العودة ${index}`,
        })
      await browserContext.loginAs(reader.user)
      const page = await visit('/my-tasks?tab=assigned')
      await page.setViewportSize({ width: 1280, height: 700 })
      await page.getByText('مهمة العودة 12').waitFor()
      // The page scrolls in the workspace's scroll region on large screens (owner decision 20).
      const scroller = `(() => { const region = document.querySelector('[scroll-region]'); return region && ['auto', 'scroll'].includes(getComputedStyle(region).overflowY) ? region : document.scrollingElement })()`
      await page.evaluate(`${scroller}.scrollTop = ${scroller}.scrollHeight`)
      assert.isAbove(await page.evaluate<number>(`${scroller}.scrollTop`), 200)
      // The view to return to is the one at the moment of the click: Playwright may scroll the
      // link while it clicks it, and the list remembers where the page actually was.
      await page.evaluate(
        `document.addEventListener('click', () => { window.adulaClickScroll = ${scroller}.scrollTop }, { capture: true, once: true })`
      )
      await page.getByRole('link', { name: 'عينات الواجهة: عينة التعليقات' }).last().click()
      const scroll = await page.evaluate<number>('window.adulaClickScroll')
      assert.isAbove(scroll, 200)
      await page.getByRole('dialog', { name: 'تفاصيل · عينات الواجهة' }).waitFor()
      await page.keyboard.press('Escape')
      await page.waitForURL((url) => url.pathname === '/my-tasks' && url.search === '?tab=assigned')
      await page.getByRole('heading', { name: 'مهامي' }).waitFor()
      // The page CSP refuses a polling string predicate in waitForFunction; poll through evaluate.
      for (const started = Date.now(); ;) {
        if (await page.evaluate<boolean>(`Math.abs(${scroller}.scrollTop - ${scroll}) <= 2`)) break
        if (Date.now() - started > 20_000)
          assert.fail(
            `scroll did not return to ${scroll}: ${await page.evaluate<string>(`(() => { const element = ${scroller}; return JSON.stringify({ top: element.scrollTop, height: element.scrollHeight, client: element.clientHeight, region: element !== document.scrollingElement }) })()`)}`
          )
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      // The remembered view is used once.
      assert.isNull(
        await page.evaluate<string | null>('sessionStorage.getItem("adula:list-return")')
      )
    } finally {
      await db.from('assignments').where('assignee_id', reader.user.id).delete()
    }
  })

  test('the assignment dialog closes at once while clean and asks only after a change', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(owner.user)
    const page = await visit(`/resources/ui_samples/${id}`)
    await page.setViewportSize({ width: 375, height: 812 })
    const section = page.getByRole('region', { name: 'المهام المسندة' })
    const open = section.getByRole('button', { name: 'إسناد مهمة' })
    const dialog = page.getByRole('dialog', { name: 'إسناد مهمة' })
    const guard = page.getByRole('dialog', { name: 'إغلاق النموذج؟' })

    await open.click()
    await dialog.waitFor()
    assert.deepEqual(await longDialogLayout(dialog, 812), {
      footerOnScreen: true,
      headerOnScreen: true,
      bodyScrolls: true,
    })
    assert.isTrue(await dialog.getByRole('button', { name: 'إسناد', exact: true }).isVisible())
    await dialog.getByRole('button', { name: 'إلغاء', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    assert.equal(await guard.count(), 0)

    await open.click()
    const title = dialog.getByLabel('عنوان المهمة')
    await title.fill('مهمة')
    await title.fill('')
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
    assert.equal(await guard.count(), 0)

    await open.click()
    await title.fill('مهمة لم تُسند')
    await dialog.getByRole('button', { name: 'إغلاق', exact: true }).click()
    await guard.waitFor()
    await guard.getByRole('button', { name: 'متابعة التحرير', exact: true }).click()
    assert.equal(await title.inputValue(), 'مهمة لم تُسند')
    await dialog.getByRole('button', { name: 'إلغاء', exact: true }).click()
    await guard.getByRole('button', { name: 'إغلاق دون حفظ', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    // The discarded draft does not come back, and nothing was assigned.
    await open.click()
    assert.equal(await title.inputValue(), '')
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
    assert.equal(await section.getByText('مهمة لم تُسند').count(), 0)
  })
})
