import { test } from '@japa/runner'
import { join } from 'node:path'
import db from '@adonisjs/lucid/services/db'
import type { Page } from 'playwright'
import { screenshotDir, seedActor, type UiActor } from '#tests/helpers/ui_fixtures'

/**
 * Measures the backup banner in the page: its computed background next to the tinted danger
 * surface (`color-mix` of --destructive at 10%) and the solid --destructive, and the contrast
 * of its text over what the user actually sees (the banner composited on the page behind it).
 */
const MEASURE_BANNER = `(() => {
  const banner = [...document.querySelectorAll('[role="alert"]')].find((node) =>
    node.textContent.includes('لا توجد نسخة احتياطية خارجية سليمة')
  )
  const probe = (property, value) => {
    const node = document.createElement('div')
    node.style[property] = value
    banner.parentElement.append(node)
    const computed = getComputedStyle(node)[property]
    node.remove()
    return computed
  }
  let behind = banner.parentElement
  while (behind && /rgba\\(0, 0, 0, 0\\)|transparent/.test(getComputedStyle(behind).backgroundColor))
    behind = behind.parentElement
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1
  const context = canvas.getContext('2d', { willReadFrequently: true })
  const paint = (...layers) => {
    context.clearRect(0, 0, 1, 1)
    for (const layer of layers) {
      context.fillStyle = layer
      context.fillRect(0, 0, 1, 1)
    }
    return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)]
  }
  const luminance = (rgb) => {
    const [r, g, b] = rgb.map((v) => {
      const c = v / 255
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const style = getComputedStyle(banner)
  const page = getComputedStyle(behind ?? document.body).backgroundColor
  const surface = paint(page, style.backgroundColor)
  const text = paint(page, style.color)
  const [light, dark] = [luminance(surface), luminance(text)].sort((a, b) => b - a)
  return {
    theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
    background: style.backgroundColor,
    tinted: probe('backgroundColor', 'color-mix(in oklab, var(--destructive) 10%, transparent)'),
    solid: probe('backgroundColor', 'var(--destructive)'),
    color: style.color,
    text: probe('color', 'var(--foreground)'),
    icon: getComputedStyle(banner.querySelector('svg')).color,
    danger: probe('color', 'var(--destructive)'),
    contrast: (light + 0.05) / (dark + 0.05),
  }
})()`

test.group('Backup surfaces', (group) => {
  let admin: UiActor
  const knex = () => db.connection().getWriteClient()
  group.setup(async () => {
    admin = await seedActor([{ subject: 'all', action: 'manage' }], { fullName: 'مسؤول النسخ' })
    // The banner shows while no offsite backup is younger than 48 hours.
    const saved = await knex()('settings').where('key', 'backup.lastOffsite')
    await knex()('settings').where('key', 'backup.lastOffsite').delete()
    return async () => {
      await knex()('settings').where('key', 'backup.lastOffsite').delete()
      if (saved.length) await knex()('settings').insert(saved)
    }
  })

  const theme = (page: Page) =>
    page.evaluate<string>('document.documentElement.classList.contains("dark") ? "dark" : "light"')

  test('the backup warning is a tinted danger surface, readable in the current theme', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(admin.user)
    const page = await visit('/')
    await page
      .getByRole('alert')
      .filter({ hasText: 'لا توجد نسخة احتياطية خارجية سليمة' })
      .waitFor()
    const banner = await page.evaluate<{
      theme: string
      background: string
      tinted: string
      solid: string
      color: string
      text: string
      icon: string
      danger: string
      contrast: number
    }>(MEASURE_BANNER)
    assert.equal(banner.theme, await theme(page))
    assert.notEqual(banner.background, banner.solid, 'the banner is not a solid danger fill')
    assert.equal(banner.background, banner.tinted)
    assert.equal(banner.color, banner.text)
    assert.equal(banner.icon, banner.danger, 'the icon carries the danger colour')
    // WCAG AA for its normal-size text, over the colour the user actually sees.
    assert.isAtLeast(banner.contrast, 4.5, `contrast ${banner.contrast.toFixed(2)}`)
    await page.screenshot({
      path: join(await screenshotDir(), `backup-banner-${banner.theme}.png`),
    })
  })

  test('every backup destination row offers its actions, with the reason when blocked', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(admin.user)
    const page = await visit('/admin/backups')
    const table = page.getByRole('table').filter({ hasText: 'الوجهة' }).first()
    await table.waitFor()
    const header = table.getByRole('columnheader', { name: 'الإجراءات' })
    const rows = table.locator('tbody tr')
    const count = await rows.count()
    assert.equal(count, 3)
    await header.waitFor()
    for (let index = 0; index < count; index++) {
      const row = rows.nth(index)
      const name = await row.locator('td').first().innerText()
      const actions = row.locator('td').last().getByRole('button')
      const total = await actions.count()
      assert.isAbove(total, 0, `no action for ${name.trim()}`)
      for (let action = 0; action < total; action++) {
        const button = actions.nth(action)
        if (await button.isEnabled()) continue
        // A disabled action names why it cannot run yet.
        const reason = await button.getAttribute('aria-describedby')
        assert.isString(reason, `${name.trim()}: disabled without a reason`)
        const text = await page.locator(`[id="${reason}"]`).innerText()
        assert.match(text, /يتطلب/)
      }
    }
    // The actions fit the card: the table does not scroll sideways and hide them.
    const container = table.locator('xpath=..')
    const overflow = await container.evaluate((node) => {
      const box = node as unknown as { scrollWidth: number; clientWidth: number }
      return box.scrollWidth - box.clientWidth
    })
    assert.isAtMost(overflow, 1, 'the destinations table overflows its card')
    await page.screenshot({
      path: join(await screenshotDir(), `backup-destinations-${await theme(page)}.png`),
      fullPage: true,
    })
  })
})
