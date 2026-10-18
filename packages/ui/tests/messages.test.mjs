import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import {
  arabicText,
  createTranslator,
  interpolate,
  localizedLabel,
} from '../registry/ui/message_format.ts'
import { arabicInterfaceMessages } from '../../adula/src/languages/ar_ui.ts'
import { englishInterfaceMessages } from '../../adula/src/languages/en_ui.ts'

const registryDirectory = new URL('../registry/ui/', import.meta.url)
const referenceFiles = [
  'layouts/workspace.tsx',
  'components/admin-nav.tsx',
  'components/language-setting.tsx',
  'pages/auth/login.tsx',
  'pages/home.tsx',
  'pages/errors/not_found.tsx',
  'pages/errors/server_error.tsx',
].map((path) => new URL(`../../../apps/reference/inertia/${path}`, import.meta.url))

test('Arabic users see the component text unchanged, with placeholders filled', () => {
  const t = createTranslator({})
  assert.equal(t('حفظ السجل'), 'حفظ السجل')
  assert.equal(t('عرض السجل {id}', { id: 7 }), 'عرض السجل 7')
  assert.equal(arabicText('{count} بند', { count: 3 }), '3 بند')
  // An unknown placeholder stays visible instead of printing "undefined".
  assert.equal(interpolate('بند {number}', {}), 'بند {number}')
  assert.equal(interpolate('بلا معاملات'), 'بلا معاملات')
})

test('a translated interface maps the exact Arabic text and keeps its placeholders', () => {
  const t = createTranslator({
    'عرض السجل {id}': 'View record {id}',
    'تصفية {field}': 'Filter {field}',
  })
  assert.equal(t('عرض السجل {id}', { id: '12' }), 'View record 12')
  assert.equal(t('تصفية {field}', { field: 'Status' }), 'Filter Status')
  // Text without a translation falls back to Arabic; prototype keys are not translations.
  assert.equal(t('حفظ السجل'), 'حفظ السجل')
  assert.equal(t('constructor'), 'constructor')
})

test('labels use the current language when present and fall back to Arabic', () => {
  assert.equal(localizedLabel({ ar: 'الحالة', en: 'Status' }, 'en'), 'Status')
  assert.equal(localizedLabel({ ar: 'الحالة', en: 'Status' }, 'ar'), 'الحالة')
  assert.equal(localizedLabel({ ar: 'الحالة' }, 'en'), 'الحالة')
  assert.equal(localizedLabel({ ar: 'الحالة', en: '' }, 'en'), 'الحالة')
})

test('every t() text in the registry and the reference shell has a ui.* catalog entry', async () => {
  const catalog = new Set(Object.values(arabicInterfaceMessages))
  const sources = []
  for (const name of await readdir(registryDirectory))
    if (/\.tsx?$/.test(name)) sources.push(new URL(name, registryDirectory))
  sources.push(...referenceFiles)
  const missing = []
  let calls = 0
  for (const source of sources) {
    const code = await readFile(source, 'utf8')
    // Skip comments, which show t() usage examples.
    const body = code.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
    for (const match of body.matchAll(/\bt\((['"])((?:(?!\1).)*)\1/g)) {
      calls++
      if (!catalog.has(match[2]))
        missing.push(`${source.pathname.split('/').slice(-2).join('/')}: ${match[2]}`)
    }
  }
  assert.ok(calls > 150, `expected the generic UI to use t(), found ${calls} calls`)
  assert.deepEqual(missing, [])
})

test('the ui.* catalog has unique Arabic texts and translations keep every placeholder', () => {
  const texts = Object.values(arabicInterfaceMessages)
  assert.equal(new Set(texts).size, texts.length)
  const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()
  for (const [key, english] of Object.entries(englishInterfaceMessages)) {
    assert.ok(key in arabicInterfaceMessages, key)
    assert.deepEqual(placeholders(english), placeholders(arabicInterfaceMessages[key]), key)
  }
})
