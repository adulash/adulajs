import type { HttpContext } from '@adonisjs/core/http'
import vine from '@vinejs/vine'
import { translate } from 'adula'
import { availableLanguages } from '#services/languages'

const languageValidator = vine.create({ language: vine.string().trim().maxLength(16) })

export default class LanguageController {
  /** Stores the signed-in user's interface language; only enabled languages are accepted. */
  async update(ctx: HttpContext) {
    const { request, auth, response, session } = ctx
    const { language } = await request.validateUsing(languageValidator)
    if (!availableLanguages().some((entry) => entry.code === language)) {
      session.flash('inputErrorsBag', { language: [translate('validation.in')] })
      return response.redirect().toRoute('profile.show')
    }
    const user = auth.getUserOrFail()
    user.language = language
    await user.save()
    // The notice is already in the newly chosen language.
    session.flash('success', translate('flash.language.saved', language))
    return response.redirect().toRoute('profile.show')
  }
}
