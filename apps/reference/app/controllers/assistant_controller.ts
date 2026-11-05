import type { HttpContext } from '@adonisjs/core/http'
import { AdulaError, resourceToolError } from 'adula'
import { adula, requestActor } from '#services/adula'

function conversationId(value: unknown) {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id < 1)
    throw new AdulaError(404, 'E_NOT_FOUND', 'المحادثة غير موجودة')
  return id
}

/**
 * The assistant panel's JSON endpoints (ADR 052). The actor is always the signed-in user
 * (with the impersonating administrator recorded); nothing in a body names a user.
 */
export default class AssistantController {
  async acceptNotice(ctx: HttpContext) {
    await adula().assistant.acceptNotice(await requestActor(ctx))
    return { data: { noticeAccepted: true } }
  }

  async startConversation(ctx: HttpContext) {
    return { data: await adula().assistant.startConversation(await requestActor(ctx)) }
  }

  async turn(ctx: HttpContext) {
    const result = await adula().assistant.turn(
      await requestActor(ctx),
      conversationId(ctx.params.conversation),
      ctx.request.body()
    )
    return { data: result }
  }

  async confirm(ctx: HttpContext) {
    try {
      await adula().assistant.confirm(
        await requestActor(ctx),
        conversationId(ctx.params.conversation),
        String(ctx.params.id)
      )
      return { data: { confirmed: true } }
    } catch (error) {
      if (error instanceof AdulaError) throw error
      // Validation and constraint failures of the record keep their safe shape.
      const failure = resourceToolError(error)
      return ctx.response.status(failure.status).send({ error: failure })
    }
  }

  async reject(ctx: HttpContext) {
    await adula().assistant.reject(
      await requestActor(ctx),
      conversationId(ctx.params.conversation),
      String(ctx.params.id)
    )
    return { data: { rejected: true } }
  }
}
