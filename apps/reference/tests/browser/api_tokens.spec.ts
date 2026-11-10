import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import app from '@adonisjs/core/services/app'
import User from '#models/user'

// «رموز API» belongs to administrators (owner decision, 2.3.0): a tab under «الإعدادات»,
// not an account menu entry, with the same create, copy-once and revoke dialogs.

const THEME = process.env.ADULA_TEST_THEME === 'dark' ? 'dark' : 'light'
/** Saves a screenshot for the design review under .work/screenshots, one per theme. */
async function snapshot(
  page: {
    screenshot(options: object): Promise<unknown>
    waitForTimeout(ms: number): Promise<void>
  },
  name: string
) {
  // Lets a dialog's opening animation finish, so the review sees it as people do.
  await page.waitForTimeout(400)
  await mkdir(app.makePath('../../.work/screenshots'), { recursive: true })
  await page.screenshot({
    path: app.makePath(`../../.work/screenshots/api-tokens-${name}-${THEME}.png`),
    fullPage: true,
  })
}

test.group('API tokens in the settings (administrators only)', (group) => {
  let admin: User
  let member: User
  const knex = () => db.connection().getWriteClient()

  async function userWith(label: string, administrator: boolean) {
    const suffix = randomUUID().slice(0, 8)
    const user = await User.create({
      email: `tokens-${label}-${suffix}@example.test`,
      password: 'browser-test-only-password',
    })
    const [role] = await knex()('roles')
      .insert({ name: `tokens-${label}-${suffix}`, permission_level: 1 })
      .returning('id')
    await knex()('role_rules').insert(
      administrator
        ? { role_id: role.id, subject: 'all', action: 'manage' }
        : { role_id: role.id, subject: 'customers', action: 'view' }
    )
    await knex()('user_roles').insert({ user_id: user.id, role_id: role.id })
    return user
  }

  group.setup(async () => {
    admin = await userWith('admin', true)
    member = await userWith('member', false)
  })
  group.each.setup(async () => {
    await knex()('auth_access_tokens').whereIn('tokenable_id', [admin.id, member.id]).delete()
  })

  test('an administrator creates, copies once and revokes a token in the settings tab', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(admin)
    const page = await visit('/admin/tokens')
    // At phone width: the tab and the create dialog, which «إلغاء» closes at once while
    // untouched (the shared clean-close path).
    await page.setViewportSize({ width: 375, height: 812 })
    await page.getByRole('tab', { name: 'رموز API' }).waitFor()
    await snapshot(page, 'tab-375')
    await page.getByRole('button', { name: 'إنشاء رمز', exact: true }).click()
    const narrow = page.getByRole('dialog', { name: 'إنشاء رمز API' })
    await narrow.waitFor()
    await snapshot(page, 'create-375')
    await narrow.getByRole('button', { name: 'إلغاء', exact: true }).click()
    await narrow.waitFor({ state: 'hidden' })
    assert.equal(await page.getByRole('dialog', { name: 'إغلاق النموذج؟' }).count(), 0)
    await page.setViewportSize({ width: 1440, height: 900 })
    // The page is one of the «الإعدادات» tabs, and that tab is the selected one.
    const tab = page.getByRole('tab', { name: 'رموز API' })
    await tab.waitFor()
    assert.equal(await tab.getAttribute('aria-selected'), 'true')
    assert.isAtLeast(await page.getByRole('tab', { name: 'المظهر والهوية' }).count(), 1)
    await page.getByRole('heading', { name: 'رموز API', level: 1 }).waitFor()
    await page.getByText('لا رموز بعد.').waitFor()
    // The account menu no longer offers it, even to an administrator.
    await page.getByRole('button', { name: 'قائمة الحساب' }).first().click()
    await page.getByRole('menuitem', { name: 'الملف الشخصي' }).waitFor()
    assert.equal(await page.getByRole('menuitem', { name: 'رموز API' }).count(), 0)
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: 'إنشاء رمز', exact: true }).click()
    const form = page.getByRole('dialog', { name: 'إنشاء رمز API' })
    await form.getByLabel('اسم الرمز').fill('تكامل المحاسبة')
    await form.getByLabel('قراءة وكتابة').check()
    await snapshot(page, 'create')
    await form.getByRole('button', { name: 'إنشاء', exact: true }).click()

    const secret = page.getByRole('dialog', { name: 'انسخ الرمز الآن' })
    await secret.waitFor()
    assert.match((await secret.locator('code').textContent()) ?? '', /^Bearer adula_/)
    // The shared copy button sits at the footer's start and confirms the copy.
    await secret.getByRole('button', { name: 'نسخ', exact: true }).waitFor()
    await snapshot(page, 'secret')
    await secret.getByRole('button', { name: 'تم', exact: true }).click()
    await secret.waitFor({ state: 'hidden' })

    const row = page.getByRole('listitem').filter({ hasText: 'تكامل المحاسبة' })
    await row.waitFor()
    await row.getByText('قراءة وكتابة').waitFor()
    // The secret is shown once: the list holds the name and dates only.
    assert.notInclude((await page.textContent('main')) ?? '', 'adula_')
    await snapshot(page, 'list')
    const stored = await knex()('auth_access_tokens').where('tokenable_id', admin.id)
    assert.lengthOf(stored, 1)

    // Revoking stops the integrations at once, so it asks first; «تراجع» keeps the token.
    const revoke = page.getByRole('dialog', { name: 'إلغاء الرمز «تكامل المحاسبة»' })
    await row.getByRole('button', { name: 'إلغاء تكامل المحاسبة' }).click()
    await revoke.getByText('تتوقف فورًا كل التكاملات التي تستخدم هذا الرمز').waitFor()
    await snapshot(page, 'revoke')
    await revoke.getByRole('button', { name: 'تراجع', exact: true }).click()
    await revoke.waitFor({ state: 'hidden' })
    await row.waitFor()
    assert.lengthOf(await knex()('auth_access_tokens').where('tokenable_id', admin.id), 1)

    await row.getByRole('button', { name: 'إلغاء تكامل المحاسبة' }).click()
    await revoke.getByRole('button', { name: 'إلغاء الرمز', exact: true }).click()
    await page.getByText('لا رموز بعد.').waitFor()
    assert.lengthOf(await knex()('auth_access_tokens').where('tokenable_id', admin.id), 0)
  })

  test('a non-administrator has no menu entry and is refused the page', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(member)
    const page = await visit('/')
    await page.getByRole('button', { name: 'قائمة الحساب' }).first().click()
    await page.getByRole('menuitem', { name: 'الملف الشخصي' }).waitFor()
    assert.equal(await page.getByRole('menuitem', { name: 'رموز API' }).count(), 0)
    await page.keyboard.press('Escape')

    for (const url of ['/admin/tokens', '/account/tokens']) {
      const response = await page.goto(url)
      assert.equal(response?.status(), 403, url)
      assert.equal(await page.getByRole('tab', { name: 'رموز API' }).count(), 0)
      assert.equal(await page.getByRole('button', { name: 'إنشاء رمز', exact: true }).count(), 0)
    }
    assert.lengthOf(await knex()('auth_access_tokens').where('tokenable_id', member.id), 0)
  })
})
