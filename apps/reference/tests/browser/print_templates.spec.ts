import { test } from '@japa/runner'
import { join } from 'node:path'
import { adula } from '#services/adula'
import { screenshotDir, seedActor, type UiActor } from '#tests/helpers/ui_fixtures'

test.group('Print templates browser acceptance', (group) => {
  let owner: UiActor
  let id: number
  group.setup(async () => {
    owner = await seedActor([{ subject: 'all', action: 'manage' }], { fullName: 'سارة المحاسبة' })
    const saved = await adula().resources.save('orders', await adula().actors.load(owner.user.id), {
      notes: 'طلب فاتورة المتصفح',
      total: '1250000',
      orgUnitId: owner.orgUnitId,
      lines: [{ description: 'جهاز طباعة', quantity: 3 }],
    })
    id = Number(saved.id)
  })

  test('open an order, choose the invoice template in the print dialog and get the invoice', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(owner.user)
    const page = await visit(`/resources/orders/${id}`)
    await page.getByRole('button', { name: 'طباعة', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'طباعة السجل' })
    await dialog.waitFor()
    await dialog.getByRole('radio', { name: 'فاتورة الطلب' }).click()
    // PDF is offered only when GOTENBERG_URL is configured.
    assert.isTrue(await dialog.getByRole('radio', { name: 'PDF' }).isDisabled())
    const opened = browserContext.waitForEvent('page')
    await dialog.getByRole('link', { name: 'فتح للطباعة' }).click()
    const invoice = await opened
    await invoice.waitForLoadState()
    assert.include(invoice.url(), `/resources/orders/${id}/print?template=invoice`)
    await invoice.getByRole('heading', { name: 'فاتورة الطلب' }).waitFor()
    await invoice.getByText('جهاز طباعة').waitFor()
    await invoice.getByText('إجمالي الكميات').waitFor()
    assert.include(await invoice.content(), '12,500.00')
    await invoice.screenshot({ path: join(await screenshotDir(), 'print-template-invoice.png') })
  })

  test('an administrator creates, previews and revises a template, then prints an order with it', async ({
    browserContext,
    visit,
    assert,
  }) => {
    const shots = await screenshotDir()
    const key = `delivery_${Date.now()}`
    const alerts: string[] = []
    browserContext.on('page', (opened) =>
      opened.on('dialog', (dialog) => {
        alerts.push(dialog.message())
        void dialog.dismiss()
      })
    )
    await browserContext.loginAs(owner.user)
    const page = await visit('/admin/print-templates')
    page.on('dialog', (dialog) => {
      alerts.push(dialog.message())
      void dialog.dismiss()
    })
    await page.getByRole('button', { name: 'قالب جديد' }).click()
    const editor = page.getByRole('dialog', { name: 'قالب طباعة جديد' })
    await editor.waitFor()
    await editor.getByRole('combobox', { name: 'الكيان' }).click()
    await page.getByRole('option', { name: 'الطلبات', exact: true }).click()
    await editor.getByLabel('المفتاح').fill(key)
    await editor.getByLabel('اسم القالب').fill('إشعار تسليم')
    await editor.getByLabel('الترويسة').fill('{{company}} — إشعار رقم {{id}}')
    // Hostile markup an administrator might paste: none of it may stay active.
    await editor
      .getByLabel('متن القالب')
      .fill(
        '<h1>إشعار تسليم</h1><p>{{field.notes}}</p><table class="lines">{{#each lines.lines}}<tr><td>{{rowNumber}}</td><td>{{row.description}}</td></tr>{{/each}}</table>' +
          '<script>alert(1)</script><img src=x onerror=alert(1)><style>@import url(http://evil)</style><div style="background:url(http://evil)">x</div>'
      )
    await editor.getByLabel('رقم سجل المعاينة').fill(String(id))
    await editor.getByRole('button', { name: 'معاينة' }).click()
    const preview = editor.frameLocator('iframe[title="معاينة قالب الطباعة"]')
    await preview.getByRole('heading', { name: 'إشعار تسليم' }).waitFor()
    await preview.getByText('جهاز طباعة').waitFor()
    await page.screenshot({
      path: join(shots, 'print-templates-editor-preview.png'),
      fullPage: true,
    })
    await editor.getByRole('button', { name: 'إنشاء القالب' }).click()
    await editor.waitFor({ state: 'hidden' })
    await page.getByRole('button', { name: 'تعديل إشعار تسليم' }).waitFor()

    await page.getByRole('button', { name: 'تعديل إشعار تسليم' }).click()
    const revise = page.getByRole('dialog', { name: 'تعديل قالب الطباعة' })
    await revise.waitFor()
    await revise.getByLabel('اسم القالب').fill('إشعار التسليم')
    await revise.getByRole('button', { name: 'حفظ نسخة جديدة' }).click()
    await revise.waitFor({ state: 'hidden' })
    await page.getByRole('button', { name: 'سجل نسخ إشعار التسليم' }).click()
    const history = page.getByRole('dialog', { name: 'نسخ القالب' })
    await history.getByText('v2', { exact: true }).waitFor()
    await history.getByText('v1', { exact: true }).waitFor()
    const stored = await history.locator('pre').first().textContent()
    assert.notInclude(stored ?? '', '<script')
    assert.notInclude(stored ?? '', 'alert(')
    assert.notInclude(stored ?? '', 'onerror')
    assert.notInclude(stored ?? '', 'evil')
    await page.screenshot({ path: join(shots, 'print-templates-history.png'), fullPage: true })
    await page.keyboard.press('Escape')
    await history.waitFor({ state: 'hidden' })
    await page.screenshot({ path: join(shots, 'print-templates-list.png'), fullPage: true })

    await page.goto(`/resources/orders/${id}`)
    await page.getByRole('button', { name: 'طباعة', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'طباعة السجل' })
    await dialog.getByRole('radio', { name: 'إشعار التسليم' }).click()
    const opened = browserContext.waitForEvent('page')
    await dialog.getByRole('link', { name: 'فتح للطباعة' }).click()
    const printed = await opened
    await printed.waitForLoadState()
    assert.include(printed.url(), `template=${key}`)
    await printed.getByRole('heading', { name: 'إشعار تسليم' }).waitFor()
    await printed.getByText('جهاز طباعة').waitFor()
    await printed.getByText(`إشعار رقم ${id}`).waitFor()
    const html = await printed.content()
    for (const banned of ['<script', 'alert(', 'onerror', '<img', 'evil', '@import', 'url('])
      assert.notInclude(html.slice(html.indexOf('<body')), banned, banned)
    await printed.screenshot({ path: join(shots, 'print-templates-printed.png'), fullPage: true })
    assert.deepEqual(alerts, [])
  })
})
