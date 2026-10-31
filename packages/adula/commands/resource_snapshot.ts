import { BaseCommand, args } from '@adonisjs/core/ace'
import { readFile, writeFile } from 'node:fs/promises'
import { MigrationRunner } from '@adonisjs/lucid/migration'
import type { ResourceRegistry } from '../src/resource/registry.js'
import {
  embeddedResource,
  resourceSnapshot,
  rewriteResourceSnapshot,
} from '../src/commands/snapshot.js'

/**
 * Rewrites the definition embedded in a resource's generated create-migration from the
 * current resource, while that migration has not run yet (#20). A migration that already
 * ran is never edited: change the table with a new expand migration instead.
 *
 * @deprecated Use adula:resource:migration after the create-migration ran (ADR 045).
 */
export default class ResourceSnapshot extends BaseCommand {
  static commandName = 'adula:resource:snapshot'
  static description =
    "Refresh a pending generated create-migration from the resource's current definition"
  static options = { startApp: true }
  @args.string({ description: 'Resource name' }) declare name: string
  async run() {
    this.logger.warning(
      'adula:resource:snapshot is deprecated (ADR 045): run the create-migration as scaffolded, then add later fields with node ace adula:resource:migration <name>.'
    )
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
    const migrations = await new MigrationRunner(db, this.app, { direction: 'up' }).getList()
    const matches: { file: string; source: string; pending: boolean }[] = []
    for (const entry of migrations)
      for (const extension of ['.ts', '.js'])
        try {
          const file = `${entry.name}${extension}`
          const source = await readFile(this.app.makePath(file), 'utf8')
          if (embeddedResource(source) === this.name)
            matches.push({ file, source, pending: entry.status === 'pending' })
          break
        } catch {}
    const pending = matches.filter((match) => match.pending)
    if (!pending.length) {
      this.logger.error(
        matches.length
          ? `${matches[0].file} already ran; never edit it. Add an expand migration for the new columns instead.`
          : `No generated create-migration embeds ${this.name}.`
      )
      this.exitCode = 1
      return
    }
    for (const match of pending) {
      await writeFile(
        this.app.makePath(match.file),
        rewriteResourceSnapshot(match.source, resourceSnapshot(resource))
      )
      this.logger.success(match.file)
    }
    this.logger.info(
      'Update the model, factory and contract fixture to the same fields, then run migration:run.'
    )
  }
}
