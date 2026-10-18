import { BaseCommand, args, flags } from '@adonisjs/core/ace'
import { fileURLToPath } from 'node:url'
import { planApp, writeAppPlan } from '../src/commands/app_scaffold.js'

export default class App extends BaseCommand {
  static commandName = 'adula:app'
  static description =
    'Create and register a business application: module, example resource, default roles and a smoke test'
  @args.string({ description: 'Application name: lower-case letters, digits and underscores' })
  declare name: string
  @flags.string({ flagName: 'label-ar', description: 'Arabic label shown in the menu (required)' })
  declare labelAr: string
  @flags.string({
    flagName: 'label-en',
    description: 'English label (defaults to the title-cased name)',
  })
  declare labelEn: string
  @flags.boolean({ flagName: 'dry-run', description: 'Print the plan without writing files' })
  declare dryRun: boolean
  async run() {
    if (this.app.inProduction)
      throw new Error('Generate applications in the source checkout, not in production')
    const root = fileURLToPath(this.app.appRoot)
    let plan: Awaited<ReturnType<typeof planApp>>
    try {
      plan = await planApp(root, { name: this.name, labelAr: this.labelAr, labelEn: this.labelEn })
    } catch (error) {
      this.logger.error((error as Error).message)
      this.exitCode = 1
      return
    }
    const files = Object.keys(plan.files)
    if (this.dryRun) {
      this.logger.info(`Dry run: adula:app ${plan.name} would create`)
      for (const directory of plan.directories) this.logger.log(`  ${directory}/`)
      for (const file of files) this.logger.log(`  ${file}`)
      this.logger.log(`  and register module_${plan.name} in start/modules.ts`)
      this.logger.info('Nothing was written.')
      return
    }
    await writeAppPlan(root, plan)
    for (const file of files) this.logger.success(file)
    this.logger.success(`Registered module_${plan.name} in start/modules.ts`)
    this.logger.info(
      [
        'Next steps:',
        `  1. Fill app/modules/${plan.name}/resources/${plan.name}.ts with the real fields, then run \`node ace adula:resource:snapshot ${plan.name}\` and update the model, validator, factory and contract fixture.`,
        '  2. node ace migration:run',
        `  3. node ace adula:install  (creates the roles ${plan.name}_manager and ${plan.name}_user)`,
        `  4. Assign the roles to people on /admin/users, then run node ace test functional --files=${plan.name} --files=${plan.name}/smoke`,
      ].join('\n')
    )
  }
}
