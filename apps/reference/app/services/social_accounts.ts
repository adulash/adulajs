import env from '#start/env'
import User from '#models/user'
import db from '@adonisjs/lucid/services/db'
import { Settings } from 'adula'
import { randomBytes } from 'node:crypto'
import { DateTime } from 'luxon'
import type { SocialProviders } from '@adonisjs/ally/types'

export type SocialProvider = keyof SocialProviders
export type SocialProviderOption = { name: SocialProvider; label: string }
/**
 * One provider as the administration screen shows it. `disabled` is the administrator's
 * switch, independent of credentials; `enabled` = configured and not disabled.
 */
export type SocialProviderStatus = SocialProviderOption & {
  configured: boolean
  enabled: boolean
  disabled: boolean
}

/** System setting: provider names an administrator switched off. Absent = none. */
export const DISABLED_PROVIDERS_KEY = 'auth.providers.disabled'

type EnvKey = Parameters<typeof env.get>[0]
const catalogue: (SocialProviderOption & { credentials: EnvKey[] })[] = [
  { name: 'github', label: 'GitHub', credentials: ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'] },
  { name: 'google', label: 'Google', credentials: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] },
  {
    name: 'microsoft',
    label: 'Microsoft',
    credentials: ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET', 'MICROSOFT_TENANT_ID'],
  },
]

export const SOCIAL_PROVIDER_NAMES: SocialProvider[] = catalogue.map(({ name }) => name)

export function isKnownProvider(value: unknown): value is SocialProvider {
  return catalogue.some((provider) => provider.name === value)
}

export function providerLabel(name: SocialProvider) {
  return catalogue.find((provider) => provider.name === name)?.label ?? name
}

/** Credentials are read per call, so a changed environment applies without a restart. */
function configured(name: SocialProvider) {
  const entry = catalogue.find((provider) => provider.name === name)
  return !!entry && entry.credentials.every((key) => !!env.get(key))
}

/** Provider names switched off by an administrator; malformed values disable nothing. */
export async function disabledProviders(): Promise<SocialProvider[]> {
  const value = await new Settings(db.connection().getWriteClient()).get<unknown>(
    DISABLED_PROVIDERS_KEY
  )
  return Array.isArray(value) ? value.filter(isKnownProvider) : []
}

/** Every known provider with whether it is configured and whether it is offered. */
export async function providerStatuses(): Promise<SocialProviderStatus[]> {
  const disabled = await disabledProviders()
  return catalogue.map(({ name, label }) => {
    const ready = configured(name)
    const off = disabled.includes(name)
    return { name, label, configured: ready, enabled: ready && !off, disabled: off }
  })
}

/** Providers offered to users: configured and not disabled by an administrator. */
export async function socialProviders(): Promise<SocialProviderOption[]> {
  const statuses = await providerStatuses()
  return statuses.filter((provider) => provider.enabled).map(({ name, label }) => ({ name, label }))
}

/** The provider when it is offered right now, else null (callers answer 404). */
export async function enabledProvider(value: unknown): Promise<SocialProvider | null> {
  if (!isKnownProvider(value) || !configured(value)) return null
  const disabled = await disabledProviders()
  return disabled.includes(value) ? null : value
}

export type SocialProfile = {
  provider: SocialProvider
  providerId: string
  /** Verified by the provider; callers must refuse unverified addresses first. */
  email: string
  name: string | null
}

export type SocialResolution =
  | {
      user: User
      created: boolean
      /** An e-mail match was linked now (log it as an automatic link). */
      linked: boolean
      /** An e-mail match whose link waits for the second factor (`deferLink`). */
      pendingLink?: { provider: SocialProvider; providerId: string }
      refused?: never
    }
  | {
      user?: never
      created?: never
      linked?: never
      /**
       * unverified: the local account never proved the address; closed: no
       * account and signup is closed; conflict: the account already has another
       * identity of this provider; disabled: the account is disabled.
       */
      refused: 'unverified' | 'closed' | 'conflict' | 'disabled'
    }

/**
 * Resolves the local user for an OAuth identity: an existing link wins, then a
 * user with the same verified e-mail is linked, otherwise a user is created with
 * an unguessable password. An existing account whose e-mail ownership was never
 * proven is not linked: otherwise whoever self-registered the address first
 * would receive the provider identity (account pre-hijacking). With `allowCreate`
 * false (signup closed) an unknown address creates nothing. A disabled account
 * gains no link. Runs in one transaction against PostgreSQL. When `deferLink`
 * says so for the matched account (it has a second factor), nothing is inserted:
 * the caller links it only after the second step passes (`pendingLink`).
 */
export async function linkOrCreateSocialUser(
  profile: SocialProfile,
  {
    allowCreate = true,
    deferLink,
  }: { allowCreate?: boolean; deferLink?: (userId: number) => Promise<boolean> } = {}
): Promise<SocialResolution> {
  return await db.transaction(async (trx) => {
    const link = await trx
      .from('social_accounts')
      .where({ provider: profile.provider, provider_id: profile.providerId })
      .first()
    if (link) {
      const linked = await User.query({ client: trx }).where('id', link.user_id).firstOrFail()
      if (linked.disabledAt) return { refused: 'disabled' as const }
      return { user: linked, created: false, linked: false }
    }
    let user = await User.query({ client: trx })
      .whereRaw('lower(email) = lower(?)', [profile.email])
      .forUpdate()
      .first()
    let created = false
    if (user && !user.emailVerifiedAt) return { refused: 'unverified' as const }
    if (user?.disabledAt) return { refused: 'disabled' as const }
    if (!user && !allowCreate) return { refused: 'closed' as const }
    if (user) {
      const other = await trx
        .from('social_accounts')
        .where({ provider: profile.provider, user_id: user.id })
        .first()
      if (other) return { refused: 'conflict' as const }
      if (deferLink && (await deferLink(user.id)))
        return {
          user,
          created: false,
          linked: false,
          pendingLink: { provider: profile.provider, providerId: profile.providerId },
        }
    } else {
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

/**
 * Links a provider identity to a user who asked for it while signed in. The
 * provider e-mail plays no part: the signed-in session proves the account and
 * the OAuth round trip proves the identity. Refused when the identity belongs
 * to someone else (`taken`) or the user has another identity of this provider
 * (`conflict`). Linking the same identity again is a no-op (`unchanged`).
 */
export async function linkSocialAccount(
  userId: number,
  provider: SocialProvider,
  providerId: string
): Promise<'linked' | 'unchanged' | 'taken' | 'conflict'> {
  return await db.transaction(async (trx) => {
    // Serialises concurrent links of one user so the one-per-provider rule holds.
    await trx.from('users').where('id', userId).forUpdate().firstOrFail()
    const owner = await trx
      .from('social_accounts')
      .where({ provider, provider_id: providerId })
      .first()
    if (owner) return owner.user_id === userId ? 'unchanged' : 'taken'
    const other = await trx.from('social_accounts').where({ provider, user_id: userId }).first()
    if (other) return 'conflict'
    await trx
      .table('social_accounts')
      .insert({ provider, provider_id: providerId, user_id: userId })
    return 'linked'
  })
}

/** Removes the user's identity of this provider; returns how many links were removed. */
export async function unlinkSocialAccount(userId: number, provider: SocialProvider) {
  return Number(
    await db
      .connection()
      .getWriteClient()('social_accounts')
      .where({ provider, user_id: userId })
      .delete()
  )
}

export type UserConnection = { provider: SocialProvider; label: string; linkedAt: string }

/** The user's linked identities (provider ids stay on the server). */
export async function listUserConnections(userId: number): Promise<UserConnection[]> {
  const rows = await db
    .connection()
    .getWriteClient()('social_accounts')
    .where('user_id', userId)
    .orderBy('created_at')
    .select('provider', 'created_at')
  return rows
    .filter((row) => isKnownProvider(row.provider))
    .map((row) => ({
      provider: row.provider as SocialProvider,
      label: providerLabel(row.provider as SocialProvider),
      linkedAt: new Date(row.created_at).toISOString(),
    }))
}

/** The profile page block: providers the user may link now, and the identities already linked. */
export async function userConnections(userId: number) {
  return { available: await socialProviders(), linked: await listUserConnections(userId) }
}
