import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import type { Page } from 'playwright'
import { adula } from '#services/adula'
import {
  installSampleResources,
  removeSampleResources,
  seedActor,
  type UiActor,
} from '#tests/helpers/ui_fixtures'

/**
 * Owner decision 29 («اخف الشريط عند فتح النوافذ»): opening, switching or closing a dialog
 * never shows Inertia's top progress bar (#nprogress), however slowly the server answers.
 * Page-to-page navigation keeps it.
 */

const SLOW_MS = 600

/** Delays every request the page makes to the server (views, Inertia visits, reloads). */
async function slowServer(page: Page) {
  await page.route('**/*', async (route) => {
    const type = route.request().resourceType()
    if (type === 'xhr' || type === 'fetch')
      await new Promise((resolve) => setTimeout(resolve, SLOW_MS))
    await route.continue()
  })
}

/**
 * Counts every time the progress bar becomes visible, sampled at each animation frame (what
 * the user can see). Inertia inserts #nprogress at the top level even for a visit without
 * progress and keeps it hidden then: as a closed popover where the browser has popovers,
 * else with display: none. So presence alone is not the bar showing.
 */
async function watchProgress(page: Page) {
  await page.evaluate(`(() => {
    window.__progress = 0
    let shown = false
    const visible = () => {
      const bar = document.getElementById('nprogress')
      if (!bar || !bar.isConnected) return false
      if (bar.hasAttribute('popover')) return bar.matches(':popover-open')
      return getComputedStyle(bar).display !== 'none'
    }
    const frame = () => {
      const now = visible()
      if (now && !shown) window.__progress++
      shown = now
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  })()`)
}

/** How many times the bar appeared since the last reset; resets the count. */
async function progressShown(page: Page) {
  return page.evaluate<number>(`(() => {
    const count = window.__progress
    window.__progress = 0
    return count
  })()`)
}

/** Waits until the slow requests a step started have answered (more than the bar's delay). */
async function settle(page: Page) {
  await page.waitForTimeout(SLOW_MS + 400)
}

test.group('Dialogs never show the progress bar (owner decision 29)', (group) => {
  let admin: UiActor
  group.setup(async () => {
    admin = await seedActor([{ subject: 'all', action: 'manage' }], { fullName: 'مدير الشريط' })
    await installSampleResources()
    const actor = await adula().actors.load(admin.user.id)
    for (let index = 0; index < 3; index++)
      await adula().resources.save('ui_samples', actor, {
        orgUnitId: admin.orgUnitId,
        title: `عينة الشريط ${index}`,
      })
    return () => removeSampleResources()
  })

  test('opening, switching and closing record and create dialogs show no progress bar', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(admin.user)
    const page = await visit('/resources/ui_samples')
    await page.locator('main table tbody tr[data-row-id]').first().waitFor()
    await page.waitForLoadState('networkidle')
    await slowServer(page)
    await watchProgress(page)

    // A record's details: opened, loaded slowly, and closed.
    await page.locator('main table tbody tr[data-row-id] a').first().click()
    const details = page.getByRole('dialog', { name: /^تفاصيل/ })
    await details.waitFor()
    await details.locator('[data-slot="record-loading"]').waitFor({ state: 'detached' })
    await settle(page)
    assert.equal(await progressShown(page), 0, 'opening a record')
    await page.keyboard.press('Escape')
    await details.waitFor({ state: 'hidden' })
    await settle(page)
    assert.equal(await progressShown(page), 0, 'closing a record')

    // Switching to edit, saving (the dialog shows the changed record) and closing, which
    // refreshes the list behind it.
    await page.locator('main table tbody tr[data-row-id] a').first().click()
    await details.waitFor()
    await details.locator('[data-slot="record-loading"]').waitFor({ state: 'detached' })
    await details.getByRole('button', { name: 'تعديل السجل', exact: true }).click()
    const edit = page.getByRole('dialog', { name: /^تعديل/ })
    await edit.waitFor()
    await edit.locator('[data-slot="record-loading"]').waitFor({ state: 'detached' })
    await settle(page)
    assert.equal(await progressShown(page), 0, 'switching to edit')
    await edit.getByLabel('العنوان').fill('عينة الشريط المعدلة')
    await edit.getByRole('button', { name: 'حفظ السجل', exact: true }).click()
    await details.getByText('عينة الشريط المعدلة').first().waitFor()
    await settle(page)
    assert.equal(await progressShown(page), 0, 'saving inside the dialog')
    await page.keyboard.press('Escape')
    await details.waitFor({ state: 'hidden' })
    await page.locator('main table').getByText('عينة الشريط المعدلة').waitFor()
    await settle(page)
    assert.equal(await progressShown(page), 0, 'closing a changed record')

    // The create form: opened, loaded slowly, and closed.
    await page.getByRole('link', { name: 'إضافة عينة' }).click()
    const create = page.getByRole('dialog', { name: 'إضافة عينة' })
    await create.waitFor()
    await create.locator('[data-slot="record-loading"]').waitFor({ state: 'detached' })
    await settle(page)
    assert.equal(await progressShown(page), 0, 'opening the create form')
    await page.keyboard.press('Escape')
    await create.waitFor({ state: 'hidden' })
    await settle(page)
    assert.equal(await progressShown(page), 0, 'closing the create form')

    // The control: a slow page-to-page navigation still shows the bar.
    await page.locator('a[href="/notifications"]').first().click()
    await page.waitForURL('**/notifications')
    await settle(page)
    assert.isAtLeast(await progressShown(page), 1, 'a page navigation keeps the bar')
  }).timeout(90_000)

  test('a record opened over the alerts page shows no progress bar', async ({
    browserContext,
    visit,
    assert,
  }) => {
    const knex = db.connection().getWriteClient()
    const [record] = await knex('ui_samples').select('id').orderBy('id').limit(1)
    await knex('notifications').where({ user_id: admin.user.id }).delete()
    await knex('notifications').insert({
      user_id: admin.user.id,
      title: 'سجل يفتح فوق التنبيهات',
      body: 'نص',
      resource: 'ui_samples',
      record_id: record.id,
    })
    await browserContext.loginAs(admin.user)
    const page = await visit('/notifications')
    await page.getByRole('link', { name: 'سجل يفتح فوق التنبيهات' }).waitFor()
    await page.waitForLoadState('networkidle')
    await slowServer(page)
    await watchProgress(page)

    await page.getByRole('link', { name: 'سجل يفتح فوق التنبيهات' }).click()
    const details = page.getByRole('dialog', { name: /^تفاصيل/ })
    await details.waitFor()
    await details.locator('[data-slot="record-loading"]').waitFor({ state: 'detached' })
    await settle(page)
    assert.equal(await progressShown(page), 0, 'opening over the alerts')
    await page.keyboard.press('Escape')
    await details.waitFor({ state: 'hidden' })
    await settle(page)
    assert.equal(await progressShown(page), 0, 'closing over the alerts')
  }).timeout(60_000)

  test('a record loaded by its own address closes over its list with no progress bar', async ({
    browserContext,
    visit,
    assert,
  }) => {
    const [record] = await db
      .connection()
      .getWriteClient()('ui_samples')
      .select('id')
      .orderBy('id')
      .limit(1)
    await browserContext.loginAs(admin.user)
    const page = await visit(`/resources/ui_samples/${record.id}`)
    const details = page.getByRole('dialog', { name: /^تفاصيل/ })
    await details.waitFor()
    await details.locator('[data-slot="record-loading"]').waitFor({ state: 'detached' })
    await page.waitForLoadState('networkidle')
    await slowServer(page)
    await watchProgress(page)

    await page.keyboard.press('Escape')
    await page.waitForURL((url) => url.pathname === '/resources/ui_samples')
    await page.locator('main table tbody tr[data-row-id]').first().waitFor()
    await settle(page)
    assert.equal(await progressShown(page), 0, 'closing a record opened by its address')
  }).timeout(60_000)

  test('closing a task from «مهامي» shows no progress bar', async ({
    browserContext,
    visit,
    assert,
  }) => {
    const knex = db.connection().getWriteClient()
    const [record] = await knex('ui_samples').select('id').orderBy('id').limit(1)
    const actor = await adula().actors.load(admin.user.id)
    await adula().assignments.assign('ui_samples', record.id, actor, {
      assigneeId: admin.user.id,
      title: 'مهمة الشريط',
    })
    await browserContext.loginAs(admin.user)
    const page = await visit('/my-tasks')
    const task = page.locator('main li').filter({ hasText: 'مهمة الشريط' }).first()
    await task.waitFor()
    await page.waitForLoadState('networkidle')
    await slowServer(page)
    await watchProgress(page)

    const done = task.getByRole('button', { name: 'تم الإنجاز' })
    await done.click()
    const closing = page.getByRole('dialog', { name: 'إنجاز المهمة' })
    await closing.waitFor()
    await page.getByRole('button', { name: 'تراجع', exact: true }).click()
    await closing.waitFor({ state: 'hidden' })
    await settle(page)
    assert.equal(await progressShown(page), 0, 'opening and backing out of the close dialog')

    await done.click()
    await closing.waitFor()
    await closing.getByRole('button', { name: 'تأكيد الإنجاز', exact: true }).click()
    await closing.waitFor({ state: 'hidden' })
    await done.waitFor({ state: 'detached' })
    await settle(page)
    assert.equal(await progressShown(page), 0, 'closing the task refreshes the list behind it')
  }).timeout(60_000)

  test('the invitation page closes with no progress bar', async ({
    browserContext,
    visit,
    assert,
  }) => {
    const inviter = await seedActor([{ subject: 'core.users', action: 'invite' }], {
      fullName: 'داعٍ الشريط',
      orgUnitId: admin.orgUnitId,
    })
    await browserContext.loginAs(inviter.user)
    const page = await visit('/users/invite')
    const invite = page.getByRole('dialog')
    await invite.getByLabel('الاسم الكامل').waitFor()
    await page.waitForLoadState('networkidle')
    await slowServer(page)
    await watchProgress(page)

    await page.keyboard.press('Escape')
    await page.waitForURL((url) => url.pathname === '/')
    await invite.waitFor({ state: 'hidden' })
    await settle(page)
    assert.equal(await progressShown(page), 0, 'closing the invitation')
  }).timeout(60_000)

  test('a record opened from «تدفقات فاشلة» shows no progress bar', async ({
    browserContext,
    visit,
    assert,
  }) => {
    const knex = db.connection().getWriteClient()
    const [record] = await knex('ui_samples').select('id').orderBy('id').limit(1)
    const [failed] = await knex('workflow_runs')
      .insert({
        id: randomUUID(),
        resource: 'ui_samples',
        record_id: record.id,
        definition: 'progress_probe',
        definition_version: 1,
        snapshot: JSON.stringify({ value: 'start' }),
        status: 'failed',
      })
      .returning('id')
    try {
      await browserContext.loginAs(admin.user)
      const page = await visit('/admin/workflows')
      const link = page.locator(`main a[href="/resources/ui_samples/${record.id}"]`).first()
      await link.waitFor()
      await page.waitForLoadState('networkidle')
      await slowServer(page)
      await watchProgress(page)

      await link.click()
      const details = page.getByRole('dialog', { name: /^تفاصيل/ })
      await details.waitFor()
      await details.locator('[data-slot="record-loading"]').waitFor({ state: 'detached' })
      await settle(page)
      assert.equal(await progressShown(page), 0, 'opening over the failed flows')
      await page.keyboard.press('Escape')
      await details.waitFor({ state: 'hidden' })
      await settle(page)
      assert.equal(await progressShown(page), 0, 'closing over the failed flows')
    } finally {
      await knex('workflow_runs').where('id', failed.id).delete()
    }
  }).timeout(60_000)
})
