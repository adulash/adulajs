import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import User from '#models/user'
import { adula } from '#services/adula'

const TEST_KEY = 'test-key-not-real'
/** The opened provider key, as only the server-side client sees it. */
const storedKey = () =>
  adula()
    .assistantSettings.runtime()
    .then((runtime) => runtime.key)
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
    await page
      .getByTestId('assistant-key-state')
      .getByText('مفتاح محفوظ', { exact: true })
      .waitFor()
    assert.notInclude(await page.content(), TEST_KEY)
    await page.getByRole('button', { name: 'تعديل الإعداد', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'إعداد المساعد' })
    assert.equal(await dialog.getByLabel('معرّف النموذج').inputValue(), 'test/model')
    // The key comes first; the provider address is not an owner setting.
    await dialog.getByRole('group', { name: 'مفتاح OpenRouter (API key)' }).waitFor()
    assert.equal(await dialog.getByText('عنوان المزوّد').count(), 0)
    assert.equal(await dialog.locator('input[type="url"], #assistant-url').count(), 0)
  })

  test('an unchanged settings dialog closes at once by Escape, the close button and «إلغاء»', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(admin)
    const page = await visit('/admin/assistant')
    const open = page.getByRole('button', { name: 'تعديل الإعداد', exact: true })
    const dialog = page.getByRole('dialog', { name: 'إعداد المساعد' })
    const asked = page.getByRole('dialog', { name: 'إغلاق النموذج؟' })

    await open.click()
    await dialog.waitFor()
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached' })

    await open.click()
    await dialog.getByRole('button', { name: 'إغلاق', exact: true }).click()
    await dialog.waitFor({ state: 'detached' })

    // Typing and then restoring the original value is still clean.
    await open.click()
    const model = dialog.getByLabel('معرّف النموذج')
    await model.fill('test/other')
    await model.fill('test/model')
    await dialog.getByRole('button', { name: 'إلغاء', exact: true }).click()
    await dialog.waitFor({ state: 'detached' })

    // Opening the key field without typing changes nothing either.
    await open.click()
    await dialog.getByRole('button', { name: 'تغيير المفتاح', exact: true }).click()
    await page.mouse.click(5, 5)
    await dialog.waitFor({ state: 'detached' })
    assert.equal(await asked.count(), 0)
  })

  test('a changed settings dialog asks before closing and keeps the stored values', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(admin)
    const page = await visit('/admin/assistant')
    const dialog = page.getByRole('dialog', { name: 'إعداد المساعد' })
    const asked = page.getByRole('dialog', { name: 'إغلاق النموذج؟' })
    await page.getByRole('button', { name: 'تعديل الإعداد', exact: true }).click()
    await dialog.getByLabel('معرّف النموذج').fill('test/changed')

    await page.keyboard.press('Escape')
    await asked.waitFor()
    await asked.getByRole('button', { name: 'متابعة التحرير', exact: true }).click()
    await asked.waitFor({ state: 'detached' })
    assert.equal(await dialog.getByLabel('معرّف النموذج').inputValue(), 'test/changed')

    await dialog.getByRole('button', { name: 'إلغاء', exact: true }).click()
    await asked.getByRole('button', { name: 'إغلاق دون حفظ', exact: true }).click()
    await dialog.waitFor({ state: 'detached' })
    const stored = await adula().assistantSettings.read()
    assert.equal(stored.model, 'test/model')

    // A typed key alone is a change too.
    await page.getByRole('button', { name: 'تعديل الإعداد', exact: true }).click()
    await dialog.getByRole('button', { name: 'تغيير المفتاح', exact: true }).click()
    await dialog.getByLabel('مفتاح OpenRouter (API key)').fill('test-key-typed-not-saved')
    await dialog.getByRole('button', { name: 'إغلاق', exact: true }).click()
    await asked.waitFor()
    await asked.getByRole('button', { name: 'إغلاق دون حفظ', exact: true }).click()
    await dialog.waitFor({ state: 'detached' })
    assert.equal(await storedKey(), TEST_KEY)
  })

  // A desktop screen and a phone (375×812): the footer stays put and only the body scrolls.
  for (const [width, height] of [
    [1440, 900],
    [375, 812],
  ] as const) {
    test(`the settings dialog keeps its footer in view and scrolls its body at ${width}×${height}`, async ({
      browserContext,
      visit,
      assert,
    }) => {
      await browserContext.loginAs(admin)
      const page = await visit('/admin/assistant')
      await page.setViewportSize({ width, height })
      await page.getByRole('button', { name: 'تعديل الإعداد', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'إعداد المساعد' })
      const save = dialog.getByRole('button', { name: 'حفظ', exact: true })
      await save.waitFor()
      // The long dialog pattern (ADR 016): Save sits in the fixed footer, inside the dialog and
      // the viewport and clickable before any scrolling.
      const inView = async () => {
        const box = (await save.boundingBox())!
        const frame = (await dialog.boundingBox())!
        return (
          box.y >= frame.y &&
          box.y + box.height <= frame.y + frame.height &&
          box.y + box.height <= height
        )
      }
      assert.isTrue(await inView())
      assert.deepEqual(
        await dialog
          .locator('[data-slot="long-dialog-footer"]')
          .getByRole('button')
          .allInnerTexts(),
        ['إلغاء', 'حفظ']
      )
      await save.click({ trial: true, timeout: 2000 })
      // Only the body scrolls: it is taller than its box, and reaching the last field moves
      // the body, not the footer.
      type Metrics = { scrollHeight: number; clientHeight: number; scrollTop: number }
      const metrics = () =>
        page.evaluate(`(() => {
          const body = document.querySelector('[data-slot="long-dialog-body"]')
          return { scrollHeight: body.scrollHeight, clientHeight: body.clientHeight, scrollTop: body.scrollTop }
        })()`) as Promise<Metrics>
      const before = await metrics()
      assert.isAbove(before.scrollHeight, before.clientHeight)
      const footerBefore = (await save.boundingBox())!.y
      const title = dialog.getByRole('heading', { name: 'إعداد المساعد' })
      const headerBefore = (await title.boundingBox())!.y
      const last = dialog.getByLabel('السماح باقتراح التعديلات')
      await last.scrollIntoViewIfNeeded()
      assert.isTrue(await last.isVisible())
      const after = await metrics()
      assert.isAbove(after.scrollTop, 0)
      assert.equal((await save.boundingBox())!.y, footerBefore)
      assert.equal((await title.boundingBox())!.y, headerBefore)
      assert.isTrue(await inView())
    })
  }

  // Last: it deletes the key the other tests use (group.setup stores it again next run).
  test('the OpenRouter key is entered, replaced and deleted in the settings dialog', async ({
    browserContext,
    visit,
    assert,
  }) => {
    const REPLACEMENT = 'test-key-browser-replacement'
    await browserContext.loginAs(admin)
    const page = await visit('/admin/assistant')
    await page.getByRole('button', { name: 'تعديل الإعداد', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'إعداد المساعد' })
    const keyGroup = dialog.getByRole('group', { name: 'مفتاح OpenRouter (API key)' })
    await keyGroup.getByText('مفتاح محفوظ', { exact: true }).waitFor()

    await keyGroup.getByRole('button', { name: 'تغيير المفتاح', exact: true }).click()
    const field = dialog.getByLabel('مفتاح OpenRouter (API key)')
    assert.equal(await field.getAttribute('type'), 'password')
    assert.equal(await field.inputValue(), '')
    await field.fill(REPLACEMENT)
    await dialog.getByRole('button', { name: 'حفظ', exact: true }).click()
    await dialog.waitFor({ state: 'detached' })
    await page.getByText('تم حفظ الإعداد والمفتاح مشفّرًا.').first().waitFor()
    assert.equal(await storedKey(), REPLACEMENT)
    assert.notInclude(await page.content(), REPLACEMENT)

    // Two requests: when the key is stored but the rest is refused, the dialog says so and
    // the page shows the stored key.
    const SECOND = 'test-key-browser-second'
    await page.getByRole('button', { name: 'تعديل الإعداد', exact: true }).click()
    await keyGroup.getByRole('button', { name: 'تغيير المفتاح', exact: true }).click()
    await field.fill(SECOND)
    await dialog.getByLabel('معرّف النموذج').fill('not a model!')
    await dialog.getByRole('button', { name: 'حفظ', exact: true }).click()
    await dialog
      .getByRole('alert')
      .getByText(/^حُفظ المفتاح، وتعذر حفظ بقية الإعداد/)
      .waitFor()
    assert.equal(await storedKey(), SECOND)
    const refused = await adula().assistantSettings.read()
    assert.equal(refused.model, 'test/model')
    await keyGroup.getByText('مفتاح محفوظ', { exact: true }).waitFor()
    // The model field still holds the refused value, so leaving asks first.
    await dialog.getByRole('button', { name: 'إلغاء', exact: true }).click()
    await page.getByRole('button', { name: 'إغلاق دون حفظ', exact: true }).click()
    await dialog.waitFor({ state: 'detached' })

    // Deleting the key is a card action outside the dialog, confirmed as destructive.
    await page.getByRole('button', { name: 'حذف المفتاح', exact: true }).click()
    const danger = page
      .getByRole('dialog', { name: 'حذف مفتاح OpenRouter؟' })
      .getByRole('button', { name: 'حذف المفتاح', exact: true })
    assert.equal(await danger.getAttribute('data-variant'), 'destructive')
    await danger.click()
    await page.getByText('تم حذف المفتاح وإيقاف المساعد.').first().waitFor()
    await page
      .getByTestId('assistant-key-state')
      .getByText('لا يوجد مفتاح', { exact: true })
      .waitFor()
    assert.isNull(await storedKey())
    const afterDelete = await adula().assistantSettings.read()
    assert.isFalse(afterDelete.enabled)
    // With no key the dialog offers the empty write-only field, and its label names it.
    await page.getByRole('button', { name: 'إعداد المساعد', exact: true }).click()
    assert.equal(await dialog.getByLabel('مفتاح OpenRouter (API key)').inputValue(), '')
  })
})
