import { test } from '@japa/runner'
import { randomUUID } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import type { Page, Request, Route } from 'playwright'
import User from '#models/user'

/**
 * Signing in, starting impersonation and ending it rotate the session: the browser gets a new
 * session cookie and the old session ends. A request the browser sent with the old cookie,
 * which the server answers after the rotation (a deferred prop, the notification bell, a
 * dialog's view), used to answer with the old cookie again: the browser kept it, and the next
 * page signed the user out to /login. Each test holds such a request until the rotation is
 * done, lets it through, then expects the user to still be signed in.
 */
test.group('A late request with the old session cookie', (group) => {
  let admin: User
  let member: User
  const unique = randomUUID().replaceAll('-', '').slice(0, 10)
  const knex = () => db.connection().getWriteClient()
  const password = 'rotation-test-only-password'

  group.setup(async () => {
    admin = await User.create({
      fullName: 'مدير التدوير',
      email: `rotation-admin-${unique}@example.test`,
      password,
    })
    member = await User.create({
      fullName: 'عضو التدوير',
      email: `rotation-member-${unique}@example.test`,
      password,
    })
    const [root] = await knex()('org_units')
      .insert({ name: 'جذر التدوير', type: 'root', path: `rot${unique}` })
      .returning('id')
    const [adminRole] = await knex()('roles')
      .insert({ name: `rotation-admin-${unique}`, permission_level: 1 })
      .returning('id')
    await knex()('role_rules').insert({ role_id: adminRole.id, subject: 'all', action: 'manage' })
    await knex()('user_roles').insert({ user_id: admin.id, role_id: adminRole.id })
    const [role] = await knex()('roles')
      .insert({ name: `rotation-role-${unique}` })
      .returning('id')
    await knex()('user_roles').insert({ user_id: member.id, role_id: role.id })
    await knex()('user_org_units').insert([
      { user_id: admin.id, org_unit_id: root.id },
      { user_id: member.id, org_unit_id: root.id },
    ])
  })

  /**
   * Sends a background read from the page with the session cookie it has now, and holds it in
   * the browser until `release` lets it reach the server. Chromium attaches cookies after a
   * request is intercepted, so the cookie of the moment it was sent is set on it explicitly.
   * `/login` answers anyone, so the late read is answered whoever it finds signed in.
   */
  async function holdBackgroundRead(page: Page) {
    const cookies = await page.context().cookies()
    const sent = cookies.find((cookie) => cookie.name === 'adonis-session')
    if (!sent) throw new Error('no session cookie yet')
    let held: Route | undefined
    const pattern = /\/login\?held=1$/
    // The page's other requests in flight: not the held read, nor the live-update stream, which
    // stays open.
    const pending = new Set<Request>()
    page.on('request', (request) => {
      if (!pattern.test(request.url()) && request.resourceType() !== 'eventsource')
        pending.add(request)
    })
    page.on('requestfinished', (request) => pending.delete(request))
    page.on('requestfailed', (request) => pending.delete(request))
    await page.route(pattern, (route) => {
      held = route
    })
    // Not awaited here: the read is held until `release`.
    await page.evaluate(
      `void (window.__late = fetch('/login?held=1', { headers: { Accept: 'application/json' } })
        .then((response) => response.status, () => 0))`
    )
    for (const started = Date.now(); !held;) {
      if (Date.now() - started > 10_000) throw new Error('the late read was not sent')
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    return {
      async release() {
        // Everything the new page loads has settled first, so nothing answers after the read.
        for (let quiet = 0; quiet < 10;) {
          quiet = pending.size === 0 ? quiet + 1 : 0
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
        // The read reaches the server now, with the cookie it was sent with; its answer, cookies
        // and all, is what the page receives.
        const headers = { ...held!.request().headers(), cookie: `adonis-session=${sent.value}` }
        const response = await held!.fetch({ headers, maxRedirects: 0 })
        await held!.fulfill({ response })
        const status = await page.evaluate<number>('window.__late')
        await page.unroute(pattern)
        return status
      },
    }
  }

  /** From the member's page (already open, so a read held there is not cancelled). */
  async function startImpersonation(page: Page) {
    await page.getByRole('button', { name: 'انتحال الحساب', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: `انتحال حساب ${member.fullName}` })
    await dialog
      .getByLabel('سبب الانتحال', { exact: true })
      .fill('مراجعة تدوير الجلسة في اختبار المتصفح')
    await dialog.getByRole('button', { name: 'بدء الانتحال', exact: true }).click()
    await page.getByText(`أنت تتصفح باسم ${member.fullName}`).waitFor()
  }

  test('ending impersonation keeps the administrator signed in', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(admin)
    const page = await visit(`/admin/users/${member.id}`)
    await startImpersonation(page)
    const late = await holdBackgroundRead(page)
    await page.getByRole('button', { name: 'إنهاء الانتحال', exact: true }).click()
    await page.waitForURL(`**/admin/users/${member.id}`)
    await page.getByRole('heading', { name: member.fullName!, exact: true }).waitFor()
    assert.notEqual(await late.release(), 0, 'the late read was answered')
    await page.goto('/admin/users')
    assert.equal(new URL(page.url()).pathname, '/admin/users', 'still signed in')
    assert.equal(await page.getByText('أنت تتصفح باسم').count(), 0)
  }).timeout(60_000)

  test('starting impersonation keeps the impersonated session', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(admin)
    const page = await visit(`/admin/users/${member.id}`)
    const late = await holdBackgroundRead(page)
    await startImpersonation(page)
    assert.notEqual(await late.release(), 0, 'the late read was answered')
    await page.goto('/')
    assert.equal(new URL(page.url()).pathname, '/', 'still signed in')
    await page.locator('main h1').waitFor()
    assert.equal(
      await page.getByText(`أنت تتصفح باسم ${member.fullName}`).count(),
      1,
      'still the impersonated session, not the old one'
    )
    await page.getByRole('button', { name: 'إنهاء الانتحال', exact: true }).click()
    await page.waitForURL(`**/admin/users/${member.id}`)
  }).timeout(60_000)

  test('signing in keeps the new session', async ({ visit, assert }) => {
    const page = await visit('/login')
    await page.locator('#email').waitFor()
    const late = await holdBackgroundRead(page)
    await page.locator('#email').fill(member.email)
    await page.locator('#password').fill(password)
    await page.getByRole('button', { name: 'دخول', exact: true }).click()
    await page.waitForURL((url) => url.pathname !== '/login')
    assert.notEqual(await late.release(), 0, 'the late read was answered')
    await page.goto('/notifications')
    assert.equal(new URL(page.url()).pathname, '/notifications', 'still signed in')
  }).timeout(60_000)

  test('an administrator-revoked session still ends at once', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(member)
    const page = await visit('/notifications')
    await knex()('user_sessions')
      .where({ user_id: member.id })
      .whereNull('revoked_at')
      .update({ revoked_at: knex().fn.now() })
    await page.goto('/notifications')
    assert.equal(new URL(page.url()).pathname, '/login', 'a revoked session is signed out')
  }).timeout(60_000)
})
