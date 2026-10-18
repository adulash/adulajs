import { AsyncLocalStorage } from 'node:async_hooks'
import { arabicMessages } from './ar.js'

/**
 * Arabic is the base language of every system: its catalog is complete and every
 * other language is an optional layer on top. A missing translation falls back to
 * the Arabic text, never to a key or an empty string.
 */
export const BASE_LANGUAGE = 'ar'
export type MessageCatalog = Readonly<Record<string, string>>
export type MessageParams = Readonly<Record<string, string | number>>
export type TextDirection = 'rtl' | 'ltr'
export type LanguageInfo = { code: string; name: string; dir: TextDirection }
export type LanguageOptions = { name: string; dir?: TextDirection }

type Registered = LanguageInfo & { catalog: MessageCatalog; byArabic: Map<string, string> }

const languages = new Map<string, Registered>()
/** clientMessages results by language and prefix; cleared when a catalog changes. */
const clientCache = new Map<string, Record<string, string>>()
const storage = new AsyncLocalStorage<string>()
/** Arabic text → message key, so text thrown by older code can still be translated. */
const keysByArabic = new Map<string, string>()
for (const [key, text] of Object.entries(arabicMessages))
  if (!keysByArabic.has(text)) keysByArabic.set(text, key)
languages.set(BASE_LANGUAGE, {
  code: BASE_LANGUAGE,
  name: 'العربية',
  dir: 'rtl',
  catalog: arabicMessages,
  byArabic: new Map(),
})

function assertCode(code: string) {
  if (!/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(code))
    throw new Error(`Invalid language code: ${code}`)
}

/**
 * Adds an optional language. Keys that the Arabic catalog does not define are
 * refused so a typo cannot silently create an untranslatable message; keys the
 * catalog leaves out fall back to Arabic. Registering the same code again merges
 * the catalogs, so an application can extend or override a bundled catalog.
 */
export function registerLanguage(code: string, catalog: MessageCatalog, options: LanguageOptions) {
  assertCode(code)
  if (code === BASE_LANGUAGE) throw new Error('Arabic is the base language; it cannot be replaced')
  if (!options.name?.trim()) throw new Error(`Language ${code} needs a display name`)
  for (const [key, text] of Object.entries(catalog)) {
    if (!Object.hasOwn(arabicMessages, key))
      throw new Error(`Language ${code}: unknown message key ${key}`)
    if (typeof text !== 'string' || !text) throw new Error(`Language ${code}: empty message ${key}`)
  }
  const previous = languages.get(code)
  clientCache.clear()
  const merged = { ...previous?.catalog, ...catalog }
  const byArabic = new Map<string, string>()
  for (const [key, text] of Object.entries(merged)) byArabic.set(arabicMessages[key], text)
  languages.set(code, {
    code,
    name: options.name,
    dir: options.dir ?? 'ltr',
    catalog: Object.freeze(merged),
    byArabic,
  })
}

/** Every registered language, Arabic first. */
export function registeredLanguages(): LanguageInfo[] {
  return [...languages.values()].map(({ code, name, dir }) => ({ code, name, dir }))
}

/**
 * The languages users may choose: Arabic always, first, followed by the configured
 * codes that are registered. An unknown configured code is a configuration error.
 */
export function enabledLanguages(configured: readonly string[] = [BASE_LANGUAGE]): LanguageInfo[] {
  const codes = [BASE_LANGUAGE, ...configured.filter((code) => code !== BASE_LANGUAGE)]
  return [...new Set(codes)].map((code) => {
    const language = languages.get(code)
    if (!language) throw new Error(`Language ${code} is enabled but not registered`)
    return { code: language.code, name: language.name, dir: language.dir }
  })
}

/** The preferred language when it is enabled, Arabic otherwise. */
export function resolveLanguage(
  preferred: string | null | undefined,
  configured: readonly string[] = [BASE_LANGUAGE]
): string {
  if (!preferred || preferred === BASE_LANGUAGE) return BASE_LANGUAGE
  return configured.includes(preferred) && languages.has(preferred) ? preferred : BASE_LANGUAGE
}

export function languageDirection(code: string): TextDirection {
  return languages.get(code)?.dir ?? 'rtl'
}

function interpolate(text: string, params?: MessageParams) {
  if (!params) return text
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match
  )
}

/**
 * The message for `key` in `language`, falling back to Arabic. `{name}` placeholders
 * are replaced from `params`. Unknown keys are a programming error.
 */
export function translate(key: string, language = currentLanguage(), params?: MessageParams) {
  const arabic = Object.hasOwn(arabicMessages, key) ? arabicMessages[key] : undefined
  if (arabic === undefined) throw new Error(`Unknown message key: ${key}`)
  const text =
    language === BASE_LANGUAGE ? arabic : (languages.get(language)?.catalog[key] ?? arabic)
  return interpolate(text, params)
}

/**
 * Translates Arabic text that matches a catalog entry exactly; other text is returned
 * unchanged. Lets boundaries (flash messages, error responses) localize text produced
 * by code that predates the catalog while Arabic output stays byte-identical.
 */
export function localizeText(text: string, language = currentLanguage()): string {
  if (language === BASE_LANGUAGE) return text
  return languages.get(language)?.byArabic.get(text) ?? text
}

/** The catalog key of an Arabic text, when the catalog defines it. */
export function messageKeyOf(text: string): string | undefined {
  return keysByArabic.get(text)
}

/**
 * Arabic text → translation for the keys under `prefix` (the user interface strings
 * by default). Interfaces keep their Arabic text and look it up here; an empty map
 * means "render the Arabic", which is the case for Arabic users.
 */
export function clientMessages(language: string, prefix = 'ui.'): Record<string, string> {
  if (language === BASE_LANGUAGE) return {}
  const cacheKey = `${language}:${prefix}`
  const cached = clientCache.get(cacheKey)
  if (cached) return cached
  const catalog = languages.get(language)?.catalog ?? {}
  const messages: Record<string, string> = {}
  for (const [key, text] of Object.entries(catalog))
    if (key.startsWith(prefix)) messages[arabicMessages[key]] = text
  // Shared between requests: frozen so no caller can change another request's copy.
  clientCache.set(cacheKey, Object.freeze(messages))
  return messages
}

/** Runs `callback` with `language` as the current language of everything it awaits. */
export function runWithLanguage<T>(language: string, callback: () => T): T {
  return storage.run(languages.has(language) ? language : BASE_LANGUAGE, callback)
}

/** The language of the current request (see runWithLanguage), Arabic outside one. */
export function currentLanguage(): string {
  return storage.getStore() ?? BASE_LANGUAGE
}

/**
 * A resource, field, action, lookup or menu label in `language`: `label.<language>`
 * when the label provides it, `label.ar` otherwise.
 */
export function labelText(
  label: { ar: string; [language: string]: string | undefined },
  language = currentLanguage()
): string {
  return (language !== BASE_LANGUAGE && label[language]) || label.ar
}
