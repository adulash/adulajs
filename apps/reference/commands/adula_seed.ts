import { BaseCommand, flags } from '@adonisjs/core/ace'
import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { testFixturesEnabled } from '#start/test_fixtures'

export default class Seed extends BaseCommand {
  static commandName = 'adula:seed'
  static description = 'Bootstrap a local administrator; business fixtures run only in test mode'
  static options = { startApp: true }
  @flags.number() declare rows: number

  async run() {
    if (this.app.inProduction) throw new Error('Reference seeding is forbidden in production')
    const { default: User } = await import('#models/user')
    const count = this.rows ?? 25
    if (!Number.isSafeInteger(count) || count < 1 || count > 100000)
      throw new Error('--rows must be between 1 and 100000')
    const email = process.env.ADULA_ADMIN_EMAIL ?? 'admin@adula.local'
    let user = await User.findBy('email', email)
    if (!user) {
      const password = randomBytes(18).toString('base64url')
      user = await User.create({ email, password, fullName: 'مدير النظام التجريبي' })
      await mkdir(this.app.tmpPath(), { recursive: true })
      await writeFile(
        this.app.tmpPath('dev-admin.txt'),
        `Local development only\nEmail: ${email}\nPassword: ${password}\n`,
        { mode: 0o600 }
      )
      this.logger.info('Development credentials saved to the ignored tmp/dev-admin.txt file')
    }
    process.env.ADULA_ADMIN_EMAIL = email
    // This command created the account (or the developer already owns it): keep its password.
    const installed = await this.kernel.exec('adula:install', ['--keep-password'])
    if (installed.exitCode) throw new Error('Core installation failed')
    if (testFixturesEnabled) {
      const { seedData } = await import('#tests/fixtures/seed_data')
      await seedData(user.id, count, this.logger)
    } else {
      this.logger.success(
        'Core administrator installed; no educational modules or records are created'
      )
    }
  }
}
