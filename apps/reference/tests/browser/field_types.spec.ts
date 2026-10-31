import { test } from '@japa/runner'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import db from '@adonisjs/lucid/services/db'
import { adula } from '#services/adula'
import { screenshotDir, seedActor, type UiActor } from '#tests/helpers/ui_fixtures'

const knex = () => db.connection().getWriteClient()
// The server tsconfig omits the DOM lib; this runs inside the page through evaluate().
type Styled = {
  ownerDocument: {
    defaultView: { getComputedStyle: (element: Styled) => { paddingRight: string } }
  }
}
// Distinct supplier codes within a run (the code is unique per organization unit).
let serial = Date.now() % 9000
const nextCode = () => `SUP-${1000 + (serial++ % 9000)}`

/**
 * The suppliers fixture declares every 2.2 field type (ADR 045). The generated form offers a
 * widget for each, prefills declared defaults, hides fields whose visibleWhen does not hold,
 * and the details page renders the stored canonical values.
 */
test.group('Field type widgets in the generated UI', (group) => {
  let admin: UiActor
  let raw: string
  let services: string
  let shots: string
  group.setup(async () => {
    admin = await seedActor([{ subject: 'all', action: 'manage' }], { fullName: 'مدير الموردين' })
    const runtime = adula()
    const actor = await runtime.actors.load(admin.user.id)
    const unique = randomUUID().slice(0, 6)
    raw = `مواد خام ${unique}`
    services = `خدمات لوجستية ${unique}`
    for (const name of [raw, services])
      await runtime.resources.save('supply_categories', actor, { name, orgUnitId: admin.orgUnitId })
    shots = await screenshotDir()
  })

  test('creates and edits a supplier through every new widget', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(admin.user)
    const page = await visit('/resources/suppliers/create')
    await page.getByRole('heading', { name: 'إضافة مورد', exact: true }).waitFor()
    const field = (name: string) => page.getByLabel(name, { exact: true })
    const kind = page.getByRole('combobox', { name: 'نوع المورد', exact: true })

    // Declared defaults prefill the create form.
    await kind.getByText('محلي', { exact: true }).waitFor()
    assert.equal(await field('مدة السداد (يوم)').inputValue(), '30')
    assert.equal(await field('نسبة الخصم').inputValue(), '0.00')
    assert.isTrue(await page.getByRole('checkbox', { name: 'تحويل بنكي' }).isChecked())
    assert.isFalse(await page.getByRole('checkbox', { name: 'نقدًا' }).isChecked())

    // visibleWhen: the commercial register belongs to local suppliers, the country to foreign ones.
    await field('السجل التجاري').waitFor()
    assert.equal(await field('الدولة').count(), 0)
    await kind.click()
    await page.getByRole('option', { name: 'دولي', exact: true }).click()
    await field('الدولة').fill('ألمانيا')
    assert.equal(await field('السجل التجاري').count(), 0)
    await kind.click()
    await page.getByRole('option', { name: 'محلي', exact: true }).click()
    assert.equal(await field('الدولة').count(), 0)

    const code = nextCode()
    const name = `شركة التوريد ${randomUUID().slice(0, 6)}`
    await field('رمز المورد').fill(code)
    await field('اسم المورد').fill(name)
    await field('السجل التجاري').fill('1010123456')
    assert.equal(await field('البريد الإلكتروني').getAttribute('type'), 'email')
    assert.equal(await field('البريد الإلكتروني').getAttribute('dir'), 'ltr')
    await field('البريد الإلكتروني').fill(' Sales@United.Example ')
    assert.equal(await field('الهاتف').getAttribute('type'), 'tel')
    await field('الهاتف').fill('٠٥٠ ١٢٣ ٤٥٦٧')
    assert.equal(await field('الموقع الإلكتروني').getAttribute('type'), 'url')
    await field('الموقع الإلكتروني').fill('https://united.example/about')
    // A long amount never runs under the currency or percent suffix: the suffix sits inside
    // the input's padding on the same physical side.
    const suffixClear = async (fieldLabel: string) => {
      const input = field(fieldLabel)
      const suffix = input.locator('xpath=following-sibling::span')
      const [box, mark, padding] = await Promise.all([
        input.boundingBox(),
        suffix.boundingBox(),
        input.evaluate((element: Styled) =>
          Number.parseFloat(
            element.ownerDocument.defaultView.getComputedStyle(element).paddingRight
          )
        ),
      ])
      assert.exists(box)
      assert.exists(mark)
      assert.isAtLeast(
        mark!.x,
        box!.x + box!.width - padding - 1,
        `${fieldLabel}: suffix outside padding`
      )
      assert.isAtMost(
        mark!.x + mark!.width,
        box!.x + box!.width,
        `${fieldLabel}: suffix outside input`
      )
    }
    await field('حد الائتمان').fill('123456789012.50')
    await field('نسبة الخصم').fill('99.99')
    await suffixClear('حد الائتمان')
    await suffixClear('نسبة الخصم')
    await field('حد الائتمان').screenshot({ path: join(shots, 'field-types-money-suffix.png') })
    await field('حد الائتمان').fill('5000')
    // Arabic-Indic digits and the Arabic decimal separator normalize to the field's scale.
    await field('نسبة الخصم').fill('٢٫٥')
    await field('نسبة الخصم').blur()
    assert.equal(await field('نسبة الخصم').inputValue(), '2.50')
    await page.getByText('٪', { exact: true }).first().waitFor()
    await field('التقييم').fill('٤٫٥')
    await field('التقييم').blur()
    assert.equal(await field('التقييم').inputValue(), '4.5')
    await page.getByRole('checkbox', { name: 'نقدًا' }).click()
    const categories = page.getByRole('combobox', { name: 'فئات التوريد', exact: true })
    await categories.click()
    await page.getByPlaceholder('ابحث في السجلات المرتبطة').fill(raw)
    await page.getByRole('option', { name: raw, exact: true }).click()
    await page.getByPlaceholder('ابحث في السجلات المرتبطة').fill(services)
    await page.getByRole('option', { name: services, exact: true }).click()
    // While the list is open it sits below the chosen badges and never covers them.
    const chosen = page.getByRole('list', { name: 'المحدد في فئات التوريد' })
    const search = page.getByPlaceholder('ابحث في السجلات المرتبطة')
    const apart = async () => {
      const [list, input, content] = await Promise.all([
        chosen.boundingBox(),
        search.boundingBox(),
        page.locator('[data-slot="popover-content"]').boundingBox(),
      ])
      assert.exists(list)
      assert.exists(input)
      assert.exists(content)
      for (const box of [input!, content!])
        assert.isTrue(
          box.y >= list!.y + list!.height || box.y + box.height <= list!.y,
          `popover overlaps the chosen badges: ${JSON.stringify({ list, box })}`
        )
    }
    await apart()
    await page.screenshot({ path: join(shots, 'field-types-picker-open.png') })
    await page.setViewportSize({ width: 375, height: 812 })
    await categories.scrollIntoViewIfNeeded()
    await apart()
    await page.screenshot({ path: join(shots, 'field-types-picker-open-mobile.png') })
    await page.keyboard.press('Escape')
    await page.locator('[data-slot="popover-content"]').waitFor({ state: 'detached' })
    await page.screenshot({ path: join(shots, 'field-types-form-mobile.png'), fullPage: true })
    await page.setViewportSize({ width: 1280, height: 720 })
    await chosen.getByText(raw).waitFor()
    await page.assertVisible(categories.getByText('2 محدد'))
    await page.screenshot({ path: join(shots, 'field-types-form.png'), fullPage: true })
    await page.getByRole('button', { name: 'حفظ السجل', exact: true }).click()
    await page.waitForURL(/\/resources\/suppliers\/\d+$/)

    const stored = await knex()('suppliers').where({ code, org_unit_id: admin.orgUnitId }).first()
    assert.exists(stored)
    assert.include(stored, {
      name,
      kind: 'local',
      commercial_register: '1010123456',
      country: null,
      email: 'sales@united.example',
      phone: '0501234567',
      website: 'https://united.example/about',
      credit_limit: '500000',
      payment_terms_days: 30,
      discount_rate: '2.50',
      rating: '4.5',
    })
    assert.deepEqual(stored.payment_methods, ['bank', 'cash'])
    const linked = async () =>
      knex()('suppliers_categories')
        .join('supply_categories', 'supply_categories.id', 'supply_categories_id')
        .where('suppliers_id', stored.id)
        .orderBy('supply_categories.name')
        .pluck('supply_categories.name')
    assert.sameMembers(await linked(), [raw, services])

    // The details render each type: links, the percent sign, option and record badges.
    await page.getByRole('heading', { name: 'تفاصيل · الموردون' }).waitFor()
    const mail = page.getByRole('link', { name: 'sales@united.example', exact: true })
    assert.equal(await mail.getAttribute('href'), 'mailto:sales@united.example')
    const phone = page.getByRole('link', { name: '0501234567', exact: true })
    assert.equal(await phone.getAttribute('href'), 'tel:0501234567')
    const site = page.getByRole('link', { name: 'https://united.example/about', exact: true })
    assert.equal(await site.getAttribute('rel'), 'noopener noreferrer')
    assert.equal(await site.getAttribute('target'), '_blank')
    await page.assertVisible(page.locator('dd', { hasText: '2.50٪' }))
    await page.assertVisible(page.locator('dd', { hasText: /^4\.5$/ }))
    await page.assertVisible(page.locator('dd', { hasText: '5,000.00' }))
    await page.assertVisible(page.locator('dd').getByText('محلي', { exact: true }))
    await page.assertVisible(page.locator('dd').getByText('تحويل بنكي', { exact: true }))
    await page.assertVisible(page.locator('dd').getByText('نقدًا', { exact: true }))
    await page.assertVisible(page.locator('dd').getByText(raw, { exact: true }))
    await page.assertVisible(page.locator('dd').getByText(services, { exact: true }))
    await page.screenshot({ path: join(shots, 'field-types-show.png'), fullPage: true })

    // Editing: stored values come back into the widgets; switching the kind swaps the fields.
    await page.getByRole('link', { name: 'تعديل السجل', exact: true }).click()
    await page.waitForURL(/\/edit$/)
    await page.getByRole('heading', { name: 'تعديل مورد', exact: true }).waitFor()
    assert.equal(await field('نسبة الخصم').inputValue(), '2.50')
    assert.equal(await field('التقييم').inputValue(), '4.5')
    assert.isTrue(await page.getByRole('checkbox', { name: 'نقدًا' }).isChecked())
    await page.getByRole('button', { name: `إزالة ${raw}`, exact: true }).click()
    await page.getByRole('checkbox', { name: 'نقدًا' }).click()
    await page.getByRole('checkbox', { name: 'شيك' }).click()
    await kind.click()
    await page.getByRole('option', { name: 'دولي', exact: true }).click()
    assert.equal(await field('السجل التجاري').count(), 0)
    await field('الدولة').fill('ألمانيا')
    await field('التقييم').fill('3')
    await page.getByRole('button', { name: 'حفظ السجل', exact: true }).click()
    await page.waitForURL(new RegExp(`/resources/suppliers/${stored.id}$`))
    await page.locator('dd').getByText('دولي', { exact: true }).waitFor()

    const edited = await knex()('suppliers').where({ id: stored.id }).first()
    assert.include(edited, {
      kind: 'international',
      country: 'ألمانيا',
      // Hidden by visibleWhen: the server clears it on update.
      commercial_register: null,
      rating: '3.0',
      discount_rate: '2.50',
    })
    assert.deepEqual(edited.payment_methods, ['bank', 'cheque'])
    assert.deepEqual(await linked(), [services])
    await page.assertVisible(page.locator('dd', { hasText: /^3\.0$/ }))
    await page.assertVisible(page.locator('dd').getByText('شيك', { exact: true }))
    assert.equal(await page.locator('dd').getByText(raw, { exact: true }).count(), 0)
  })

  test('the list renders and filters by the new types', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(admin.user)
    const runtime = adula()
    const actor = await runtime.actors.load(admin.user.id)
    const [category] = await knex()('supply_categories').where({ name: services }).pluck('id')
    const name = `مورد القائمة ${randomUUID().slice(0, 6)}`
    await runtime.resources.save('suppliers', actor, {
      code: nextCode(),
      name,
      kind: 'local',
      commercialRegister: '2020123456',
      rating: '2.5',
      paymentMethods: ['cheque'],
      categories: [category],
      orgUnitId: admin.orgUnitId,
    })
    const page = await visit('/resources/suppliers?filters[paymentMethods]=cheque')
    const row = page.getByRole('row').filter({ hasText: name })
    await row.waitFor()
    await page.assertVisible(row.getByText('شيك', { exact: true }))
    await page.assertVisible(row.getByText(services, { exact: true }))
    await page.assertVisible(row.getByText('2.5', { exact: true }))
    await page.goto('/resources/suppliers?filters[paymentMethods]=cash')
    // The list-layer filter (ADR 046) opens from a button named after the field.
    await page.getByRole('button', { name: 'تصفية طرق الدفع', exact: true }).waitFor()
    assert.equal(await page.getByRole('row').filter({ hasText: name }).count(), 0)
  })
})
