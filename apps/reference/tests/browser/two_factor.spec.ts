import { test } from '@japa/runner'
import { randomUUID } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import User from '#models/user'
import { enrolTwoFactor, totpCode } from '../helpers/two_factor.js'

const PASSWORD = 'browser-test-only-password'
const STEP = 30_000

const makeUser = (label: string) =>
  User.create({
    fullName: 'مستخدم التحقق',
    email: `browser-2fa-${label}-${randomUUID()}@example.test`,
    password: PASSWORD,
  })

test.group('Browser two-factor authentication', () => {
  test('the challenge Dialog refuses a wrong code, then signs in with the next code', async ({
    visit,
    assert,
  }) => {
    const user = await makeUser('challenge')
    const { secret } = await enrolTwoFactor(user.id, user.email)
    const page = await visit('/login')
    await page.getByLabel('البريد الإلكتروني', { exact: true }).fill(user.email)
    await page.getByLabel('كلمة المرور', { exact: true }).fill(PASSWORD)
    await page.getByRole('button', { name: 'دخول', exact: true }).click()
    await page.waitForURL('**/login/two-factor')

    const dialog = page.getByRole('dialog', { name: 'التحقق بخطوتين' })
    await dialog.waitFor()
    // Escape does not dismiss the step.
    await page.keyboard.press('Escape')
    await dialog.waitFor()
    const code = dialog.getByLabel('رمز التحقق', { exact: true })
    assert.equal(await code.getAttribute('autocomplete'), 'one-time-code')
    assert.equal(await code.getAttribute('inputmode'), 'numeric')

    await code.fill('000000')
    await dialog.getByRole('button', { name: 'تحقق ومتابعة', exact: true }).click()
    await dialog.getByText('رمز التحقق غير صحيح').waitFor()

    // Enrolment consumed the current time step; an authenticator shows the next one soon.
    await dialog.getByLabel('رمز التحقق', { exact: true }).fill(totpCode(secret, Date.now() + STEP))
    await dialog.getByRole('button', { name: 'تحقق ومتابعة', exact: true }).click()
    await page.waitForURL((url) => url.pathname === '/')
    const actions = await db
      .connection()
      .getWriteClient()('activities')
      .where({ resource: 'users', record_id: user.id })
      .orderBy('id')
      .pluck('action')
    assert.deepEqual(actions, ['two_factor_failed', 'login'])
  })

  test('the profile enrols an authenticator and shows the recovery codes once', async ({
    visit,
    assert,
  }) => {
    const user = await makeUser('enrol')
    // A real sign-in: starting enrolment needs a recent one.
    const page = await visit('/login')
    await page.getByLabel('البريد الإلكتروني', { exact: true }).fill(user.email)
    await page.getByLabel('كلمة المرور', { exact: true }).fill(PASSWORD)
    await page.getByRole('button', { name: 'دخول', exact: true }).click()
    await page.waitForURL((url) => url.pathname === '/')
    await page.goto('/account/profile?enrol=two-factor')

    // The forced-enrolment query opens the Dialog without a click.
    const dialog = page.getByRole('dialog', { name: 'تفعيل التحقق بخطوتين' })
    await dialog.waitFor()
    const secretText = await dialog.locator('code').first().textContent()
    const secret = String(secretText).replaceAll(' ', '')
    assert.match(secret, /^[A-Z2-7]{32}$/)
    const link = await dialog
      .getByRole('link', { name: 'فتح في تطبيق المصادقة' })
      .getAttribute('href')
    assert.match(String(link), /^otpauth:\/\/totp\//)

    await dialog.getByLabel('الرمز من تطبيق المصادقة', { exact: true }).fill(totpCode(secret))
    await dialog.getByRole('button', { name: 'تأكيد وتفعيل', exact: true }).click()
    const codes = page.getByRole('dialog', { name: 'رموز الاسترداد' })
    await codes.getByText('احفظ هذه الرموز الآن').waitFor()
    await page.assertElementsCount('ol[aria-label="رموز الاسترداد"] li', 10)
    await codes.getByRole('button', { name: 'حفظت الرموز', exact: true }).click()

    await page.getByText('10 من 10 متبقية').waitFor()
    await page.getByText('مفعّل', { exact: true }).first().waitFor()
  })
})
