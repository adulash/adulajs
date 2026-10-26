import { BaseCommand, args } from '@adonisjs/core/ace'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { MigrationRunner } from '@adonisjs/lucid/migration'
import type { ResourceRegistry } from '../src/resource/registry.js'
import { embeddedResource } from '../src/commands/snapshot.js'
import {
  additionMigrationSource,
  describeDrift,
  resourceAddition,
  schemaDrift,
} from '../src/database/schema_diff.js'

/**
 * Writes an additive migration with what the database lacks for a resource: new
 * columns, join tables and unique indexes (see alterResourceTable). Only the new pieces
 * are embedded, so migrations that already ran stay unchanged.
 */
export default class ResourceMigration extends BaseCommand {
  static commandName = 'adula:resource:migration'
  static description =
    'Write an additive migration for the columns, join tables and unique indexes a resource table lacks'
  static options = { startApp: true }
  @args.string({ description: 'Resource name' }) declare name: string
  async run() {
    const { default: db } = await import('@adonisjs/lucid/services/db')
    const { registry } = (await this.app.import('#start/modules')) as {
      registry: ResourceRegistry
    }
    let resource
    try {
      resource = registry.get(this.name)
    } catch {
      this.logger.error(`Unknown resource: ${this.name}. Register it in its module first.`)
      this.exitCode = 1
      return
    }
    const drift = await schemaDrift(db.connection().getWriteClient(), resource)
    if (drift.missingTable) {
      this.logger.error(
        `${this.name} has no table yet: run its create-migration with migration:run first.`
      )
      this.exitCode = 1
      return
    }
    for (const entry of drift.wrongTypes)
      this.logger.warning(
        `${this.name}.${entry.column} is ${entry.actual}, the definition expects ${entry.expected}; types are never changed automatically (write an expand/contract migration).`
      )
    const addition = resourceAddition(resource, drift)
    if (!addition.fields && !addition.unique) {
      this.logger.info(
        `${this.name}: the database already has every column, join table and unique index.`
      )
      return
    }
    // Next to the resource's create-migration, or in its module's migrations folder.
    let folder = `app/modules/${registry.owner(this.name)}/migrations`
    const migrations = await new MigrationRunner(db, this.app, { direction: 'up' }).getList()
    for (const entry of migrations)
      for (const extension of ['.ts', '.js'])
        try {
          const source = await readFile(this.app.makePath(`${entry.name}${extension}`), 'utf8')
          if (embeddedResource(source) === this.name) folder = dirname(entry.name)
          break
        } catch {}
    const file = `${folder}/${Date.now()}_alter_${this.name}.ts`
    await mkdir(this.app.makePath(folder), { recursive: true })
    await writeFile(this.app.makePath(file), additionMigrationSource(this.name, addition), {
      flag: 'wx',
    })
    for (const line of describeDrift(drift)) this.logger.info(line)
    this.logger.success(file)
    this.logger.info('Review the migration, then run migration:run after the deployment backup.')
  }
}
