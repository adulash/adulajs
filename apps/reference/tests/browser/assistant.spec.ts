import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import User from '#models/user'
import { adula } from '#services/adula'

const TEST_KEY = 'test-key-not-real'
const notesOf = (id: number) =>
  db
    .connection()
    .getWriteClient()('orders')
    .where('id', id)
    .first()
    .then((row) => row?.notes)

test.group('Assistant panel in the browser (ADR 052)', (group) => {
  let admin: User
  let member: User
  let plain: User
  let orderId: number
  let server: Server
  const replies: Record<string, unknown>[] = []
  const unique = randomUUID().replaceAll('-', '').slice(0, 10)
  const knex = () => db.connection().getWriteClient()
  const text = (content: string) => ({ choices: [{ message: { role: 'assistant', content } }] })
  const propose = (notes: string, version: number) => ({
    choices: [
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: `call_${randomUUID()}`,
              type: 'function',
              function: {
                name: 'adula_propose_write',
                arguments: JSON.stringify({
                  resource: 'orders',
                  action: 'update',
                  id: orderId,
                  input: { notes, version },
                }),
              },
            },
          ],
        },
      },
    ],
  })

  group.setup(async () => {
    // A local fake of OpenRouter's chat-completions API; never a real key or host.
    server = createServer((request, response) => {
      request.resume()
      request.on('end', () => {
        const reply = replies.shift() ?? text('لا مزيد.')
        response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(reply))
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const password = 'browser-test-only-password'
    admin = await User.create({ email: `ai-browser-admin-${unique}@example.test`, password })
    member = await User.create({ email: `ai-browser-member-${unique}@example.test`, password })
    plain = await User.create({ email: `ai-browser-plain-${unique}@example.test`, password })
    const [unit] = await knex()('org_units')
      .insert({ name: 'وحدة المساعد', type: 'root', path: `ai${unique}` })
      .returning('id')
    const [adminRole, memberRole] = await knex()('roles')
      .insert([
        { name: `ai-browser-admin-${unique}`, permission_level: 1 },
        { name: `ai-browser-member-${unique}`, permission_level: 0 },
      ])
      .returning('id')
    await knex()('role_rules').insert([
      { role_id: adminRole.id, subject: 'all', action: 'manage' },
      { role_id: memberRole.id, subject: 'orders', action: 'view' },
      { role_id: memberRole.id, subject: 'orders', action: 'update' },
      { role_id: memberRole.id, subject: 'core.ai', action: 'use' },
    ])
    await knex()('user_roles').insert([
      { user_id: admin.id, role_id: adminRole.id },
      { user_id: member.id, role_id: memberRole.id },
    ])
    await knex()('user_org_units').insert([
      { user_id: admin.id, org_unit_id: unit.id },
      { user_id: member.id, org_unit_id: unit.id },
      { user_id: plain.id, org_unit_id: unit.id },
    ])
    const runtime = adula()
    const actor = await runtime.actors.load(admin.id)
    const record = await runtime.resources.save('orders', actor, {
      orgUnitId: unit.id,
      notes: 'ملاحظة أصلية',
    })
    orderId = Number(record.id)
    const port = (server.address() as AddressInfo).port
    await runtime.assistantSettings.save(actor, {
      baseUrl: `http://127.0.0.1:${port}/api/v1`,
      model: 'test/model',
      allowWriteProposals: true,
    })
    await runtime.assistantSettings.setKey(actor, TEST_KEY)
    await runtime.assistantSettings.save(actor, { enabled: true })
  })
  group.teardown(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  test('users without the permission see no assistant', async ({ browserContext, visit }) => {
    await browserContext.loginAs(plain)
    const page = await visit('/account/profile')
    await page.getByRole('heading').first().waitFor()
    await page
      .getByRole('button', { name: 'المساعد الذكي', exact: true })
      .waitFor({ state: 'detached' })
  })

  test('the notice comes first, replies are plain text and proposals run only on confirm', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(member)
    const page = await visit('/account/profile')
    await page.getByRole('button', { name: 'المساعد الذكي', exact: true }).click()
    const panel = page.getByRole('dialog', { name: 'المساعد الذكي' })
    await panel.getByText('ما الذي يُرسل إلى مزوّد خارجي؟').waitFor()
    // While the panel is open the launcher takes the top bar's active state (text-primary).
    const launcherColors = async () =>
      (await page.evaluate(`(() => {
      const probe = document.createElement('span')
      probe.className = 'text-primary'
      document.body.append(probe)
      const primary = getComputedStyle(probe).color
      probe.remove()
      const launcher = document.querySelector('[data-testid="assistant-launcher"]')
      return { primary, launcher: getComputedStyle(launcher).color }
    })()`)) as { primary: string; launcher: string }
    // The button eases its colors (transition-colors), so read again until it settles.
    let colors = await launcherColors()
    for (let tries = 0; tries < 20 && colors.launcher !== colors.primary; tries++) {
      await page.waitForTimeout(100)
      colors = await launcherColors()
    }
    assert.equal(colors.launcher, colors.primary)
    await panel.getByRole('button', { name: 'فهمت وأوافق', exact: true }).click()

    replies.push(text('**لا** يوجد <b>تنسيق</b>'))
    await panel.getByLabel('سؤالك').fill('مرحبا')
    await panel.getByRole('button', { name: 'إرسال', exact: true }).click()
    // Markup from the model is shown as text, never rendered.
    await panel.getByText('**لا** يوجد <b>تنسيق</b>', { exact: true }).waitFor()
    assert.equal(await panel.locator('b').count(), 0)

    // The daily budget names its unit in the Arabic form its number takes (CLDR plural rules).
    const remaining = (await panel.getByText(/^المتبقي اليوم: /).textContent()) ?? ''
    const count = Number(remaining.match(/\d+/)?.[0] ?? Number.NaN)
    const unit = {
      zero: `${count} رمز`,
      one: 'رمز واحد',
      two: 'رمزان',
      few: `${count} رموز`,
      many: `${count} رمزًا`,
      other: `${count} رمز`,
    }[new Intl.PluralRules('ar').select(count)]
    assert.equal(remaining, `المتبقي اليوم: ${unit}`)

    const current = await knex()('orders').where('id', orderId).first()
    replies.push(propose('ملاحظة مرفوضة', Number(current.version)), text('اقترحت التعديل.'))
    await panel.getByLabel('سؤالك').fill('عدّل الملاحظة')
    await panel.getByRole('button', { name: 'إرسال', exact: true }).click()
    await panel.getByRole('button', { name: 'مراجعة', exact: true }).click()
    const review = page.getByRole('dialog', { name: 'مراجعة اقتراح المساعد' })
    await review.getByText('ملاحظة مرفوضة', { exact: true }).waitFor()
    await review.getByText('ملاحظة أصلية', { exact: true }).waitFor()
    await review.getByRole('button', { name: 'رفض الاقتراح', exact: true }).click()
    await panel.getByText('رُفض الاقتراح ولم يُنفَّذ.').waitFor()
    assert.equal(await notesOf(orderId), 'ملاحظة أصلية')

    replies.push(propose('ملاحظة معتمدة', Number(current.version)), text('اقترحت التعديل.'))
    await panel.getByLabel('سؤالك').fill('عدّلها مرة أخرى')
    await panel.getByRole('button', { name: 'إرسال', exact: true }).click()
    await panel.getByRole('button', { name: 'مراجعة', exact: true }).click()
    await review.getByRole('button', { name: 'تنفيذ', exact: true }).click()
    await page.getByText('نُفّذ الاقتراح.').first().waitFor()
    assert.equal(await notesOf(orderId), 'ملاحظة معتمدة')
  })

  test('the administration shows whether a key is set, never the key', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(admin)
    const page = await visit('/admin/assistant')
    await page.getByTestId('assistant-key-state').getByText('مُعَدّ', { exact: true }).waitFor()
    assert.notInclude(await page.content(), TEST_KEY)
    await page.getByRole('button', { name: 'تعديل الإعداد', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'إعداد المساعد' })
    assert.equal(await dialog.getByLabel('معرّف النموذج').inputValue(), 'test/model')
  })

  test('the settings dialog scrolls to a usable save button at 1440×900', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(admin)
    const page = await visit('/admin/assistant')
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByRole('button', { name: 'تعديل الإعداد', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'إعداد المساعد' })
    const save = dialog.getByRole('button', { name: 'حفظ', exact: true })
    await save.waitFor()
    // The dialog itself scrolls (the shared long-dialog pattern, as in mail-setup); once
    // scrolled to, Save lies inside the dialog and the viewport and nothing covers it.
    await save.scrollIntoViewIfNeeded()
    const box = (await save.boundingBox())!
    const frame = (await dialog.boundingBox())!
    assert.isAtLeast(box.y, frame.y)
    assert.isAtMost(box.y + box.height, frame.y + frame.height)
    assert.isAtMost(box.y + box.height, 900)
    await save.click({ trial: true, timeout: 2000 })
  })
})
