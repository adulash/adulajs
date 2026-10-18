import { BaseCommand, args, flags } from '@adonisjs/core/ace'
import { generateResource } from '../src/commands/generator.js'
import { fileURLToPath } from 'node:url'
export default class Resource extends BaseCommand {
  static commandName = 'adula:resource'
  static description =
    'Generate a scoped resource, migration, model, validator, factory and security contract'
  @args.string() declare name: string
  @flags.string() declare module: string
  async run() {
    if (!this.module) {
      this.logger.error('--module is required')
      this.exitCode = 1
      return
    }
    const files = await generateResource(fileURLToPath(this.app.appRoot), this.name, this.module)
    files.forEach((file) => this.logger.success(file))
    this.logger.info(
      'Set the Arabic labels (label: the plural list heading; recordLabel: the singular record noun; label.en and other languages are optional) and fill the resource definition. The generated migration embeds the definition as scaffolded: after filling the definition, run `node ace adula:resource:snapshot <name>` to refresh the pending migration, and update the model, factory and contract fixture, before migration:run. adula:doctor reports a pending migration that differs. Then run the generated security contract.'
    )
  }
}
