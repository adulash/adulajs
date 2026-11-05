import type { HttpContext } from '@adonisjs/core/http'
import { AdulaError } from 'adula'
import { adula, requestActor } from '#services/adula'

/** JSON only, so a provider key is never flashed into the session as old input. */
function requireJson(ctx: HttpContext) {
  if (ctx.request.header('Content-Type')?.split(';', 1)[0] !== 'application/json')
    throw new AdulaError(415, 'E_AI_JSON', 'أرسل الطلب بصيغة JSON')
}

/** The assistant section of the administration (ADR 052). The key never leaves the server. */
export default class AdminAssistantController {
  async index(ctx: HttpContext) {
    const settings = await adula().assistantSettings.read()
    return ctx.inertia.render('admin/assistant/index', { settings })
  }

  async update(ctx: HttpContext) {
    requireJson(ctx)
    const actor = await requestActor(ctx)
    return { data: await adula().assistantSettings.save(actor, ctx.request.body()) }
  }

  async setKey(ctx: HttpContext) {
    requireJson(ctx)
    const actor = await requestActor(ctx)
    return { data: await adula().assistantSettings.setKey(actor, ctx.request.input('key')) }
  }

  async clearKey(ctx: HttpContext) {
    return { data: await adula().assistantSettings.clearKey(await requestActor(ctx)) }
  }

  /** One minimal request with the stored key; answers with a failure category only. */
  async test() {
    return { data: await adula().assistant.testConnection() }
  }
}
