import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import { adula, requestActor } from '#services/adula'
import { refuseTwoFactorRequired, twoFactorRequirementUnmet } from '#services/two_factor'

/**
 * The assistant endpoints (ADR 052) answer JSON only. They need the `core.ai/use`
 * permission, an enabled assistant and, for administrators, the required second factor.
 */
export default class AssistantMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const user = ctx.auth.getUserOrFail()
    if (await twoFactorRequirementUnmet(user.id))
      return refuseTwoFactorRequired(ctx, { json: true })
    if (ctx.request.header('Content-Type')?.split(';', 1)[0] !== 'application/json')
      return ctx.response.status(415).send({
        error: { code: 'E_AI_JSON', message: 'أرسل الطلب بصيغة JSON' },
      })
    const actor = await requestActor(ctx)
    const runtime = adula()
    if (!runtime.assistant.canUse(actor))
      return ctx.response.forbidden({
        error: { code: 'E_FORBIDDEN', message: 'لا تملك صلاحية استخدام المساعد' },
      })
    const status = await runtime.assistant.status(actor)
    if (!status.available)
      return ctx.response.notFound({
        error: { code: 'E_AI_DISABLED', message: 'المساعد غير مفعّل' },
      })
    return next()
  }
}
