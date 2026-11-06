import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { crc32, deflateSync } from 'node:zlib'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import User from '#models/user'
import { derivePrimaryTheme } from 'adula'
import { adula } from '#services/adula'
import app from '@adonisjs/core/services/app'

// «المظهر والهوية» in the browser (ADR 053): live preview, save, and an occasion that the
// page shows on its dates and drops by itself afterwards (the clock is injected).

const THEME = process.env.ADULA_TEST_THEME === 'dark' ? 'dark' : 'light'
/** Saves a screenshot for the design review under .work/screenshots, one per theme. */
async function snapshot(page: { screenshot(options: object): Promise<unknown> }, name: string) {
  await mkdir(app.makePath('../../.work/screenshots'), { recursive: true })
  await page.screenshot({
    path: app.makePath(`../../.work/screenshots/appearance-${name}-${THEME}.png`),
    fullPage: true,
  })
}

function chunk(type: string, data: Buffer = Buffer.alloc(0)) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0)
  return Buffer.concat([head, data, crc])
}
function png(width = 120, height = 40) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 2
  const row = Buffer.alloc(1 + width * 3, 0x35)
  row[0] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
    chunk('IEND'),
  ])
}

/** The primary token the page applies, read from the document root. */
const rootPrimary = `getComputedStyle(document.documentElement).getPropertyValue('--primary').trim()`
/** What the root token should be for a saved colour in the theme the run uses. */
const expected = (color: string) =>
  derivePrimaryTheme(color)[process.env.ADULA_TEST_THEME === 'dark' ? 'dark' : 'light']['--primary']
/** Reads the root token until it matches; the page CSP forbids waitForFunction's eval. */
async function primaryBecomes(
  page: {
    evaluate: (script: string) => Promise<unknown>
    waitForTimeout: (ms: number) => Promise<void>
  },
  matches: (value: string) => boolean
) {
  let value = ''
  for (let tries = 0; tries < 50; tries++) {
    value = String(await page.evaluate(rootPrimary))
    if (matches(value)) return value
    await page.waitForTimeout(100)
  }
  throw new Error(`--primary stayed ${value}`)
}

test.group('Appearance in the browser (ADR 053)', (group) => {
  let admin: User
  const knex = () => db.connection().getWriteClient()
  const appearance = () => adula().appearance
  const realClock = appearance().clock

  group.setup(async () => {
    const suffix = randomUUID().slice(0, 8)
    admin = await User.create({
      email: `appearance-browser-${suffix}@example.test`,
      password: 'browser-test-only-password',
    })
    const [role] = await knex()('roles')
      .insert({ name: `appearance-browser-${suffix}`, permission_level: 1 })
      .returning('id')
    await knex()('role_rules').insert({ role_id: role.id, subject: 'all', action: 'manage' })
    await knex()('user_roles').insert({ user_id: admin.id, role_id: role.id })
  })
  group.each.setup(async () => {
    await knex()('appearance_occasions').delete()
    await knex()('settings').where('key', 'appearance.identity').delete()
    await knex()('attachments').where('resource', 'core_appearance').delete()
    appearance().forget()
    appearance().clock = () => new Date('2026-01-15T09:00:00Z')
    return () => {
      appearance().clock = realClock
    }
  })

  test('the identity dialog previews the colour and logo live, refuses weak contrast and saves', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(admin)
    const page = await visit('/admin/appearance')
    await page.getByRole('button', { name: 'تعديل الهوية', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'تعديل الهوية' })
    const preview = dialog.getByTestId('appearance-preview')

    await dialog.getByLabel('اسم الشركة', { exact: true }).fill('شركة المعاينة')
    await preview.getByText('شركة المعاينة').first().waitFor()

    const color = dialog.getByLabel('اللون الأساسي', { exact: true })
    await color.fill('#ffd400')
    await dialog
      .getByTestId('appearance-color-contrast')
      .getByText(/التباين .*4\.5:1/)
      .waitFor()
    await dialog.getByRole('button', { name: 'حفظ', exact: true }).click()
    await dialog
      .getByRole('alert')
      .getByText(/التباين/)
      .waitFor()

    await color.fill('#006c35')
    await dialog
      .getByTestId('appearance-color-contrast')
      .getByText(/يحقق حد التباين المطلوب/)
      .waitFor()
    const light = preview.locator('[data-mode="light"]')
    const dark = preview.locator('[data-mode="dark"]')
    // Each preview panel carries its own scoped tokens.
    const tokenOf = async (panel: typeof light) =>
      /--primary:\s*(#[0-9a-f]{6})/.exec((await panel.getAttribute('style')) ?? '')?.[1]
    assert.equal(await tokenOf(light), '#006c35')
    const darkPrimary = await tokenOf(dark)
    assert.match(darkPrimary ?? '', /^#[0-9a-f]{6}$/)
    assert.notEqual(darkPrimary, '#006c35')

    await dialog.locator('#appearance-logo').setInputFiles({
      name: 'logo.png',
      mimeType: 'image/png',
      buffer: png(),
    })
    await dialog.getByRole('img', { name: 'الشعار المختار' }).waitFor()
    await dialog.getByLabel('عنوان صفحة الدخول', { exact: true }).fill('مرحبًا بك في المعاينة')
    await preview.getByText('مرحبًا بك في المعاينة').first().waitFor()
    await snapshot(page, 'identity-dialog')

    await dialog.getByRole('button', { name: 'حفظ', exact: true }).click()
    await dialog.waitFor({ state: 'detached' })
    await page.getByText('حُفظت الهوية.').first().waitFor()
    const summary = page.getByTestId('appearance-identity')
    await summary.getByText('شركة المعاينة', { exact: true }).waitFor()
    await summary.getByRole('img', { name: 'شعار شركة المعاينة' }).waitFor()
    // The whole system now uses the colour, in this page view and after a reload.
    await primaryBecomes(page, (value) => value === expected('#006c35'))
    await page.reload()
    // The Inertia app mounts (and applies the colour) after the load event.
    await page.getByTestId('appearance-identity').waitFor()
    assert.equal(
      await primaryBecomes(page, (value) => value === expected('#006c35')),
      expected('#006c35')
    )
    const stored = await appearance().identity()
    assert.equal(stored.company, 'شركة المعاينة')
    assert.isNotNull(stored.logoId)

    // «استعادة الافتراضي» returns to the project identity and the theme's own colour.
    await page.getByRole('button', { name: 'استعادة الافتراضي', exact: true }).click()
    await page
      .getByRole('dialog', { name: 'استعادة الهوية الافتراضية؟' })
      .getByRole('button', { name: 'استعادة الافتراضي', exact: true })
      .click()
    await page.getByText('عادت الهوية الافتراضية.').first().waitFor()
    await primaryBecomes(page, (value) => value !== expected('#006c35'))
    const restored = await appearance().identity()
    assert.isNull(restored.company)
  })

  test('an occasion shows on its dates and the base identity returns after it ends', async ({
    browserContext,
    visit,
    assert,
  }) => {
    appearance().clock = () => new Date('2026-09-21T09:00:00Z')
    const actor = { id: admin.id }
    await appearance().saveIdentity(actor, { primaryColor: '#1d4ed8' })
    await browserContext.loginAs(admin)
    const page = await visit('/admin/appearance')

    await page.getByRole('button', { name: 'إضافة مناسبة', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'إضافة مناسبة' })
    await dialog.getByLabel('اسم المناسبة', { exact: true }).fill('اليوم الوطني')
    await dialog.getByLabel('من يوم', { exact: true }).fill('2026-09-20')
    await dialog.getByLabel('إلى يوم', { exact: true }).fill('2026-09-23')
    await dialog.getByLabel('رسالة المناسبة', { exact: true }).fill('كل عام والوطن بخير')
    await dialog.getByLabel('لون المناسبة', { exact: true }).fill('#006c35')
    // The banner appears in the preview while typing.
    await dialog.getByTestId('appearance-preview').getByText('كل عام والوطن بخير').first().waitFor()
    await dialog.getByRole('button', { name: 'حفظ', exact: true }).click()
    await dialog.waitFor({ state: 'detached' })

    await page.getByTestId('appearance-today').getByText('اليوم الوطني').waitFor()
    await page.getByRole('cell', { name: 'اليوم الوطني', exact: true }).waitFor()
    await page.getByText('نشطة اليوم', { exact: true }).waitFor()
    await primaryBecomes(page, (value) => value === expected('#006c35'))

    // An overlapping occasion is refused with the other occasion's name.
    await page.getByRole('button', { name: 'إضافة مناسبة', exact: true }).click()
    await dialog.getByLabel('اسم المناسبة', { exact: true }).fill('متداخلة')
    await dialog.getByLabel('من يوم', { exact: true }).fill('2026-09-23')
    await dialog.getByLabel('إلى يوم', { exact: true }).fill('2026-09-25')
    await dialog.getByLabel('رسالة المناسبة', { exact: true }).fill('x')
    await dialog.getByRole('button', { name: 'حفظ', exact: true }).click()
    await dialog
      .getByRole('alert')
      .getByText(/تتداخل الفترة مع مناسبة «اليوم الوطني»/)
      .waitFor()
    await dialog.getByRole('button', { name: 'إلغاء', exact: true }).click()
    await page.getByRole('button', { name: 'إغلاق دون حفظ', exact: true }).click()
    await dialog.waitFor({ state: 'detached' })

    // The day after the end date, nothing was run: the base identity is simply back.
    appearance().clock = () => new Date('2026-09-24T09:00:00Z')
    await page.reload()
    await page
      .getByTestId('appearance-today')
      .getByText(/لا مناسبة نشطة اليوم/)
      .waitFor()
    await page.getByText('انتهت', { exact: true }).waitFor()
    await snapshot(page, 'page')
    assert.equal(
      await primaryBecomes(page, (value) => value === expected('#1d4ed8')),
      expected('#1d4ed8')
    )
  })

  test('on a 375 px phone the dialog keeps its footer in view and reaches the preview', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(admin)
    const page = await visit('/admin/appearance')
    await page.setViewportSize({ width: 375, height: 812 })
    await page.getByRole('button', { name: 'تعديل الهوية', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'تعديل الهوية' })
    const save = dialog.getByRole('button', { name: 'حفظ', exact: true })
    await save.waitFor()
    const box = (await save.boundingBox())!
    assert.isAtMost(box.y + box.height, 812)
    assert.isAtMost(box.x + box.width, 375)
    await save.click({ trial: true, timeout: 2000 })
    // The preview sits below the fields on a phone; the body scrolls to it.
    const preview = dialog.getByTestId('appearance-preview')
    await preview.scrollIntoViewIfNeeded()
    assert.isTrue(await preview.isVisible())
    const width = (await preview.boundingBox())!.width
    assert.isAtMost(width, 375)
    await snapshot(page, 'identity-dialog-375')
  })
})
