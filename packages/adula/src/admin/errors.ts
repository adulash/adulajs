import { localizeText, messageKeyOf } from '../languages/catalog.js'

/**
 * A refusal the caller can act on. The message is Arabic text from the catalog
 * (src/languages/ar.ts); inside a request running in another language (see
 * runWithLanguage) it is translated when that language translates the text, so a
 * response, flash or MCP answer built from `message` is already localized.
 */
export class AdulaError extends Error {
  /** The catalog key of the Arabic message, when the catalog defines it. */
  readonly messageKey?: string

  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(localizeText(message))
    this.messageKey = messageKeyOf(message)
  }
}
