import { BaseCommand, args, flags } from '@adonisjs/core/ace'
import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { identifier } from '../src/resource/define_resource.js'
import {
  MODULE_DIRECTORIES,
  moduleSource,
  registerModuleSource,
} from '../src/commands/source_markers.js'

export default class ModuleAdd extends BaseCommand {
  static commandName = 'adula:module:add'
  static description = 'Create and register an application-owned module'
  @args.string() declare name: string
  @flags.boolean({ description: 'Mark a disposable reference module' }) declare reference: boolean
  async run() {
    identifier(this.name)
    if (this.app.inProduction)
      throw new Error('Generate modules in the source checkout, not in production')
    const path = this.app.makePath('app/modules', this.name)
    try {
      await access(path)
      throw new Error(`Module directory already exists: ${this.name}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const indexPath = this.app.makePath('start/modules.ts')
    const next = registerModuleSource(await readFile(indexPath, 'utf8'), this.name)
    for (const directory of MODULE_DIRECTORIES)
      await mkdir(this.app.makePath('app/modules', this.name, directory), { recursive: true })
    await writeFile(
      this.app.makePath('app/modules', this.name, 'module.ts'),
      moduleSource(this.name, { reference: Boolean(this.reference), typed: true }),
      { flag: 'wx' }
    )
    await writeFile(indexPath, next)
    this.logger.success(
      `Created ${this.name}. Fill the Arabic labels (other languages are optional) and declare dependencies before adding resources.`
    )
  }
}
