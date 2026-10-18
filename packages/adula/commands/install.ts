import { BaseCommand, flags } from '@adonisjs/core/ace'
import { randomBytes } from 'node:crypto'
import { readFile, writeFile, access } from 'node:fs/promises'
import {
  grantInstallAdministrator,
  resolveInstallAdministrator,
} from '../src/core/administrators.js'
import { seedModules } from '../src/core/module_seed.js'
import type { ResourceRegistry } from '../src/resource/registry.js'
import { syncAgentAssets } from '../src/commands/agent_assets.js'
import { GAPS_TEMPLATE } from '../src/commands/gap_report.js'
import { ADULA_VERSION } from '../src/version.js'
import { fileURLToPath } from 'node:url'

/**
 * Installs the core organization, administrator role and managed agent instructions.
 * Creating or re-securing the first administrator requires the application's `#models/user`
 * Lucid model (with `email`, `fullName` and a hashed `password`); it is loaded only then.
 */
export default class Install extends BaseCommand {
  static commandName = 'adula:install'
  static description =
    'Install core organization, administrator role (creating the first administrator when missing) and managed agent instructions after migrations'
  static options = { startApp: true }
  @flags.string({ description: 'Administrator e-mail (defaults to ADULA_ADMIN_EMAIL)' })
  declare adminEmail?: string
  @flags.string({ description: 'Full name used when the first administrator is created' })
  declare adminName?: string
  @flags.boolean({
    description:
      'Keep the password of an existing account promoted as the first administrator (only when you created it yourself)',
  })
  declare keepPassword?: boolean
  async run() {
    const { default: db } = await import('@adonisjs/lucid/services/db')
    const knex = db.connection().getWriteClient()
    const email = (this.adminEmail ?? process.env.ADULA_ADMIN_EMAIL)?.trim().toLowerCase()
    if (!email)
      throw new Error(
        'Set ADULA_ADMIN_EMAIL (or pass --admin-email) to the administrator e-mail address.'
      )
    let password: string | undefined
    const userModel = async () => {
      try {
        const module = await this.app.import('#models/user')
        return module.default
      } catch (error) {
        throw new Error(
          "adula:install creates the first administrator through the application's #models/user model; it was not found",
          { cause: error }
        )
      }
    }
    const user = await resolveInstallAdministrator(
      knex,
      email,
      async () => {
        // The first administrator is created here so self-signup is never the bootstrap path.
        password = randomBytes(18).toString('base64url')
        const User = await userModel()
        const created = await User.create({
          email,
          fullName: this.adminName?.trim() || 'مدير النظام',
          password,
        })
        return Number(created.id)
      },
      {
        // Anyone may have self-registered this address before the first administrator existed.
        rotatePassword: this.keepPassword
          ? undefined
          : async (id: number) => {
              password = randomBytes(18).toString('base64url')
              const User = await userModel()
              const account = await User.findOrFail(id)
              account.password = password
              await account.save()
            },
      }
    )
    await grantInstallAdministrator(knex, user.id, ADULA_VERSION)
    // Shown once on the terminal and never written to a file; change it after signing in.
    if (user.created && password)
      this.logger.warning(
        `First administrator ${email} created. One-time password (change it after signing in): ${password}`
      )
    if (user.rotated && password)
      this.logger.warning(
        `Existing account ${email} promoted to first administrator: its password was replaced and ${user.rotated.sessions} session(s), ${user.rotated.tokens} API token(s), ${user.rotated.resetTokens} recovery link(s) and ${user.rotated.invitations} invitation(s) were ended. One-time password (change it after signing in): ${password}. Pass --keep-password only for an account you created yourself.`
      )
    // Module lookups and default roles: added when missing, never overwritten.
    let registry: ResourceRegistry | undefined
    try {
      ;({ registry } = await this.app.import('#start/modules'))
    } catch (error) {
      this.logger.warning(`Module defaults skipped: ${(error as Error).message}`)
    }
    if (registry) {
      const seeded = await seedModules(knex, registry, user.id)
      this.logger.info(
        `Module defaults: ${seeded.lookups} lookup rows added; roles created: ${seeded.created.join(', ') || 'none'}; adopted by name: ${seeded.adopted.join(', ') || 'none'}`
      )
    }
    for (const [name, content] of [
      ['CLAUDE.md', 'Read and follow AGENTS.md.\nThe project rules are maintained there.\n'],
      ['GAPS.md', GAPS_TEMPLATE],
    ]) {
      const path = this.app.makePath(name)
      try {
        await access(path)
      } catch {
        await writeFile(path, content, { flag: 'wx' })
      }
    }
    await syncAgentAssets(fileURLToPath(this.app.appRoot))
    const pkg = JSON.parse(await readFile(this.app.makePath('package.json'), 'utf8'))
    let uiInstalled = false
    try {
      await access(this.app.makePath('ui.lock.json'))
      uiInstalled = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (pkg.dependencies?.['@adula/ui'] && !uiInstalled) {
      const ui = await this.kernel.exec('adula:ui', ['add', 'all'])
      if (ui.exitCode)
        throw new Error('UI installation failed; existing project customizations require review')
    }
    this.logger.success('Core installation complete. Run adula:doctor.')
  }
}
