export type InterfaceDirection = 'rtl' | 'ltr'
export type InterfaceLanguage = { code: string; name: string; dir: InterfaceDirection }
/** A resource or field label: Arabic is required, every other language is optional. */
export type LocalizedLabel = { ar: string; [language: string]: string | undefined }
export type MessageParams = Record<string, string | number>
export type Translate = (arabic: string, params?: MessageParams) => string

const none: Record<string, string> = {}

/** Replaces `{name}` placeholders; an unknown placeholder is kept as written. */
export function interpolate(template: string, params?: MessageParams) {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : match
  )
}

/**
 * Arabic is the base language: the interface text is the lookup key and is shown
 * unchanged when no translation exists (always the case for Arabic users).
 */
export function createTranslator(messages: Record<string, string> = none): Translate {
  return (arabic, params) =>
    interpolate(Object.hasOwn(messages, arabic) ? messages[arabic] : arabic, params)
}

/** The Arabic text with its placeholders filled, for helpers called outside components. */
export const arabicText: Translate = createTranslator()

/** `label.<locale>` when present, otherwise the required Arabic label. */
export function localizedLabel(label: LocalizedLabel, locale: string) {
  return label[locale] || label.ar
}
