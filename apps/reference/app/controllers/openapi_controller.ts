import type { HttpContext } from '@adonisjs/core/http'
import env from '#start/env'
import { openApiDocument, apiClientSource, apiClientDeclarations, ADULA_VERSION } from 'adula'
import { adula, requestActor } from '#services/adula'

/** The API description for the calling token's owner, generated from the registry. */
export default class OpenApiController {
  async handle(ctx: HttpContext) {
    return this.#document(ctx)
  }

  /** GET /api/v1/client.ts: a typed client of exactly what this token's owner may use. */
  async client(ctx: HttpContext) {
    return this.#typescript(ctx, 'client.ts', apiClientSource(await this.#document(ctx)))
  }

  /** GET /api/v1/client.d.ts: the same client's types and runtime signatures. */
  async declarations(ctx: HttpContext) {
    return this.#typescript(ctx, 'client.d.ts', apiClientDeclarations(await this.#document(ctx)))
  }

  async #document(ctx: HttpContext) {
    return openApiDocument(adula().registry, {
      title: 'Resource API',
      version: ADULA_VERSION,
      serverUrl: env.get('APP_URL'),
      actor: await requestActor(ctx),
    })
  }

  #typescript(ctx: HttpContext, file: string, source: string) {
    ctx.response.header('Content-Type', 'text/plain; charset=utf-8')
    ctx.response.header('Content-Disposition', `inline; filename="${file}"`)
    ctx.response.header('Cache-Control', 'no-store')
    return source
  }
}
