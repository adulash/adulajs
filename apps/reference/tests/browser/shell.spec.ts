import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { adula } from '#services/adula'
import { seedActor, screenshotDir, type UiActor } from '#tests/helpers/ui_fixtures'
import { join } from 'node:path'
import type { Locator, Page } from 'playwright'

const knex = () => db.connection().getWriteClient()

/** Waits until the user's stored preference has the value (the save runs after the click). */
/** The element's box once it stops moving: width transitions animate over ~200 ms. */
async function settledBox(locator: Locator) {
  let previous = await locator.boundingBox()
  for (const started = Date.now(); Date.now() - started < 5_000;) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    const current = await locator.boundingBox()
    if (previous && current && current.x === previous.x && current.width === previous.width)
      return current
    previous = current
  }
  throw new Error('The element kept moving for 5 seconds')
}

/** The computed value of a utility class's property, read from a probe element. */
async function tokenStyle(page: Page, className: string, property: 'backgroundColor' | 'color') {
  return page.evaluate<string>(
    `(() => { const probe = document.createElement('span'); probe.className = '${className}'; document.body.append(probe); const value = getComputedStyle(probe).${property}; probe.remove(); return value })()`
  )
}

/** Computed styles once their color transitions have finished (two equal reads). */
async function settledStyles(page: Page, selector: string, properties: string[]) {
  const read = () =>
    page.evaluate<string[]>(
      `(() => { const style = getComputedStyle(document.querySelector(${JSON.stringify(selector)})); return ${JSON.stringify(properties)}.map((property) => style[property]) })()`
    )
  let previous = await read()
  for (const started = Date.now(); Date.now() - started < 5_000;) {
    await new Promise((resolve) => setTimeout(resolve, 150))
    const current = await read()
    if (current.join() === previous.join()) return current
    previous = current
  }
  throw new Error(`${selector} kept changing for 5 seconds`)
}

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
    // The rail sits at the start (the right in RTL) and is narrow, once its width transition
    // (page transitions are on by default) has finished.
    const box = await settledBox(sidebar)
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

  test('every module group in the collapsed rail shows an icon and its name as a tooltip (#153)', async ({
    browserContext,
    visit,
    assert,
  }) => {
    // The groups the server permits this user, in its order.
    const actor = await adula().actors.load(admin.user.id)
    const navigation = adula().resources.navigation(actor)
    const expected = [
      ...new Map(navigation.map((entry) => [entry.module, entry.moduleLabel ?? entry.module])),
    ]
    assert.isAbove(expected.length, 1)
    await knex()('settings').insert({
      key: 'preference.shell.sidebar',
      scope: 'user',
      scope_id: String(admin.user.id),
      value: JSON.stringify('icons'),
    })
    await browserContext.loginAs(admin.user)
    const page = await visit('/')
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.locator('[data-workspace-shell][data-sidebar="icons"]').waitFor()
    const rail = page.locator('#workspace-sidebar')
    const groups = rail.locator('button[data-module]')
    await groups.first().waitFor()
    // The name appears under the mouse.
    await groups.first().hover()
    await page.getByRole('tooltip', { name: expected[0][1] }).waitFor()
    const shown: (string | null)[] = []
    for (let index = 0; index < (await groups.count()); index++)
      shown.push(await groups.nth(index).getAttribute('data-module'))
    assert.deepEqual(
      shown,
      expected.map(([module]) => module)
    )
    const shapes: (string | null)[] = []
    for (const [module, label] of expected) {
      const button = rail.locator(`button[data-module="${module}"]`)
      // lucide names its shape in the class (lucide-boxes, lucide-layers, ...).
      shapes.push(await button.locator('svg').getAttribute('class'))
      // An icon, not a letter: an svg and no visible text; the name stays accessible.
      assert.equal(await button.locator('svg').count(), 1)
      const text = await button.innerText()
      assert.equal(text.trim(), '')
      assert.equal(await button.getAttribute('aria-label'), label)
      // Keyboard focus shows the name as a tooltip (Radix opens one on focus).
      await button.focus()
      await page.getByRole('tooltip', { name: label }).waitFor()
      // The icon is drawn in a visible color in this theme (light or dark suite).
      const [color, background] = await page.evaluate<[string, string]>(
        `[getComputedStyle(document.querySelector('#workspace-sidebar button[data-module="${module}"] svg')).color, getComputedStyle(document.querySelector('#workspace-sidebar')).backgroundColor]`
      )
      assert.notEqual(color, background)
    }
    // Different modules, different shapes: two groups never share an icon (12 shapes).
    assert.isAtMost(expected.length, 12)
    assert.equal(new Set(shapes).size, expected.length, shapes.join(' | '))
    await page.screenshot({
      path: join(
        await screenshotDir(),
        `shell-rail-icons-${process.env.ADULA_TEST_THEME ?? 'light'}.png`
      ),
    })
    // The group still opens its pages.
    const [firstModule] = expected[0]
    await rail.locator(`button[data-module="${firstModule}"]`).click()
    const menu = page.getByRole('menu')
    await menu.getByRole('menuitem').first().waitFor()
    assert.deepEqual(
      await menu.getByRole('menuitem').allTextContents(),
      navigation.filter((entry) => entry.module === firstModule).map((entry) => entry.label)
    )
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
    // The member's groups include a single page (several pages: the administrator below).
    assert.isTrue(
      modules.some(
        (module) => navigation.filter((item) => item.module === module.module).length === 1
      )
    )
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
      // A heading names a group of pages; over a single page it would repeat its name.
      const headings = await menu.locator('[data-slot="dropdown-menu-label"]').allTextContents()
      assert.deepEqual(headings, pages.length > 1 ? [label] : [])
      // The arrow keys move between the pages.
      await page.keyboard.press('ArrowDown')
      assert.equal(
        await page.evaluate<string | null>('document.activeElement?.getAttribute("href")'),
        pages[pages.length > 1 ? 1 : 0].href
      )
      await page.keyboard.press('Escape')
      await menu.waitFor({ state: 'detached' })
      // Each module entry carries its icon (the collapsed sidebar's shape), then the chevron.
      const svgs = trigger.locator('svg')
      const shapes: string[] = []
      for (let index = 0; index < (await svgs.count()); index++)
        shapes.push((await svgs.nth(index).getAttribute('class')) ?? '')
      assert.lengthOf(shapes, 2)
      assert.notInclude(shapes[0], 'lucide-chevron-down')
      assert.include(shapes[1], 'lucide-chevron-down')
      // Opening a page from the menu navigates and marks the module as current.
      await trigger.click()
      await page.getByRole('menuitem', { name: pages[pages.length - 1].label }).click()
      await page.waitForURL((url) => url.pathname === pages[pages.length - 1].href.split('?')[0])
      assert.equal(await trigger.getAttribute('data-current'), 'true')
      // The current entry is filled like the sidebar's active entry, without an underline.
      await page.mouse.move(700, 800)
      const [border, background, color] = await settledStyles(
        page,
        `[data-top-navigation] [data-module="${module.module}"]`,
        ['borderBottomWidth', 'backgroundColor', 'color']
      )
      assert.equal(border, '0px')
      assert.equal(background, await tokenStyle(page, 'bg-accent', 'backgroundColor'))
      assert.equal(color, await tokenStyle(page, 'text-primary', 'color'))
      // Inside its menu, the current page stands out: semibold and in the primary color.
      await trigger.click()
      const current = page.getByRole('menu').locator('a[aria-current="page"]')
      await current.waitFor()
      const [weight, currentColor] = await page.evaluate<[string, string]>(
        `(() => { const style = getComputedStyle(document.querySelector('[role="menu"] a[aria-current="page"]')); return [style.fontWeight, style.color] })()`
      )
      assert.equal(weight, '600')
      assert.equal(currentColor, await tokenStyle(page, 'text-primary', 'color'))
      await page.keyboard.press('Escape')
      await page.getByRole('menu').waitFor({ state: 'detached' })
    }
    // «مهامي» and the bell stay in the header.
    await page.getByTestId('my-tasks-button').waitFor()
    await page.getByRole('link', { name: /^الإشعارات/ }).waitFor()
    await page.screenshot({ path: join(await screenshotDir(), 'shell-top-layout.png') })

    // A group of several pages keeps its heading over them.
    const all = adula().resources.navigation(await adula().actors.load(admin.user.id))
    const counts = new Map<string, number>()
    for (const entry of all) counts.set(entry.module, (counts.get(entry.module) ?? 0) + 1)
    const several = all.find((entry) => counts.get(entry.module)! > 1)
    assert.exists(several)
    await browserContext.clearCookies()
    await browserContext.loginAs(admin.user)
    const adminPage = await visit('/')
    await adminPage.setViewportSize({ width: 1440, height: 900 })
    const label = several!.moduleLabel ?? several!.module
    await adminPage
      .locator('[data-top-navigation]')
      .getByRole('button', { name: label, exact: true })
      .click()
    const menu = adminPage.getByRole('menu')
    await menu.getByRole('menuitem').first().waitFor()
    assert.deepEqual(await menu.locator('[data-slot="dropdown-menu-label"]').allTextContents(), [
      label,
    ])
    assert.equal(await menu.getByRole('menuitem').count(), counts.get(several!.module))
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

  test('the menu order dialog keeps its header and footer on a phone while its lists scroll', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(admin.user)
    const page = await visit('/')
    await page.setViewportSize({ width: 375, height: 812 })
    await page.getByRole('button', { name: 'قائمة الحساب' }).click()
    await page.getByRole('menuitem', { name: 'ترتيب القائمة…' }).click()
    const dialog = page.getByRole('dialog', { name: 'ترتيب القائمة' })
    await dialog.waitFor()
    // Measure after the opening zoom, when the dialog has its settled box.
    await dialog.evaluate(
      async (element: { getAnimations(): { finished: Promise<unknown> }[] }) => {
        await Promise.all(element.getAnimations().map((animation) => animation.finished))
      }
    )
    const body = dialog.locator('[data-slot="long-dialog-body"]')
    const footer = dialog.locator('[data-slot="long-dialog-footer"]')
    // The administrator's entries do not fit: the body scrolls, the dialog stays on screen.
    const [scrollHeight, clientHeight] = await page.evaluate<[number, number]>(
      `(() => { const body = document.querySelector('[role="dialog"] [data-slot="long-dialog-body"]'); return [body.scrollHeight, body.clientHeight] })()`
    )
    assert.isAbove(scrollHeight, clientHeight)
    const inView = async () => {
      const box = (await footer.boundingBox())!
      assert.isAtLeast(box.y, 0)
      assert.isAtMost(box.y + box.height, 812)
    }
    await inView()
    // Scrolling to the last entry leaves the header and the footer where they were.
    const title = dialog.getByRole('heading', { name: 'ترتيب القائمة' })
    const titleBefore = (await title.boundingBox())!.y
    await body.evaluate('(element) => { element.scrollTop = element.scrollHeight }')
    await inView()
    // Up to 1px: the dialog is centred with a -50% transform, so its boxes sit on sub-pixel
    // positions that the browser rounds differently once the body has scrolled. A header that
    // scrolled away would move by its whole height, far beyond this.
    assert.isAtMost(Math.abs((await title.boundingBox())!.y - titleBefore), 1)
    // The shared footer: reset (ghost, RotateCcw), then cancel (outline), then save.
    const buttons = footer.getByRole('button')
    const names: string[] = []
    const variants: (string | null)[] = []
    for (let index = 0; index < (await buttons.count()); index++) {
      const name = await buttons.nth(index).innerText()
      names.push(name.trim())
      variants.push(await buttons.nth(index).getAttribute('data-variant'))
    }
    assert.deepEqual(names, ['استعادة الترتيب الافتراضي', 'إلغاء', 'حفظ الترتيب'])
    assert.deepEqual(variants, ['ghost', 'outline', 'default'])
    assert.equal(await footer.locator('svg.lucide-rotate-ccw').count(), 1)
    for (let index = 0; index < 3; index++) await page.assertVisible(buttons.nth(index))
    // Saving from the fixed footer still submits the lists' form.
    await dialog
      .getByRole('button', { name: /^تحريك .+ لأسفل$/ })
      .first()
      .click()
    await footer.getByRole('button', { name: 'حفظ الترتيب' }).click()
    await dialog.waitFor({ state: 'detached' })
    const saved = await knex()('settings')
      .where({ key: 'preference.shell.navOrder', scope: 'user', scope_id: String(admin.user.id) })
      .first()
    assert.exists(saved)
  })

  test('the account menu sets «ترتيب القائمة…» apart, and account pages name themselves in the breadcrumb', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(member.user)
    const page = await visit('/account/profile')
    await page.setViewportSize({ width: 1440, height: 900 })
    // The breadcrumb names the account and the page, not the overview.
    const breadcrumb = page.locator('header [data-breadcrumb]')
    await breadcrumb.getByText('الملف الشخصي', { exact: true }).waitFor()
    const text = (value: string) => value.replaceAll(/\s+/g, ' ')
    const trail = text(await breadcrumb.innerText())
    assert.include(trail, 'حسابي / الملف الشخصي')
    assert.notInclude(trail, 'نظرة عامة')
    assert.notInclude(trail, 'مساحة العمل')
    // A separator directly precedes «ترتيب القائمة…», after the theme choices.
    await page.getByRole('button', { name: 'قائمة الحساب' }).click()
    const arrange = page.getByRole('menuitem', { name: 'ترتيب القائمة…' })
    await arrange.waitFor()
    assert.deepEqual(
      await page.evaluate<[string | null, string | null]>(
        `(() => { const items = [...document.querySelectorAll('[role="menu"] [role="menuitem"]')]; const item = items.find((element) => element.textContent.includes('ترتيب القائمة')); const before = item.previousElementSibling; return [before.getAttribute('role'), before.previousElementSibling?.getAttribute('role') ?? null] })()`
      ),
      ['separator', 'group']
    )
    // Other account pages too.
    await page.keyboard.press('Escape')
    await page.goto('/account/sessions')
    await breadcrumb.getByText('الجلسات', { exact: true }).waitFor()
    assert.include(text(await breadcrumb.innerText()), 'حسابي / الجلسات')
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
    // Start from light explicitly: the dark suite (pnpm test:browser:dark) defaults to dark.
    await page.getByRole('button', { name: 'قائمة الحساب' }).click()
    await page.getByRole('menuitemradio', { name: 'فاتح' }).click()
    await page.locator('html:not(.dark)').waitFor({ state: 'attached' })
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
      // Both header icons are named by a tooltip on keyboard focus, and share one shape.
      for (const [testId, name] of [
        ['notifications-button', 'الإشعارات'],
        ['my-tasks-button', 'مهامي'],
      ]) {
        await page.getByTestId(testId).focus()
        await page.getByRole('tooltip', { name }).waitFor()
      }
      const shape = (testId: string) =>
        page.evaluate<string>(
          `(() => { const element = document.querySelector('[data-testid="${testId}"]'); const style = getComputedStyle(element); return [element.getBoundingClientRect().width, style.borderRadius, element.querySelector('svg').getAttribute('stroke-width')].join(' ') })()`
        )
      assert.equal(await shape('notifications-button'), await shape('my-tasks-button'))
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
      // Its active state is the shell's: the accent fill and the primary color.
      await page.mouse.move(700, 800)
      const [active, activeColor] = await settledStyles(page, '[data-testid="my-tasks-button"]', [
        'backgroundColor',
        'color',
      ])
      assert.equal(active, await tokenStyle(page, 'bg-accent', 'backgroundColor'))
      assert.equal(activeColor, await tokenStyle(page, 'text-primary', 'color'))
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
    // The current tab looks like the sidebar's active entry: same background and text color,
    // semibold, and no border or bar at its start (light and dark suites).
    await settingsTabs.locator('a[aria-current="page"]').waitFor()
    const [tab, entry] = await page.evaluate<[Record<string, string>, Record<string, string>]>(`[
      document.querySelector('[data-admin-subtabs] a[aria-current="page"]'),
      document.querySelector('nav[aria-label="التنقل الإداري"] a[aria-current="page"]'),
    ].map((element) => {
      const style = getComputedStyle(element)
      return {
        border: style.borderInlineStartWidth,
        background: style.backgroundColor,
        color: style.color,
        weight: style.fontWeight,
      }
    })`)
    assert.equal(tab.border, '0px')
    assert.equal(tab.background, entry.background)
    assert.equal(tab.color, entry.color)
    assert.equal(tab.weight, '600')
    assert.notEqual(tab.background, 'rgba(0, 0, 0, 0)')

    // Arrange: move «المراقبة والتشغيل» to the top with the keyboard-accessible buttons.
    await page.getByRole('button', { name: 'قائمة الحساب' }).click()
    await page.getByRole('menuitem', { name: 'ترتيب القائمة…' }).click()
    const dialog = page.getByRole('dialog', { name: 'ترتيب القائمة' })
    // The shared dialog footer: reset as a ghost button with its icon, cancel as outline,
    // the action as the primary button (the same rule as the overview's customize dialog).
    const reset = dialog.getByRole('button', { name: 'استعادة الترتيب الافتراضي' })
    assert.equal(await reset.getAttribute('data-variant'), 'ghost')
    assert.equal(await reset.locator('svg.lucide-rotate-ccw').count(), 1)
    assert.equal(
      await dialog.getByRole('button', { name: 'إلغاء' }).getAttribute('data-variant'),
      'outline'
    )
    assert.equal(
      await dialog.getByRole('button', { name: 'حفظ الترتيب' }).getAttribute('data-variant'),
      'default'
    )
    for (let step = 0; step < 2; step++)
      await dialog.getByRole('button', { name: 'تحريك المراقبة والتشغيل لأعلى' }).click()
    await dialog.getByRole('button', { name: 'حفظ الترتيب' }).click()
    await dialog.waitFor({ state: 'detached' })
    // Section entries only (the one-time setup may be listed first while it is pending).
    const first = async () => {
      // allTextContents does not wait: after a reload, let the sidebar render first.
      await sections.getByRole('link', { name: 'الإعدادات' }).waitFor()
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
