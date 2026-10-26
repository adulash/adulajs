import { BaseCommand } from '@adonisjs/core/ace'
import { fileURLToPath } from 'node:url'
import {
  diagnose,
  diagnoseResourceSnapshots,
  diagnoseResourceSchemas,
  diagnoseOutbox,
  diagnoseWorkflowRoles,
} from '../src/commands/doctor.js'
import { runtimeHealth } from '../src/core/health.js'
import { diagnoseAttachments } from '../src/attachments/doctor.js'
import { Settings } from '../src/services/settings.js'
import { MigrationRunner } from '@adonisjs/lucid/migration'
import { readFile } from 'node:fs/promises'
import type { ResourceRegistry } from '../src/resource/registry.js'
import { renamedMigration } from '../src/upgrade/legacy.js'
export default class Doctor extends BaseCommand {
  static commandName = 'adula:doctor'
  static description = 'Check AdulaJS ownership, installation and backup readiness'
  static options = { startApp: true }
  async run() {
    const { default: db } = await import('@adonisjs/lucid/services/db')
    const findings = await diagnose(
      fileURLToPath(this.app.appRoot),
      new Settings(db.connection().getWriteClient()),
      this.app.inProduction,
      process.env
    )
    findings.push(await diagnoseAttachments(db.connection().getWriteClient()))
    findings.push(diagnoseOutbox(await runtimeHealth(db.connection().getWriteClient())))
    const migrations = await new MigrationRunner(db, this.app, { direction: 'up' }).getList()
    const missing = migrations.filter((entry) => entry.status === 'corrupt')
    const pending = migrations.filter((entry) => entry.status === 'pending')
    const legacy = missing.some((entry) => renamedMigration(entry.name))
    findings.push({
      check: 'database.migrations',
      status: missing.length ? 'fail' : pending.length ? 'warn' : 'pass',
      message: legacy
        ? 'The migration history still names the 1.x package; run node ace adula:upgrade before migration:run'
        : missing.length
          ? `Applied migration files are missing: ${missing.map((entry) => entry.name).join(', ')}`
          : pending.length
            ? `${pending.length} pending migrations; run migration:run after the deployment backup`
            : 'Migration files and database history agree',
    })
    const sources = []
    for (const entry of pending)
      for (const extension of ['.ts', '.js'])
        try {
          const file = `${entry.name}${extension}`
          sources.push({ file, source: await readFile(this.app.makePath(file), 'utf8') })
          break
        } catch {}
    let registry: ResourceRegistry | undefined
    try {
      ;({ registry } = await this.app.import('#start/modules'))
    } catch {}
    if (registry) {
      // Before the 1.1 migrations run, roles have no key column yet (an unfinished upgrade).
      const keyed = await db.connection().getWriteClient().schema.hasColumn('roles', 'key')
      const roles = await db.from('roles').select(keyed ? ['key', 'name'] : ['name'])
      findings.push(
        diagnoseWorkflowRoles(
          registry.workflows(),
          roles.map((role) => ({
            key: role.key ? String(role.key) : null,
            name: String(role.name),
          }))
        )
      )
    }
    if (registry)
      findings.push(
        diagnoseResourceSnapshots(sources, (name) => {
          try {
            return registry.get(name)
          } catch {
            return undefined
          }
        })
      )
    // Tables of resources whose create-migration is still pending are reported missing.
    if (registry)
      findings.push(await diagnoseResourceSchemas(db.connection().getWriteClient(), registry.all()))
    for (const finding of findings)
      this.logger.log(`${finding.status.toUpperCase()} ${finding.check}: ${finding.message}`)
    if (findings.some((finding) => finding.status === 'fail')) this.exitCode = 1
  }
}
