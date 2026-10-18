import { BaseCommand, flags } from '@adonisjs/core/ace'

export default class AdulaRuntimeHealth extends BaseCommand {
  static commandName = 'adula:runtime:health'
  static description = 'Check the worker or single scheduler heartbeat'
  static options = { startApp: true }
  @flags.string({ default: 'worker' }) declare service: string
  async run() {
    if (!['worker', 'scheduler'].includes(this.service)) throw new Error('Unknown service')
    const { Settings } = await import('../src/services/settings.js')
    const { default: db } = await import('@adonisjs/lucid/services/db')
    const last = await new Settings(db.connection().getWriteClient()).get<string>(
      `${this.service}.heartbeat`
    )
    const age = Date.now() - Date.parse(last ?? '')
    const healthy = Number.isFinite(age) && age >= 0 && age < 60000
    this.logger.log(`${this.service}: ${healthy ? 'healthy' : 'unhealthy'}`)
    if (!healthy) this.exitCode = 1
  }
}
