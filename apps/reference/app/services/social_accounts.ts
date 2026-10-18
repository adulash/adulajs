import env from '#start/env'
import User from '#models/user'
import db from '@adonisjs/lucid/services/db'
import { randomBytes } from 'node:crypto'
import { DateTime } from 'luxon'
import type { SocialProviders } from '@adonisjs/ally/types'

export type SocialProvider = keyof SocialProviders
export type SocialProviderOption = { name: SocialProvider; label: string }

/**
 * A provider is offered only when both of its credentials exist. The list is
 * computed once at boot and shared with the login page as "socialProviders".
 */
const catalogue: (SocialProviderOption & { id: string | undefined; secret: string | undefined })[] =
  [
    {
      name: 'github',
      label: 'GitHub',
      id: env.get('GITHUB_CLIENT_ID'),
      secret: env.get('GITHUB_CLIENT_SECRET'),
    },
    {
      name: 'google',
      label: 'Google',
      id: env.get('GOOGLE_CLIENT_ID'),
      secret: env.get('GOOGLE_CLIENT_SECRET'),
    },
  ]
const configured: SocialProviderOption[] = catalogue
  .filter((provider) => provider.id && provider.secret)
  .map(({ name, label }) => ({ name, label }))

export function socialProviders(): SocialProviderOption[] {
  return configured
}

export function isSocialProvider(value: unknown): value is SocialProvider {
  return configured.some((provider) => provider.name === value)
}

export type SocialProfile = {
  provider: SocialProvider
  providerId: string
  /** Verified by the provider; callers must refuse unverified addresses first. */
  email: string
  name: string | null
}

/**
 * Resolves the local user for an OAuth identity: an existing link wins, then a
 * user with the same verified e-mail is linked, otherwise a user is created with
 * an unguessable password. An existing account whose e-mail ownership was never
 * proven is not linked: otherwise whoever self-registered the address first
 * would receive the provider identity (account pre-hijacking). With `allowCreate`
 * false (signup closed) an unknown address creates nothing and returns `closed`.
 * Runs in one transaction against PostgreSQL.
 */
export async function linkOrCreateSocialUser(
  profile: SocialProfile,
  { allowCreate = true }: { allowCreate?: boolean } = {}
): Promise<
  | { user: User; created: boolean; linked: boolean; unverified?: never; closed?: never }
  | { user?: never; created?: never; linked?: never; unverified: true; closed?: never }
  | { user?: never; created?: never; linked?: never; unverified?: never; closed: true }
> {
  return await db.transaction(async (trx) => {
    const link = await trx
      .from('social_accounts')
      .where({ provider: profile.provider, provider_id: profile.providerId })
      .first()
    if (link) {
      const linked = await User.query({ client: trx }).where('id', link.user_id).firstOrFail()
      return { user: linked, created: false, linked: false }
    }
    let user = await User.query({ client: trx })
      .whereRaw('lower(email) = lower(?)', [profile.email])
      .forUpdate()
      .first()
    let created = false
    if (user && !user.emailVerifiedAt) return { unverified: true as const }
    if (!user && !allowCreate) return { closed: true as const }
    if (!user) {
      user = await User.create(
        {
          email: profile.email,
          fullName: profile.name,
          password: randomBytes(32).toString('base64url'),
          emailVerifiedAt: DateTime.now(),
        },
        { client: trx }
      )
      created = true
    }
    await trx
      .table('social_accounts')
      .insert({ provider: profile.provider, provider_id: profile.providerId, user_id: user.id })
    return { user, created, linked: !created }
  })
}
