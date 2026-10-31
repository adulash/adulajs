import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import { runWithLanguage } from 'adula'
import { languageOf } from '#services/languages'

/**
 * Chooses the request's interface language from the signed-in user's preference
 * (Arabic for guests and for a language that is no longer enabled) and runs the
 * rest of the request in it, so validation messages, AdulaError messages and pages
 * answer in that language.
 */
export default class LanguageMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    ctx.language = languageOf(ctx.auth?.user)
    return runWithLanguage(ctx.language, () => next())
  }
}
