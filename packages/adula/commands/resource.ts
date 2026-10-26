import { BaseCommand, args, flags } from '@adonisjs/core/ace'
import { generateResource } from '../src/commands/generator.js'
import { fileURLToPath } from 'node:url'
export default class Resource extends BaseCommand {
  static commandName = 'adula:resource'
  static description =
    'Generate a scoped resource, its create-migration and security contract (validator and model are derived; opt in with --validator / --model)'
  @args.string() declare name: string
  @flags.string() declare module: string
  @flags.boolean({ description: 'Also write a VineJS validator file instead of the derived one' })
  declare validator: boolean
  @flags.boolean({ description: 'Also write a Lucid model and factory for your own code' })
  declare model: boolean
  async run() {
    if (!this.module) {
      this.logger.error('--module is required')
      this.exitCode = 1
      return
    }
    const files = await generateResource(fileURLToPath(this.app.appRoot), this.name, this.module, {
      validator: Boolean(this.validator),
      model: Boolean(this.model),
    })
    files.forEach((file) => this.logger.success(file))
    this.logger.info(
      'Set the Arabic labels (label: the plural list heading; recordLabel: the singular record noun; label.en and other languages are optional) and fill the resource definition: its fields decide validation, columns and forms. The generated migration embeds the definition as scaffolded: run migration:run, then after adding fields run `node ace adula:resource:migration <name>` for an additive migration of what the table lacks. adula:doctor reports tables that differ from their definitions. Then run the generated security contract.'
    )
  }
}
