import { test } from '@japa/runner'
import { createHash, randomUUID } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import mail from '@adonisjs/mail/services/main'
import limiter from '@adonisjs/limiter/services/main'
import { SMTPTransport } from '@adonisjs/mail/transports/smtp'
import User from '#models/user'
import { smtpSink } from '../helpers/smtp.js'

const password = 'e2e-invitation-password-123'

test.group('User invitation E2E through browser and SMTP', (group) => {
  group.each.setup(async () => {
    await limiter.clear(['memory'])
  })

  for (const authority of ['administrator', 'delegated'] as const) {
    test(`${authority} invites through SMTP; recipient accepts, logs in and cannot invite others`, async ({
      visit,
      assert,
    }) => {
      const knex = db.connection().getWriteClient()
      const version = await knex.raw('SHOW server_version_num')
      assert.isAtLeast(Number(version.rows[0].server_version_num), 170000)
      assert.isBelow(Number(version.rows[0].server_version_num), 180000)
      const suffix = randomUUID()
      const sender = await User.create({
        fullName: 'مرسل الدعوة',
        email: `sender-${suffix}@example.test`,
        password,
      })
      const [role] = await knex('roles')
        .insert({ name: `invite-e2e-${suffix}` })
        .returning('id')
      await knex('role_rules').insert({
        role_id: role.id,
        subject: authority === 'administrator' ? 'all' : 'core.users',
        action: authority === 'administrator' ? 'manage' : 'invite',
      })
      await knex('user_roles').insert({ role_id: role.id, user_id: sender.id })
      const recipient = `recipient-${suffix}@example.test`
      const sink = await smtpSink()
      const previous = mail.config.mailers.smtp
      try {
        await mail.close('smtp')
        mail.config.mailers.smtp = () =>
          new SMTPTransport({ host: '127.0.0.1', port: sink.port, secure: false, ignoreTLS: true })

        const page = await visit('/login')
        await page.setViewportSize({ width: 1280, height: 720 })
        await page.getByLabel('البريد الإلكتروني', { exact: true }).fill(sender.email)
        await page.getByLabel('كلمة المرور', { exact: true }).fill(password)
        await page.getByRole('button', { name: 'دخول', exact: true }).click()
        await page.waitForURL((url) => url.pathname === '/')
        await page
          .getByRole('link', { name: 'دعوة مستخدم', exact: true })
          .filter({ visible: true })
          .click()
        const form = page.getByRole('dialog')
        await form.getByLabel('الاسم الكامل').fill('المستخدم المدعو')
        await form.getByLabel('البريد الإلكتروني').fill(recipient)
        await form.getByRole('button', { name: 'إرسال الدعوة', exact: true }).click()
        // The workspace shows the result as a flash message, once.
        const sent = page.getByText('تم إرسال الدعوة بالبريد.', { exact: false })
        await sent.first().waitFor()
        assert.equal(await sent.count(), 1)

        assert.lengthOf(sink.messages, 1)
        const [headers, ...body] = sink.messages[0].split('\r\n\r\n')
        assert.include(headers, recipient)
        assert.match(headers, /Content-Transfer-Encoding: base64/i)
        const delivered = Buffer.from(body.join('\r\n\r\n'), 'base64').toString('utf8')
        const link = delivered.match(/https?:\/\/[^\s]+\/invitations\/[\w-]{43}/)?.[0]
        assert.exists(link)
        const invitationPath = new URL(link!).pathname
        const token = invitationPath.split('/').pop()!
        const pending = await knex('user_invitations').where('email', recipient).first()
        assert.equal(pending.token_hash, createHash('sha256').update(token).digest('hex'))
        assert.isUndefined(await knex('users').where('email', recipient).first())

        // Use the real logout UI, then open the exact path received over SMTP as a guest.
        await page.goto('/')
        await page.getByRole('button', { name: 'قائمة الحساب', exact: true }).click()
        await page.getByRole('menuitem', { name: 'تسجيل الخروج', exact: true }).click()
        await page.waitForURL('**/login')
        await page.goto(invitationPath)
        const acceptance = page.getByRole('dialog')
        await acceptance.getByLabel('كلمة المرور', { exact: true }).fill(password)
        await acceptance.getByLabel('تأكيد كلمة المرور').fill('mismatched-password')
        await acceptance.getByRole('button', { name: 'إنشاء حسابي', exact: true }).click()
        await acceptance
          .getByRole('alert')
          .getByText('يجب أن تتطابق كلمتا المرور', { exact: true })
          .waitFor()
        await acceptance.getByLabel('تأكيد كلمة المرور').fill(password)
        await acceptance.getByRole('button', { name: 'إنشاء حسابي', exact: true }).click()
        await page.waitForURL('**/login')
        await page.goto(invitationPath)
        await page.getByRole('alert').getByText('الدعوة غير صالحة', { exact: false }).waitFor()
        await page.goto('/login')
        await page.getByLabel('البريد الإلكتروني', { exact: true }).fill(recipient)
        await page.getByLabel('كلمة المرور', { exact: true }).fill(password)
        await page.getByRole('button', { name: 'دخول', exact: true }).click()
        await page.waitForURL((url) => url.pathname === '/')
        assert.equal(await page.getByRole('link', { name: 'دعوة مستخدم', exact: true }).count(), 0)
        const denied = await page.goto('/users/invite')
        assert.equal(denied?.status(), 403)
        const user = await User.findByOrFail('email', recipient)
        assert.lengthOf(await knex('user_roles').where('user_id', user.id), 0)
        assert.lengthOf(
          await knex('activities').where({
            resource: 'core.users',
            record_id: user.id,
            action: 'invitation_accepted',
          }),
          1
        )
      } finally {
        await mail.close('smtp')
        mail.config.mailers.smtp = previous
        await sink.close()
      }
    })
  }
})
