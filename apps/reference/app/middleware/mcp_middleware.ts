import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import { isModernProtocolRequest } from '@jrmc/adonis-mcp/protocols/version'
import { randomUUID } from 'node:crypto'
import { refuseTwoFactorRequired, twoFactorRequirementUnmet } from '#services/two_factor'

// Adapted from @jrmc/adonis-mcp 2.0.0's official middleware stub (MIT).
// Session authentication and Shield CSRF remain enabled on this route.
export default class McpMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    // An administrator without the required second factor gets no tools.
    if (ctx.auth.user && (await twoFactorRequirementUnmet(ctx.auth.user.id)))
      return refuseTwoFactorRequired(ctx, { json: true })
    const body = ctx.request.body()
    if (ctx.request.header('Content-Type')?.split(';', 1)[0] !== 'application/json')
      return ctx.response.badRequest('Content-Type header must be application/json')
    if (
      isModernProtocolRequest(
        ctx.request.header('MCP-Protocol-Version'),
        body.params?._meta?.['io.modelcontextprotocol/protocolVersion']
      )
    )
      return next()
    if (body.method === 'initialize') ctx.response.safeHeader('MCP-Session-Id', randomUUID())
    else {
      const sessionId = ctx.request.header('MCP-Session-Id')
      if (!sessionId) return ctx.response.badRequest('MCP-Session-Id header is required')
      ctx.response.safeHeader('MCP-Session-Id', sessionId)
    }
    return next()
  }
}
