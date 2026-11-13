import { test } from '@japa/runner'
import { join } from 'node:path'
import type { Page } from 'playwright'
import { screenshotDir } from '#tests/helpers/ui_fixtures'
import { configureSignup } from '#tests/helpers/signup'

/**
 * The guest shell (home, sign-in and the other account pages) follows the design standard:
 * a sticky header of project-owned buttons, no legacy frame, and cards at a readable width.
 * Runs in light mode and, in the dark suite (ADULA_TEST_THEME=dark), in dark mode.
 */
test.group('Guest shell', (group) => {
  // Earlier suites create administrators, which closes the default signup policy; the sign-up
  // link these tests assert needs signup explicitly open.
  group.each.setup(() => configureSignup(true))

  const theme = (page: Page) =>
    page.evaluate<string>('document.documentElement.classList.contains("dark") ? "dark" : "light"')

  /** Header actions are the registry Button (a button or an asChild link), never bare controls. */
  const nativeHeaderButtons = (page: Page) =>
    page.evaluate<number>(
      `[...document.querySelectorAll('header button, header nav a')].filter(
        (node) => node.dataset.slot !== 'button'
      ).length`
    )
  const horizontalOverflow = (page: Page) =>
    page.evaluate<number>(
      'document.documentElement.scrollWidth - document.documentElement.clientWidth'
    )

  for (const path of ['/', '/login']) {
    test(`the guest page ${path} uses the guest shell at desktop and phone widths`, async ({
      visit,
      assert,
    }) => {
      const page = await visit(path)
      const name = path === '/' ? 'home' : 'login'
      const viewports = [
        { width: 1920, height: 1080 },
        { width: 375, height: 812 },
      ]
      const card = page.locator('[data-slot="card"]').first()
      await card.waitFor()
      // The title template adds the application name once; a page must not add it again.
      const title = await page.title()
      const appName = title.split(' - ').at(-1) ?? ''
      assert.equal(title.split(appName).length - 1, 1, `${path}: title ${title}`)
      for (const viewport of viewports) {
        await page.setViewportSize(viewport)
        await page.screenshot({
          path: join(
            await screenshotDir(),
            `guest-${name}-${viewport.width}-${await theme(page)}.png`
          ),
          fullPage: true,
        })
      }
      for (const viewport of viewports) {
        const label = `${path} ${viewport.width}`
        await page.setViewportSize(viewport)
        // No legacy frame: the page sits on the theme background, not a bordered box.
        assert.equal(await page.locator('[data-adula-legacy]').count(), 0, `${label}: legacy`)
        const header = page.locator('header').first()
        assert.equal(
          await header.evaluate((node) => {
            const view = globalThis as unknown as {
              getComputedStyle: (element: unknown) => { position: string }
            }
            return view.getComputedStyle(node).position
          }),
          'sticky',
          `${label}: sticky header`
        )
        assert.equal(await nativeHeaderButtons(page), 0, `${label}: native header button`)
        assert.isAtMost(await horizontalOverflow(page), 0, `${label}: horizontal scroll`)
        const box = await card.boundingBox()
        if (viewport.width === 1920)
          assert.isAtLeast(box?.width ?? 0, 320, `${label}: card width ${box?.width}`)
        else assert.isAtMost(box?.width ?? 0, viewport.width, `${label}: card fits`)
      }
      // The mark is decorative: the brand link is named by the company alone.
      await page.locator('header').getByRole('link', { name: 'أدولا', exact: true }).waitFor()
      // One way to sign in: the page's own action, not a duplicate header link.
      const signIn = page.getByRole('link', { name: /^(الدخول|تسجيل الدخول)$/ })
      if (path === '/') {
        assert.equal(await signIn.count(), 1)
        await signIn.click()
        await page.waitForURL(/\/login$/)
      } else {
        const header = page.locator('header')
        assert.equal(await header.getByRole('link', { name: 'الدخول' }).count(), 0)
        // The card links to sign-up; the header does not repeat it.
        assert.equal(await page.getByRole('link', { name: 'إنشاء حساب' }).count(), 1)
        assert.equal(await header.getByRole('link', { name: 'إنشاء حساب' }).count(), 0)
      }
    })
  }
})
