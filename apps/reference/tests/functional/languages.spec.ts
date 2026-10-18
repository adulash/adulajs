import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import { arabicMessages, englishMessages } from 'adula'
import { seedActor, type UiActor } from '#tests/helpers/ui_fixtures'

const json = { Accept: 'application/json' }
const html = { Accept: 'text/html' }

test.group('Optional interface languages', (group) => {
  let english: UiActor
  let arabic: UiActor
  const rules = [
    { subject: 'customers', action: 'manage' },
    { subject: 'order_receipts', action: 'manage' },
  ]
  group.setup(async () => {
    english = await seedActor(rules)
    arabic = await seedActor(rules)
    english.user.language = 'en'
    await english.user.save()
  })
  // The opt-in of config/adula.ts; off by default, so every other test sees Arabic.
  group.each.setup(() => {
    const configured = app.config.get('adula.languages')
    app.config.set('adula.languages', ['ar', 'en'])
    return () => app.config.set('adula.languages', configured)
  })

  test('a user with English gets English framework strings and ltr while another gets Arabic', async ({
    client,
    assert,
  }) => {
    const englishPage = await client
      .get('/resources/customers')
      .loginAs(english.user)
      .headers(html)
      .withInertia()
    englishPage.assertStatus(200)
    const props = englishPage.body().props
    assert.equal(props.locale, 'en')
    assert.equal(props.dir, 'ltr')
    assert.deepEqual(
      props.languages.map((language: { code: string }) => language.code),
      ['ar', 'en']
    )
    assert.equal(
      props.messages[arabicMessages['ui.language.title']],
      englishMessages['ui.language.title']
    )
    // label.en where the resource defines it, label.ar where it does not.
    const labels = Object.fromEntries(
      props.navigation.map((entry: { name: string; label: string }) => [entry.name, entry.label])
    )
    assert.equal(labels.customers, 'Customers')
    assert.equal(labels.order_receipts, 'إيصالات الطلبات')
    assert.equal(props.view.resource.label, 'Customers')

    const arabicPage = await client
      .get('/resources/customers')
      .loginAs(arabic.user)
      .headers(html)
      .withInertia()
    arabicPage.assertStatus(200)
    assert.equal(arabicPage.body().props.locale, 'ar')
    assert.equal(arabicPage.body().props.dir, 'rtl')
    assert.deepEqual(arabicPage.body().props.messages, {})
    assert.equal(arabicPage.body().props.view.resource.label, 'العملاء')

    // The document itself follows the language.
    const englishHtml = await client.get('/resources/customers').loginAs(english.user).headers(html)
    assert.include(englishHtml.text(), '<html lang="en" dir="ltr">')
    const arabicHtml = await client.get('/resources/customers').loginAs(arabic.user).headers(html)
    assert.include(arabicHtml.text(), '<html lang="ar" dir="rtl">')

    // Framework errors: AdulaError and VineJS validation messages.
    const missing = await client
      .get('/resources/no_such_resource')
      .loginAs(english.user)
      .headers(json)
    missing.assertStatus(404)
    assert.equal(missing.body().error.message, englishMessages['errors.E_NOT_FOUND.2'])
    const missingArabic = await client
      .get('/resources/no_such_resource')
      .loginAs(arabic.user)
      .headers(json)
    assert.equal(missingArabic.body().error.message, 'الكيان غير موجود')
  })

  test('validation messages follow the language and an Arabic-only resource validates', async ({
    client,
    assert,
  }) => {
    for (const [actor, expected] of [
      [english, englishMessages['validation.required']],
      [arabic, arabicMessages['validation.required']],
    ] as const) {
      const response = await client
        .post('/resources/order_receipts')
        .loginAs(actor.user)
        .withCsrfToken()
        .headers(json)
        .json({ orgUnitId: actor.orgUnitId })
      response.assertStatus(422)
      assert.include(JSON.stringify(response.body()), expected)
    }
    // The resource without label.en renders and saves for both users.
    for (const actor of [english, arabic]) {
      const page = await client
        .get('/resources/order_receipts')
        .loginAs(actor.user)
        .headers(html)
        .withInertia()
      page.assertStatus(200)
      assert.equal(page.body().props.view.resource.label, 'إيصالات الطلبات')
      const scan = page
        .body()
        .props.view.resource.fields.find((field: { key: string }) => field.key === 'scan')
      assert.deepEqual(scan.label, { ar: 'صورة الإيصال' })
      const created = await client
        .post('/resources/order_receipts')
        .loginAs(actor.user)
        .withCsrfToken()
        .headers(json)
        .json({ reference: `R-${actor.user.id}`, orgUnitId: actor.orgUnitId })
      created.assertStatus(201)
    }
  })

  test('the profile setting stores an enabled language only, and a disabled one falls back to Arabic', async ({
    client,
    assert,
  }) => {
    const member = await seedActor([{ subject: 'customers', action: 'view' }])
    const chosen = await client
      .put('/account/language')
      .loginAs(member.user)
      .withCsrfToken()
      .redirects(0)
      .form({ language: 'en' })
    chosen.assertStatus(302)
    await member.user.refresh()
    assert.equal(member.user.language, 'en')
    const profile = await client
      .get('/account/profile')
      .loginAs(member.user)
      .headers(html)
      .withInertia()
    assert.equal(profile.body().props.locale, 'en')

    const refused = await client
      .put('/account/language')
      .loginAs(member.user)
      .withCsrfToken()
      .redirects(0)
      .form({ language: 'de' })
    refused.assertStatus(302)
    await member.user.refresh()
    assert.equal(member.user.language, 'en')

    // The administrator turns English off: the stored preference stays, Arabic shows.
    app.config.set('adula.languages', ['ar'])
    const fallback = await client
      .get('/account/profile')
      .loginAs(member.user)
      .headers(html)
      .withInertia()
    assert.equal(fallback.body().props.locale, 'ar')
    assert.equal(fallback.body().props.dir, 'rtl')
    assert.lengthOf(fallback.body().props.languages, 1)
    const blocked = await client
      .put('/account/language')
      .loginAs(arabic.user)
      .withCsrfToken()
      .redirects(0)
      .form({ language: 'en' })
    blocked.assertStatus(302)
    await arabic.user.refresh()
    assert.equal(arabic.user.language, 'ar')
  })
})
