import app from '@adonisjs/core/services/app'
import { type HttpContext, ExceptionHandler } from '@adonisjs/core/http'
import type { StatusPageRange, StatusPageRenderer } from '@adonisjs/core/types/http'
import { AdulaError, localizeText, translate } from 'adula'
import { requestLanguage } from '#services/languages'

export default class HttpExceptionHandler extends ExceptionHandler {
  /**
   * In debug mode, the exception handler will display verbose errors
   * with pretty printed stack traces.
   */
  protected debug = !app.inProduction

  /**
   * Status pages are used to display a custom HTML pages for certain error
   * codes. You might want to enable them in production only, but feel
   * free to enable them in development as well.
   */
  protected renderStatusPages = app.inProduction

  /**
   * Status pages is a collection of error code range and a callback
   * to return the HTML contents to send as a response.
   */
  protected statusPages: Record<StatusPageRange, StatusPageRenderer> = {
    '404': (_, { inertia }) => inertia.render('errors/not_found', {}),
    '500..599': (_, { inertia }) => inertia.render('errors/server_error', {}),
  }

  /**
   * The method is used for handling errors and returning
   * response to the client
   */
  async handle(error: unknown, ctx: HttpContext) {
    if (
      (error as { code?: string })?.code === 'E_BAD_CSRF_TOKEN' &&
      (ctx.request.url() === '/mcp' || ctx.request.accepts(['json', 'html']) === 'json')
    )
      return ctx.response.forbidden({
        error: {
          code: 'E_BAD_CSRF_TOKEN',
          message: translate('errors.E_BAD_CSRF_TOKEN', requestLanguage(ctx)),
        },
      })
    // An AdulaError thrown inside the request is already in the request's language.
    // Errors raised before the language middleware (CSRF, unknown routes) stay Arabic.
    if (error instanceof AdulaError)
      return ctx.response.status(error.status).send({
        error: { code: error.code, message: localizeText(error.message, requestLanguage(ctx)) },
      })
    if ((error as { code?: string })?.code === '23505')
      return ctx.response.conflict({
        error: {
          code: 'E_DUPLICATE',
          message: translate('errors.E_DUPLICATE', requestLanguage(ctx)),
        },
      })
    if ((error as { code?: string })?.code === '23503')
      return ctx.response.unprocessableEntity({
        error: {
          code: 'E_RELATION',
          message: translate('errors.E_RELATION', requestLanguage(ctx)),
        },
      })
    return super.handle(error, ctx)
  }

  /**
   * The method is used to report error to the logging service or
   * the a third party error monitoring service.
   *
   * @note You should not attempt to send a response from this method.
   */
  async report(error: unknown, ctx: HttpContext) {
    return super.report(error, ctx)
  }
}
