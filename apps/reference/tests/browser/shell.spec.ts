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

  test('one header spans the window, the sidebar has one trigger above it and a rail, and the page scrolls on its own (owner decision 20, #153)', async ({
    browserContext,
    visit,
    assert,
  }) => {
    const theme = process.env.ADULA_TEST_THEME ?? 'light'
    await browserContext.loginAs(member.user)
    const page = await visit('/')
    await page.setViewportSize({ width: 1440, height: 900 })
    assert.equal(await page.evaluate<string>('document.documentElement.dir'), 'rtl')
    const sidebar = page.locator('#workspace-sidebar')
    const shell = page.locator('[data-workspace-shell]')
    const header = page.locator('[data-shell-header]')
    await sidebar.getByRole('navigation', { name: 'التنقل الرئيسي' }).waitFor()
    const trigger = page.locator('[data-sidebar-trigger]')
    const box = async (locator: typeof sidebar) => (await settledBox(locator))!

    // One header from edge to edge; the sidebar starts at its bottom edge.
    const top = await box(header)
    assert.isAtMost(Math.abs(top.x), 0.5)
    assert.isAtMost(Math.abs(top.x + top.width - 1440), 0.5)
    assert.isAtMost(Math.abs(top.y), 0.5)
    const side = await box(sidebar)
    assert.isAtMost(Math.abs(side.y - (top.y + top.height)), 1)
    // The brand is part of the header, not of the sidebar.
    await page.assertVisible(header.getByRole('link', { name: /أدولا/ }))
    assert.equal(await sidebar.getByText('أدولا').count(), 0)
    // The one trigger sits in the header segment above the sidebar; no other sidebar button.
    const control = await box(trigger)
    assert.isAtLeast(control.x, side.x - 0.5)
    assert.isAtMost(control.x + control.width, side.x + side.width + 0.5)
    assert.isBelow(control.y + control.height, top.y + top.height)
    assert.equal(await page.locator('svg.lucide-maximize-2').count(), 0)
    assert.equal(await page.getByRole('button', { name: 'إخفاء القائمة الجانبية' }).count(), 0)
    assert.equal(await trigger.getAttribute('aria-label'), 'طي القائمة الجانبية')
    assert.equal(await trigger.getAttribute('aria-expanded'), 'true')
    assert.equal(await trigger.getAttribute('aria-controls'), 'workspace-sidebar')
    await trigger.hover()
    await page.getByRole('tooltip', { name: 'طي القائمة الجانبية' }).waitFor()

    // The page's own scroll container: the document does not scroll, the page region does, in
    // the right-to-left direction, so Chromium draws its scroll bar at the left edge.
    await page.setViewportSize({ width: 1440, height: 420 })
    const region = page.locator('[data-page-scroll]')
    assert.deepEqual(
      await page.evaluate<[number, string, string, boolean]>(
        `(() => { const element = document.querySelector('[data-page-scroll]'); const style = getComputedStyle(element); return [document.documentElement.scrollHeight - window.innerHeight, style.overflowY, style.direction, element.hasAttribute('scroll-region')] })()`
      ),
      [0, 'auto', 'rtl', true]
    )
    const pageBox = await box(region)
    assert.isAtMost(Math.abs(pageBox.x), 0.5)
    assert.isAtMost(Math.abs(pageBox.x + pageBox.width - side.x), 1)
    // The page overflows its region here, so the region's own bar is the page's scroll bar.
    assert.isTrue(
      await page.evaluate<boolean>(
        `(() => { const element = document.querySelector('[data-page-scroll]'); return element.scrollHeight > element.clientHeight })()`
      )
    )
    await page.setViewportSize({ width: 1440, height: 900 })

    // Keyboard: Enter on the trigger collapses to icons, the default collapse mode.
    await trigger.focus()
    await page.keyboard.press('Enter')
    await page.locator('[data-workspace-shell][data-sidebar="icons"]').waitFor()
    const rail = await box(sidebar)
    assert.isBelow(rail.width, 90)
    assert.isAbove(rail.x + rail.width, 1440 - 2)
    // The header segment narrows with it and keeps the trigger above the rail; no brand tile
    // in the rail, the brand stays in the header.
    const narrow = await box(trigger)
    assert.isAtLeast(narrow.x, rail.x - 0.5)
    assert.equal(await sidebar.getByText('أ', { exact: true }).count(), 0)
    await page.assertVisible(header.getByRole('link', { name: /أدولا/ }))
    assert.equal(await trigger.getAttribute('aria-expanded'), 'false')
    // Icons keep their names: an accessible name and a tooltip.
    const overview = sidebar.getByRole('link', { name: 'نظرة عامة' }).last()
    await overview.hover()
    await page.getByRole('tooltip', { name: 'نظرة عامة' }).waitFor()
    await stored(member.user.id, 'shell.sidebar', 'icons')
    await page.reload()
    await page.locator('[data-workspace-shell][data-sidebar="icons"]').waitFor()
    await page.screenshot({ path: join(await screenshotDir(), `frame-icons-${theme}.png`) })

    // The rail on the sidebar's edge toggles it too.
    await page.locator('[data-sidebar-rail]').click()
    await page.locator('[data-workspace-shell][data-sidebar="expanded"]').waitFor()
    await stored(member.user.id, 'shell.sidebar', 'expanded')

    // The account menu sets what collapsing does: hide it completely.
    await page.getByRole('button', { name: 'قائمة الحساب' }).first().click()
    await page.getByRole('menuitemradio', { name: 'إخفاء كامل' }).click()
    await stored(member.user.id, 'shell.sidebarCollapse', 'hidden')
    await page.keyboard.press('Escape')
    await trigger.click()
    await sidebar.waitFor({ state: 'hidden' })
    assert.equal(await shell.getAttribute('data-sidebar'), 'hidden')
    const main = (await page.locator('main').boundingBox())!
    assert.isAbove(main.width, 1300)
    // The header keeps the trigger (and the brand), which brings the sidebar back.
    assert.equal(await trigger.getAttribute('aria-label'), 'إظهار القائمة الجانبية')
    await page.screenshot({ path: join(await screenshotDir(), `frame-hidden-${theme}.png`) })
    await page.reload()
    await sidebar.waitFor({ state: 'hidden' })
    await trigger.click()
    await sidebar.getByRole('navigation', { name: 'التنقل الرئيسي' }).waitFor()
    assert.equal(await shell.getAttribute('data-sidebar'), 'expanded')
    await stored(member.user.id, 'shell.sidebar', 'expanded')
    await page.screenshot({ path: join(await screenshotDir(), `frame-1440-${theme}.png`) })

    // A phone: the header stays full width, without the sidebar trigger, and nothing scrolls
    // sideways.
    await page.setViewportSize({ width: 375, height: 812 })
    await page.reload()
    await header.waitFor()
    const phone = await box(header)
    assert.isAtMost(Math.abs(phone.x), 0.5)
    assert.isAtMost(Math.abs(phone.width - 375), 0.5)
    assert.isFalse(await trigger.isVisible())
    assert.isAtMost(await page.evaluate<number>('document.documentElement.scrollWidth'), 375)
    await page.screenshot({ path: join(await screenshotDir(), `frame-375-${theme}.png`) })
  })

  test('changing «عند طي القائمة» while the sidebar is collapsed applies the new mode at once (owner decision 20)', async ({
    browserContext,
    visit,
  }) => {
    // Start from the defaults: an expanded sidebar that collapses to icons.
    await knex()('settings')
      .where({ scope: 'user', scope_id: String(member.user.id) })
      .whereIn('key', ['preference.shell.sidebar', 'preference.shell.sidebarCollapse'])
      .delete()
    await browserContext.loginAs(member.user)
    const page = await visit('/')
    await page.setViewportSize({ width: 1440, height: 900 })
    const sidebar = page.locator('#workspace-sidebar')
    const trigger = page.locator('[data-sidebar-trigger]')
    const shell = (mode: string) => page.locator(`[data-workspace-shell][data-sidebar="${mode}"]`)
    const choose = async (name: string) => {
      await page.getByRole('button', { name: 'قائمة الحساب' }).first().click()
      await page.getByRole('menuitemradio', { name }).click()
      await page.keyboard.press('Escape')
    }
    await sidebar.getByRole('navigation', { name: 'التنقل الرئيسي' }).waitFor()
    await trigger.click()
    await shell('icons').waitFor()

    // Collapsed to icons: choosing «إخفاء كامل» hides the sidebar now, not at the next collapse.
    await choose('إخفاء كامل')
    await shell('hidden').waitFor()
    await sidebar.waitFor({ state: 'hidden' })
    await stored(member.user.id, 'shell.sidebarCollapse', 'hidden')
    await stored(member.user.id, 'shell.sidebar', 'hidden')

    // Hidden: choosing «أيقونات» shows the rail at once.
    await choose('أيقونات')
    await shell('icons').waitFor()
    await sidebar.waitFor()
    await stored(member.user.id, 'shell.sidebarCollapse', 'icons')
    await stored(member.user.id, 'shell.sidebar', 'icons')

    // An expanded sidebar stays expanded; the choice waits for its next collapse.
    await trigger.click()
    await shell('expanded').waitFor()
    await choose('إخفاء كامل')
    await stored(member.user.id, 'shell.sidebarCollapse', 'hidden')
    await shell('expanded').waitFor()
    await stored(member.user.id, 'shell.sidebar', 'expanded')
    await trigger.click()
    await shell('hidden').waitFor()
    await choose('أيقونات')
    await shell('icons').waitFor()
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
    // The registry Breadcrumb in the header (owner decision 20).
    const breadcrumb = page.locator('header').getByRole('navigation', { name: 'مسار التنقل' })
    await breadcrumb.getByText('الملف الشخصي', { exact: true }).waitFor()
    const trail = async () => {
      const items = await breadcrumb.locator('[data-slot=breadcrumb-item]').allInnerTexts()
      return items.map((item) => item.trim())
    }
    assert.deepEqual(await trail(), ['حسابي', 'الملف الشخصي'])
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
    assert.deepEqual(await trail(), ['حسابي', 'الجلسات'])
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

  test('administration has two sidebar entries, its pages as horizontal tabs under the header, and a resettable order (ADR 049)', async ({
    browserContext,
    visit,
    assert,
    cleanup,
  }) => {
    const theme = process.env.ADULA_TEST_THEME ?? 'light'
    // The backup warning lines up with the tabs below: it shows while no offsite backup is
    // younger than 48 hours, whatever an earlier suite recorded (the functional backup-warning
    // test ends on a fresh one).
    const savedBackup = await knex()('settings').where('key', 'backup.lastOffsite')
    await knex()('settings').where('key', 'backup.lastOffsite').delete()
    cleanup(async () => {
      await knex()('settings').where('key', 'backup.lastOffsite').delete()
      // pg returns the json value parsed; serialize it again so a string stays valid JSON.
      if (savedBackup.length)
        await knex()('settings').insert(
          savedBackup.map((row) => ({ ...row, value: JSON.stringify(row.value) }))
        )
    })
    await browserContext.loginAs(admin.user)
    const page = await visit('/admin/users')
    await page.setViewportSize({ width: 1440, height: 900 })
    const sections = page.getByRole('navigation', { name: 'التنقل الإداري' })
    const titles = async () => {
      await sections.getByRole('link').first().waitFor()
      const texts = await sections.getByRole('link').allInnerTexts()
      return texts.map((text) => text.replace(/\d+/g, '').trim())
    }
    // Exactly two entries, with no sub-items under them (owner's review).
    assert.deepEqual(await titles(), ['الأشخاص والصلاحيات', 'الإعدادات'])
    assert.equal(await sections.getByRole('link', { name: 'الأدوار والصلاحيات' }).count(), 0)

    // The section's pages are one horizontal row of the registry Tabs right below the header,
    // across the page area, not a column inside the page (owner decision 22).
    const people = page.getByRole('tablist', { name: 'صفحات القسم: الأشخاص والصلاحيات' })
    assert.equal(await people.getAttribute('aria-orientation'), 'horizontal')
    assert.equal(await people.getAttribute('data-slot'), 'tabs-list')
    assert.equal(await page.locator('main [role=tablist]').count(), 0)
    const usersTab = people.getByRole('tab', { name: 'المستخدمون', exact: true })
    assert.equal(await usersTab.getAttribute('aria-selected'), 'true')
    // The page is the selected tab's panel.
    const panel = page.getByRole('tabpanel')
    assert.equal(await panel.getAttribute('aria-labelledby'), await usersTab.getAttribute('id'))
    await page.assertVisible(panel.getByRole('heading', { name: 'المستخدمون', exact: true }))
    // No reorder or restore control among the tabs.
    assert.equal(await people.getByRole('button').count(), 0)
    const shellHeader = (await page.locator('[data-shell-header]').boundingBox())!
    const row = (await page.locator('[data-admin-tabs-row]').boundingBox())!
    const column = (await page.locator('[data-page-scroll]').boundingBox())!
    // Directly under the header, as wide as the page area beside the sidebar.
    assert.isAtMost(Math.abs(row.y - (shellHeader.y + shellHeader.height)), 1)
    assert.isAtMost(Math.abs(row.x - column.x), 1)
    assert.isAtMost(Math.abs(row.width - column.width), 1)
    // The tabs begin at the start side (the right in RTL), and the page below them uses the
    // full content width: no tab column beside it.
    const listBox = (await people.boundingBox())!
    assert.isAtMost(Math.abs(listBox.x + listBox.width - (row.x + row.width - 40)), 1)
    const panelBox = (await panel.boundingBox())!
    const main = (await page.locator('main').boundingBox())!
    assert.isAtLeast(panelBox.width, main.width - 2 * 40 - 1)
    assert.isAbove(panelBox.y, row.y + row.height - 1)

    // The active sidebar entry: the shell's pattern without a border; keyboard focus shows the
    // ring, not the browser outline.
    const entry = sections.getByRole('link', { name: 'الأشخاص والصلاحيات' })
    assert.equal(await entry.getAttribute('aria-current'), 'page')
    const style = (selector: string) =>
      page.evaluate<Record<string, string>>(
        `(() => { const s = getComputedStyle(document.querySelector(${JSON.stringify(selector)})); return { border: s.borderInlineStartWidth, background: s.backgroundColor, color: s.color, weight: s.fontWeight, outline: s.outlineStyle, shadow: s.boxShadow } })()`
      )
    const activeEntry = 'nav[aria-label="التنقل الإداري"] a[aria-current="page"]'
    const active = await style(activeEntry)
    assert.equal(active.border, '0px')
    assert.equal(active.background, await tokenStyle(page, 'bg-accent', 'backgroundColor'))
    assert.equal(active.color, await tokenStyle(page, 'text-primary', 'color'))
    assert.equal(active.weight, '600')
    await entry.focus()
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Tab')
    const focused = await style(activeEntry)
    assert.equal(focused.outline, 'none')
    assert.notEqual(focused.shadow, 'none')

    // The registry's default look: the muted list with the selected tab raised on it.
    assert.equal(await people.getAttribute('data-variant'), 'default')
    await page.mouse.move(0, 0)
    const look = await page.evaluate<Record<string, string>>(`(() => {
      const list = getComputedStyle(document.querySelector('[role=tablist]'))
      const tab = getComputedStyle(document.querySelector('[role=tab][aria-selected=true]'))
      const other = getComputedStyle(document.querySelector('[role=tab][aria-selected=false]'))
      return { list: list.backgroundColor, tab: tab.backgroundColor, other: other.backgroundColor }
    })()`)
    assert.equal(look.list, await tokenStyle(page, 'bg-muted', 'backgroundColor'))
    assert.notEqual(look.tab, look.other)
    assert.notEqual(look.tab, 'rgba(0, 0, 0, 0)')

    // Arrow keys move between tabs; Enter opens the focused one at its own address.
    await usersTab.focus()
    // Horizontal and right to left: the next tab is to the left.
    await page.keyboard.press('ArrowLeft')
    const rolesTab = people.getByRole('tab', { name: 'الأدوار والصلاحيات', exact: true })
    // Radix moves the focus on the next task; the page CSP forbids string waitForFunction.
    const focusedTab = () =>
      page.evaluate<string>('document.activeElement?.textContent?.trim() ?? ""')
    for (const started = Date.now(); (await focusedTab()) !== 'الأدوار والصلاحيات';) {
      if (Date.now() - started > 5_000) assert.equal(await focusedTab(), 'الأدوار والصلاحيات')
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    await page.keyboard.press('Enter')
    await page.waitForURL((url) => url.pathname === '/admin/roles')
    await page.getByRole('heading', { name: 'الأدوار والصلاحيات', exact: true }).waitFor()
    assert.equal(await rolesTab.getAttribute('aria-selected'), 'true')
    assert.equal(await usersTab.getAttribute('aria-selected'), 'false')

    // Direct links, Back and Forward select the right tab.
    const sessionsTab = people.getByRole('tab', { name: 'الجلسات', exact: true })
    await page.goto('/admin/sessions')
    await page.getByRole('heading', { name: 'الجلسات', exact: true }).waitFor()
    assert.equal(await sessionsTab.getAttribute('aria-selected'), 'true')
    await page.goBack()
    await page.waitForURL((url) => url.pathname === '/admin/roles')
    await page.getByRole('heading', { name: 'الأدوار والصلاحيات', exact: true }).waitFor()
    assert.equal(await rolesTab.getAttribute('aria-selected'), 'true')
    await page.goForward()
    await page.waitForURL((url) => url.pathname === '/admin/sessions')
    await page.getByRole('heading', { name: 'الجلسات', exact: true }).waitFor()
    assert.equal(await sessionsTab.getAttribute('aria-selected'), 'true')

    // «الإعدادات» gathers the settings, operations, backups, failures and the activity log.
    await sections.getByRole('link', { name: /^الإعدادات/ }).click()
    await page.waitForURL(/\/admin\/(setup|settings)$/)
    const settings = page.getByRole('tablist', { name: 'صفحات القسم: الإعدادات' })
    for (const label of [
      'الإعدادات العامة',
      'تشغيل النظام',
      'النسخ الاحتياطي',
      'تدفقات فاشلة',
      'سجل النشاط',
    ])
      await settings.getByRole('tab', { name: new RegExp(`^${label}`) }).waitFor()
    assert.equal(
      await sections.getByRole('link', { name: /^الإعدادات/ }).getAttribute('aria-current'),
      'page'
    )

    // From a tablet up the eleven tabs wrap onto further rows instead of scrolling: every tab
    // and its badge is whole and inside the window (the registry's TabsList wrap option).
    assert.equal(await settings.getAttribute('data-wrap'), 'true')
    for (const width of [768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/admin/settings')
      await settings.waitFor()
      const fit = await page.evaluate<{ overflow: number; outside: string[] }>(`(() => {
        const list = document.querySelector('[role=tablist]')
        const box = list.getBoundingClientRect()
        const outside = [...list.querySelectorAll('[role=tab], [role=tab] [data-slot=badge]')]
          .filter((element) => {
            const rect = element.getBoundingClientRect()
            return rect.left < Math.max(0, box.left) - 0.5 || rect.right > Math.min(innerWidth, box.right) + 0.5 || rect.top < box.top - 0.5 || rect.bottom > box.bottom + 0.5
          })
          .map((element) => element.textContent.trim())
        return { overflow: list.scrollWidth - list.clientWidth, outside }
      })()`)
      assert.isAtMost(fit.overflow, 0, `${width}`)
      assert.deepEqual(fit.outside, [], `${width}`)
      if (width === 1920) {
        // The tabs, the backup warning and the page share one centred column.
        const edges = await page.evaluate<number[][]>(
          `['[data-admin-tabs-column]', '[data-backup-banner]', 'main'].map((selector) => { const element = document.querySelector(selector); const box = element.getBoundingClientRect(); const style = getComputedStyle(element); return [box.left + parseFloat(style.paddingLeft), box.right - parseFloat(style.paddingRight)] })`
        )
        for (const [left, right] of edges.slice(0, 2)) {
          assert.isAtMost(Math.abs(left - edges[2][0]), 1, `left ${left} vs ${edges[2][0]}`)
          assert.isAtMost(Math.abs(right - edges[2][1]), 1, `right ${right} vs ${edges[2][1]}`)
        }
      }
      await page.screenshot({
        path: join(await screenshotDir(), `admin-tabs-${width}-${theme}.png`),
      })
    }
    await page.setViewportSize({ width: 1440, height: 900 })

    // The header and the tabs stay on screen while a long page scrolls: the row sits outside
    // the page's scroll region.
    await page.goto('/admin/settings')
    await settings.waitFor()
    const header = page.locator('[data-shell-top]')
    const tabsRow = page.locator('[data-admin-tabs-row]')
    const region = '[data-page-scroll]'
    const before = (await tabsRow.boundingBox())!
    await page.evaluate(
      `(() => { const element = document.querySelector('${region}'); element.scrollTop = element.scrollHeight })()`
    )
    assert.isAbove(
      await page.evaluate<number>(`document.querySelector('${region}').scrollTop`),
      100
    )
    await page.waitForTimeout(150)
    const headerBox = (await header.boundingBox())!
    assert.isAtMost(Math.abs(headerBox.y), 0.5)
    assert.deepEqual((await tabsRow.boundingBox())!, before)
    await page.assertVisible(settings.getByRole('tab', { name: 'سجل النشاط', exact: true }))
    await page.evaluate(`document.querySelector('${region}').scrollTop = 0`)
    await page.screenshot({
      path: join(await screenshotDir(), `admin-tabs-desktop-${theme}.png`),
    })

    // On a phone the row scrolls sideways and brings the active tab into view, and it sticks
    // under the header while the page scrolls.
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/admin/activity')
    await settings.waitFor()
    assert.equal(await settings.getAttribute('aria-orientation'), 'horizontal')
    assert.isAbove(
      await page.evaluate<number>(
        '(() => { const list = document.querySelector("[role=tablist]"); return list.scrollWidth - list.clientWidth })()'
      ),
      0
    )
    const inView = () =>
      page.evaluate<boolean>(
        '(() => { const list = document.querySelector("[role=tablist]").getBoundingClientRect(); const tab = document.querySelector("[role=tab][aria-selected=true]").getBoundingClientRect(); return tab.left >= list.left - 1 && tab.right <= list.right + 1 })()'
      )
    for (const started = Date.now(); !(await inView());) {
      if (Date.now() - started > 5_000) assert.isTrue(await inView())
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    assert.isAtMost(await page.evaluate<number>('document.documentElement.scrollWidth'), 375)
    // Phone order: the header, the main phone navigation, the section tabs, then the warnings
    // and the page.
    const phoneNav = (await page
      .getByRole('navigation', { name: 'التنقل على الجوال' })
      .boundingBox())!
    const rowAtTop = (await tabsRow.boundingBox())!
    assert.isAtMost(Math.abs(phoneNav.y - 72), 1)
    assert.isAtMost(Math.abs(rowAtTop.y - (phoneNav.y + phoneNav.height)), 1)
    const banner = page.getByRole('alert').filter({ hasText: 'لا توجد نسخة احتياطية خارجية حديثة' })
    if (await banner.count())
      assert.isAtLeast((await banner.boundingBox())!.y, rowAtTop.y + rowAtTop.height - 1)
    // The phone navigation uses the shell's patterns: the alerts count is the destructive count
    // Badge (as on the sidebar entry and the tab), and the current entry is filled.
    const phoneLinks = page.getByRole('navigation', { name: 'التنقل على الجوال' })
    const phoneSettings = phoneLinks.getByRole('link', { name: /^الإعدادات/ })
    // The current entry (and its badge) is scrolled into view in the sideways phone navigation.
    const phoneCurrentInView = () =>
      page.evaluate<boolean>(
        `(() => { const nav = document.querySelector('nav[aria-label="التنقل على الجوال"]').getBoundingClientRect(); const link = document.querySelector('nav[aria-label="التنقل على الجوال"] a[aria-current="page"]').getBoundingClientRect(); return link.left >= nav.left - 0.5 && link.right <= nav.right + 0.5 })()`
      )
    for (const started = Date.now(); !(await phoneCurrentInView());) {
      if (Date.now() - started > 5_000) assert.isTrue(await phoneCurrentInView())
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    assert.notMatch(await phoneSettings.innerText(), /\(/)
    const alertCount = await page
      .locator('nav[aria-label="التنقل الإداري"] [data-slot=badge]')
      .count()
    const phoneBadge = phoneSettings.locator('[data-slot=badge]')
    assert.equal(await phoneBadge.count(), alertCount)
    if (alertCount) {
      assert.equal(await phoneBadge.getAttribute('data-variant'), 'destructive')
      assert.match((await phoneBadge.getAttribute('aria-label')) ?? '', /تنبيه إداري/)
    }
    assert.equal(await phoneSettings.getAttribute('aria-current'), 'page')
    const phoneActive = await page.evaluate<Record<string, string>>(
      `(() => { const s = getComputedStyle(document.querySelector('nav[aria-label="التنقل على الجوال"] a[aria-current="page"]')); return { background: s.backgroundColor, color: s.color, weight: s.fontWeight } })()`
    )
    assert.equal(phoneActive.background, await tokenStyle(page, 'bg-accent', 'backgroundColor'))
    assert.equal(phoneActive.color, await tokenStyle(page, 'text-primary', 'color'))
    assert.equal(phoneActive.weight, '600')
    await page.screenshot({ path: join(await screenshotDir(), `admin-tabs-phone-${theme}.png`) })
    // The focus ring of the first and the last tab fits inside the scrolling row (the list's
    // padding holds the 3 px ring).
    const ringFits = (which: 'first' | 'last') =>
      page.evaluate<boolean>(`(() => {
        const list = document.querySelector('[role=tablist]')
        const tabs = list.querySelectorAll('[role=tab]')
        const tab = ${which === 'first' ? 'tabs[0]' : 'tabs[tabs.length - 1]'}
        const box = list.getBoundingClientRect()
        const rect = tab.getBoundingClientRect()
        return document.activeElement === tab && rect.left - 3 >= box.left - 0.5 && rect.right + 3 <= box.right + 0.5 && rect.top - 3 >= box.top - 0.5 && rect.bottom + 3 <= box.bottom + 0.5
      })()`)
    await settings.getByRole('tab', { name: 'سجل النشاط', exact: true }).focus()
    for (const [key, which] of [
      ['Home', 'first'],
      ['End', 'last'],
    ] as const) {
      await page.keyboard.press(key)
      for (const started = Date.now(); !(await ringFits(which));) {
        if (Date.now() - started > 5_000) assert.isTrue(await ringFits(which), which)
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      await page.screenshot({
        path: join(await screenshotDir(), `admin-tabs-phone-focus-${which}-${theme}.png`),
      })
    }
    await page.locator('main h1').first().click()
    await page.evaluate('window.scrollTo(0, document.documentElement.scrollHeight)')
    await page.waitForTimeout(150)
    assert.isAbove(await page.evaluate<number>('window.scrollY'), 100)
    const phoneHeader = (await header.boundingBox())!
    assert.isAtMost(Math.abs(phoneHeader.y), 0.5)
    const phoneRow = (await tabsRow.boundingBox())!
    assert.isAtMost(Math.abs(phoneRow.y - (phoneHeader.y + phoneHeader.height)), 1)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/admin/users')

    // Arrange the two entries with the keyboard-accessible buttons; reset restores them.
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
    await dialog.getByRole('button', { name: 'تحريك الإعدادات لأعلى' }).click()
    await dialog.getByRole('button', { name: 'حفظ الترتيب' }).click()
    await dialog.waitFor({ state: 'detached' })
    assert.deepEqual(await titles(), ['الإعدادات', 'الأشخاص والصلاحيات'])
    await stored(admin.user.id, 'shell.navOrder', ['admin.settings', 'admin.people'])
    await page.reload()
    assert.deepEqual(await titles(), ['الإعدادات', 'الأشخاص والصلاحيات'])
    await page.getByRole('button', { name: 'قائمة الحساب' }).click()
    await page.getByRole('menuitem', { name: 'ترتيب القائمة…' }).click()
    await dialog.getByRole('button', { name: 'استعادة الترتيب الافتراضي' }).click()
    await dialog.waitFor({ state: 'detached' })
    assert.deepEqual(await titles(), ['الأشخاص والصلاحيات', 'الإعدادات'])
    await stored(admin.user.id, 'shell.navOrder', null)

    // A non-administrator never sees the administration, whatever their stored order says.
    await knex()('settings').insert({
      key: 'preference.shell.navOrder',
      scope: 'user',
      scope_id: String(member.user.id),
      value: JSON.stringify(['admin.settings', 'module.suppliers']),
    })
    await browserContext.clearCookies()
    await browserContext.loginAs(member.user)
    const plain = await visit('/')
    await plain.setViewportSize({ width: 1440, height: 900 })
    await plain.getByRole('navigation', { name: 'التنقل الرئيسي' }).waitFor()
    assert.equal(await plain.getByRole('navigation', { name: 'التنقل الإداري' }).count(), 0)
    assert.equal(await plain.getByRole('link', { name: 'الموردون' }).count(), 0)
    assert.equal(await plain.getByText('الموردون').count(), 0)
  })

  test('every sidebar entry and every administration tab opens its own page, wide, narrow and collapsed (owner decision 22)', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await knex()('settings')
      .where({ scope: 'user', scope_id: String(admin.user.id) })
      .whereIn('key', [
        'preference.shell.sidebar',
        'preference.shell.sidebarCollapse',
        'preference.shell.navOrder',
      ])
      .delete()
    await browserContext.loginAs(admin.user)
    const page = await visit('/')
    await page.setViewportSize({ width: 1440, height: 900 })
    const origin = new URL(page.url()).origin
    // Anything that goes wrong while navigating: failed responses, console errors and
    // uncaught page errors, each with the address it happened on.
    const problems: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') problems.push(`${page.url()}: ${message.text()}`)
    })
    page.on('pageerror', (error) => problems.push(`${page.url()}: ${error.message}`))
    page.on('response', (response) => {
      if (response.url().startsWith(origin) && response.status() >= 400)
        problems.push(`${response.status()} ${response.url()}`)
    })
    const address = (href: string) => {
      const url = new URL(href, origin)
      return url.pathname + url.search
    }
    // The page at the link's own address, with its heading and no error page.
    const landed = async (href: string) => {
      await page
        .waitForURL((url) => url.pathname + url.search === address(href), { timeout: 10_000 })
        .catch(() => assert.fail(`${href} landed on ${page.url()}`))
      await page.locator('main h1').first().waitFor()
      for (const text of ['الصفحة غير موجودة', 'حدث خطأ غير متوقع'])
        assert.equal(await page.getByText(text).count(), 0, `${href}: ${text}`)
    }
    const clean = (where: string) => {
      assert.deepEqual(problems.splice(0), [], where)
    }

    // Every link the navigation renders, read from the page rather than a fixed list, opens
    // its address and becomes the current entry there.
    const clickEach = async (container: string, where: string) => {
      await page.locator(container).first().waitFor()
      const hrefs = await page.evaluate<string[]>(
        `[...new Set([...document.querySelectorAll(${JSON.stringify(`${container} a[href]`)})].filter((link) => link.getClientRects().length > 0).map((link) => link.getAttribute('href')))]`
      )
      assert.isAbove(hrefs.length, 3, where)
      for (const href of hrefs) {
        const link = page.locator(`${container} a[href="${href}"]`).first()
        await link.click()
        await landed(href)
        for (const started = Date.now(); (await link.getAttribute('aria-current')) !== 'page';) {
          if (Date.now() - started > 5_000)
            assert.equal(await link.getAttribute('aria-current'), 'page', `${where} ${href}`)
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
        clean(`${where} ${href}`)
      }
      return hrefs
    }

    // Every tab of both administration sections opens its own page in the panel.
    const clickTabs = async (where: string) => {
      for (const section of ['الأشخاص والصلاحيات', 'الإعدادات']) {
        const list = page.getByRole('tablist', { name: `صفحات القسم: ${section}` })
        const entry =
          where === 'phone'
            ? page
                .getByRole('navigation', { name: 'التنقل على الجوال' })
                .getByRole('link', { name: new RegExp(`^${section}`) })
            : page
                .getByRole('navigation', { name: 'التنقل الإداري' })
                .getByRole('link', { name: new RegExp(`^${section}`) })
        await entry.click()
        await list.waitFor()
        const hrefs = await page.evaluate<string[]>(
          `[...document.querySelectorAll('[role=tablist] a[role=tab]')].map((tab) => tab.getAttribute('href'))`
        )
        assert.isAbove(hrefs.length, 1, `${where} ${section}`)
        for (const href of hrefs) {
          const tab = list.locator(`a[role=tab][href="${href}"]`)
          await tab.click()
          await landed(href)
          for (const started = Date.now(); (await tab.getAttribute('aria-selected')) !== 'true';) {
            if (Date.now() - started > 5_000)
              assert.equal(await tab.getAttribute('aria-selected'), 'true', `${where} ${href}`)
            await new Promise((resolve) => setTimeout(resolve, 50))
          }
          const panel = page.getByRole('tabpanel')
          assert.equal(await panel.getAttribute('aria-labelledby'), await tab.getAttribute('id'))
          await page.assertVisible(panel.locator('h1').first())
          clean(`${where} ${href}`)
        }
      }
    }

    // A wide window: the expanded sidebar, then the administration tabs.
    const wide = await clickEach('#workspace-sidebar nav', 'expanded')
    // «دعوة مستخدم» below the entries is an action: it opens the invitation over the users list.
    await page.locator('#workspace-sidebar').getByRole('link', { name: 'دعوة مستخدم' }).click()
    await page.waitForURL((url) => url.pathname + url.search === '/admin/users?invite=1')
    await page.getByRole('dialog', { name: 'دعوة مستخدم' }).waitFor()
    await page.keyboard.press('Escape')
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    clean('invite')
    await clickTabs('wide')

    // The sidebar collapsed to icons offers the same entries.
    await page.locator('[data-sidebar-trigger]').click()
    await page.locator('[data-workspace-shell][data-sidebar="icons"]').waitFor()
    const rail = await clickEach('#workspace-sidebar nav', 'icons')
    for (const href of rail) assert.include(wide, href)
    await page.locator('[data-sidebar-trigger]').click()
    await page.locator('[data-workspace-shell][data-sidebar="expanded"]').waitFor()

    // A phone: the phone navigation's entries, then the tabs.
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/')
    await clickEach('nav[aria-label="التنقل على الجوال"]', 'phone')
    await clickTabs('phone')
    clean('end')
  })

  test('a disabled switch is muted with shadcn opacity and shows its reason beside it', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(admin.user)
    const page = await visit('/admin/settings')
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.locator('[data-slot=switch]').first().waitFor()
    // A provider without credentials cannot be switched on (the reference application has
    // none): shadcn's opacity-50 mutes it, and its reason is written beside it.
    const disabled = page.locator('[data-slot=switch][disabled]').first()
    assert.isAbove(await disabled.count(), 0)
    assert.equal(
      await page.evaluate<string>(
        'getComputedStyle(document.querySelector("[data-slot=switch][disabled]")).opacity'
      ),
      '0.5'
    )
    const row = disabled.locator('xpath=ancestor::li[1]')
    await page.assertVisible(row.getByText(/غير مهيأ/))
  })
})
