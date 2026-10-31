import { test } from '@japa/runner'
import { randomUUID } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import User from '#models/user'

const PASSWORD = 'browser-test-only-password'

test.group('Browser authentication lifecycle', () => {
  test('the guest home page has no links to removed educational modules', async ({ visit }) => {
    const page = await visit('/')
    await page.getByRole('heading', { name: 'مساحة العمل', exact: true }).waitFor()
    for (const name of ['customers', 'orders', 'tasks', 'leave_requests']) {
      await page.assertElementsCount(`a[href="/resources/${name}"]`, 0)
    }
    await page.assertVisible(page.getByRole('link', { name: 'تسجيل الدخول', exact: true }))
  })
  test('login, profile, sessions, revoke the current session and land on login', async ({
    visit,
    assert,
  }) => {
    const user = await User.create({
      fullName: 'مستخدم المتصفح',
      email: `browser-auth-${randomUUID()}@example.test`,
      password: PASSWORD,
    })
    const page = await visit('/login')
    await page.getByLabel('البريد الإلكتروني', { exact: true }).fill(user.email)
    await page.getByLabel('كلمة المرور', { exact: true }).fill(PASSWORD)
    await page.getByRole('button', { name: 'دخول', exact: true }).click()
    await page.waitForURL((url) => url.pathname === '/')

    await page.goto('/account/profile')
    await page.getByRole('heading', { name: 'الملف الشخصي', exact: true }).waitFor()
    await page.getByLabel('الاسم الكامل', { exact: true }).fill('اسم من المتصفح')
    await page.getByRole('button', { name: 'حفظ البيانات', exact: true }).click()
    await page.getByText('تم حفظ بيانات الملف الشخصي.').waitFor()
    await user.refresh()
    assert.equal(user.fullName, 'اسم من المتصفح')

    await page.getByRole('button', { name: 'قائمة الحساب', exact: true }).click()
    await page.getByRole('menuitem', { name: 'الجلسات', exact: true }).click()
    await page.waitForURL('**/account/sessions')
    await page.getByText('الجلسة الحالية', { exact: true }).waitFor()
    await page.assertElementsCount('tbody tr', 1)

    await page.getByRole('button', { name: 'إنهاء هذه الجلسة', exact: true }).click()
    await page.waitForURL('**/login')
    await page.goto('/account/profile')
    await page.waitForURL('**/login')

    const knex = db.connection().getWriteClient()
    const sessions = await knex('user_sessions').where({ user_id: user.id })
    assert.lengthOf(sessions, 1)
    assert.isNotNull(sessions[0].revoked_at)
    const actions = await knex('activities')
      .where({ resource: 'users', record_id: user.id })
      .orderBy('id')
      .pluck('action')
    assert.deepEqual(actions, ['login', 'profile_updated', 'session_revoked'])
  })
})
