import { test } from '@japa/runner'
import { join } from 'node:path'
import db from '@adonisjs/lucid/services/db'
import type { Page } from 'playwright'
import { screenshotDir, seedActor, type UiActor } from '#tests/helpers/ui_fixtures'

/**
 * Measures the backup banner in the page against the destructive Alert pattern (bg-card,
 * text-destructive, description text-destructive/90, the shared border colour), and the contrast
 * of its title and description over what the user actually sees (the card on the page behind).
 */
const MEASURE_BANNER = `(() => {
  const banner = [...document.querySelectorAll('[role="alert"]')].find((node) =>
    node.textContent.includes('لا توجد نسخة احتياطية خارجية حديثة')
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
  const contrast = (color) => {
    const [light, dark] = [luminance(surface), luminance(paint(page, style.backgroundColor, color))]
      .sort((a, b) => b - a)
    return (light + 0.05) / (dark + 0.05)
  }
  const title = getComputedStyle(banner.querySelector('[data-slot="alert-title"]')).color
  const description = getComputedStyle(
    banner.querySelector('[data-slot="alert-description"] a')
  ).color
  return {
    theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
    slot: banner.dataset.slot,
    background: style.backgroundColor,
    card: probe('backgroundColor', 'var(--card)'),
    border: style.borderTopColor,
    borderToken: probe('borderTopColor', 'var(--border)'),
    title,
    danger: probe('color', 'var(--destructive)'),
    description,
    dangerMuted: probe('color', 'color-mix(in oklab, var(--destructive) 90%, transparent)'),
    icon: getComputedStyle(banner.querySelector('svg')).color,
    titleContrast: contrast(title),
    descriptionContrast: contrast(description),
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

  test('the backup warning is the destructive Alert, readable in the current theme', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(admin.user)
    const page = await visit('/')
    await page
      .getByRole('alert')
      .filter({ hasText: 'لا توجد نسخة احتياطية خارجية حديثة' })
      .waitFor()
    const banner = await page.evaluate<{
      theme: string
      slot: string
      background: string
      card: string
      border: string
      borderToken: string
      title: string
      danger: string
      description: string
      dangerMuted: string
      icon: string
      titleContrast: number
      descriptionContrast: number
    }>(MEASURE_BANNER)
    assert.equal(banner.theme, await theme(page))
    // The destructive Alert: card surface, shared border, danger title, icon and description.
    assert.equal(banner.slot, 'alert')
    assert.equal(banner.background, banner.card)
    assert.equal(banner.border, banner.borderToken)
    assert.equal(banner.title, banner.danger)
    assert.equal(banner.icon, banner.danger)
    assert.equal(banner.description, banner.dangerMuted)
    // WCAG AA for normal-size text, over the colour the user actually sees.
    assert.isAtLeast(banner.titleContrast, 4.5, `title ${banner.titleContrast.toFixed(2)}`)
    assert.isAtLeast(
      banner.descriptionContrast,
      4.5,
      `description ${banner.descriptionContrast.toFixed(2)}`
    )
    await page.screenshot({
      path: join(await screenshotDir(), `backup-banner-${banner.theme}.png`),
    })
    // On a phone the short title is whole and the 48 hours stay readable in the description.
    await page.setViewportSize({ width: 375, height: 812 })
    const alert = page.getByRole('alert').filter({ hasText: 'لا توجد نسخة احتياطية خارجية حديثة' })
    assert.isTrue(
      await page.evaluate<boolean>(
        `(() => { const title = document.querySelector('[data-slot=alert-title]'); return title.scrollHeight <= title.clientHeight + 1 })()`
      )
    )
    await page.assertVisible(alert.getByText('لم تُنشأ نسخة خارجية سليمة خلال آخر 48 ساعة.'))
    await page.screenshot({
      path: join(await screenshotDir(), `backup-banner-375-${banner.theme}.png`),
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
