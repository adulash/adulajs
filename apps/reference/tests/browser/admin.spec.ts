import { test } from '@japa/runner'
import mail from '@adonisjs/mail/services/main'
import { randomUUID } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import User from '#models/user'
import { UserInvitations } from 'adula'
import UserInvitationNotification from '#mails/user_invitation_notification'
import app from '@adonisjs/core/services/app'
import { mkdir } from 'node:fs/promises'

/** The browser global read inside page.evaluate (the test project has no DOM types). */
type Styled = { getComputedStyle: (element: unknown) => { listStyleType: string } }
type Shaped = {
  getComputedStyle: (element: unknown) => { borderTopLeftRadius: string; whiteSpace: string }
}
type Measured = {
  getBoundingClientRect: () => { height: number; left: number; right: number }
  firstElementChild: { scrollWidth: number; clientWidth: number } | null
}

test.group('Administration screens in the browser', (group) => {
  let admin: User
  let member: User
  let roleId: number
  let rootId: number
  let rootPath: string
  let movingId: number
  let targetId: number
  const unique = randomUUID().replaceAll('-', '').slice(0, 10)
  const knex = () => db.connection().getWriteClient()
  const moving = `وحدة النقل ${unique}`

  group.setup(async () => {
    admin = await User.create({
      fullName: 'مدير المتصفح',
      email: `browser-admin-${unique}@example.test`,
      password: 'browser-test-only-password',
    })
    member = await User.create({
      fullName: 'عضو المتصفح',
      email: `browser-member-${unique}@example.test`,
      password: 'browser-test-only-password',
    })
    rootPath = `br${unique}`
    const [root] = await knex()('org_units')
      .insert({ name: 'جذر المتصفح', type: 'root', path: rootPath })
      .returning('id')
    rootId = root.id
    const [source] = await knex()('org_units')
      .insert({ name: moving, type: 'department', path: `${rootPath}.tmp1${unique}` })
      .returning('id')
    movingId = source.id
    await knex()('org_units')
      .where('id', movingId)
      .update({ parent_id: rootId, path: `${rootPath}.${movingId}` })
    const [target] = await knex()('org_units')
      .insert({ name: `الوجهة ${unique}`, type: 'department', path: `${rootPath}.tmp2${unique}` })
      .returning('id')
    targetId = target.id
    await knex()('org_units')
      .where('id', targetId)
      .update({ parent_id: rootId, path: `${rootPath}.${targetId}` })
    const [adminRole] = await knex()('roles')
      .insert({ name: `browser-admin-${unique}`, permission_level: 1 })
      .returning('id')
    await knex()('role_rules').insert({ role_id: adminRole.id, subject: 'all', action: 'manage' })
    await knex()('user_roles').insert({ user_id: admin.id, role_id: adminRole.id })
    await knex()('user_org_units').insert([
      { user_id: admin.id, org_unit_id: rootId },
      { user_id: member.id, org_unit_id: rootId },
    ])
    const [role] = await knex()('roles')
      .insert({ name: `browser-role-${unique}` })
      .returning('id')
    roleId = role.id
    await knex()('user_roles').insert({ user_id: member.id, role_id: roleId })
  })

  test('invitation dialog preserves duplicate errors, sends mail and fits mobile', async ({
    browserContext,
    visit,
    assert,
  }) => {
    const { mails } = mail.fake()
    try {
      await browserContext.loginAs(admin)
      const page = await visit('/admin/users')
      // The users page offers the invitation as its primary action.
      const invite = page.locator('main').getByRole('link', { name: 'دعوة مستخدم', exact: true })
      assert.equal(await invite.getAttribute('data-variant'), 'default')
      await invite.click()
      const dialog = page.getByRole('dialog', { name: 'دعوة مستخدم' })
      await dialog.waitFor()
      // Over the users list, with an address that opens it again.
      await page.waitForURL('**/admin/users?invite=1')
      // The dialog hides the page from assistive technology, so the list is found by its markup.
      assert.isTrue(await page.locator('main table').first().isVisible())
      assert.include(await page.locator('main h1').first().innerText(), 'المستخدمون')
      // The long dialog pattern: fixed header and footer around a scrolling body.
      assert.equal(await dialog.getAttribute('data-long-dialog'), '')
      assert.equal(await dialog.locator('[data-slot="long-dialog-footer"]').count(), 1)
      // Unchanged, «إلغاء» closes at once and the address returns to the list.
      await dialog.getByRole('button', { name: 'إلغاء', exact: true }).click()
      await dialog.waitFor({ state: 'hidden' })
      assert.equal(await page.getByRole('dialog', { name: 'إغلاق النموذج؟' }).count(), 0)
      await page.waitForURL('**/admin/users')
      // The direct address opens the same dialog over the list.
      await page.goto(page.url().replace(/\/admin\/users.*$/, '/users/invite'))
      await page.waitForURL('**/admin/users?invite=1')
      await dialog.waitFor()
      await dialog.getByLabel('الاسم الكامل').fill('مستخدم الدعوة')
      await dialog.getByLabel('البريد الإلكتروني').fill(member.email)
      await dialog.getByRole('button', { name: 'إرسال الدعوة', exact: true }).click()
      await dialog.getByText('يوجد حساب بهذا البريد بالفعل', { exact: true }).waitFor()
      assert.equal(await dialog.getByLabel('الاسم الكامل').inputValue(), 'مستخدم الدعوة')
      const address = `browser-invited-${randomUUID()}@example.test`
      await dialog.getByLabel('البريد الإلكتروني').fill(address)
      await dialog.getByRole('button', { name: 'إرسال الدعوة', exact: true }).click()
      await page.getByText('تم إرسال الدعوة بالبريد.', { exact: false }).waitFor()
      mails.assertSentCount(UserInvitationNotification, 1)
      assert.isUndefined(await knex()('users').where('email', address).first())
      await page.setViewportSize({ width: 390, height: 844 })
      await dialog.evaluate(
        async (element: { getAnimations(): { finished: Promise<unknown> }[] }) => {
          await Promise.all(element.getAnimations().map((animation) => animation.finished))
        }
      )
      await mkdir(app.makePath('../../.work/screenshots'), { recursive: true })
      await page.screenshot({
        path: app.makePath('../../.work/screenshots/invite-mobile.png'),
        fullPage: true,
      })
      const bounds = await dialog.boundingBox()
      assert.isAtLeast(bounds!.x, 12)
      assert.isAtMost(bounds!.x + bounds!.width, 378)
      await dialog.getByLabel('الاسم الكامل').fill('مسودة محفوظة')
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: 'متابعة التحرير', exact: true }).click()
      assert.equal(await dialog.getByLabel('الاسم الكامل').inputValue(), 'مسودة محفوظة')
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: 'إغلاق دون حفظ', exact: true }).click()
      await page.waitForURL('**/admin/users')
    } finally {
      mail.restore()
    }
  })

  test('guest accepts an invitation in a dialog and signs in with the chosen password', async ({
    visit,
    assert,
  }) => {
    let token = ''
    const address = `accepted-${randomUUID()}@example.test`
    await new UserInvitations(knex()).invite(
      admin.id,
      { email: address, fullName: 'المستخدم الجديد' },
      async (invitation) => {
        token = invitation.token
      }
    )
    const page = await visit(`/invitations/${token}`)
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('كلمة المرور', { exact: true }).fill('browser-invitation-123')
    await dialog.getByLabel('تأكيد كلمة المرور').fill('different-password')
    const rejected = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && response.url().includes('/invitations/')
    )
    await dialog.getByRole('button', { name: 'إنشاء حسابي', exact: true }).click()
    const rejection = await rejected
    assert.equal(rejection.status(), 302)
    try {
      await dialog.getByRole('alert').first().waitFor()
    } finally {
      await page.screenshot({
        path: app.makePath('../../.work/screenshots/invitation-validation.png'),
        fullPage: true,
      })
    }
    await dialog.getByLabel('تأكيد كلمة المرور').fill('browser-invitation-123')
    await dialog.getByRole('button', { name: 'إنشاء حسابي', exact: true }).click()
    await page.waitForURL('**/login')
    const authenticated = await User.verifyCredentials(address, 'browser-invitation-123')
    assert.equal(authenticated.fullName, 'المستخدم الجديد')
    const again = await visit(`/invitations/${token}`)
    await again.getByRole('alert').getByText('الدعوة غير صالحة', { exact: false }).waitFor()
    await again.goto('/login')
    await again.getByLabel('البريد الإلكتروني', { exact: true }).fill(address)
    await again.getByLabel('كلمة المرور', { exact: true }).fill('browser-invitation-123')
    await again.getByRole('button', { name: 'دخول', exact: true }).click()
    await again.waitForURL((url) => url.pathname === '/')
  })

  test('initial setup asks for mail receipt and persists the negative response', async ({
    browserContext,
    visit,
    assert,
  }) => {
    mail.fake()
    try {
      await browserContext.loginAs(admin)
      const page = await visit('/admin/setup')
      await page.getByRole('heading', { name: 'الإعداد الأولي', exact: true }).waitFor()
      await page.getByRole('button', { name: 'إرسال بريد تجريبي', exact: true }).click()
      await page
        .getByRole('dialog')
        .getByRole('heading', { name: 'هل وصل البريد التجريبي؟' })
        .waitFor()
      assert.include(await page.getByRole('dialog').innerText(), admin.email)
      await page.getByRole('button', { name: 'لم تصل الرسالة', exact: true }).click()
      await page.getByRole('status').filter({ hasText: 'أفاد المدير بعدم وصول الرسالة' }).waitFor()
      await page.reload()
      await page.getByRole('status').filter({ hasText: 'أفاد المدير بعدم وصول الرسالة' }).waitFor()
      assert.equal(await page.getByRole('dialog').count(), 0)
    } finally {
      mail.restore()
    }
  })

  test('setup identity review uses a dialog and requires explicit approval', async ({
    browserContext,
    visit,
  }) => {
    await browserContext.loginAs(admin)
    const page = await visit('/admin/setup')
    await page.getByRole('button', { name: 'مراجعة الهوية', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'أعتمد الهوية الحالية' }).click()
    await page.getByText('اعتمد المدير الهوية الحالية', { exact: true }).waitFor()
    await page.reload()
    await page.getByText('اعتمد المدير الهوية الحالية', { exact: true }).waitFor()
  })

  test('storage setup guide lists ordered steps and copies its environment lines', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(admin)
    const page = await visit('/admin/setup')
    await page.evaluate(() => {
      const copied: string[] = []
      ;(globalThis as unknown as { copied: string[] }).copied = copied
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async (text: string) => void copied.push(text) },
      })
    })
    await page.getByRole('button', { name: 'إعداد التخزين', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('heading', { name: 'إعداد الملفات' }).waitFor()
    const steps = dialog.getByTestId('setup-guide-steps').locator(':scope > li')
    assert.equal(await steps.count(), 4)
    // Steps are numbered ١. ٢. ٣. like the page's section titles, still as an ordered list.
    for (let index = 0; index < 4; index++)
      assert.equal(
        await steps
          .nth(index)
          .evaluate(
            (item) => (globalThis as unknown as Styled).getComputedStyle(item).listStyleType
          ),
        'arabic-indic'
      )
    assert.include(await steps.nth(0).innerText(), 'أضف المتغيرات التالية')
    assert.include(await steps.nth(2).innerText(), 'فحص التخزين')
    assert.include(await steps.nth(3).innerText(), 'node ace adula:storage:migrate local s3')
    // The same copy pattern as the mail setup: environment lines in one block, copied at once;
    // the optional endpoint is commented out so an empty value never fails validation.
    const lines = [
      'DRIVE_DISK=s3',
      'AWS_ACCESS_KEY_ID=',
      'AWS_SECRET_ACCESS_KEY=',
      'AWS_REGION=',
      'S3_BUCKET=',
      '# AWS_ENDPOINT=',
    ].join('\n')
    assert.equal(await steps.nth(0).getByTestId('setup-guide-env-lines').innerText(), lines)
    const variables = steps.nth(0).getByRole('list', { name: 'المتغيرات' }).getByRole('listitem')
    assert.equal(await variables.count(), 6)
    assert.include(await variables.last().innerText(), 'AWS_ENDPOINT')
    assert.include(await variables.last().innerText(), 'اختياري')
    await steps.nth(0).getByRole('button', { name: 'نسخ الأسطر', exact: true }).click()
    await steps.nth(0).getByRole('button', { name: 'تم النسخ', exact: true }).waitFor()
    await dialog
      .getByRole('button', { name: 'نسخ node ace adula:storage:migrate local s3', exact: true })
      .click()
    assert.deepEqual(
      await page.evaluate(() => (globalThis as unknown as { copied: string[] }).copied),
      [lines, 'node ace adula:storage:migrate local s3']
    )
    assert.include(await dialog.getByRole('alert').innerText(), 'لا ينقل الملفات القائمة')
  })

  test('mail setup dialog builds provider lines to copy without any secret', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(admin)
    const page = await visit('/admin/settings')
    await page.evaluate(() => {
      const copied: string[] = []
      ;(globalThis as unknown as { copied: string[] }).copied = copied
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async (text: string) => void copied.push(text) },
      })
    })
    await page.getByRole('button', { name: 'إعداد البريد', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('heading', { name: 'إعداد البريد' }).waitFor()
    const mailSteps = dialog.getByTestId('mail-setup-steps').locator(':scope > li')
    assert.equal(await mailSteps.count(), 4)
    assert.deepEqual(
      await mailSteps.evaluateAll((items) =>
        items.map((item) => (globalThis as unknown as Styled).getComputedStyle(item).listStyleType)
      ),
      ['arabic-indic', 'arabic-indic', 'arabic-indic', 'arabic-indic']
    )
    assert.include(
      await dialog.getByTestId('mail-env-lines').innerText(),
      'SMTP_HOST=smtp.gmail.com'
    )
    await dialog.getByRole('combobox', { name: 'اختر مزود البريد:' }).click()
    await page.getByRole('option', { name: 'SendGrid', exact: true }).click()
    const lines = await dialog.getByTestId('mail-env-lines').innerText()
    assert.include(lines, 'SMTP_HOST=smtp.sendgrid.net')
    assert.include(lines, 'SMTP_PORT=587')
    assert.include(lines, 'SMTP_USERNAME=apikey')
    assert.match(lines, /^SMTP_PASSWORD=$/m)
    assert.include(await dialog.innerText(), 'مفتاح API من SendGrid')
    await dialog.getByRole('button', { name: 'نسخ الأسطر', exact: true }).click()
    const copied = await page.evaluate(() => (globalThis as unknown as { copied: string[] }).copied)
    assert.deepEqual(copied, [lines.trim()])
  })

  test('toggling a matrix cell writes the rule and the page reflects it', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(admin)
    const page = await visit(`/admin/roles/${roleId}`)
    const allow = page.getByRole('button', { name: 'سماح: المهام / عرض', exact: true })
    const deny = page.getByRole('button', { name: 'منع: المهام / عرض', exact: true })
    assert.equal(await allow.getAttribute('aria-pressed'), 'false')
    await allow.click()
    await page.getByRole('button', { name: 'تراجع', exact: true }).click()
    assert.notExists(
      await knex()('role_rules')
        .where({ role_id: roleId, subject: 'tasks', action: 'view', inverted: false })
        .first()
    )
    await allow.click()
    await page.getByRole('button', { name: 'تأكيد التغيير', exact: true }).click()
    await page.locator('button[aria-label="سماح: المهام / عرض"][aria-pressed="true"]').waitFor()
    assert.exists(
      await knex()('role_rules')
        .where({ role_id: roleId, subject: 'tasks', action: 'view', inverted: false })
        .first()
    )
    await deny.click()
    await page.getByRole('button', { name: 'تأكيد التغيير', exact: true }).click()
    await page.locator('button[aria-label="منع: المهام / عرض"][aria-pressed="true"]').waitFor()
    assert.exists(
      await knex()('role_rules')
        .where({ role_id: roleId, subject: 'tasks', action: 'view', inverted: true })
        .first()
    )
    // all, core.users and core.ai (ADR 052), then one row per registered resource subject;
    // the suppliers fixture adds two (ADR 045) and the order_documents fixture one (ADR 047).
    await page.assertElementsCount('tbody tr', 3 + 8 + 1 + 1 + 2 + 1)
    await allow.click()
    await page.getByRole('button', { name: 'تأكيد حذف الصلاحية', exact: true }).click()
    await page.locator('button[aria-label="سماح: المهام / عرض"][aria-pressed="false"]').waitFor()
    assert.notExists(
      await knex()('role_rules')
        .where({ role_id: roleId, subject: 'tasks', action: 'view', inverted: false })
        .first()
    )
  })

  test('a rule condition can name the current user on a user field', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await knex()('role_rules').insert({
      role_id: roleId,
      subject: 'order_inspections',
      action: 'update',
    })
    await browserContext.loginAs(admin)
    const page = await visit(`/admin/roles/${roleId}`)
    await page
      .getByRole('button', { name: 'تحرير قاعدة تفتيش الطلبات / تعديل', exact: true })
      .click()
    await page.getByRole('button', { name: 'إضافة شرط', exact: true }).click()
    // The current-user choice appears only for user fields and the creator/updater.
    await page.getByRole('combobox', { name: 'حقل الشرط 1', exact: true }).click()
    await page.getByRole('option', { name: 'الملاحظات', exact: true }).click()
    await page.assertNotExists(
      page.getByRole('button', { name: 'المستخدم الحالي للشرط 1', exact: true })
    )
    await page.getByRole('combobox', { name: 'حقل الشرط 1', exact: true }).click()
    await page.getByRole('option', { name: 'المفتش', exact: true }).click()
    const current = page.getByRole('button', { name: 'المستخدم الحالي للشرط 1', exact: true })
    await current.click()
    assert.equal(await current.getAttribute('aria-pressed'), 'true')
    await page.assertInputValue(
      page.getByRole('textbox', { name: 'قيمة الشرط 1', exact: true }),
      'المستخدم الحالي'
    )
    await page.getByRole('button', { name: 'حفظ القاعدة', exact: true }).click()
    await page.getByRole('button', { name: 'تأكيد التغيير', exact: true }).click()
    // The rules table names the placeholder instead of showing it as a literal value.
    await page.assertVisible(page.getByText('{"inspector":{"$eq":المستخدم الحالي}}'))
    const stored = await knex()('role_rules')
      .where({ role_id: roleId, subject: 'order_inspections', action: 'update' })
      .first()
    assert.deepEqual(stored.conditions, { inspector: { $eq: '$actor.id' } })
  })

  test('moving an org unit updates its path in the tree', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(admin)
    const page = await visit('/admin/org-units')
    await page.getByRole('combobox', { name: `نقل ${moving} إلى`, exact: true }).click()
    await page.getByRole('option', { name: new RegExp(`الوجهة ${unique}$`) }).click()
    await page.getByRole('button', { name: `نقل ${moving}`, exact: true }).click()
    const path = `${rootPath}.${targetId}.${movingId}`
    await page.getByText(path, { exact: true }).waitFor()
    const row = await knex()('org_units').where('id', movingId).first()
    assert.equal(String(row.path), path)
    assert.equal(row.parent_id, targetId)
  })

  test('own administrator grant requires confirmation and cannot be removed', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(admin)
    const assignment = await knex()('user_roles').where('user_id', admin.id).first()
    const page = await visit(`/admin/roles/${assignment.role_id}`)
    await page.getByRole('button', { name: /^تفاصيل قاعدة/ }).click()
    await page.getByRole('dialog').waitFor()
    await page.locator('[data-slot="dialog-overlay"]').click({ position: { x: 4, y: 4 } })
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    await page.getByRole('button', { name: /^حذف قاعدة/ }).click()
    await page.getByRole('button', { name: 'تأكيد حذف الصلاحية', exact: true }).click()
    await page
      .getByText(/لا يمكنك إزالة صلاحية إدارة النظام من حسابك الحالي|سيزيل آخر مدير نشط للنظام/)
      .waitFor()
    assert.exists(
      await knex()('role_rules')
        .where({ role_id: assignment.role_id, subject: 'all', action: 'manage', inverted: false })
        .first()
    )
    // Back to the users through the section's tab (ADR 049).
    await page.getByRole('tab', { name: 'المستخدمون', exact: true }).click()
    await page.getByRole('heading', { name: 'المستخدمون', exact: true }).waitFor()
  })

  test('authenticated navigation preserves the workspace and honors reduced motion', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(admin)
    const page = await visit('/')
    await page.locator('[data-workspace-shell]').waitFor()
    await page.evaluate('window.__testShell = document.querySelector("[data-workspace-shell]")')
    // A section entry, then its page as a tab (ADR 049): the shell stays mounted throughout.
    await page
      .getByRole('navigation', { name: 'التنقل الإداري' })
      .getByRole('link', { name: 'الأشخاص والصلاحيات' })
      .click()
    await page
      .getByRole('tablist', { name: 'صفحات القسم: الأشخاص والصلاحيات' })
      .getByRole('tab', { name: 'الأدوار والصلاحيات', exact: true })
      .click()
    await page.getByRole('heading', { name: 'الأدوار والصلاحيات', exact: true }).waitFor()
    assert.isTrue(
      await page.evaluate<boolean>(
        'window.__testShell === document.querySelector("[data-workspace-shell]")'
      )
    )
    await page.emulateMedia({ reducedMotion: 'reduce' })
    assert.equal(
      await page.evaluate<string>(
        'getComputedStyle(document.querySelector(".adula-page-enter")).animationName'
      ),
      'none'
    )
  })

  test('the sidebar puts daily work first and keeps administration in one categorized entry', async ({
    browserContext,
    visit,
    assert,
  }) => {
    const [failed] = await knex()('workflow_runs')
      .insert({
        id: randomUUID(),
        resource: 'orders',
        record_id: 1,
        definition: 'sidebar_probe',
        definition_version: 1,
        snapshot: JSON.stringify({ value: 'start' }),
        status: 'failed',
      })
      .returning('id')
    try {
      await browserContext.loginAs(admin)
      const page = await visit('/')
      const main = page.getByRole('navigation', { name: 'التنقل الرئيسي' })
      await main.getByRole('link', { name: 'نظرة عامة' }).waitFor()
      // «مهامي» moved beside the notification bell (#156).
      assert.equal(await main.getByRole('link', { name: /مهامي/ }).count(), 0)
      await page.getByTestId('my-tasks-button').waitFor()
      // Approvals merged into My tasks; the overview has no duplicate home link.
      assert.equal(await page.getByRole('link', { name: 'صندوق الموافقات' }).count(), 0)
      assert.equal(await page.getByRole('link', { name: 'الصفحة الرئيسية' }).count(), 0)
      // Administration is exactly two entries, inside and outside the admin area (owner's
      // review, ADR 049), with no sub-items; the alerts count sits on «الإعدادات».
      assert.equal(await page.getByRole('link', { name: 'الأدوار والصلاحيات' }).count(), 0)
      const areas = page.getByRole('navigation', { name: 'التنقل الإداري' })
      const titles = async () => {
        await areas.getByRole('link').first().waitFor()
        const texts = await areas.getByRole('link').allInnerTexts()
        return texts.map((text) => text.replace(/\d+/g, '').trim())
      }
      assert.deepEqual(await titles(), ['الأشخاص والصلاحيات', 'الإعدادات'])
      const settings = areas.getByRole('link', { name: /^الإعدادات/ })
      await page.assertVisible(settings.getByLabel(/تنبيه إداري/))
      await settings.click()
      await page.waitForURL(/\/admin\/(setup|settings)$/)
      assert.deepEqual(await titles(), ['الأشخاص والصلاحيات', 'الإعدادات'])
      // The failed workflow's count is on its own tab, which opens the failures.
      const failures = page
        .getByRole('tablist', { name: 'صفحات القسم: الإعدادات' })
        .getByRole('tab', { name: /^تدفقات فاشلة/ })
      await page.assertVisible(failures.getByLabel(/تنبيه إداري/))
      await failures.click()
      await page.waitForURL((url) => url.pathname === '/admin/workflows')
      assert.equal(await failures.getAttribute('aria-selected'), 'true')

      // A member without create rights sees neither imports nor administration.
      await browserContext.clearCookies()
      await browserContext.loginAs(member)
      const plain = await visit('/')
      await plain.getByRole('navigation', { name: 'التنقل الرئيسي' }).waitFor()
      assert.equal(await plain.getByRole('link', { name: 'الاستيراد' }).count(), 0)
      assert.equal(await plain.getByRole('navigation', { name: 'التنقل الإداري' }).count(), 0)
      assert.equal(await plain.getByRole('link', { name: /^الإعدادات/ }).count(), 0)
    } finally {
      await knex()('workflow_runs').where('id', failed.id).delete()
    }
  })

  test('an administrator adds an inbound webhook source and receives its secret once', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(admin)
    const page = await visit('/admin/webhooks')
    await page.getByRole('heading', { name: 'الروابط الواردة' }).waitFor()
    await page.getByRole('button', { name: 'إضافة مصدر وارد', exact: true }).click()
    const form = page.getByRole('dialog', { name: 'إضافة مصدر وارد' })
    await form.getByLabel('الاسم', { exact: true }).fill('مستودعات الشيفرة')
    await form.getByLabel('المفتاح في العنوان', { exact: true }).fill(`git_${unique}`)
    await form.getByRole('button', { name: 'حفظ', exact: true }).click()
    const secret = page.getByRole('dialog', { name: 'مفتاح التوقيع للمرسل' })
    await secret.waitFor()
    await secret.getByText(`/webhooks/in/git_${unique}`).waitFor()
    await secret.getByRole('button', { name: 'تم', exact: true }).click()
    await page.getByText(`POST http://`, { exact: false }).first().waitFor()
    const stored = await knex()('inbound_sources').where('key', `git_${unique}`).first()
    assert.equal(stored.name, 'مستودعات الشيفرة')
    await knex()('inbound_sources').where('id', stored.id).delete()
  })

  test('the bell shows the unread count and clears after mark-all-read', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await knex()('notifications').insert([
      { user_id: member.id, title: 'تنبيه أول', body: 'نص الإشعار' },
      { user_id: member.id, title: 'تنبيه ثانٍ', body: 'نص الإشعار' },
    ])
    await browserContext.loginAs(member)
    const page = await visit('/notifications')
    assert.equal(await page.getByTestId('unread-count').textContent(), '2')
    await page.getByRole('button', { name: 'تعيين الكل كمقروء', exact: true }).click()
    await page.getByTestId('unread-count').waitFor({ state: 'detached' })
    await page.getByText('لا إشعارات غير مقروءة', { exact: true }).waitFor()
    const unread = await knex()('notifications').where({ user_id: member.id }).whereNull('read_at')
    assert.lengthOf(unread, 0)
  })

  test('the user page starts with no role and asks a dedicated confirmation for full administration', async ({
    browserContext,
    visit,
    assert,
  }) => {
    const [ordinary] = await knex()('roles')
      .insert({ name: `browser-ordinary-${unique}` })
      .returning('id')
    const privileged = await knex()('user_roles').where('user_id', admin.id).first()
    const [privilegedRole] = await knex()('roles').where('id', privileged.role_id).select('name')
    await browserContext.loginAs(admin)
    const page = await visit(`/admin/users/${member.id}`)
    // The shell names the signed-in administrator, not the account the page shows.
    await page
      .getByRole('button', { name: 'قائمة الحساب', exact: true })
      .getByText(admin.fullName!)
      .waitFor()
    const role = page.getByRole('combobox', { name: 'الدور', exact: true })
    assert.include(await role.textContent(), 'اختر دوراً')
    const form = page.locator('form').filter({ has: role })
    const submit = form.getByRole('button', { name: 'إسناد الدور', exact: true })
    assert.isTrue(await submit.isDisabled())

    await role.click()
    await page
      .getByRole('option', { name: `${privilegedRole.name} (إدارة كاملة)`, exact: true })
      .click()
    await submit.click()
    const grant = page.getByRole('dialog', { name: 'منح الإدارة الكاملة؟' })
    await grant.waitFor()
    await grant.getByRole('button', { name: 'تراجع', exact: true }).click()
    await grant.waitFor({ state: 'hidden' })
    assert.notExists(
      await knex()('user_roles').where({ user_id: member.id, role_id: privileged.role_id }).first()
    )

    await role.click()
    await page.getByRole('option', { name: `browser-ordinary-${unique}`, exact: true }).click()
    await submit.click()
    const ordinaryDialog = page.getByRole('dialog', { name: 'إسناد الدور؟' })
    await ordinaryDialog.getByRole('button', { name: 'إسناد الدور', exact: true }).click()
    await ordinaryDialog.waitFor({ state: 'hidden' })
    await page.getByRole('cell', { name: `browser-ordinary-${unique}`, exact: true }).waitFor()
    assert.exists(
      await knex()('user_roles').where({ user_id: member.id, role_id: ordinary.id }).first()
    )

    // Access-ending actions sit in their own section, apart from the header.
    const danger = page.locator('[data-slot="card"]').filter({ hasText: 'إجراءات حساسة' })
    for (const name of ['تعطيل الحساب', 'إنهاء الجلسات', 'إلغاء جميع الرموز', 'انتحال الحساب'])
      assert.equal(await danger.getByRole('button', { name, exact: true }).count(), 1, name)
  })

  test('the activity log filters by actor name and reads changed fields', async ({
    browserContext,
    visit,
  }) => {
    const [entry] = await knex()('activities')
      .insert({
        resource: 'customers',
        record_id: 2147483001,
        actor_id: admin.id,
        action: 'update',
        changes: JSON.stringify({ fields: ['name', 'email'] }),
      })
      .returning('id')
    await knex()('field_changes').insert({
      activity_id: entry.id,
      resource: 'customers',
      record_id: 2147483001,
      field: 'email',
      before: JSON.stringify(`old-${unique}@example.test`),
      after: JSON.stringify(`new-${unique}@example.test`),
    })
    await browserContext.loginAs(admin)
    const page = await visit('/admin/activity')
    await page.getByRole('combobox', { name: 'المنفّذ', exact: true }).click()
    await page.getByRole('option', { name: admin.fullName!, exact: true }).click()
    await page.getByRole('button', { name: 'تصفية', exact: true }).click()
    await page.waitForURL((url) => url.searchParams.get('actorId') === String(admin.id))
    const row = page.getByRole('row').filter({ hasText: `new-${unique}@example.test` })
    await row.getByText('البريد الإلكتروني:', { exact: true }).waitFor()
    await row.getByText(`old-${unique}@example.test`, { exact: true }).waitFor()
    await row.getByText('العملاء', { exact: true }).waitFor()
    await row.getByText('تعديل', { exact: true }).waitFor()
  })

  test('impersonation switches the session and can be ended', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(admin)
    const page = await visit(`/admin/users/${member.id}`)
    await page.getByRole('button', { name: 'انتحال الحساب', exact: true }).click()
    // Starting asks for a written reason in a dialog; nothing starts before it is given.
    const dialog = page.getByRole('dialog', { name: `انتحال حساب ${member.fullName}` })
    await dialog.waitFor()
    const start = dialog.getByRole('button', { name: 'بدء الانتحال', exact: true })
    assert.isTrue(await start.isDisabled())
    await dialog.getByLabel('سبب الانتحال', { exact: true }).fill('قصير')
    assert.isTrue(await start.isDisabled())
    assert.lengthOf(
      await knex()('activities').where({
        resource: 'core.users',
        record_id: member.id,
        action: 'impersonate',
      }),
      0
    )
    const reason = 'مراجعة مشكلة في عرض الطلبات أبلغ عنها المستخدم'
    await dialog.getByLabel('سبب الانتحال', { exact: true }).fill(reason)
    await start.click()
    await page.getByText(`أنت تتصفح باسم ${member.fullName}`).waitFor()
    assert.equal(await page.getByRole('link', { name: 'المستخدمون', exact: true }).count(), 0)
    await page.getByRole('button', { name: 'إنهاء الانتحال', exact: true }).click()
    await page.waitForURL(`**/admin/users/${member.id}`)
    await page.getByRole('heading', { name: member.fullName!, exact: true }).waitFor()
    assert.equal(await page.getByText('أنت تتصفح باسم').count(), 0)
    const log = await knex()('activities')
      .where({ resource: 'core.users', record_id: member.id })
      .whereIn('action', ['impersonate', 'stop_impersonation'])
      .orderBy('id')
    assert.deepEqual(
      log.map((row) => row.action),
      ['impersonate', 'stop_impersonation']
    )
    assert.equal(log[0].changes.reason, reason)
    assert.isNumber(log[1].changes.durationSeconds)
  })

  test('the users table keeps long values inside its frame at 1440×900 in light and dark', async ({
    browserContext,
    visit,
    assert,
  }) => {
    const long = `${unique}-${'a'.repeat(48)}`
    const wide = await User.create({
      fullName: `مستخدم باسم طويل جدًا لاختبار التفاف الجدول ${unique}`,
      email: `very-long-address-for-the-users-table-${long}@example.test`,
      password: 'browser-test-only-password',
    })
    const [role] = await knex()('roles')
      .insert({ name: `role-with-a-very-long-name-${long}` })
      .returning('id')
    const [unit] = await knex()('org_units')
      .insert({
        name: `وحدة باسم طويل ${long}`,
        type: 'department',
        path: `${rootPath}.w${unique}`,
      })
      .returning('id')
    await knex()('user_roles').insert({ user_id: wide.id, role_id: role.id })
    await knex()('user_org_units').insert({ user_id: wide.id, org_unit_id: unit.id })
    const theme = (value: string) => ({
      key: 'preference.shell.theme',
      scope: 'user',
      scope_id: String(admin.id),
      value: JSON.stringify(value),
    })
    try {
      // The full sidebar is the default and narrows the workspace the most.
      await knex()('settings')
        .whereIn('key', ['preference.shell.sidebar', 'preference.shell.theme'])
        .where({ scope: 'user', scope_id: String(admin.id) })
        .delete()
      await browserContext.loginAs(admin)
      for (const mode of ['light', 'dark'] as const) {
        await knex()('settings')
          .insert(theme(mode))
          .onConflict(['key', 'scope', 'scope_id'])
          .merge()
        const page = await visit(`/admin/users?q=${unique}-`)
        await page.setViewportSize({ width: 1440, height: 900 })
        assert.equal(
          await page.evaluate<boolean>('document.documentElement.classList.contains("dark")'),
          mode === 'dark'
        )
        await page.locator('[data-workspace-shell][data-sidebar="expanded"]').waitFor()
        const row = page.getByRole('row').filter({ hasText: wide.email })
        await row.getByRole('link', { name: 'تفاصيل' }).waitFor()
        const sizes = await page.evaluate<{
          page: [number, number]
          table: [number, number]
          frame: [number, number]
          cells: [number, number][]
        }>(`(() => {
          const span = (el) => { const r = el.getBoundingClientRect(); return [r.left, r.right] }
          const table = document.querySelector('main table')
          const frame = table.closest('section')
          return {
            page: [document.documentElement.scrollWidth, document.documentElement.clientWidth],
            table: [table.parentElement.scrollWidth, table.parentElement.clientWidth],
            frame: span(frame),
            cells: [...table.querySelectorAll('th, td')].map(span),
          }
        })()`)
        assert.isAtMost(sizes.page[0], sizes.page[1], `${mode}: the page scrolls sideways`)
        assert.isAtMost(
          sizes.table[0],
          sizes.table[1],
          `${mode}: the table is wider than its frame`
        )
        for (const [left, right] of sizes.cells) {
          assert.isAtLeast(left, sizes.frame[0] - 1, `${mode}: a cell starts outside the frame`)
          assert.isAtMost(right, sizes.frame[1] + 1, `${mode}: a cell ends outside the frame`)
        }
        // A name longer than its cell keeps the standard pill Badge: one line, fully rounded,
        // cut with an ellipsis inside the frame, and shown in full in a Tooltip.
        const roleName = `role-with-a-very-long-name-${long}`
        const badge = row
          // TooltipTrigger replaces the Badge's data-slot; its variant attribute remains.
          .locator('[data-variant="secondary"]')
          .filter({ hasText: 'role-with-a-very-long-name' })
        const shape = await badge.evaluate((element) => {
          const style = (globalThis as unknown as Shaped).getComputedStyle(element)
          const box = (element as unknown as Measured).getBoundingClientRect()
          const text = (element as unknown as Measured).firstElementChild!
          return {
            radius: Number.parseFloat(style.borderTopLeftRadius),
            whiteSpace: style.whiteSpace,
            height: box.height,
            left: box.left,
            right: box.right,
            cut: text.scrollWidth > text.clientWidth,
          }
        })
        assert.isAtLeast(shape.radius, shape.height / 2, `${mode}: the badge stays rounded-full`)
        assert.equal(shape.whiteSpace, 'nowrap')
        assert.isTrue(shape.cut, `${mode}: the long name is cut inside its badge`)
        assert.isAtLeast(shape.left, sizes.frame[0] - 1, `${mode}: the badge starts inside`)
        assert.isAtMost(shape.right, sizes.frame[1] + 1, `${mode}: the badge ends inside`)
        await badge.hover()
        const tooltip = page.getByRole('tooltip')
        await tooltip.waitFor({ state: 'attached' })
        const tip = await tooltip.textContent()
        assert.equal(tip?.trim(), roleName)
        await mkdir(app.makePath('../../.work/screenshots'), { recursive: true })
        await page.screenshot({
          path: app.makePath(`../../.work/screenshots/admin-users-long-values-${mode}.png`),
        })
        await page.close()
      }
    } finally {
      await knex()('settings')
        .where({ key: 'preference.shell.theme', scope: 'user', scope_id: String(admin.id) })
        .delete()
      await knex()('user_roles').where('user_id', wide.id).delete()
      await knex()('user_org_units').where('user_id', wide.id).delete()
      await knex()('users').where('id', wide.id).delete()
      await knex()('roles').where('id', role.id).delete()
      await knex()('org_units').where('id', unit.id).delete()
    }
  })

  test('long dialogs keep the header and footer fixed while the body scrolls with a visible scrollbar', async ({
    browserContext,
    visit,
    assert,
  }) => {
    type Box = {
      scrollTop: number
      scrollHeight: number
      clientHeight: number
      offsetWidth: number
      clientWidth: number
    }
    const theme = (value: string) => ({
      key: 'preference.shell.theme',
      scope: 'user',
      scope_id: String(admin.id),
      value: JSON.stringify(value),
    })
    const viewports = [
      { name: 'desktop', width: 1440, height: 900 },
      { name: 'mobile', width: 375, height: 812 },
    ]
    try {
      await browserContext.loginAs(admin)
      for (const mode of ['light', 'dark'] as const) {
        await knex()('settings')
          .insert(theme(mode))
          .onConflict(['key', 'scope', 'scope_id'])
          .merge()
        for (const viewport of viewports) {
          const label = `${mode} ${viewport.name}`
          const page = await visit('/admin/setup')
          await page.setViewportSize({ width: viewport.width, height: viewport.height })
          assert.equal(
            await page.evaluate<boolean>('document.documentElement.classList.contains("dark")'),
            mode === 'dark'
          )
          const surfaces = [
            { open: 'إعداد الدخول الخارجي', title: 'الدخول الخارجي — اختياري' },
            { open: 'إعداد البريد', title: 'إعداد البريد' },
          ]
          for (const surface of surfaces) {
            await page.getByRole('button', { name: surface.open, exact: true }).click()
            const dialog = page.getByRole('dialog', { name: surface.title })
            await dialog.waitFor()
            const body = dialog.locator('[data-slot="long-dialog-body"]')
            const header = dialog.getByRole('heading', { name: surface.title })
            const footer = dialog.locator('[data-slot="long-dialog-footer"]')
            const metrics = () =>
              body.evaluate((element) => {
                const box = element as unknown as Box
                return {
                  scrollTop: box.scrollTop,
                  scrollHeight: box.scrollHeight,
                  clientHeight: box.clientHeight,
                  offsetWidth: box.offsetWidth,
                  clientWidth: box.clientWidth,
                }
              })
            const before = await metrics()
            // The scrollbar is laid out (not an idle overlay) in both themes.
            assert.isAbove(before.offsetWidth - before.clientWidth, 0, `${label}: scrollbar width`)
            // Measure after the opening animation: the box stops changing between frames.
            const settled = async (locator: typeof header) => {
              let previous = JSON.stringify(await locator.boundingBox())
              for (let attempt = 0; attempt < 50; attempt++) {
                await page.waitForTimeout(50)
                const next = JSON.stringify(await locator.boundingBox())
                if (next === previous)
                  return JSON.parse(next) as NonNullable<
                    Awaited<ReturnType<typeof locator.boundingBox>>
                  >
                previous = next
              }
              throw new Error(`${label}: the dialog kept moving`)
            }
            const headerBefore = await settled(header)
            const footerBefore = await settled(footer)
            assert.isAtMost(
              footerBefore.y + footerBefore.height,
              viewport.height,
              `${label}: footer on screen`
            )
            assert.isAtLeast(headerBefore.y, 0, `${label}: header on screen`)
            if (surface.open === 'إعداد الدخول الخارجي') {
              // This guide is taller than the dialog on both screens: only the body moves.
              assert.isAbove(
                before.scrollHeight,
                before.clientHeight,
                `${label}: ${surface.title} overflows`
              )
              await body.hover()
              await page.mouse.wheel(0, 2000)
              let after = await metrics()
              for (let attempt = 0; attempt < 20 && after.scrollTop === 0; attempt++) {
                await page.waitForTimeout(50)
                after = await metrics()
              }
              assert.isAbove(after.scrollTop, 0, `${label}: body scrolled`)
              assert.deepEqual(await header.boundingBox(), headerBefore, `${label}: header stayed`)
              assert.deepEqual(await footer.boundingBox(), footerBefore, `${label}: footer stayed`)
            }
            await footer.getByRole('button', { name: 'إغلاق', exact: true }).click()
            await dialog.waitFor({ state: 'hidden' })
          }
          await page.close()
        }
      }
    } finally {
      await knex()('settings')
        .where({ key: 'preference.shell.theme', scope: 'user', scope_id: String(admin.id) })
        .delete()
    }
  })

  test('the mail setup guide saves nothing, so it always closes at once', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(admin)
    for (const size of [
      { width: 1440, height: 900 },
      { width: 375, height: 812 },
    ]) {
      const page = await visit('/admin/settings')
      await page.setViewportSize(size)
      const dialog = page.getByRole('dialog', { name: 'إعداد البريد' })
      const confirmClose = page.getByRole('dialog', { name: 'إغلاق النموذج؟' })
      const provider = dialog.getByRole('combobox', { name: 'اختر مزود البريد:' })
      const choose = async (name: string) => {
        await provider.click()
        await page.getByRole('option', { name, exact: true }).click()
        // Let the list close first, or it takes the next Escape for itself.
        await page.getByRole('listbox').waitFor({ state: 'detached' })
        const chosen = await provider.textContent()
        assert.equal(chosen?.trim(), name)
      }
      await page.getByRole('button', { name: 'إعداد البريد', exact: true }).click()
      await dialog.waitFor()
      const first = (await provider.textContent())!.trim()
      // Unchanged: the footer's «إغلاق» closes at once.
      await dialog
        .locator('[data-slot="long-dialog-footer"]')
        .getByRole('button', { name: 'إغلاق', exact: true })
        .click()
      await dialog.waitFor({ state: 'hidden' })
      assert.equal(await confirmClose.count(), 0)
      // Another provider only changes the lines shown: Escape still closes at once, and the
      // next opening starts again from the first provider.
      await page.getByRole('button', { name: 'إعداد البريد', exact: true }).click()
      await dialog.waitFor()
      await choose('SendGrid')
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'hidden' })
      assert.equal(await confirmClose.count(), 0)
      await page.getByRole('button', { name: 'إعداد البريد', exact: true }).click()
      await dialog.waitFor()
      const reopened = await provider.textContent()
      assert.equal(reopened?.trim(), first)
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'hidden' })
      await page.close()
    }
  })
})
