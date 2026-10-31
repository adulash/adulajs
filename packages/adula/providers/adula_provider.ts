import type { ApplicationService } from '@adonisjs/core/types'
import type { Database } from '@adonisjs/lucid/database'
import { ResourceRegistry } from '../src/resource/registry.js'
import { keepCalendarDays } from '../src/database/calendar_days.js'
export default class AdulaProvider {
  constructor(protected app: ApplicationService) {}
  register() {
    this.app.container.singleton(ResourceRegistry, () => new ResourceRegistry())
  }
  /** DATE columns stay calendar days in every time zone (see keepCalendarDays). */
  async boot() {
    if (!this.app.container.hasBinding('lucid.db')) return
    keepCalendarDays((await this.app.container.make('lucid.db')) as Database)
  }
}
