import type { Knex } from 'knex'
import { Settings } from '../services/settings.js'
import { logActivity } from './activity.js'

/**
 * Whether any user holds an unconditional `manage all` grant, which is what the
 * administration area requires. Disabled holders still count: disabling the last
 * administrator must not reopen bootstrap paths such as self-signup.
 */
export async function administratorExists(knex: Knex | Knex.Transaction) {
  const row = await knex('user_roles')
    .join('role_rules', 'role_rules.role_id', 'user_roles.role_id')
    .where({ 'role_rules.subject': 'all', 'role_rules.action': 'manage' })
    .where('role_rules.inverted', false)
    .whereNull('role_rules.conditions')
    .whereNull('role_rules.fields')
    .first('user_roles.user_id')
  return Boolean(row)
}

/** What installation did to secure a pre-existing account before promoting it. */
export type InstallAccountRotation = {
  sessions: number
  tokens: number
  resetTokens: number
  invitations: number
}

/**
 * Ends every way into an account: browser sessions (the `user_sessions` index and
 * the database session store), personal API tokens, outstanding recovery links and
 * pending invitations for the address. Tables are application-owned, so each is used
 * only when it exists.
 */
async function endAccountAccess(
  knex: Knex,
  userId: number,
  email: string
): Promise<InstallAccountRotation> {
  let sessions = 0
  let tokens = 0
  let resetTokens = 0
  let invitations = 0
  if (await knex.schema.hasTable('user_sessions')) {
    const rows: { id: string }[] = await knex('user_sessions')
      .where({ user_id: userId })
      .select('id')
    if (rows.length && (await knex.schema.hasTable('sessions')))
      await knex('sessions')
        .whereIn(
          'id',
          rows.map((row) => row.id)
        )
        .delete()
    sessions = Number(await knex('user_sessions').where({ user_id: userId }).delete())
  }
  if (await knex.schema.hasTable('auth_access_tokens'))
    tokens = Number(await knex('auth_access_tokens').where({ tokenable_id: userId }).delete())
  // A recovery link requested while signup was open would otherwise outlive the rotation.
  if (await knex.schema.hasTable('password_reset_tokens'))
    resetTokens = Number(
      await knex('password_reset_tokens').where({ user_id: userId }).whereNull('used_at').delete()
    )
  if (await knex.schema.hasTable('user_invitations'))
    invitations = Number(
      await knex('user_invitations')
        .whereRaw('lower(email) = lower(?)', [email])
        .whereNull('accepted_at')
        .delete()
    )
  return { sessions, tokens, resetTokens, invitations }
}

/**
 * Resolves the installation administrator by e-mail. A missing account is created
 * through `create` only while the application has no administrator yet, so a
 * mistyped address on an existing installation never mints a new privileged user.
 *
 * An account that already exists while no administrator does may have been
 * self-registered by anyone who guessed the address (pre-registration takeover).
 * When `rotatePassword` is given it replaces the password, every session and API
 * token of that account ends, and the event is recorded before it is promoted.
 * Callers that just created the account themselves omit it (`--keep-password`).
 */
export async function resolveInstallAdministrator(
  knex: Knex,
  email: string,
  create: () => Promise<number>,
  options: { rotatePassword?: (userId: number) => Promise<void> } = {}
): Promise<{ id: number; created: boolean; rotated?: InstallAccountRotation }> {
  const existing = await knex('users').whereRaw('lower(email) = lower(?)', [email]).first('id')
  const bootstrap = !(await administratorExists(knex))
  if (existing) {
    const id = Number(existing.id)
    if (!bootstrap || !options.rotatePassword) return { id, created: false }
    await options.rotatePassword(id)
    const rotated = await endAccountAccess(knex, id, email)
    await logActivity(knex, {
      resource: 'core.users',
      recordId: id,
      actorId: id,
      action: 'install_rotate_credentials',
      changes: rotated,
    })
    return { id, created: false, rotated }
  }
  if (!bootstrap)
    throw new Error(
      'Administrator user does not exist. An administrator already exists, so adula:install only creates the first one; check the e-mail address.'
    )
  return { id: await create(), created: true }
}

/**
 * Idempotently installs the root unit, the bootstrap `administrator` role with its
 * `manage all` grant, and assigns it to the user. A transaction-scoped advisory
 * lock makes repeated and concurrent installation safe.
 */
export async function grantInstallAdministrator(knex: Knex, userId: number, version: string) {
  await knex.transaction(async (trx) => {
    await trx.raw('SELECT pg_advisory_xact_lock(717011)')
    let root = await trx('org_units').whereNull('parent_id').first()
    if (!root) {
      const [created] = await trx('org_units')
        .insert({ name: 'الجهة', type: 'root', path: 'root' })
        .returning('*')
      await trx('org_units')
        .where('id', created.id)
        .update({ path: String(created.id) })
      root = created
    }
    let role = await trx('roles').where('name', 'administrator').first()
    if (!role) {
      const [created] = await trx('roles')
        .insert({ name: 'administrator', key: 'administrator', permission_level: 1 })
        .returning('*')
      role = created
    } else if (!role.key && !(await trx('roles').where('key', 'administrator').first()))
      await trx('roles').where('id', role.id).update({ key: 'administrator' })
    // Repair a missing bootstrap grant even when the role already exists.
    if (
      !(await trx('role_rules')
        .where({ role_id: role.id, subject: 'all', action: 'manage', inverted: false })
        .whereNull('conditions')
        .whereNull('fields')
        .first())
    )
      await trx('role_rules').insert({ role_id: role.id, subject: 'all', action: 'manage' })
    if (
      !(await trx('user_roles')
        .where({ user_id: userId, role_id: role.id })
        .whereNull('org_unit_id')
        .first())
    )
      await trx('user_roles').insert({ user_id: userId, role_id: role.id })
    await trx('user_org_units')
      .insert({ user_id: userId, org_unit_id: root.id })
      .onConflict(['user_id', 'org_unit_id'])
      .ignore()
    await new Settings(trx).set('adula.version', version)
  })
}
