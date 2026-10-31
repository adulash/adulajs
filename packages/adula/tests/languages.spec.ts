import { test } from '@japa/runner'
import { BaseModel } from '@adonisjs/lucid/orm'
import {
  AdulaError,
  CatalogMessagesProvider,
  ResourceRegistry,
  arabicMessages,
  clientMessages,
  currentLanguage,
  defineResource,
  enabledLanguages,
  englishMessages,
  installCatalogMessages,
  labelText,
  languageDirection,
  localizeText,
  openApiDocument,
  registerLanguage,
  resolveLanguage,
  runWithLanguage,
  translate,
} from '../index.js'
import type { RecordData } from '../index.js'

registerLanguage('en', englishMessages, { name: 'English' })

test.group('Message catalog', () => {
  test('Arabic is the base: every key resolves, other languages fall back to it', ({ assert }) => {
    assert.equal(translate('errors.E_NOT_FOUND.1', 'ar'), 'السجل غير موجود')
    assert.equal(translate('errors.E_NOT_FOUND.1', 'en'), englishMessages['errors.E_NOT_FOUND.1'])
    // A registered language without the key, and an unknown language, show Arabic.
    registerLanguage(
      'fr',
      { 'validation.required': 'Ce champ est obligatoire' },
      { name: 'Français' }
    )
    assert.equal(translate('validation.required', 'fr'), 'Ce champ est obligatoire')
    assert.equal(translate('errors.E_NOT_FOUND.1', 'fr'), 'السجل غير موجود')
    assert.equal(translate('errors.E_NOT_FOUND.1', 'de'), 'السجل غير موجود')
    assert.throws(() => translate('errors.NO_SUCH_KEY', 'ar'), /Unknown message key/)
    // Placeholders interpolate in every language.
    assert.equal(translate('validation.min', 'ar', { min: 3 }), 'يجب ألا تقل القيمة عن 3')
    assert.equal(translate('validation.min', 'en', { min: 3 }), 'The value must be at least 3')
  })

  test('the bundled English catalog only uses Arabic keys and registration is validated', ({
    assert,
  }) => {
    for (const key of Object.keys(englishMessages))
      assert.isTrue(Object.hasOwn(arabicMessages, key), key)
    assert.throws(() => registerLanguage('ar', {}, { name: 'x' }), /base language/)
    assert.throws(
      () => registerLanguage('xx', { 'no.such': 'x' }, { name: 'X' }),
      /unknown message key/
    )
    assert.throws(
      () => registerLanguage('xx', { 'validation.required': '' }, { name: 'X' }),
      /empty message/
    )
    assert.throws(() => registerLanguage('EN!', {}, { name: 'X' }), /Invalid language code/)
    assert.throws(() => registerLanguage('xx', {}, { name: ' ' }), /display name/)
  })

  test('enabled languages put Arabic first and a disabled preference resolves to Arabic', ({
    assert,
  }) => {
    assert.deepEqual(enabledLanguages(), [{ code: 'ar', name: 'العربية', dir: 'rtl' }])
    assert.deepEqual(
      enabledLanguages(['en', 'ar']).map((language) => [language.code, language.dir]),
      [
        ['ar', 'rtl'],
        ['en', 'ltr'],
      ]
    )
    assert.throws(() => enabledLanguages(['de']), /not registered/)
    assert.equal(resolveLanguage('en', ['ar', 'en']), 'en')
    assert.equal(resolveLanguage('en', ['ar']), 'ar')
    assert.equal(resolveLanguage('de', ['ar', 'de']), 'ar')
    assert.equal(resolveLanguage(null, ['ar', 'en']), 'ar')
    assert.equal(languageDirection('en'), 'ltr')
    assert.equal(languageDirection('ar'), 'rtl')
  })

  test('older Arabic text is translated by exact match and stays byte-identical in Arabic', ({
    assert,
  }) => {
    const arabic = arabicMessages['errors.E_DUPLICATE']
    assert.strictEqual(localizeText(arabic, 'ar'), arabic)
    assert.equal(localizeText(arabic, 'en'), englishMessages['errors.E_DUPLICATE'])
    assert.equal(localizeText('نص لا يعرفه الكتالوج', 'en'), 'نص لا يعرفه الكتالوج')
    assert.deepEqual(clientMessages('ar'), {})
    const ui = clientMessages('en')
    assert.equal(ui[arabicMessages['ui.language.title']], englishMessages['ui.language.title'])
    assert.isFalse(Object.hasOwn(ui, arabic))
  })

  test('the request language reaches AdulaError and validation messages', async ({ assert }) => {
    assert.equal(currentLanguage(), 'ar')
    const arabic = new AdulaError(404, 'E_NOT_FOUND', 'السجل غير موجود')
    assert.equal(arabic.message, 'السجل غير موجود')
    assert.equal(arabic.messageKey, 'errors.E_NOT_FOUND.1')
    const english = await runWithLanguage('en', async () => {
      await Promise.resolve()
      return new AdulaError(404, 'E_NOT_FOUND', 'السجل غير موجود')
    })
    assert.equal(english.message, englishMessages['errors.E_NOT_FOUND.1'])
    // An unknown language runs as Arabic.
    assert.equal(runWithLanguage('de', currentLanguage), 'ar')

    const provider = new CatalogMessagesProvider()
    const field = { name: 'title' }
    assert.equal(provider.getMessage('raw', 'required', field), 'هذا الحقل مطلوب')
    assert.equal(
      provider.getMessage('raw', 'maxLength', field, { max: 5 }),
      'عدد الأحرف يتجاوز الحد المسموح (5)'
    )
    assert.equal(
      runWithLanguage('en', () => provider.getMessage('raw', 'maxLength', field, { max: 5 })),
      'Enter at most 5 characters'
    )
    // A rule without a catalog entry keeps its own message.
    assert.equal(provider.getMessage('رسالة القاعدة', 'customRule', field), 'رسالة القاعدة')
    // …interpolated the way VineJS's default provider does it.
    assert.equal(
      provider.getMessage(
        'The {{ field }} field must start with {{ substring }}',
        'startsWith',
        field,
        {
          substring: 'INV-',
        }
      ),
      'The title field must start with INV-'
    )
    assert.equal(
      provider.getMessage('{{ field }} في {{ values }} \\{{ literal }}', 'custom', field, {
        values: ['أ', 'ب'],
      }),
      'title في أ، ب {{ literal }}'
    )
    // A text the catalog knows is translated even when a rule supplies it.
    assert.equal(
      runWithLanguage('en', () =>
        provider.getMessage(arabicMessages['errors.E_DUPLICATE'], 'unique', field)
      ),
      englishMessages['errors.E_DUPLICATE']
    )
  })

  test('installCatalogMessages switches default validators and keeps custom providers', ({
    assert,
  }) => {
    const original = { name: 'vine default' }
    const custom = { name: 'custom' }
    const vine = { messagesProvider: original as unknown }
    const plain = { messagesProvider: original as unknown }
    const own = { messagesProvider: custom as unknown }
    const provider = installCatalogMessages(vine, [{ validator: plain }, { validator: own }])
    assert.instanceOf(provider, CatalogMessagesProvider)
    assert.strictEqual(vine.messagesProvider, provider)
    assert.strictEqual(plain.messagesProvider, provider)
    assert.strictEqual(own.messagesProvider, custom)
  })
})

test.group('Arabic-only labels', () => {
  const base = {
    name: 'notes',
    label: { ar: 'الملاحظات' },
    model: BaseModel,
    scoped: false,
    fields: {
      body: { type: 'text', label: { ar: 'النص' }, required: true },
      title: { type: 'string', label: { ar: 'العنوان', en: 'Title' } },
    },
    list: ['title'],
    form: ['title', 'body'],
    show: ['title', 'body'],
    actions: ['view', 'create'],
    validator: {
      async validate(data: unknown) {
        const record = data as RecordData
        if (!record.body) throw new AdulaError(422, 'E_FIELD_INVALID', 'قيمة غير صالحة')
        return record
      },
    },
  } as const

  test('a resource without label.en is defined, registered, described and validated', async ({
    assert,
  }) => {
    const notes = defineResource(base)
    const registry = new ResourceRegistry().register([
      {
        name: 'notebook',
        label: { ar: 'الدفتر' },
        dependsOn: [],
        resources: [notes],
        lookups: { note_kind: [{ key: 'memo', label: { ar: 'مذكرة' } }] },
      },
    ])
    assert.equal(registry.get('notes').label.ar, 'الملاحظات')
    // label.<lang> falls back to label.ar.
    assert.equal(labelText(notes.label, 'en'), 'الملاحظات')
    assert.equal(labelText(notes.fields.title.label, 'en'), 'Title')
    assert.equal(labelText(notes.fields.title.label, 'ar'), 'العنوان')
    // The English API document falls back to the Arabic label.
    const document = openApiDocument(registry, {
      title: 'Notes',
      version: '1',
      serverUrl: 'http://localhost',
    })
    assert.include(JSON.stringify(document.paths), 'الملاحظات')
    await assert.rejects(() => notes.validator!.validate({ title: 'x' }), /قيمة غير صالحة/)
    assert.deepEqual(await notes.validator!.validate({ body: 'نص' }), { body: 'نص' })
  })

  test('Arabic stays required and a named language cannot be empty', ({ assert }) => {
    assert.throws(
      () => defineResource({ ...base, label: { ar: '' } } as never),
      /notes: label needs Arabic text/
    )
    assert.throws(
      () => defineResource({ ...base, label: { ar: 'الملاحظات', en: '' } }),
      /en is optional but cannot be empty/
    )
    assert.throws(
      () =>
        defineResource({
          ...base,
          fields: { ...base.fields, body: { type: 'text', label: { en: 'Body' } } },
        } as never),
      /body: label needs Arabic text/
    )
  })
})
