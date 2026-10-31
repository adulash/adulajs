import { test } from '@japa/runner'
import { randomUUID } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import { adula } from '#services/adula'
import { seedActor, type UiActor } from '#tests/helpers/ui_fixtures'

/**
 * Browser acceptance of the list layer (ADR 046) on the test-only orders/tasks fixtures
 * (ADR 017): selection and bulk actions with a partial failure, «المحذوفات» with restore, and
 * the dashboard page. Authorization is the stored role of a real PostgreSQL user.
 */
const knex = () => db.connection().getWriteClient()

test.group('List layer browser acceptance', (group) => {
  let admin: UiActor
  group.setup(async () => {
    admin = await seedActor([{ subject: 'all', action: 'manage' }], { fullName: 'مدير القوائم' })
    await knex()('lookups')
      .insert({ group: 'order_status', key: 'open', label_ar: 'مفتوح', label_en: 'Open' })
      .onConflict(['group', 'key'])
      .ignore()
  })

  async function createTasks(owner: UiActor, titles: string[]) {
    const runtime = adula()
    const actor = await runtime.actors.load(owner.user.id)
    const ids: number[] = []
    for (const title of titles) {
      const task = await runtime.resources.save('tasks', actor, {
        title,
        done: false,
        orgUnitId: owner.orgUnitId,
      })
      ids.push(Number(task.id))
    }
    return ids
  }

  test('selected rows run a bulk action; a row changed meanwhile is reported, the rest succeed', async ({
    browserContext,
    visit,
    assert,
  }) => {
    const stamp = randomUUID().slice(0, 8)
    const titles = ['أولى', 'ثانية', 'ثالثة'].map((word) => `مهمة جماعية ${word} ${stamp}`)
    const [first, second, third] = await createTasks(admin, titles)
    await browserContext.loginAs(admin.user)
    const page = await visit(`/resources/tasks?search=${stamp}`)
    await page.assertElementsCount('tbody tr[aria-rowindex]', 3)
    const region = page.getByRole('region', { name: 'الإجراءات الجماعية' })
    assert.equal(await region.count(), 0)
    await page.getByRole('checkbox', { name: `تحديد السجل ${first}`, exact: true }).click()
    await page.getByRole('checkbox', { name: `تحديد السجل ${second}`, exact: true }).click()
    await page.assertVisible(region.getByText('تم تحديد 2'))
    assert.equal(
      await page
        .getByRole('checkbox', { name: 'تحديد كل السجلات المعروضة', exact: true })
        .getAttribute('data-state'),
      'indeterminate'
    )
    // Another user deletes one selected task before the action is confirmed.
    await knex()('tasks').where('id', second).update({ deleted_at: new Date() })
    await region.getByRole('button', { name: 'تعليم كمنجزة', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'تعليم كمنجزة' })
    await dialog.waitFor()
    await page.assertVisible(dialog.getByText('تعليم المهام المحددة كمنجزة؟'))
    await dialog.getByRole('button', { name: 'تأكيد', exact: true }).click()
    await page.assertVisible(dialog.getByText('نُفذ على 1 سجل'))
    await page.assertVisible(dialog.getByText('تعذر تنفيذ الإجراء على 1 سجل'))
    const failure = dialog.locator('ul > li')
    assert.equal(await failure.count(), 1)
    assert.include(await failure.innerText(), titles[1])
    assert.include(await failure.innerText(), `#${second}`)
    // The per-row reason is the server's Arabic message.
    assert.match(await failure.innerText(), /[؀-ۿ]{3,}.*[؀-ۿ]{3,}$/)
    await dialog
      .locator('[data-slot="dialog-footer"]')
      .getByRole('button', { name: 'إغلاق' })
      .click()
    // The list refreshed: the deleted task left it.
    await page.assertElementsCount('tbody tr[aria-rowindex]', 2)
    const done = await knex()('tasks').whereIn('id', [first, second, third]).orderBy('id')
    assert.deepEqual(
      done.map((row) => row.done),
      [true, false, false]
    )

    // Select all loaded rows, then the destructive built-in delete.
    await page.getByRole('checkbox', { name: 'تحديد كل السجلات المعروضة', exact: true }).click()
    await page.assertVisible(region.getByText('تم تحديد 2'))
    await region.getByRole('button', { name: 'حذف', exact: true }).click()
    const removal = page.getByRole('dialog', { name: 'حذف' })
    await removal.waitFor()
    assert.include(
      (await removal.getByRole('button', { name: 'تأكيد', exact: true }).getAttribute('class')) ??
        '',
      'bg-destructive'
    )
    await removal.getByRole('button', { name: 'تأكيد', exact: true }).click()
    await page.assertVisible(removal.getByText('نُفذ على 2 سجل'))
    await removal
      .locator('[data-slot="dialog-footer"]')
      .getByRole('button', { name: 'إغلاق' })
      .click()
    await page.assertVisible(page.getByText('لا توجد سجلات مطابقة'))
    const deleted = await knex()('tasks').whereIn('id', [first, third]).whereNotNull('deleted_at')
    assert.lengthOf(deleted, 2)
  })

  test('«المحذوفات» lists deleted records and restores them, one by one and in bulk', async ({
    browserContext,
    visit,
    assert,
  }) => {
    const stamp = randomUUID().slice(0, 8)
    const titles = ['أولى', 'ثانية', 'ثالثة'].map((word) => `مهمة محذوفة ${word} ${stamp}`)
    // A unit of its own, so the empty «المحذوفات» at the end holds only this test's records.
    const owner = await seedActor([{ subject: 'all', action: 'manage' }], {
      fullName: 'مستعيد المهام',
    })
    const ids = await createTasks(owner, titles)
    await knex()('tasks').whereIn('id', ids).update({ deleted_at: new Date() })
    await browserContext.loginAs(owner.user)
    const page = await visit(`/resources/tasks?search=${stamp}`)
    await page.assertVisible(page.getByText('لا توجد سجلات مطابقة'))
    await page.getByRole('link', { name: 'المحذوفات', exact: true }).click()
    await page.waitForURL((url) => url.pathname === '/resources/tasks/trash')
    await page.getByRole('heading', { name: 'المحذوفات · المهام', exact: true }).waitFor()
    // Trashed rows offer restore only: no create, view, edit or row delete; no saved views.
    assert.equal(await page.getByRole('link', { name: 'مهمة جديدة', exact: true }).count(), 0)
    assert.equal(await page.getByRole('link', { name: /عرض السجل/ }).count(), 0)
    assert.equal(await page.getByRole('button', { name: /^حذف السجل/ }).count(), 0)
    assert.equal(await page.getByRole('button', { name: 'حفظ العرض الحالي' }).count(), 0)
    assert.equal(await page.getByRole('button', { name: 'تصدير النتائج' }).count(), 0)
    await page.getByLabel('البحث في المهام').fill(stamp)
    await page.getByLabel('البحث في المهام').press('Enter')
    await page.waitForURL(
      (url) => url.pathname === '/resources/tasks/trash' && url.search.includes(stamp)
    )
    await page.assertElementsCount('tbody tr[aria-rowindex]', 3)

    await page.getByRole('button', { name: `استعادة السجل ${ids[0]}`, exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'استعادة السجل' })
    await dialog.waitFor()
    await dialog.getByRole('button', { name: 'استعادة', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    await page.assertElementsCount('tbody tr[aria-rowindex]', 2)
    const restored = await knex()('tasks').where('id', ids[0]).first()
    assert.isNull(restored.deleted_at)

    // Bulk in «المحذوفات» offers restore only.
    await page.getByRole('checkbox', { name: 'تحديد كل السجلات المعروضة', exact: true }).click()
    const region = page.getByRole('region', { name: 'الإجراءات الجماعية' })
    await page.assertVisible(region.getByText('تم تحديد 2'))
    assert.deepEqual(await region.getByRole('button').allInnerTexts(), ['إلغاء التحديد', 'استعادة'])
    await region.getByRole('button', { name: 'استعادة', exact: true }).click()
    const bulk = page.getByRole('dialog', { name: 'استعادة' })
    await bulk.getByRole('button', { name: 'تأكيد', exact: true }).click()
    await page.assertVisible(bulk.getByText('نُفذ على 2 سجل'))
    await bulk.locator('[data-slot="dialog-footer"]').getByRole('button', { name: 'إغلاق' }).click()
    await page.assertVisible(page.getByText('لا توجد سجلات مطابقة'))
    const live = await knex()('tasks').whereIn('id', ids).whereNull('deleted_at')
    assert.lengthOf(live, 3)
    const activity = await knex()('activities')
      .where({ resource: 'tasks', action: 'restore' })
      .whereIn('record_id', ids)
    assert.lengthOf(activity, 3)

    await page.goto('/resources/tasks/trash')
    await page.assertVisible(page.getByText('لا توجد سجلات محذوفة'))
    await page.getByRole('link', { name: 'السجلات النشطة', exact: true }).click()
    await page.waitForURL((url) => url.pathname === '/resources/tasks')
    await page.getByLabel('البحث في المهام').fill(stamp)
    await page.getByLabel('البحث في المهام').press('Enter')
    await page.waitForURL(/search=/)
    await page.assertElementsCount('tbody tr[aria-rowindex]', 3)
  })

  test('the dashboard shows totals and grouped bars computed within the viewer scope', async ({
    browserContext,
    visit,
    assert,
  }) => {
    // This actor's unit is new, so only the records created here are in its scope.
    const viewer = await seedActor([{ subject: 'all', action: 'manage' }], {
      fullName: 'قارئ المؤشرات',
    })
    const runtime = adula()
    const actor = await runtime.actors.load(viewer.user.id)
    for (const total of ['150050', '49950'])
      await runtime.resources.save('orders', actor, {
        orgUnitId: viewer.orgUnitId,
        status: 'open',
        total,
        notes: `طلب المؤشرات ${randomUUID().slice(0, 8)}`,
      })
    await runtime.resources.save('tasks', actor, {
      orgUnitId: viewer.orgUnitId,
      title: `مهمة المؤشرات ${randomUUID().slice(0, 8)}`,
      done: false,
    })
    await browserContext.loginAs(viewer.user)
    const page = await visit('/')
    await page.getByRole('link', { name: 'لوحات المؤشرات', exact: true }).first().click()
    await page.waitForURL((url) => url.pathname === '/dashboards/orders_overview')
    await page.getByRole('heading', { name: 'لوحة الطلبات', exact: true }).waitFor()
    await page.assertVisible(page.getByText('مؤشرات الطلبات والمهام المتاحة لك'))
    await page.assertVisible(page.getByText('تُحسب الأرقام ضمن نطاق صلاحياتك'))
    const totals = page.getByRole('region', { name: 'المؤشرات الإجمالية' })
    const orders = totals.locator('[data-slot="card"]').filter({ hasText: 'عدد الطلبات' })
    assert.include(await orders.innerText(), '2')
    const amount = totals.locator('[data-slot="card"]').filter({ hasText: 'إجمالي الطلبات' })
    assert.include(await amount.innerText(), '2,000.00 ر.س')
    const grouped = page.getByRole('region', { name: 'المؤشرات حسب الفئة' })
    await page.assertVisible(grouped.getByRole('meter', { name: 'مفتوح: 2', exact: true }))
    await page.assertVisible(grouped.getByRole('meter', { name: 'لا: 1', exact: true }))
    assert.equal(
      await grouped
        .getByRole('meter', { name: 'مفتوح: 2', exact: true })
        .getAttribute('aria-valuenow'),
      '100'
    )
    // Each widget links to its resource list.
    assert.equal(
      await page
        .getByRole('link', { name: 'فتح سجلات عدد الطلبات', exact: true })
        .getAttribute('href'),
      '/resources/orders'
    )
  })
})
