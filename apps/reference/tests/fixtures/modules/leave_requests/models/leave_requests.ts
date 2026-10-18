import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export default class extends BaseModel {
  static table = 'leave_requests'
  @column({ isPrimary: true }) declare id: number
  @column() declare employee: number
  @column() declare startDate: string
  @column() declare endDate: string
  @column() declare reason: string | null
  @column() declare status: string | null
  @column() declare orgUnitId: number
  @column() declare createdBy: number
  @column() declare updatedBy: number
  @column.dateTime({ autoCreate: true }) declare createdAt: DateTime
  @column.dateTime({ autoCreate: true, autoUpdate: true }) declare updatedAt: DateTime
  @column.dateTime() declare deletedAt: DateTime | null
}
