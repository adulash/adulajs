import { test } from '@japa/runner'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import db from '@adonisjs/lucid/services/db'
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

// The server tsconfig omits the DOM lib; these run inside the page through evaluate().
type Scrollable = {
  scrollTop: number
  scrollHeight: number
  scrollWidth: number
  clientWidth: number
}
/**
 * Scrolls whatever scrolls the list (the window, or a scrolling content column) to its end:
 * the table has no scroller of its own (#109). Runs in the page; the server tsconfig has no DOM lib.
 */
const scrollListToEnd = `(() => {
  let element = document.querySelector('[data-slot="table-scroll"]').closest('section').parentElement
  while (element && element !== document.body) {
    const { overflowY } = getComputedStyle(element)
    if ((overflowY === 'auto' || overflowY === 'scroll') && element.scrollHeight > element.clientHeight) {
      element.scrollTop = element.scrollHeight
      return
    }
    element = element.parentElement
  }
  window.scrollTo(0, document.documentElement.scrollHeight)
})()`
/** Elements inside the list section that would scroll vertically on their own. */
const innerScrollers = `[...document.querySelector('[data-slot="table-scroll"]').closest('section').querySelectorAll('*')]
  .filter((element) => ['auto', 'scroll'].includes(getComputedStyle(element).overflowY))
  .filter((element) => element.scrollHeight > element.clientHeight).length`

const knex = () => db.connection().getWriteClient()
async function service(actor: UiActor) {
  const runtime = adula()
  return { runtime, loaded: await runtime.actors.load(actor.user.id) }
}
/** Waits for a dialog's opening animation, so its box is the settled one. */
async function settled(dialog: Locator) {
  await dialog.evaluate(async (element: { getAnimations(): { finished: Promise<unknown> }[] }) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished))
  })
}
/**
 * Loads every page through the «تحميل المزيد» button. The click is dispatched without scrolling:
 * the list scrolls with the page (#109), so scrolling the button into view would itself start
 * the automatic load of the next page and replace the button while Playwright clicks it.
 */
async function loadAll(page: Page) {
  for (let round = 0; round < 8; round++) {
    const more = page.getByRole('button', { name: 'تحميل المزيد', exact: true })
    if (!(await more.isVisible())) break
    await more.dispatchEvent('click')
    await page.getByRole('status').waitFor({ state: 'hidden' })
  }
}

test.group('Generic resource browser acceptance', (group) => {
  let admin: UiActor
  let viewer: UiActor
  let customerName: string
  let orderNumber: string
  let orderNotes: string
  let shots: string
  group.setup(async () => {
    admin = await seedActor([{ subject: 'all', action: 'manage' }], { fullName: 'مدير الواجهة' })
    viewer = await seedActor([{ subject: 'customers', action: 'view' }], {
      level: 0,
      orgUnitId: admin.orgUnitId,
      fullName: 'قارئ العملاء',
    })
    await installSampleResources()
    const { runtime, loaded } = await service(admin)
    customerName = `عميل المتصفح ${randomUUID().slice(0, 8)}`
    await runtime.resources.save('customers', loaded, { name: customerName })
    orderNotes = `طلب متصفح ${randomUUID().slice(0, 8)}`
    const order = await runtime.resources.save('orders', loaded, {
      orgUnitId: admin.orgUnitId,
      notes: orderNotes,
    })
    orderNumber = String(order.number)
    shots = await screenshotDir()
    return () => removeSampleResources()
  })

  test('customers: create, show with deferred activity, edit and delete', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(admin.user)
    const page = await visit('/resources/customers/create')
    await page.getByRole('dialog', { name: 'إضافة · العملاء' }).waitFor()
    const name = `عميل عام ${randomUUID().slice(0, 8)}`
    await page.getByLabel('اسم العميل', { exact: true }).fill(name)
    await page.getByLabel('البريد الإلكتروني', { exact: true }).fill('generic@example.test')
    await page.getByRole('button', { name: 'حفظ السجل', exact: true }).click()
    await openCreatedRecord(page, 'customers')
    await page.getByRole('heading', { name: 'تفاصيل · العملاء' }).waitFor()
    await page.getByRole('dialog', { name: 'تفاصيل · العملاء' }).waitFor()
    await page.assertVisible(page.getByText(name, { exact: true }))
    const activity = page.getByRole('region', { name: 'سجل النشاط' })
    await activity.getByText('إنشاء السجل', { exact: true }).waitFor()
    // History shows who acted by display name; account e-mails stay private.
    await page.assertVisible(activity.getByText('مدير الواجهة'))
    assert.equal(await activity.getByText(admin.user.email).count(), 0)
    const saved = await knex()('customers').where({ name }).first()
    assert.exists(saved)
    await page.getByRole('link', { name: 'تعديل السجل', exact: true }).click()
    await page.waitForURL(/\/edit$/)
    await page.getByRole('dialog', { name: 'تعديل · العملاء' }).waitFor()
    assert.equal(await page.getByLabel('اسم العميل', { exact: true }).inputValue(), name)
    await page.getByLabel('البريد الإلكتروني', { exact: true }).fill('updated@example.test')
    await page.getByRole('button', { name: 'حفظ السجل', exact: true }).click()
    await page.waitForURL(new RegExp(`/resources/customers/${saved.id}$`))
    await page.assertVisible(page.getByText('updated@example.test'))
    await page.getByText('تعديل السجل', { exact: true }).first().waitFor()
    await page.getByRole('button', { name: 'حذف السجل', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'حذف السجل', exact: true })
    await dialog.waitFor()
    await dialog.getByRole('button', { name: 'تأكيد', exact: true }).click()
    await page.waitForURL(/\/resources\/customers$/)
    const deleted = await knex()('customers').where({ id: saved.id }).first()
    assert.isNotNull(deleted.deleted_at)
  })

  test('tasks: belongsTo search, switch, required validation and mobile form', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(admin.user)
    const page = await visit('/resources/tasks/create')
    await page.getByRole('button', { name: 'حفظ السجل', exact: true }).click()
    await page.assertVisible(page.getByText('هذا الحقل مطلوب', { exact: true }))
    const title = `مهمة المتصفح ${randomUUID().slice(0, 8)}`
    await page.getByLabel('المهمة', { exact: true }).fill(title)
    await page.getByRole('combobox', { name: 'الطلب' }).click()
    await page.getByPlaceholder('ابحث في السجلات المرتبطة').fill(orderNotes)
    await page.getByRole('option', { name: orderNumber, exact: true }).click()
    await page.assertVisible(page.getByRole('combobox', { name: 'الطلب' }).getByText(orderNumber))
    await page.getByRole('switch', { name: 'مكتملة' }).click()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: join(shots, 'form-mobile.png'), fullPage: true })
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.getByRole('button', { name: 'حفظ السجل', exact: true }).click()
    await openCreatedRecord(page, 'tasks')
    await page.assertVisible(page.getByText(title, { exact: true }))
    await page.assertVisible(page.getByText(orderNumber, { exact: true }))
    await page.assertVisible(page.getByText('نعم', { exact: true }))
    const task = await knex()('tasks').where({ title }).first()
    assert.equal(task.done, true)
    assert.equal(task.org_unit_id, admin.orgUnitId)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByText('إنشاء السجل', { exact: true }).waitFor()
    await page.screenshot({ path: join(shots, 'show-mobile.png'), fullPage: true })
  })

  test('sample resource: every field control saves, displays, edits inline rows and reports conflicts', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(admin.user)
    const page = await visit('/resources/ui_samples/create')
    const title = `عينة ${randomUUID().slice(0, 8)}`
    await page.getByLabel('العنوان', { exact: true }).fill(title)
    await page.getByLabel('ملاحظات', { exact: true }).fill('ملاحظة\nسطر ثانٍ')
    await page.getByLabel('الكمية', { exact: true }).fill('3')
    await page.getByLabel('المبلغ', { exact: true }).fill('١٢٣٤٫٥')
    await page.getByLabel('المبلغ', { exact: true }).blur()
    assert.equal(await page.getByLabel('المبلغ', { exact: true }).inputValue(), '1234.50')
    await page.getByRole('switch', { name: 'مفعل' }).click()
    await page.getByLabel('اليوم', { exact: true }).fill('2026-09-18')
    await page.getByLabel('الوقت', { exact: true }).fill('2026-09-18T10:30')
    await page.getByLabel('التفاصيل', { exact: true }).fill('{"a":1,"b":[1,2]}')
    await page.getByRole('button', { name: 'تنسيق JSON', exact: true }).click()
    assert.include(await page.getByLabel('التفاصيل', { exact: true }).inputValue(), '"a": 1')
    await page.getByRole('combobox', { name: 'العميل' }).click()
    await page.getByPlaceholder('ابحث في السجلات المرتبطة').fill(customerName)
    await page.getByRole('option', { name: customerName, exact: true }).click()
    await page.getByRole('combobox', { name: 'الحالة', exact: true }).click()
    await page.getByRole('option', { name: 'مفتوح', exact: true }).click()
    // User fields list active members of the chosen unit and search them by name (#28).
    await page.getByRole('combobox', { name: 'المراجع', exact: true }).click()
    await page.getByPlaceholder('ابحث بالاسم').fill('قارئ')
    await page.getByRole('option', { name: 'قارئ العملاء', exact: true }).click()
    await page
      .getByLabel('المرفق', { exact: true })
      .setInputFiles({ name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('مرفق') })
    await page.getByRole('link', { name: 'note.txt', exact: true }).waitFor()
    await page.getByRole('button', { name: 'إضافة بند', exact: true }).click()
    await page.getByLabel('الصنف للبند 1', { exact: true }).fill('صنف أول')
    await page.getByLabel('العدد للبند 1', { exact: true }).fill('2')
    await page.screenshot({ path: join(shots, 'form-desktop.png'), fullPage: true })
    await page.getByRole('heading', { name: 'إضافة عينة', exact: true }).waitFor()
    await page.getByRole('button', { name: 'حفظ السجل', exact: true }).click()
    await page.getByText('تمت إضافة عينة', { exact: true }).waitFor()
    await openCreatedRecord(page, 'ui_samples')
    await page.getByRole('heading', { name: 'تفاصيل · عينات الواجهة' }).waitFor()
    await page.assertVisible(page.getByText('1,234.50'))
    await page.assertVisible(page.getByText('مفتوح', { exact: true }))
    await page.assertVisible(page.getByText(customerName, { exact: true }))
    await page.assertVisible(page.getByText('قارئ العملاء', { exact: true }))
    // Dates render in reading order: no bidi marks and no forced LTR container (issue #19).
    const day = page.locator('dd bdi', { hasText: '18/09/2026' }).first()
    await page.assertVisible(day)
    assert.notMatch((await day.textContent()) ?? '', /[\u200e\u200f]/)
    assert.equal(await day.locator('xpath=ancestor::*[@dir="ltr"]').count(), 0)
    await page.assertVisible(page.locator('pre', { hasText: '"a": 1' }))
    await page.assertVisible(page.getByText('نعم', { exact: true }))
    await page.getByText('صنف أول', { exact: true }).waitFor()
    await page.getByText('إنشاء السجل', { exact: true }).waitFor()
    await page.assertVisible(page.getByRole('link', { name: /note\.txt/ }))
    await page.screenshot({ path: join(shots, 'show-desktop.png'), fullPage: true })
    const stored = await knex()('ui_samples')
      .where({ title })
      .first(
        'id',
        'version',
        'amount',
        'quantity',
        'enabled',
        'instant',
        'details',
        knex().raw("to_char(day, 'YYYY-MM-DD') as day")
      )
    assert.equal(stored.amount, '123450')
    assert.equal(stored.quantity, 3)
    assert.equal(stored.enabled, true)
    assert.equal(stored.day, '2026-09-18')
    // The control turns the naive input into an instant in the browser's zone, not the server's.
    const expectedInstant = await page.evaluate(() => new Date('2026-09-18T10:30').toISOString())
    assert.equal(new Date(stored.instant).toISOString(), expectedInstant)
    assert.deepEqual(stored.details, { a: 1, b: [1, 2] })
    const line = await knex()('ui_sample_lines').where({ sample_id: stored.id }).first()
    assert.equal(line.count, 2)
    await page.getByRole('link', { name: 'تعديل السجل', exact: true }).click()
    await page.waitForURL(/\/edit$/)
    await page.getByLabel('العدد للبند 1', { exact: true }).fill('5')
    await page.getByRole('button', { name: 'إضافة بند', exact: true }).click()
    await page.getByLabel('الصنف للبند 2', { exact: true }).fill('صنف ثانٍ')
    await page.getByLabel('العدد للبند 2', { exact: true }).fill('1')
    await page.getByRole('button', { name: 'حفظ السجل', exact: true }).click()
    await page.waitForURL(new RegExp(`/resources/ui_samples/${stored.id}$`))
    const lines = await knex()('ui_sample_lines').where({ sample_id: stored.id }).orderBy('id')
    assert.lengthOf(lines, 2)
    assert.equal(lines[0].count, 5)
    assert.equal(lines[0].version, 2)
    const updated = await knex()('ui_samples').where({ id: stored.id }).first('version')
    assert.equal(updated.version, 2)
    await page.getByRole('link', { name: 'تعديل السجل', exact: true }).click()
    await page.waitForURL(/\/edit$/)
    const { runtime, loaded } = await service(admin)
    await runtime.resources.save(
      'ui_samples',
      loaded,
      { title: `${title} متزامن`, version: 2 },
      stored.id
    )
    await page.getByLabel('العنوان', { exact: true }).fill(`${title} متأخر`)
    await page.getByRole('button', { name: 'حفظ السجل', exact: true }).click()
    await page.assertVisible(page.getByText('تعارض في الإصدار', { exact: true }))
    await page.assertVisible(page.getByRole('button', { name: 'إعادة التحميل', exact: true }))
    const untouched = await knex()('ui_samples').where({ id: stored.id }).first('title', 'version')
    assert.equal(untouched.title, `${title} متزامن`)
    assert.equal(untouched.version, 3)
  })

  test('modal routes support mobile, keyboard dismissal, direct detail URLs and an explicit page override', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(admin.user)
    const page = await visit('/resources/customers')
    await page.getByRole('link', { name: 'إضافة سجل', exact: true }).click()
    const form = page.getByRole('dialog', { name: 'إضافة · العملاء' })
    await form.waitFor()
    await page.setViewportSize({ width: 390, height: 844 })
    // Measure the settled modal, not its opening animation across a viewport resize.
    await form.evaluate(async (element: { getAnimations(): { finished: Promise<unknown> }[] }) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished))
    })
    await page.screenshot({ path: join(shots, 'dialog-mobile.png'), fullPage: true })
    const bounds = await form.boundingBox()
    assert.exists(bounds)
    assert.isAtLeast(bounds!.x, 12)
    assert.isAtMost(bounds!.x + bounds!.width, 378)
    assert.isAtMost(bounds!.height, 844)
    await page.getByLabel('اسم العميل', { exact: true }).focus()
    for (let index = 0; index < 9; index++) {
      await page.keyboard.press('Tab')
      assert.isTrue(
        await page.evaluate<boolean>(
          'Boolean(document.activeElement?.closest(\'[role="dialog"]\'))'
        )
      )
    }
    await page.screenshot({ path: join(shots, 'dialog-mobile.png'), fullPage: true })
    await page.getByLabel('اسم العميل', { exact: true }).fill('مسودة محفوظة في النموذج')
    await page.keyboard.press('Escape')
    await page.getByRole('dialog', { name: 'إغلاق النموذج؟' }).waitFor()
    await page.getByRole('button', { name: 'متابعة التحرير', exact: true }).click()
    assert.equal(
      await page.getByLabel('اسم العميل', { exact: true }).inputValue(),
      'مسودة محفوظة في النموذج'
    )
    await page.locator('[data-slot="dialog-overlay"]').click({ position: { x: 4, y: 4 } })
    await page.getByRole('button', { name: 'إغلاق دون حفظ', exact: true }).click()
    await page.waitForURL(/\/resources\/customers$/)
    await page.getByRole('heading', { name: 'العملاء', exact: true }).waitFor()
    assert.equal(await page.getByRole('dialog').count(), 0)
    await page
      .getByRole('link', { name: /عرض السجل/ })
      .first()
      .click()
    await page.getByRole('dialog', { name: 'تفاصيل · العملاء' }).waitFor()
    await page.reload()
    await page.getByRole('dialog', { name: 'تفاصيل · العملاء' }).waitFor()
    await page.locator('[data-slot="dialog-overlay"]').click({ position: { x: 4, y: 4 } })
    await page.waitForURL(/\/resources\/customers$/)

    // Change only the presentation prop of a real authorized Inertia response.
    // A project-owned page can pass this prop after the user requests a page.
    // Wide enough to show the page's reading width, which the dialog does not use (#102).
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.route('**/resources/customers/create', async (route) => {
      const response = await route.fetch()
      const body = await response.json()
      body.props.presentation = 'page'
      await route.fulfill({ response, json: body })
    })
    // «إضافة» reads the form as JSON for a dialog over the list; a page presentation there
    // makes it visit the page instead.
    await page.route('**/resources/customers/create/view', async (route) => {
      const response = await route.fetch()
      const body = await response.json()
      body.presentation = 'page'
      await route.fulfill({ response, json: body })
    })
    await page.getByRole('link', { name: 'إضافة سجل', exact: true }).click()
    // The page's own way back: the dialog shell shown on the click has given way to the page.
    await page.getByRole('link', { name: 'العودة إلى القائمة', exact: true }).waitFor()
    await page.getByRole('heading', { name: 'إضافة · العملاء' }).waitFor()
    assert.equal(await page.getByRole('dialog').count(), 0)
    await page.assertVisible(page.getByLabel('اسم العميل', { exact: true }))
    const width = (await page.locator('main form').first().boundingBox())!.width
    assert.isAtMost(width, 896)
    assert.isAbove(width, 880)
    await page.getByRole('link', { name: 'العودة إلى القائمة', exact: true }).click()
    await page.waitForURL(/\/resources\/customers$/)
  })

  test('sample index: search, sort, operator filters, saved views and the server export', async ({
    browserContext,
    visit,
    assert,
  }) => {
    const { runtime, loaded } = await service(admin)
    const stamp = randomUUID().slice(0, 8)
    // Counting unfiltered rows only works when this test owns every sample row.
    await knex()('ui_sample_lines').del()
    await knex()('ui_samples').del()
    const customer = await knex()('customers').where('name', customerName).first('id')
    const statuses: Record<number, string | null> = { 1: 'open', 2: null, 3: 'closed' }
    for (const quantity of [1, 2, 3])
      await runtime.resources.save('ui_samples', loaded, {
        orgUnitId: admin.orgUnitId,
        title: `عينة الفرز ${quantity} ${stamp}`,
        quantity,
        enabled: quantity === 2,
        status: statuses[quantity],
        customerId: quantity === 2 ? customer.id : null,
        reviewer: quantity === 1 ? admin.user.id : null,
      })
    await browserContext.loginAs(admin.user)
    const page = await visit('/resources/ui_samples')
    await page.getByRole('heading', { name: 'عينات الواجهة', exact: true }).waitFor()
    await page.assertVisible(page.getByRole('link', { name: 'إضافة عينة', exact: true }))
    await page.screenshot({ path: join(shots, 'index-desktop.png'), fullPage: true })
    await page.getByLabel('البحث في عينات الواجهة').fill(`عينة الفرز 2 ${stamp}`)
    await page.getByLabel('البحث في عينات الواجهة').press('Enter')
    await page.waitForURL(/search=/)
    await page.assertElementsCount('tbody tr[aria-rowindex]', 1)
    // The sort control is the column header; the toolbar's «تصفية الكمية» is a separate button.
    const sortQuantity = page.locator('thead').getByRole('button', { name: 'الكمية', exact: true })
    await sortQuantity.click()
    await page.waitForURL(/sort=quantity&direction=asc/)
    await page.assertElementsCount('tbody tr[aria-rowindex]', 1)
    await page.goto(
      page
        .url()
        .replace(/[?&]search=[^&]*/, '')
        .replace('ui_samples&', 'ui_samples?')
    )
    await sortQuantity.waitFor()
    assert.equal(await page.locator('th[aria-sort]').getAttribute('aria-sort'), 'ascending')
    // The quantity is the first left-to-right (numeric) value; the selection checkbox comes first.
    // Cells keep the page direction and isolate their value in a `bdi` (#113).
    const firstQuantity = () =>
      page
        .locator('tbody tr[aria-rowindex]')
        .first()
        .locator('td bdi[dir="ltr"]')
        .first()
        .innerText()
    assert.equal(await firstQuantity(), '1')
    await sortQuantity.click()
    await page.waitForURL(/sort=quantity&direction=desc/)
    assert.equal(await firstQuantity(), '3')

    // Filters are popovers over the operators of ADR 046, composed of registry components (#39).
    const panel = page.locator('[data-slot="popover-content"]')
    const openFilter = async (field: string) => {
      await page.getByRole('button', { name: `تصفية ${field}`, exact: true }).click()
      await panel.waitFor()
    }
    const apply = async () => {
      await panel.getByRole('button', { name: 'تطبيق', exact: true }).click()
      await panel.waitFor({ state: 'hidden' })
    }
    const chips = page.getByRole('list', { name: 'التصفية المطبقة' })
    // «أيٌّ من»: several lookup values travel as filters[status][in]=open,closed.
    await openFilter('الحالة')
    await panel.getByRole('option', { name: 'مفتوح', exact: true }).click()
    await panel.getByRole('option', { name: 'مغلق', exact: true }).click()
    await apply()
    await page.waitForURL(/filters%5Bstatus%5D%5Bin%5D=open%2Cclosed/)
    await page.assertElementsCount('tbody tr[aria-rowindex]', 2)
    await page.assertVisible(chips.getByText('مفتوح، مغلق'))
    // Row actions stay pinned at the inline end of wide tables (#31), and only of tables whose
    // columns do not fit, where the pinned column then carries a shadow (#109).
    const actionsPosition = () =>
      page.evaluate<string>(
        'getComputedStyle([...document.querySelectorAll("thead th")].at(-1)).position'
      )
    const viewport = page.viewportSize()!
    const tableScroll = page.locator('[data-slot="table-scroll"]')
    if ((await tableScroll.getAttribute('data-overflowing')) === null)
      assert.equal(await actionsPosition(), 'static')
    await page.setViewportSize({ width: 560, height: viewport.height })
    await page.locator('[data-slot="table-scroll"][data-overflowing]').waitFor()
    assert.equal(await actionsPosition(), 'sticky')
    assert.notEqual(
      await page.evaluate<string>(
        'getComputedStyle([...document.querySelectorAll("thead th")].at(-1)).boxShadow'
      ),
      'none'
    )
    await page.setViewportSize(viewport)
    // Closing a record opened from a filtered list returns to that exact view (#31).
    const listUrl = page.url()
    const view = page.getByRole('link', { name: /عرض السجل/ }).first()
    const record = await view.getAttribute('href')
    await view.click()
    await page.getByRole('dialog', { name: 'تفاصيل · عينات الواجهة' }).waitFor()
    await page.keyboard.press('Escape')
    await page.waitForURL(listUrl)
    await page.assertElementsCount('tbody tr[aria-rowindex]', 2)
    assert.equal(
      await page.evaluate<string>('document.activeElement?.getAttribute("href") ?? ""'),
      record
    )
    // «فارغ» replaces the field's previous operator: only the sample without a status remains.
    await openFilter('الحالة')
    await panel.getByRole('button', { name: 'فارغ', exact: true }).click()
    await apply()
    await page.waitForURL(
      (url) =>
        url.search.includes('filters%5Bstatus%5D%5Bempty%5D=true') &&
        !url.search.includes('%5Bin%5D')
    )
    await page.assertElementsCount('tbody tr[aria-rowindex]', 1)
    assert.equal(await firstQuantity(), '2')
    await openFilter('مفعل')
    await panel.getByRole('button', { name: 'لا', exact: true }).click()
    await apply()
    await page.waitForURL(/filters%5Benabled%5D=false/)
    await page.assertVisible(page.getByText('لا توجد سجلات مطابقة'))
    await page.getByRole('button', { name: 'مسح التصفية' }).click()
    await page.waitForURL((url) => !url.search.includes('filters'))
    await page.assertElementsCount('tbody tr[aria-rowindex]', 3)
    // «من / إلى»: an inclusive integer range.
    await openFilter('الكمية')
    await panel.getByLabel('من', { exact: true }).fill('2')
    await panel.getByLabel('إلى', { exact: true }).fill('3')
    await apply()
    await page.waitForURL(/filters%5Bquantity%5D%5Bgte%5D=2&filters%5Bquantity%5D%5Blte%5D=3/)
    await page.assertElementsCount('tbody tr[aria-rowindex]', 2)
    assert.equal(await firstQuantity(), '3')
    await page.assertVisible(chips.getByText('من 2 إلى 3'))
    await page.getByRole('button', { name: 'إزالة تصفية الكمية', exact: true }).click()
    await page.waitForURL((url) => !url.search.includes('filters'))
    await page.assertElementsCount('tbody tr[aria-rowindex]', 3)
    // Related records are searched on the server and stay labelled by title in the chip.
    await openFilter('العميل')
    await panel.getByPlaceholder('ابحث في السجلات المرتبطة').fill(customerName)
    await panel.getByRole('option', { name: customerName, exact: true }).click()
    await apply()
    await page.waitForURL(new RegExp(`filters%5BcustomerId%5D=${customer.id}`))
    await page.assertElementsCount('tbody tr[aria-rowindex]', 1)
    await page.assertVisible(chips.getByText(customerName))
    await page.getByRole('button', { name: 'إزالة تصفية العميل', exact: true }).click()
    await page.waitForURL((url) => !url.search.includes('filters'))
    await page.assertElementsCount('tbody tr[aria-rowindex]', 3)
    await openFilter('المراجع')
    await panel.getByRole('option', { name: 'مدير الواجهة', exact: true }).click()
    await apply()
    await page.waitForURL(new RegExp(`filters%5Breviewer%5D=${admin.user.id}`))
    await page.assertElementsCount('tbody tr[aria-rowindex]', 1)
    await page.assertVisible(page.locator('tbody').getByText('مدير الواجهة', { exact: true }))
    await page.getByRole('button', { name: 'مسح التصفية' }).click()
    await page.waitForURL((url) => !url.search.includes('filters'))
    await page.assertElementsCount('tbody tr[aria-rowindex]', 3)

    // A saved view stores the operator object and reapplies it.
    await openFilter('الكمية')
    await panel.getByLabel('من', { exact: true }).fill('2')
    await apply()
    await page.waitForURL(/filters%5Bquantity%5D%5Bgte%5D=2/)
    await page.assertElementsCount('tbody tr[aria-rowindex]', 2)
    const viewName = `نطاق الكمية ${stamp}`
    await page.getByRole('button', { name: 'حفظ العرض الحالي', exact: true }).click()
    await page.getByLabel('اسم العرض', { exact: true }).fill(viewName)
    await page.getByRole('button', { name: 'حفظ', exact: true }).click()
    await page.getByRole('button', { name: viewName, exact: true }).waitFor()
    await page.getByRole('button', { name: 'مسح التصفية' }).click()
    await page.waitForURL((url) => !url.search.includes('filters'))
    await page.assertElementsCount('tbody tr[aria-rowindex]', 3)
    await page.getByRole('button', { name: viewName, exact: true }).click()
    await page.waitForURL(/filters%5Bquantity%5D%5Bgte%5D=2/)
    await page.assertElementsCount('tbody tr[aria-rowindex]', 2)
    // Its «×» is the registry's ghost icon button; it keeps its name and deletes the view.
    const remove = page.getByRole('button', { name: `حذف العرض ${viewName}`, exact: true })
    assert.equal(await remove.getAttribute('data-slot'), 'button')
    assert.equal(await remove.getAttribute('data-variant'), 'ghost')
    await remove.click()
    await page.getByRole('button', { name: viewName, exact: true }).waitFor({ state: 'detached' })

    // The server export writes the whole filtered set, beyond the rows loaded into the page.
    const user = admin.user.id
    await knex()('ui_samples').insert(
      Array.from({ length: 101 }, (_, index) => ({
        org_unit_id: admin.orgUnitId,
        created_by: user,
        updated_by: user,
        title: `عينة التصدير ${String(index + 1).padStart(3, '0')} ${stamp}`,
        quantity: 10,
      }))
    )
    await page.goto(
      '/resources/ui_samples?filters%5Bquantity%5D%5Bgte%5D=10&sort=title&direction=asc'
    )
    await page.locator('tbody tr[aria-rowindex]').first().waitFor()
    await page.assertVisible(page.getByRole('button', { name: 'تحميل المزيد', exact: true }))
    assert.isBelow(await page.locator('tbody tr[aria-rowindex]').count(), 101)
    assert.equal(await page.getByText(`عينة التصدير 101 ${stamp}`).count(), 0)
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'تصدير النتائج', exact: true }).click()
    await page.getByRole('menuitem', { name: 'ملف CSV' }).click()
    const file = await download
    assert.match(file.suggestedFilename(), /^عينات الواجهة-\d{4}-\d{2}-\d{2}\.csv$/)
    const chunks: Buffer[] = []
    for await (const chunk of await file.createReadStream()) chunks.push(Buffer.from(chunk))
    const csv = Buffer.concat(chunks).toString('utf8')
    assert.isTrue(
      csv.startsWith('﻿"العنوان","الكمية","المبلغ","مفعل","اليوم","العميل","الحالة","المراجع"\r\n')
    )
    assert.lengthOf(csv.trimEnd().split('\r\n'), 102)
    // The 101st row was never loaded into the page; the filter left out the other samples.
    assert.include(csv, `"عينة التصدير 101 ${stamp}","10"`)
    assert.notInclude(csv, 'عينة الفرز')
    await knex()('ui_samples').where('title', 'like', 'عينة التصدير %').del()
  })

  test('records open over the mounted list; editing switches the same dialog to the details', async ({
    browserContext,
    visit,
    assert,
  }) => {
    const { runtime, loaded } = await service(admin)
    const stamp = randomUUID().slice(0, 8)
    for (const quantity of [1, 2, 3])
      await runtime.resources.save('ui_samples', loaded, {
        orgUnitId: admin.orgUnitId,
        title: `عينة النافذة ${quantity} ${stamp}`,
        quantity,
      })
    await browserContext.loginAs(admin.user)
    const page = await visit(`/resources/ui_samples?search=${stamp}&sort=quantity&direction=asc`)
    await page.assertElementsCount('tbody tr[aria-rowindex]', 3)
    const listUrl = page.url()
    const recordRequests: string[] = []
    const bulkRequests: string[] = []
    page.on('request', (request) => {
      const pathname = new URL(request.url()).pathname
      // The record itself; its collaboration and assignment panels load separately.
      if (/^\/resources\/ui_samples\/\d+(\/view)?$/.test(pathname)) recordRequests.push(pathname)
      if (pathname === '/resources/ui_samples/bulk') bulkRequests.push(pathname)
    })
    // The list under the dialog is the same mounted page: same nodes, no page transition (#100).
    await page.evaluate(
      'window.__wrapper = document.querySelector("main > div"); window.__table = document.querySelector("main table"); window.__pageEnters = 0; document.addEventListener("animationstart", (event) => { if (event.animationName === "adula-page-enter") window.__pageEnters++ }, true)'
    )
    const sameList = () =>
      page.evaluate<boolean>(
        'window.__wrapper === document.querySelector("main > div") && window.__table === document.querySelector("main table") && window.__pageEnters === 0'
      )
    const view = page.getByRole('link', { name: /عرض السجل/ }).first()
    const record = (await view.getAttribute('href'))!
    await view.click()
    const dialog = page.getByRole('dialog', { name: 'تفاصيل · عينات الواجهة' })
    await dialog.waitFor()
    await page.waitForURL((url) => url.pathname === record)
    // The list stays mounted under the dialog, and one request reads the record (#31).
    await page.assertElementsCount('tbody tr[aria-rowindex]', 3)
    assert.deepEqual(recordRequests, [`${record}/view`])
    assert.isTrue(await sameList())
    await dialog.getByRole('button', { name: 'تعديل السجل', exact: true }).click()
    const form = page.getByRole('dialog', { name: 'تعديل عينة' })
    await form.waitFor()
    await page.waitForURL((url) => url.pathname === `${record}/edit`)
    assert.isTrue(await sameList())
    await form.getByLabel('العنوان', { exact: true }).fill(`عينة معدلة ${stamp}`)
    await form.getByRole('button', { name: 'حفظ السجل', exact: true }).click()
    // Saving shows the details in the same dialog instead of closing and reopening it.
    await dialog.getByText(`عينة معدلة ${stamp}`, { exact: true }).waitFor()
    await page.waitForURL((url) => url.pathname === record)
    await page.assertElementsCount('tbody tr[aria-rowindex]', 3)
    await page.keyboard.press('Escape')
    await page.waitForURL(listUrl)
    await dialog.waitFor({ state: 'hidden' })
    // The list returns with its query and shows the saved change.
    await page.locator('tbody').getByText(`عينة معدلة ${stamp}`, { exact: true }).waitFor()
    await page.assertElementsCount('tbody tr[aria-rowindex]', 3)
    // The rows refreshed in place: the list was not rebuilt and did not fetch its actions again (#105).
    assert.isTrue(await sameList())
    assert.deepEqual(bulkRequests, [])
    // Closing replaced the record's history entry: Back stays on the list (#31).
    await page.goBack()
    await page.waitForURL(listUrl)
    await page.waitForTimeout(300)
    assert.equal(await page.getByRole('dialog').count(), 0)
    // Normal navigation still replaces the page and plays its transition.
    await page.locator('aside').getByRole('link', { name: 'نظرة عامة' }).click()
    await page.waitForURL((url) => url.pathname === '/')
    assert.isFalse(
      await page.evaluate<boolean>('window.__wrapper === document.querySelector("main > div")')
    )
    // A direct link still opens the standalone record; its deferred sections share one request.
    // The shell's «مهامي» count is deferred on every page and loads in its own request (#156).
    const partials: string[] = []
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === record)
        partials.push(request.headers()['x-inertia-partial-data'] ?? 'page')
    })
    recordRequests.length = 0
    await page.goto(record)
    await page.getByRole('dialog', { name: 'تفاصيل · عينات الواجهة' }).waitFor()
    await page.getByRole('region', { name: 'سجل النشاط' }).waitFor()
    await page.waitForLoadState('networkidle')
    assert.sameMembers(partials, ['page', 'childrenData,activity', 'openTasks'])
    assert.deepEqual(recordRequests, [record, record, record])
  })

  test('a record dialog moves nothing in the frame: the document itself never scrolls on a large screen', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(admin.user)
    const page = await visit('/resources/ui_samples')
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.locator('#workspace-sidebar').waitFor()
    // The page scrolls in its own region (owner decision 20), so the scroll lock a dialog
    // applies finds no document scroll bar to compensate and shifts neither part (#101).
    assert.isAtMost(
      await page.evaluate<number>('document.documentElement.scrollHeight - window.innerHeight'),
      0
    )
    const boxes = () =>
      page.evaluate<number[]>(
        '["[data-shell-header]", "#workspace-sidebar", "[data-page-scroll]"].flatMap((selector) => { const box = document.querySelector(selector).getBoundingClientRect(); return [box.left, box.right] })'
      )
    const before = await boxes()
    await page
      .getByRole('link', { name: /عرض السجل/ })
      .first()
      .click()
    await page.getByRole('dialog', { name: 'تفاصيل · عينات الواجهة' }).waitFor()
    assert.deepEqual(await boxes(), before)
    await page.keyboard.press('Escape')
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    assert.deepEqual(await boxes(), before)
  })

  test('record dialogs keep their top edge while late sections load, and forms fill the dialog', async ({
    browserContext,
    visit,
    assert,
  }) => {
    const { runtime, loaded } = await service(admin)
    const stamp = randomUUID().slice(0, 8)
    const saved = await runtime.resources.save('ui_samples', loaded, {
      orgUnitId: admin.orgUnitId,
      title: `عينة الموضع ${stamp}`,
    })
    await browserContext.loginAs(admin.user)
    const page = await visit(`/resources/ui_samples?search=${stamp}`)
    await page.setViewportSize({ width: 1440, height: 1400 })
    // The collaboration and assignment sections arrive after the dialog has settled.
    await page.route(
      /\/resources\/ui_samples\/\d+\/(collaboration|assignments)$/,
      async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 600))
        await route.continue()
      }
    )
    await page.getByRole('link', { name: `عرض السجل ${saved.id}`, exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'تفاصيل · عينات الواجهة' })
    await dialog.waitFor()
    await settled(dialog)
    // The record body is the dialog's only scroller; its content height shows the late sections.
    const content = () =>
      page.evaluate<number>(
        'document.querySelector("[data-slot=dialog-content] [data-slot=long-dialog-body]").scrollHeight'
      )
    const first = (await dialog.boundingBox())!
    const before = await content()
    await page
      .getByRole('region', { name: 'التعاون حول السجل' })
      .getByRole('button', { name: 'متابعة السجل' })
      .waitFor()
    await page
      .getByRole('region', { name: 'المهام المسندة' })
      .getByRole('button', { name: 'إسناد مهمة' })
      .waitFor()
    const last = (await dialog.boundingBox())!
    // The sections did grow the record. The dialog may already open at its height cap (90dvh),
    // so its box need not grow; it never shrinks and its top edge never moves (#103).
    assert.isAbove((await content()) - before, 20)
    assert.isAtLeast(last.height, first.height)
    assert.isAtMost(Math.abs(last.y - first.y), 1)

    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
    await page.getByRole('link', { name: `تعديل السجل ${saved.id}`, exact: true }).click()
    const editor = page.getByRole('dialog', { name: 'تعديل عينة' })
    await editor.waitFor()
    // Measure after the opening zoom: during it the dialog is scaled below its final width.
    await settled(editor)
    // The form meets the dialog body's padding on both sides: no page reading cap (#102).
    // Measured inside the scroll area: the body keeps a stable gutter for its visible scrollbar.
    const gaps = await page.evaluate<[number, number]>(`(() => {
      const form = document.querySelector('[data-slot=dialog-content] form')
      const body = form.closest('[data-slot=long-dialog-body]')
      const style = getComputedStyle(body)
      const outer = body.getBoundingClientRect()
      const left = outer.left + body.clientLeft
      const right = left + body.clientWidth
      const inner = form.getBoundingClientRect()
      return [inner.left - (left + parseFloat(style.paddingLeft)), right - parseFloat(style.paddingRight) - inner.right]
    })()`)
    assert.isAtMost(Math.abs(gaps[0]), 1)
    assert.isAtMost(Math.abs(gaps[1]), 1)
  })

  test('an untouched edit dialog closes without asking; a change asks until it is reverted', async ({
    browserContext,
    visit,
    assert,
  }) => {
    const { runtime, loaded } = await service(admin)
    const stamp = randomUUID().slice(0, 8)
    const title = `عينة المسودة ${stamp}`
    const saved = await runtime.resources.save('ui_samples', loaded, {
      orgUnitId: admin.orgUnitId,
      title,
    })
    await browserContext.loginAs(admin.user)
    const page = await visit(`/resources/ui_samples?search=${stamp}`)
    const listUrl = page.url()
    const edit = page.getByRole('link', { name: `تعديل السجل ${saved.id}`, exact: true })
    const dialog = page.getByRole('dialog', { name: 'تعديل عينة' })
    const confirm = page.getByRole('dialog', { name: 'إغلاق النموذج؟' })
    const closesWithoutAsking = async () => {
      await page.keyboard.press('Escape')
      await page.waitForURL(listUrl)
      await dialog.waitFor({ state: 'hidden' })
      assert.equal(await confirm.count(), 0)
    }

    await edit.click()
    await dialog.waitFor()
    await closesWithoutAsking()

    await edit.click()
    await dialog.waitFor()
    const field = dialog.getByLabel('العنوان', { exact: true })
    await field.fill(`${title} معدل`)
    await page.keyboard.press('Escape')
    await confirm.waitFor()
    await page.getByRole('button', { name: 'متابعة التحرير', exact: true }).click()
    await confirm.waitFor({ state: 'hidden' })
    // Reverting the change makes the form clean again.
    await field.fill(title)
    await closesWithoutAsking()

    // A change through a list control, not a text input, asks as well.
    await edit.click()
    await dialog.waitFor()
    await dialog.getByRole('combobox', { name: 'الحالة', exact: true }).click()
    await page.getByRole('option', { name: 'مفتوح', exact: true }).click()
    // Escape goes to the dialog only once the option list has closed.
    await page.getByRole('listbox').waitFor({ state: 'hidden' })
    await page.keyboard.press('Escape')
    await confirm.waitFor()
    await page.getByRole('button', { name: 'إغلاق دون حفظ', exact: true }).click()
    await page.waitForURL(listUrl)
    const stored = await knex()('ui_samples').where({ id: saved.id }).first('title', 'status')
    assert.equal(stored.title, title)
    assert.isNull(stored.status)
  })

  test('a refused save keeps the dialog header in view and focuses the first invalid field', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(admin.user)
    const page = await visit('/resources/ui_samples')
    await page.setViewportSize({ width: 1280, height: 700 })
    await page.getByRole('link', { name: 'إضافة عينة', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'إضافة عينة' })
    await dialog.waitFor()
    const state = () =>
      page.evaluate<{
        contentTop: number
        title: boolean
        inside: boolean
        active: string
      }>(`(() => {
        const content = document.querySelector('[data-slot=dialog-content]')
        const body = content.querySelector('form').closest('[data-slot=long-dialog-body]')
        const heading = content.querySelector('[data-slot=dialog-title]').getBoundingClientRect()
        const active = document.activeElement
        const frame = body.getBoundingClientRect()
        const box = active.getBoundingClientRect()
        return {
          contentTop: content.scrollTop,
          title: heading.top >= content.getBoundingClientRect().top,
          inside: box.top >= frame.top && box.bottom <= frame.bottom,
          active: (active.id || active.tagName) + ':' + active.getAttribute('aria-invalid'),
        }
      })()`)
    // The body scrolls on its own: start at its end, far from the first field.
    await page.evaluate(
      'const body = document.querySelector("[data-slot=dialog-content] form").closest("[data-slot=long-dialog-body]"); body.scrollTop = body.scrollHeight'
    )
    await dialog.getByRole('button', { name: 'حفظ السجل', exact: true }).click()
    await page.assertVisible(dialog.getByText('تعذر الحفظ', { exact: true }))
    assert.deepEqual(await state(), {
      contentTop: 0,
      title: true,
      inside: true,
      active: 'title:true',
    })

    // A refusal from the server moves focus the same way.
    await page.route('**/resources/ui_samples', async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      await route.fulfill({
        status: 422,
        json: { errors: [{ field: 'quantity', message: 'قيمة غير مقبولة' }] },
      })
    })
    await dialog
      .getByLabel('العنوان', { exact: true })
      .fill(`عينة مرفوضة ${randomUUID().slice(0, 8)}`)
    await dialog.getByRole('button', { name: 'حفظ السجل', exact: true }).click()
    await page.assertVisible(dialog.getByText('قيمة غير مقبولة'))
    assert.deepEqual(await state(), {
      contentTop: 0,
      title: true,
      inside: true,
      active: 'quantity:true',
    })
  })

  test('closing a record returns only to pages of this application', async ({
    browserContext,
    visit,
    assert,
  }) => {
    const { runtime, loaded } = await service(admin)
    const one = await runtime.resources.save('ui_samples', loaded, {
      orgUnitId: admin.orgUnitId,
      title: `عينة العودة ${randomUUID().slice(0, 8)}`,
    })
    const other = await runtime.resources.save('ui_samples', loaded, {
      orgUnitId: admin.orgUnitId,
      title: `عينة أخرى ${randomUUID().slice(0, 8)}`,
    })
    const record = `/resources/ui_samples/${one.id}`
    await browserContext.loginAs(admin.user)
    const page = await visit('/resources/ui_samples')
    const origin = new URL(page.url()).origin
    const foreign: string[] = []
    page.on('request', (request) => {
      if (new URL(request.url()).origin !== origin) foreign.push(request.url())
    })
    await page.route(/evil\.example/, (route) => route.abort())
    const closeWith = async (entry: { href: string; record: string }) => {
      const value = JSON.stringify({ ...entry, scroll: 0 })
      await page.evaluate(`sessionStorage.setItem('adula:list-return', ${JSON.stringify(value)})`)
      await page.goto(record)
      await page.getByRole('dialog', { name: 'تفاصيل · عينات الواجهة' }).waitFor()
      await page.keyboard.press('Escape')
      await page.getByRole('dialog').waitFor({ state: 'detached' })
      // The return visit starts after the closing animation, which can outlast the dialog node.
      await page.waitForURL((url) => url.pathname !== record)
      await page.waitForLoadState('networkidle')
      const url = new URL(page.url())
      return { origin: url.origin, path: url.pathname + url.search }
    }
    for (const href of [
      '//evil.example/resources/ui_samples',
      'https://evil.example/resources/ui_samples',
      '/\\evil.example/resources/ui_samples',
      '/.//evil.example/resources/ui_samples',
      '/resources/..//evil.example/resources/ui_samples',
      'javascript:alert(1)',
    ])
      assert.deepEqual(await closeWith({ href, record }), {
        origin,
        path: '/resources/ui_samples',
      })
    assert.deepEqual(foreign, [])
    // A page of this application that remembered itself for this record is returned to (#119).
    assert.deepEqual(await closeWith({ href: '/my-tasks?tab=assigned', record }), {
      origin,
      path: '/my-tasks?tab=assigned',
    })
    // An entry left for another record is ignored.
    assert.deepEqual(
      await closeWith({
        href: '/my-tasks?tab=assigned',
        record: `/resources/ui_samples/${other.id}`,
      }),
      { origin, path: '/resources/ui_samples' }
    )
    // The list view itself is still returned to, with its query.
    assert.deepEqual(await closeWith({ href: '/resources/ui_samples?search=x', record: '' }), {
      origin,
      path: '/resources/ui_samples?search=x',
    })
  })

  test('250 tasks load through the scroll prop and render virtualized rows; mobile keeps no page overflow', async ({
    browserContext,
    visit,
    assert,
  }) => {
    const stamp = randomUUID().slice(0, 8)
    await knex()('tasks').insert(
      Array.from({ length: 250 }, (_, index) => ({
        title: `مهمة افتراضية ${index + 1} ${stamp}`,
        done: false,
        org_unit_id: admin.orgUnitId,
        created_by: admin.user.id,
        updated_by: admin.user.id,
      }))
    )
    await browserContext.loginAs(admin.user)
    const page = await visit('/resources/tasks')
    await page.getByRole('heading', { name: 'المهام', exact: true }).waitFor()
    // A resource's own create wording replaces the generic «إضافة سجل» (#37).
    await page.assertVisible(page.getByRole('link', { name: 'مهمة جديدة', exact: true }))
    await page.assertElementsCount('tbody tr[aria-rowindex]', 25)
    await loadAll(page)
    await page.getByText('نهاية السجلات', { exact: true }).waitFor()
    const shown = await page.getByText(/^المعروض: \d+$/).innerText()
    assert.isAtLeast(Number.parseInt(shown.replace(/\D+/g, ''), 10), 250)
    // Every page is loaded, so the count is exact and its noun agrees with the number (#110).
    await page.assertVisible(page.getByText(/^ضمن نطاقك: \d+ (سجلًا|سجلات|سجل)$/))
    const rendered = await page.locator('tbody tr[aria-rowindex]').count()
    assert.isBelow(rendered, 80)
    await page.assertVisible(page.getByText(`مهمة افتراضية 1 ${stamp}`, { exact: true }))
    // The rows scroll with the page; the virtualizer follows the page scroller (#109).
    assert.equal(await page.evaluate<number>(innerScrollers), 0)
    await page.evaluate(scrollListToEnd)
    await page.getByText(`مهمة افتراضية 250 ${stamp}`, { exact: true }).waitFor()
    assert.isBelow(await page.locator('tbody tr[aria-rowindex]').count(), 80)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.assertVisible(page.getByRole('navigation', { name: 'التنقل على الجوال' }))
    assert.isAtMost(await page.evaluate<number>('document.documentElement.scrollWidth'), 390)
    // Columns that do not fit scroll sideways inside the table, with the actions column pinned.
    const scroller = page.locator('[data-slot="table-scroll"]')
    const fits = await scroller.evaluate(
      (element: Scrollable) => element.scrollWidth <= element.clientWidth
    )
    if (!fits) {
      assert.equal(await scroller.getAttribute('data-overflowing'), '')
      assert.include((await page.locator('thead th').last().getAttribute('class')) ?? '', 'sticky')
    }
    await page.screenshot({ path: join(shots, 'index-mobile.png'), fullPage: false })
  })

  test('at 1024 px a list and its trash fit without a fixed width or a nested scroller (#109)', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(admin.user)
    for (const path of ['/resources/tasks', '/resources/tasks/trash']) {
      const page = await visit(path)
      await page.setViewportSize({ width: 1024, height: 768 })
      await page.reload()
      const scroller = page.locator('[data-slot="table-scroll"]')
      await scroller.waitFor()
      // No horizontal scroll unless the content needs it, and then never the page's.
      assert.isTrue(
        await scroller.evaluate(
          (element: Scrollable) => element.scrollWidth <= element.clientWidth
        ),
        path
      )
      assert.isNull(await scroller.getAttribute('data-overflowing'), path)
      assert.isAtMost(await page.evaluate<number>('document.documentElement.scrollWidth'), 1024)
      // One vertical scroll bar: nothing inside the list scrolls on its own.
      assert.equal(await page.evaluate<number>(innerScrollers), 0, path)
      // Without overflow the actions column is an ordinary cell, so it covers no header.
      assert.notInclude(
        (await page.locator('thead th').last().getAttribute('class')) ?? '',
        'sticky',
        path
      )
    }
  })

  test('a create link with defaults opens the form already filled (#48)', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(admin.user)
    const title = `عينة من رابط ${randomUUID().slice(0, 8)}`
    const page = await visit(
      `/resources/ui_samples/create?defaults[title]=${encodeURIComponent(title)}&defaults[quantity]=7`
    )
    const input = page.getByLabel('العنوان', { exact: true })
    await input.waitFor()
    assert.equal(await input.inputValue(), title)
    assert.equal(await page.getByLabel('الكمية', { exact: true }).inputValue(), '7')
  })

  test('a viewer without write permissions sees no create, edit or delete controls', async ({
    browserContext,
    visit,
  }) => {
    await browserContext.loginAs(viewer.user)
    const page = await visit('/resources/customers')
    await page.getByRole('heading', { name: 'العملاء', exact: true }).waitFor()
    await page
      .getByRole('link', { name: /عرض السجل/ })
      .first()
      .waitFor()
    await page.assertElementsCount('a[href="/resources/customers/create"]', 0)
    await page.assertElementsCount('a[href$="/edit"]', 0)
    await page.assertElementsCount('button:has-text("حذف السجل")', 0)
    await page
      .getByRole('link', { name: /عرض السجل/ })
      .first()
      .click()
    await page.waitForURL(/\/resources\/customers\/\d+$/)
    await page.getByText('سجل النشاط', { exact: true }).waitFor()
    await page.assertElementsCount('a[href$="/edit"]', 0)
    await page.assertElementsCount('button:has-text("حذف السجل")', 0)
  })
  test('both calendars persist in settings and roundtrip either input through one stored date', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(admin.user)
    const previous = await knex()('settings')
      .where({ key: 'ui.preferences', scope: 'system', scope_id: '0' })
      .first()
    try {
      const page = await visit('/admin/settings')
      await page.getByRole('combobox', { name: 'عرض التاريخ', exact: true }).click()
      await page.getByRole('option', { name: 'الميلادي والهجري معًا', exact: true }).click()
      await page.getByRole('button', { name: 'حفظ تفضيلات الواجهة', exact: true }).click()
      await page.getByText('تم حفظ الإعداد', { exact: true }).waitFor()
      const storedPreferences = await knex()('settings')
        .where({ key: 'ui.preferences', scope: 'system', scope_id: '0' })
        .first()
      assert.equal(storedPreferences.value.calendar, 'both')
      await page.reload()
      await page
        .getByRole('combobox', { name: 'عرض التاريخ' })
        .getByText('الميلادي والهجري معًا')
        .waitFor()
      await page.goto('/resources/ui_samples/create')
      const title = `تاريخ مزدوج ${randomUUID().slice(0, 8)}`
      await page.getByLabel('العنوان', { exact: true }).fill(title)
      const inputCalendar = page.getByRole('group', { name: 'تقويم الإدخال: اليوم', exact: true })
      await inputCalendar.getByRole('button', { name: 'إدخال هجري', exact: true }).click()
      await page.getByLabel('اليوم', { exact: true }).fill('١٤٣٩-٠١-٢٤')
      await page.getByText('(2017-10-14 ميلادي)', { exact: true }).waitFor()
      await inputCalendar.getByRole('button', { name: 'إدخال ميلادي', exact: true }).click()
      assert.equal(await page.getByLabel('اليوم', { exact: true }).inputValue(), '2017-10-14')
      await inputCalendar.getByRole('button', { name: 'إدخال هجري', exact: true }).click()
      await page.getByRole('button', { name: 'التقويم: اليوم', exact: true }).click()
      await page.locator('[data-slot="popover-content"] button[aria-pressed="true"]').waitFor()
      // A calendar popover must not count as clicking outside the editor.
      await page.keyboard.press('Escape')
      assert.equal(await page.getByRole('dialog', { name: 'إغلاق النموذج؟' }).count(), 0)
      await page.getByRole('button', { name: 'حفظ السجل', exact: true }).click()
      await openCreatedRecord(page, 'ui_samples')
      const stored = await knex()('ui_samples').where({ title }).first()
      assert.equal(new Date(stored.day).toISOString().slice(0, 10), '2017-10-14')
      await page
        .locator('dd')
        .filter({ hasText: /2017.*1439/ })
        .waitFor()
      await page.reload()
      await page
        .locator('dd')
        .filter({ hasText: /2017.*1439/ })
        .waitFor()
      await page.getByRole('link', { name: 'تعديل السجل', exact: true }).click()
      assert.equal(await page.getByLabel('اليوم', { exact: true }).inputValue(), '2017-10-14')
      await page.screenshot({ path: join(shots, 'both-calendars.png'), fullPage: true })
    } finally {
      await knex()('settings')
        .where({ key: 'ui.preferences', scope: 'system', scope_id: '0' })
        .delete()
      if (previous)
        await knex()('settings').insert({ ...previous, value: JSON.stringify(previous.value) })
    }
  })
})
