import { test } from '@japa/runner'
import mail from '@adonisjs/mail/services/main'
import { randomUUID } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import User from '#models/user'
import { UserInvitations } from 'adula'
import UserInvitationNotification from '#mails/user_invitation_notification'
import app from '@adonisjs/core/services/app'
import { mkdir } from 'node:fs/promises'

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
      await page.getByRole('link', { name: 'إضافة مستخدم', exact: true }).click()
      const dialog = page.getByRole('dialog')
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

  test('storage setup guide lists ordered steps and copies variable names', async ({
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
    assert.include(await steps.nth(0).innerText(), 'أضف المتغيرات التالية')
    assert.include(await steps.nth(2).innerText(), 'فحص التخزين')
    assert.include(await steps.nth(3).innerText(), 'node ace adula:storage:migrate local s3')
    const variables = steps.nth(0).getByRole('listitem')
    assert.equal(await variables.count(), 6)
    assert.include(await variables.last().innerText(), 'AWS_ENDPOINT')
    assert.include(await variables.last().innerText(), 'اختياري')
    await dialog.getByRole('button', { name: 'نسخ DRIVE_DISK=s3', exact: true }).click()
    await dialog.getByRole('button', { name: 'نسخ AWS_REGION', exact: true }).click()
    assert.deepEqual(
      await page.evaluate(() => (globalThis as unknown as { copied: string[] }).copied),
      ['DRIVE_DISK=s3', 'AWS_REGION']
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
    assert.equal(await dialog.getByTestId('mail-setup-steps').locator(':scope > li').count(), 4)
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
    await page.getByRole('link', { name: 'المستخدمون', exact: true }).click()
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
    await page
      .locator('aside')
      .getByRole('link', { name: /^الإدارة/ })
      .click()
    // A section entry, then its page as a sub-tab (#157): the shell stays mounted throughout.
    await page
      .getByRole('navigation', { name: 'التنقل الإداري' })
      .getByRole('link', { name: 'الأشخاص والصلاحيات' })
      .click()
    await page
      .getByRole('navigation', { name: 'صفحات القسم: الأشخاص والصلاحيات' })
      .getByRole('link', { name: 'الأدوار والصلاحيات', exact: true })
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
      // Administration is one entry outside the admin area, with a badge for failures.
      assert.equal(await page.getByRole('link', { name: 'الأدوار والصلاحيات' }).count(), 0)
      const entry = page.locator('aside').getByRole('link', { name: /^الإدارة/ })
      await page.assertVisible(entry.getByLabel(/تنبيه إداري/))
      await entry.click()
      // Inside the administration: one entry per section (#157); the failure badge moves to
      // the operations section, whose pages are sub-tabs inside the page.
      const areas = page.getByRole('navigation', { name: 'التنقل الإداري' })
      for (const category of ['الأشخاص والصلاحيات', 'الإعدادات', 'المراقبة والتشغيل'])
        await areas.getByRole('link', { name: new RegExp(`^${category}`) }).waitFor()
      const operations = areas.getByRole('link', { name: /^المراقبة والتشغيل/ })
      await page.assertVisible(operations.getByLabel(/تنبيه إداري/))
      await operations.click()
      await page
        .getByRole('navigation', { name: 'صفحات القسم: المراقبة والتشغيل' })
        .getByRole('link', { name: 'تدفقات فاشلة' })
        .waitFor()

      // A member without create rights sees neither imports nor administration.
      await browserContext.clearCookies()
      await browserContext.loginAs(member)
      const plain = await visit('/')
      await plain.getByRole('navigation', { name: 'التنقل الرئيسي' }).waitFor()
      assert.equal(await plain.getByRole('link', { name: 'الاستيراد' }).count(), 0)
      assert.equal(
        await plain
          .locator('aside')
          .getByRole('link', { name: /^الإدارة/ })
          .count(),
        0
      )
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
})
