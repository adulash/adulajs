import { arabicMessages } from './ar.js'
import { currentLanguage, localizeText, translate, type MessageParams } from './catalog.js'

/** The part of VineJS's FieldContext the provider reads. */
type ValidationField = { name: string | number }

/** VineJS's own `{{ name }}` interpolation, for messages the catalog does not translate. */
function vineTemplate(message: string, field: ValidationField, args?: Record<string, unknown>) {
  if (!message.includes('{{')) return message
  const data: Record<string, unknown> = { field: field.name, ...args }
  return message.replace(/(\\)?{{(.*?)}}/g, (match, escaped: string | undefined, path: string) => {
    if (escaped) return match.slice(1)
    let value: unknown = data
    for (const token of path.trim().split('.')) {
      if (value === null || typeof value !== 'object' || !Object.hasOwn(value, token)) return ''
      value = (value as Record<string, unknown>)[token]
    }
    return Array.isArray(value) ? value.join('، ') : String(value ?? '')
  })
}

function params(args: Record<string, unknown> | undefined): MessageParams {
  const values: Record<string, string | number> = {}
  for (const [key, value] of Object.entries(args ?? {}))
    if (typeof value === 'string' || typeof value === 'number') values[key] = value
    else if (Array.isArray(value)) values[key] = value.join('، ')
  return values
}

/**
 * A VineJS messages provider that answers in the current language (see
 * runWithLanguage): Arabic by default, the user's language when it is enabled and
 * translates the rule. Assign it to `vine.messagesProvider` before validators are
 * created. A rule without a catalog entry keeps its own message, interpolated the way
 * VineJS does and translated when it matches a catalog text exactly.
 */
export class CatalogMessagesProvider {
  getMessage(
    rawMessage: string,
    rule: string,
    field: ValidationField,
    args?: Record<string, unknown>
  ): string {
    const key = `validation.${rule}`
    if (Object.hasOwn(arabicMessages, key)) return translate(key, currentLanguage(), params(args))
    return localizeText(vineTemplate(rawMessage, field, args))
  }
}

/**
 * Makes `vine` answer through the catalog: new validators get a CatalogMessagesProvider,
 * and the validators of `resources` created earlier with VineJS's default provider are
 * switched to it (applications load modules while reading their configuration, before
 * any preload runs). A validator with its own messages provider keeps it.
 */
export function installCatalogMessages(
  vine: { messagesProvider: unknown },
  resources: readonly { validator?: unknown }[] = []
): CatalogMessagesProvider {
  const previous = vine.messagesProvider
  const provider = new CatalogMessagesProvider()
  vine.messagesProvider = provider
  for (const { validator } of resources) {
    const candidate = validator as { messagesProvider?: unknown }
    if (candidate && candidate.messagesProvider === previous) candidate.messagesProvider = provider
  }
  return provider
}
