import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { adula } from '#services/adula'
import { seedActor, screenshotDir, type UiActor } from '#tests/helpers/ui_fixtures'
import { join } from 'node:path'

const knex = () => db.connection().getWriteClient()

/** Waits until the user's stored preference has the value (the save runs after the click). */
async function stored(userId: number, key: string, value: unknown) {
  const expected = JSON.stringify(value)
  for (let attempt = 0; attempt < 50; attempt++) {
    const row = await knex()('settings')
      .where({ key: `preference.${key}`, scope: 'user', scope_id: String(userId) })
      .first()
    if (JSON.stringify(row?.value ?? null) === expected) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`preference ${key} never became ${expected}`)
}

async function systemLayout(layout: 'sidebar' | 'top' | null, layoutUserChoice = false) {
  await knex()('settings').where({ key: 'ui.preferences', scope: 'system' }).delete()
  if (layout === null) return
  await knex()('settings').insert({
    key: 'ui.preferences',
    scope: 'system',
    scope_id: '0',
    value: JSON.stringify({
      calendar: 'gregory',
      confirmDialogClose: true,
      pageTransitions: false,
      layout,
      layoutUserChoice,
    }),
  })
}

/** The workspace shell (ADR 049): sidebar modes, the top layout, the theme, «مهامي» and admin. */
test.group('Workspace shell in the browser', (group) => {
  let admin: UiActor
  let member: UiActor
  group.setup(async () => {
    admin = await seedActor([{ subject: 'all', action: 'manage' }], { fullName: 'مدير الهيكل' })
    // Customers and orders, but not suppliers: the menus must never show a forbidden module.
    member = await seedActor(
      [
        { subject: 'customers', action: 'view' },
        { subject: 'orders', action: 'view' },
      ],
      { fullName: 'عضو الهيكل', level: 0, orgUnitId: admin.orgUnitId }
    )
  })
  group.each.setup(async () => {
    await knex()('settings').where('scope', 'user').whereLike('key', 'preference.%').delete()
    await systemLayout(null)
    return () => systemLayout(null)
  })

  test('the sidebar collapses to icons, hides and returns, and the choice survives a reload (#153)', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(member.user)
    const page = await visit('/')
    await page.setViewportSize({ width: 1440, height: 900 })
    assert.equal(await page.evaluate<string>('document.documentElement.dir'), 'rtl')
    const sidebar = page.locator('#workspace-sidebar')
    const shell = page.locator('[data-workspace-shell]')
    await sidebar.getByText('عدولة').waitFor()

    // Keyboard only: focus the control and press Enter.
    const collapse = page.getByRole('button', { name: 'طي القائمة الجانبية' })
    assert.equal(await collapse.getAttribute('aria-expanded'), 'true')
    assert.equal(await collapse.getAttribute('aria-controls'), 'workspace-sidebar')
    await collapse.focus()
    await page.keyboard.press('Enter')
    // The page CSP forbids string evaluation inside waitForFunction; wait on locators.
    await page.locator('[data-workspace-shell][data-sidebar="icons"]').waitFor()
    // The rail sits at the start (the right in RTL) and is narrow.
    const box = (await sidebar.boundingBox())!
    assert.isBelow(box.width, 90)
    assert.isAbove(box.x + box.width, 1440 - 2)
    // Icons keep their names: an accessible name and a tooltip.
    const overview = sidebar.getByRole('link', { name: 'نظرة عامة' }).last()
    await overview.hover()
    await page.getByRole('tooltip', { name: 'نظرة عامة' }).waitFor()
    await stored(member.user.id, 'shell.sidebar', 'icons')

    await page.reload()
    // The page CSP forbids string evaluation inside waitForFunction; wait on locators.
    await page.locator('[data-workspace-shell][data-sidebar="icons"]').waitFor()
    assert.equal(await shell.getAttribute('data-sidebar'), 'icons')

    // Hide it: the page uses the whole width; the account menu moves to the header.
    const hide = page.getByRole('button', { name: 'إخفاء القائمة الجانبية' })
    await hide.click()
    await sidebar.waitFor({ state: 'hidden' })
    await page.getByRole('button', { name: 'قائمة الحساب' }).waitFor()
    const main = (await page.locator('main').boundingBox())!
    assert.isAbove(main.width, 1300)
    await stored(member.user.id, 'shell.sidebar', 'hidden')
    await page.reload()
    await sidebar.waitFor({ state: 'hidden' })

    // Show it again: back to the full sidebar.
    await page.getByRole('button', { name: 'إظهار القائمة الجانبية' }).click()
    await sidebar.getByText('عدولة').waitFor()
    assert.equal(await shell.getAttribute('data-sidebar'), 'expanded')
    await stored(member.user.id, 'shell.sidebar', 'expanded')
  })

  test('the top layout opens one menu per permitted module with its pages, by keyboard too (#154)', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await systemLayout('top')
    await browserContext.loginAs(member.user)
    const page = await visit('/')
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.locator('[data-workspace-shell][data-layout="top"]').waitFor()
    assert.equal(await page.locator('#workspace-sidebar').count(), 0)
    const main = page.locator('[data-top-navigation]').getByRole('navigation', {
      name: 'التنقل الرئيسي',
    })
    // Exactly the modules the member may open, by the server's navigation data.
    const navigation = (await adula().resources.navigation(
      await adula().actors.load(member.user.id)
    )) as { href: string; label: string; module: string; moduleLabel?: string }[]
    const modules = [...new Map(navigation.map((entry) => [entry.module, entry])).values()]
    assert.isAbove(modules.length, 1)
    assert.equal(await main.getByRole('button', { name: /الموردون/ }).count(), 0)
    assert.equal(await main.getByRole('button').count(), modules.length)
    for (const module of modules) {
      const label = module.moduleLabel ?? module.module
      const pages = navigation.filter((item) => item.module === module.module)
      // Keyboard: focus the entry, open its menu with Enter, move with the arrow keys.
      const trigger = main.getByRole('button', { name: label })
      await trigger.focus()
      await page.keyboard.press('Enter')
      const menu = page.getByRole('menu')
      await menu.waitFor()
      const items = menu.getByRole('menuitem')
      const hrefs: (string | null)[] = []
      for (let index = 0; index < (await items.count()); index++)
        hrefs.push(await items.nth(index).getAttribute('href'))
      assert.deepEqual(
        hrefs,
        pages.map((item) => item.href)
      )
      // The arrow keys move between the pages.
      await page.keyboard.press('ArrowDown')
      assert.equal(
        await page.evaluate<string | null>('document.activeElement?.getAttribute("href")'),
        pages[pages.length > 1 ? 1 : 0].href
      )
      await page.keyboard.press('Escape')
      await menu.waitFor({ state: 'detached' })
      // Opening a page from the menu navigates and marks the module as current.
      await trigger.click()
      await page.getByRole('menuitem', { name: pages[pages.length - 1].label }).click()
      await page.waitForURL((url) => url.pathname === pages[pages.length - 1].href.split('?')[0])
      assert.equal(await trigger.getAttribute('data-current'), 'true')
    }
    // «مهامي» and the bell stay in the header.
    await page.getByTestId('my-tasks-button').waitFor()
    await page.getByRole('link', { name: /^الإشعارات/ }).waitFor()
    await page.screenshot({ path: join(await screenshotDir(), 'shell-top-layout.png') })
  })

  test('a user may choose their own layout only when the system allows it (#154)', async ({
    browserContext,
    visit,
  }) => {
    await systemLayout('sidebar', true)
    await browserContext.loginAs(member.user)
    const page = await visit('/')
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByRole('button', { name: 'قائمة الحساب' }).click()
    await page.getByRole('menuitemradio', { name: 'قائمة علوية' }).click()
    await page.locator('[data-workspace-shell][data-layout="top"]').waitFor()
    await stored(member.user.id, 'shell.layout', 'top')
    await page.reload()
    await page.locator('[data-workspace-shell][data-layout="top"]').waitFor()

    // Without the system's permission the stored choice is ignored.
    await systemLayout('sidebar', false)
    await page.reload()
    await page.locator('[data-workspace-shell][data-layout="sidebar"]').waitFor()
    await page.getByRole('button', { name: 'قائمة الحساب' }).click()
    await page.getByRole('menuitemradio', { name: 'فاتح' }).waitFor()
    await page.getByRole('menuitemradio', { name: 'قائمة علوية' }).waitFor({ state: 'detached' })
  })

  test('the theme switches from the account menu, before the first paint and by the device (#155)', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(member.user)
    const page = await visit('/')
    await page.setViewportSize({ width: 1440, height: 900 })
    const dark = () => page.evaluate<boolean>('document.documentElement.classList.contains("dark")')
    const background = () =>
      page.evaluate<string>('getComputedStyle(document.body.querySelector("main")).color')
    const lightText = await background()
    await page.getByRole('button', { name: 'قائمة الحساب' }).click()
    await page.getByRole('menuitemradio', { name: 'داكن' }).click()
    await page.locator('html.dark').waitFor({ state: 'attached' })
    assert.notEqual(await background(), lightText)
    await stored(member.user.id, 'shell.theme', 'dark')

    // Rendered by the server: dark from the first byte, no flash.
    const response = await page.request.get(page.url(), { headers: { Accept: 'text/html' } })
    assert.match(await response.text(), /<html[^>]*class="dark"[^>]*data-theme="dark"/)
    await page.reload()
    assert.isTrue(await dark())
    await page.screenshot({ path: join(await screenshotDir(), 'shell-dark.png') })

    // «حسب الجهاز» follows the device setting, and its changes.
    await page.emulateMedia({ colorScheme: 'light' })
    await page.getByRole('button', { name: 'قائمة الحساب' }).click()
    await page.getByRole('menuitemradio', { name: 'حسب الجهاز' }).click()
    await page.locator('html:not(.dark)').waitFor({ state: 'attached' })
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.locator('html.dark').waitFor({ state: 'attached' })
    await stored(member.user.id, 'shell.theme', 'system')
    await page.reload()
    assert.isTrue(await dark())
    assert.equal(await page.evaluate<string>('document.documentElement.dataset.theme'), 'system')
  })

  test('«مهامي» sits beside the bell with the count the list shows, and not in the sidebar (#156)', async ({
    browserContext,
    visit,
    assert,
  }) => {
    const runtime = adula()
    const actor = await runtime.actors.load(admin.user.id)
    const customer = await runtime.resources.save('customers', actor, { name: 'عميل المهام' })
    for (const title of ['مراجعة العقد', 'الاتصال بالعميل'])
      await runtime.assignments.assign('customers', Number(customer.id), actor, {
        assigneeId: member.user.id,
        title,
      })
    try {
      await browserContext.loginAs(member.user)
      const page = await visit('/')
      await page.setViewportSize({ width: 1440, height: 900 })
      const tasks = page.getByTestId('my-tasks-button')
      assert.equal(await page.getByTestId('open-tasks-count').textContent(), '2')
      assert.equal(await tasks.getAttribute('aria-label'), 'مهامي، 2 مفتوحة')
      // Next to the bell, in the header.
      const header = page.locator('header')
      await header.getByTestId('my-tasks-button').waitFor()
      await header.getByRole('link', { name: /^الإشعارات/ }).waitFor()
      assert.equal(
        await page.locator('#workspace-sidebar').getByRole('link', { name: /مهامي/ }).count(),
        0
      )
      await tasks.click()
      await page.waitForURL((url) => url.pathname === '/my-tasks')
      await page.getByRole('heading', { name: 'مهامي' }).waitFor()
      await page.getByText('مراجعة العقد').waitFor()
      await page.getByText('الاتصال بالعميل').waitFor()
      assert.equal(await tasks.getAttribute('aria-current'), 'page')
    } finally {
      await knex()('assignments').where('assignee_id', member.user.id).delete()
      await knex()('customers').where('id', Number(customer.id)).delete()
    }
  })

  test('administration shows one entry per section, its pages as sub-tabs, and a resettable order (#157)', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(admin.user)
    const page = await visit('/admin/users')
    await page.setViewportSize({ width: 1440, height: 900 })
    const sections = page.getByRole('navigation', { name: 'التنقل الإداري' })
    for (const title of ['الأشخاص والصلاحيات', 'الإعدادات', 'المراقبة والتشغيل'])
      await sections.getByRole('link', { name: title }).waitFor()
    // Inner pages are no longer sidebar entries; they are sub-tabs inside the page.
    assert.equal(await sections.getByRole('link', { name: 'الأدوار والصلاحيات' }).count(), 0)
    const tabs = page.getByRole('navigation', { name: 'صفحات القسم: الأشخاص والصلاحيات' })
    assert.equal(
      await tabs.getByRole('link', { name: 'المستخدمون' }).getAttribute('aria-current'),
      'page'
    )
    await tabs.getByRole('link', { name: 'الأدوار والصلاحيات' }).click()
    await page.waitForURL((url) => url.pathname === '/admin/roles')
    await sections.getByRole('link', { name: 'الإعدادات' }).click()
    await page.waitForURL((url) => url.pathname === '/admin/settings')
    const settingsTabs = page.getByRole('navigation', { name: 'صفحات القسم: الإعدادات' })
    await settingsTabs.getByRole('link', { name: 'الإعدادات العامة' }).waitFor()
    // Vertical at the start side (the right in RTL), beside the page.
    const tabsBox = (await settingsTabs.boundingBox())!
    const mainBox = (await page.locator('main').boundingBox())!
    assert.isAbove(tabsBox.x, mainBox.x + mainBox.width / 2)

    // Arrange: move «المراقبة والتشغيل» to the top with the keyboard-accessible buttons.
    await page.getByRole('button', { name: 'قائمة الحساب' }).click()
    await page.getByRole('menuitem', { name: 'ترتيب القائمة…' }).click()
    const dialog = page.getByRole('dialog', { name: 'ترتيب القائمة' })
    for (let step = 0; step < 2; step++)
      await dialog.getByRole('button', { name: 'تحريك المراقبة والتشغيل لأعلى' }).click()
    await dialog.getByRole('button', { name: 'حفظ الترتيب' }).click()
    await dialog.waitFor({ state: 'detached' })
    // Section entries only (the one-time setup may be listed first while it is pending).
    const first = async () => {
      const titles = await sections.getByRole('link').allTextContents()
      return titles.map((title) => title.trim()).find((title) => title !== 'الإعداد الأولي')
    }
    assert.match((await first())!, /^المراقبة والتشغيل/)
    await stored(admin.user.id, 'shell.navOrder', [
      'admin.operations',
      'admin.people',
      'admin.settings',
    ])
    await page.reload()
    assert.match((await first())!, /^المراقبة والتشغيل/)

    // Reset restores the default order.
    await page.getByRole('button', { name: 'قائمة الحساب' }).click()
    await page.getByRole('menuitem', { name: 'ترتيب القائمة…' }).click()
    await dialog.getByRole('button', { name: 'استعادة الترتيب الافتراضي' }).click()
    await dialog.waitFor({ state: 'detached' })
    assert.match((await first())!, /^الأشخاص والصلاحيات/)
    await stored(admin.user.id, 'shell.navOrder', null)

    // A non-administrator never sees the administration, whatever their stored order says.
    await knex()('settings').insert({
      key: 'preference.shell.navOrder',
      scope: 'user',
      scope_id: String(member.user.id),
      value: JSON.stringify(['admin.operations', 'module.suppliers']),
    })
    await browserContext.clearCookies()
    await browserContext.loginAs(member.user)
    const plain = await visit('/')
    await plain.setViewportSize({ width: 1440, height: 900 })
    await plain.getByRole('navigation', { name: 'التنقل الرئيسي' }).waitFor()
    assert.equal(await plain.getByRole('link', { name: /^الإدارة/ }).count(), 0)
    assert.equal(await plain.getByRole('link', { name: 'الموردون' }).count(), 0)
    assert.equal(await plain.getByText('الموردون').count(), 0)
  })
})
