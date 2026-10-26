import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import UserTransformer from '#transformers/user_transformer'
import BaseInertiaMiddleware from '@adonisjs/inertia/inertia_middleware'
import { adula } from '#services/adula'
import { sharedAdminProps } from '#middleware/admin_middleware'
import { clientMessages, localizeText, runWithLanguage, uiPreferences } from 'adula'
import db from '@adonisjs/lucid/services/db'
import { signupEnabled } from '#services/signup'
import {
  availableLanguages,
  localLabel,
  requestDirection,
  requestLanguage,
} from '#services/languages'

export default class InertiaMiddleware extends BaseInertiaMiddleware {
  async share(ctx: HttpContext) {
    /**
     * The share method is called everytime an Inertia page is rendered. In
     * certain cases, a page may get rendered before the session middleware
     * or the auth middleware are executed. For example: During a 404 request.
     *
     * In that case, we must always assume that HttpContext is not fully hydrated
     * with all the properties
     */
    const { auth } = ctx as Partial<HttpContext>
    const language = requestLanguage(ctx)
    const actor = auth?.user ? await adula().actors.load(auth.user.id) : undefined

    /**
     * Data shared with all Inertia pages. Make sure you are using
     * transformers for rich data-types like Models.
     */
    return {
      errors: ctx.inertia.always(this.getValidationErrors(ctx)),
      uiPreferences: ctx.inertia.always(await uiPreferences(db.connection().getWriteClient())),
      user: ctx.inertia.always(auth?.user ? UserTransformer.transform(auth.user) : undefined),
      navigation: ctx.inertia.always(
        actor ? this.#localizedNavigation(adula().resources.navigation(actor), language) : []
      ),
      // Indicator pages the user may open (ADR 046), for a navigation link to /dashboards/:name.
      dashboards: ctx.inertia.always(
        actor ? runWithLanguage(language, () => adula().dashboards.list(actor)) : []
      ),
      // Arabic is the base language; `messages` maps Arabic interface text to the
      // user's language and is empty for Arabic, so components render their own text.
      locale: ctx.inertia.always(language),
      dir: ctx.inertia.always(requestDirection(ctx)),
      // Not `always`: partial reloads keep the page's copy; a language change is a full visit.
      languages: availableLanguages(),
      messages: clientMessages(language),
      // Guests see the signup link only while the signup routes answer.
      signupEnabled: ctx.inertia.always(auth?.user ? false : await signupEnabled()),
      ...(await sharedAdminProps(ctx)),
    }
  }

  /**
   * The flash bag is sent to every Inertia page as a top-level "flash" field
   * (a sibling of "props") and is read on the client using "usePage().flash".
   *
   * Just like the share method, the flash method may run before the session
   * middleware, so HttpContext must be treated as partially hydrated.
   */
  flash(ctx: HttpContext) {
    const { session } = ctx as Partial<HttpContext>

    /**
     * Fetching the first error from the flash messages
     */
    const language = requestLanguage(ctx)
    const localize = (text: string | undefined) => text && localizeText(text, language)
    return {
      error: localize(session?.flashMessages.get('error') as string | undefined),
      success: localize(session?.flashMessages.get('success') as string | undefined),
    }
  }

  /**
   * Validation messages are produced in the request's language already; field errors
   * a controller flashes as Arabic text are translated when the catalog knows them.
   */
  getValidationErrors(ctx: HttpContext, options?: { allMessages: true }): Record<string, any> {
    const errors = options
      ? super.getValidationErrors(ctx, options)
      : super.getValidationErrors(ctx)
    const language = requestLanguage(ctx)
    if (language === 'ar') return errors
    const localize = (value: unknown): unknown =>
      typeof value === 'string'
        ? localizeText(value, language)
        : Array.isArray(value)
          ? value.map(localize)
          : value && typeof value === 'object'
            ? Object.fromEntries(
                Object.entries(value).map(([key, entry]) => [key, localize(entry)])
              )
            : value
    return localize(errors) as Record<string, any>
  }

  /** Resource and module labels in the user's language (`label.<lang>`, else Arabic). */
  #localizedNavigation(
    navigation: ReturnType<ReturnType<typeof adula>['resources']['navigation']>,
    language: string
  ) {
    if (language === 'ar') return navigation
    const { registry } = adula()
    return navigation.map((entry) => {
      const module = registry.modules().find((candidate) => candidate.name === entry.module)
      return {
        ...entry,
        label: localLabel(registry.get(entry.name).label, language) ?? entry.label,
        moduleLabel: module
          ? (localLabel(module.label, language) ?? entry.moduleLabel)
          : entry.moduleLabel,
      }
    })
  }

  async handle(ctx: HttpContext, next: NextFn) {
    await this.init(ctx)

    const output = await next()
    this.dispose(ctx)

    return output
  }
}

declare module '@adonisjs/inertia/types' {
  type MiddlewareSharedProps = InferSharedProps<InertiaMiddleware>
  export interface SharedProps extends MiddlewareSharedProps {}
}
