import { BaseCommand, flags } from '@adonisjs/core/ace'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import type { ResourceRegistry } from '../src/resource/registry.js'
import type { Actor } from '../src/auth/ability.js'
import { ActorStore } from '../src/auth/actor_store.js'
import { openApiDocument } from '../src/integrations/openapi.js'
import { apiClientName, apiClientReadme, apiClientSource } from '../src/integrations/api_client.js'
import { ADULA_VERSION } from '../src/version.js'

/**
 * Writes clients/<system>/index.ts, a typed API client of every registered resource
 * (or of what one user may use), and its README with token usage.
 */
export default class Client extends BaseCommand {
  static commandName = 'adula:client'
  static description =
    'Generate a typed TypeScript client of the bearer-token resource API in clients/<system>/'
  static options = { startApp: true }
  @flags.number({
    flagName: 'as-user',
    description: 'Describe only what this user id may use (default: the full registry)',
  })
  declare asUser: number | undefined
  @flags.string({ description: 'Default server URL in the client (default: APP_URL)' })
  declare url: string | undefined
  @flags.string({ description: 'Output directory (default: clients/<system name>)' })
  declare output: string | undefined

  async run() {
    const { registry } = (await this.app.import('#start/modules')) as {
      registry: ResourceRegistry
    }
    let actor: Actor | undefined
    if (this.asUser !== undefined) {
      if (!Number.isSafeInteger(this.asUser) || this.asUser <= 0) {
        this.logger.error('--as-user must be a user id')
        this.exitCode = 1
        return
      }
      const { default: db } = await import('@adonisjs/lucid/services/db')
      const knex = db.connection().getWriteClient()
      if (!(await knex('users').where('id', this.asUser).first('id'))) {
        this.logger.error(`No user with id ${this.asUser}`)
        this.exitCode = 1
        return
      }
      actor = await new ActorStore(knex, registry).load(this.asUser)
    }
    let name = 'app'
    try {
      name = apiClientName(
        JSON.parse(await readFile(this.app.makePath('package.json'), 'utf8')).name
      )
    } catch {}
    const document = openApiDocument(registry, {
      title: name,
      version: ADULA_VERSION,
      serverUrl: this.url ?? process.env.APP_URL ?? 'http://localhost:3333',
      actor,
    })
    const output = this.output ?? `clients/${name}`
    const directory = isAbsolute(output) ? output : this.app.makePath(output)
    await mkdir(directory, { recursive: true })
    await writeFile(`${directory}/index.ts`, apiClientSource(document))
    await writeFile(`${directory}/README.md`, apiClientReadme(name, document))
    this.logger.success(`${directory}/index.ts`)
    this.logger.success(`${directory}/README.md`)
  }
}
