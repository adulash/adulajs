import db from '@adonisjs/lucid/services/db'
import type { AccessToken } from '@adonisjs/auth/access_tokens'
import User from '#models/user'

type Client = ReturnType<ReturnType<typeof db.connection>['getWriteClient']>

/** A personal API token as shown to its owner or an administrator; never the secret. */
export function presentToken(token: AccessToken) {
  return {
    id: Number(token.identifier),
    name: token.name,
    access: token.abilities.includes('write') ? ('write' as const) : ('read' as const),
    lastUsedAt: token.lastUsedAt ? new Date(token.lastUsedAt).toISOString() : null,
    expiresAt: token.expiresAt ? new Date(token.expiresAt).toISOString() : null,
    createdAt: new Date(token.createdAt).toISOString(),
  }
}
export type PresentedToken = ReturnType<typeof presentToken>

export async function listUserTokens(user: User) {
  const tokens = await User.accessTokens.all(user)
  return tokens.map(presentToken)
}

/**
 * Deletes every personal API token of a user. Password reset, password change and
 * administrative session revocation call it: a token must not outlive the credential
 * or the access decision it was minted under. Returns the number removed.
 */
export async function revokeUserTokens(
  userId: number,
  client: Client = db.connection().getWriteClient()
) {
  return Number(
    await client('auth_access_tokens').where({ tokenable_id: userId, type: 'api_token' }).delete()
  )
}
