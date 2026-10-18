import type { Knex } from 'knex'
import { AdulaError } from '../admin/errors.js'
import { logActivity, pageLimit } from './activity.js'
import { administrationGuard } from './administration_guard.js'
import { escapeLike } from './like.js'

export type UserRoleAssignment = {
  id: number
  roleId: number
  role: string
  orgUnitId: number | null
  orgUnit: string | null
}
export type UserOrgUnit = { id: number; name: string; path: string }
export type UserSummary = {
  id: number
  fullName: string | null
  email: string
  disabledAt: string | null
  roles: UserRoleAssignment[]
  orgUnits: UserOrgUnit[]
}
export type UserPage = { data: UserSummary[]; nextCursor: number | null }

const RESOURCE = 'core.users'

/** Host applications own the users table; AdulaJS expects id, email, full_name and disabled_at. */
export class UsersAdmin {
  constructor(private db: Knex) {}

  async list(
    options: { search?: string; cursor?: number; limit?: number } = {}
  ): Promise<UserPage> {
    const limit = pageLimit(options.limit)
    const query = this.db('users')
      .select('id', 'email', 'full_name', 'disabled_at')
      .orderBy('id')
      .limit(limit + 1)
    const search = options.search?.trim()
    if (search) {
      const pattern = `%${escapeLike(search)}%`
      query.where((where) => where.whereILike('email', pattern).orWhereILike('full_name', pattern))
    }
    if (options.cursor) query.where('id', '>', options.cursor)
    const rows = await query
    const page = rows.slice(0, limit)
    const data = await this.hydrate(page)
    return { data, nextCursor: rows.length > limit ? page[page.length - 1].id : null }
  }

  async get(id: number): Promise<UserSummary> {
    const [user] = await this.hydrate([await this.find(this.db, id)])
    return user
  }

  async assignRole(
    actorId: number,
    userId: number,
    roleId: number,
    orgUnitId: number | null = null
  ) {
    return this.db.transaction(async (trx) => {
      const verifyAccess = await administrationGuard(trx, actorId)
      await this.find(trx, userId)
      const role = await trx('roles').where('id', roleId).first()
      if (!role) throw new AdulaError(404, 'E_ROLE_NOT_FOUND', 'الدور غير موجود')
      if (orgUnitId !== null && !(await trx('org_units').where('id', orgUnitId).first()))
        throw new AdulaError(404, 'E_ORG_NOT_FOUND', 'الوحدة التنظيمية غير موجودة')
      const duplicate = await trx('user_roles')
        .where({ user_id: userId, role_id: roleId })
        .andWhere((where) =>
          orgUnitId === null
            ? where.whereNull('org_unit_id')
            : where.where('org_unit_id', orgUnitId)
        )
        .first()
      if (duplicate) throw new AdulaError(409, 'E_ROLE_ASSIGNED', 'هذا الدور مسند بالفعل')
      const [row] = await trx('user_roles')
        .insert({ user_id: userId, role_id: roleId, org_unit_id: orgUnitId })
        .returning('id')
      await verifyAccess()
      await logActivity(trx, {
        resource: RESOURCE,
        recordId: userId,
        actorId,
        action: 'assign_role',
        changes: { roleId, role: role.name, orgUnitId },
      })
      return row.id as number
    })
  }

  async removeRole(actorId: number, userId: number, assignmentId: number) {
    return this.db.transaction(async (trx) => {
      const verifyAccess = await administrationGuard(trx, actorId)
      const [row] = await trx('user_roles')
        .where({ id: assignmentId, user_id: userId })
        .delete()
        .returning('*')
      if (!row) throw new AdulaError(404, 'E_ROLE_NOT_ASSIGNED', 'الإسناد غير موجود')
      await verifyAccess()
      await logActivity(trx, {
        resource: RESOURCE,
        recordId: userId,
        actorId,
        action: 'remove_role',
        changes: { roleId: row.role_id, orgUnitId: row.org_unit_id },
      })
    })
  }

  async assignOrgUnit(actorId: number, userId: number, orgUnitId: number) {
    return this.db.transaction(async (trx) => {
      await this.find(trx, userId)
      const unit = await trx('org_units').where('id', orgUnitId).first()
      if (!unit) throw new AdulaError(404, 'E_ORG_NOT_FOUND', 'الوحدة التنظيمية غير موجودة')
      if (await trx('user_org_units').where({ user_id: userId, org_unit_id: orgUnitId }).first())
        throw new AdulaError(409, 'E_MEMBERSHIP_EXISTS', 'المستخدم عضو في هذه الوحدة بالفعل')
      await trx('user_org_units').insert({ user_id: userId, org_unit_id: orgUnitId })
      await logActivity(trx, {
        resource: RESOURCE,
        recordId: userId,
        actorId,
        action: 'assign_org_unit',
        changes: { orgUnitId, orgUnit: unit.name },
      })
    })
  }

  async removeOrgUnit(actorId: number, userId: number, orgUnitId: number) {
    return this.db.transaction(async (trx) => {
      const removed = await trx('user_org_units')
        .where({ user_id: userId, org_unit_id: orgUnitId })
        .delete()
      if (!removed) throw new AdulaError(404, 'E_MEMBERSHIP_NOT_FOUND', 'العضوية غير موجودة')
      await logActivity(trx, {
        resource: RESOURCE,
        recordId: userId,
        actorId,
        action: 'remove_org_unit',
        changes: { orgUnitId },
      })
    })
  }

  async disable(actorId: number, userId: number) {
    if (actorId === userId)
      throw new AdulaError(422, 'E_SELF_DISABLE', 'لا يمكنك تعطيل حسابك الحالي')
    return this.db.transaction(async (trx) => {
      const verifyAccess = await administrationGuard(trx, actorId)
      await this.find(trx, userId)
      await trx('users')
        .where('id', userId)
        .whereNull('disabled_at')
        .update({ disabled_at: trx.fn.now() })
      await verifyAccess()
      await logActivity(trx, { resource: RESOURCE, recordId: userId, actorId, action: 'disable' })
    })
  }

  async enable(actorId: number, userId: number) {
    return this.db.transaction(async (trx) => {
      await this.find(trx, userId)
      await trx('users').where('id', userId).update({ disabled_at: null })
      await logActivity(trx, { resource: RESOURCE, recordId: userId, actorId, action: 'enable' })
    })
  }

  private async find(db: Knex, id: number) {
    const user = await db('users')
      .select('id', 'email', 'full_name', 'disabled_at')
      .where('id', id)
      .first()
    if (!user) throw new AdulaError(404, 'E_USER_NOT_FOUND', 'المستخدم غير موجود')
    return user
  }

  private async hydrate(rows: Record<string, unknown>[]): Promise<UserSummary[]> {
    if (!rows.length) return []
    const ids = rows.map((row) => row.id as number)
    const roles = await this.db('user_roles as ur')
      .join('roles as r', 'r.id', 'ur.role_id')
      .leftJoin('org_units as o', 'o.id', 'ur.org_unit_id')
      .whereIn('ur.user_id', ids)
      .select(
        'ur.id',
        'ur.user_id',
        'ur.role_id',
        'r.name as role',
        'ur.org_unit_id',
        'o.name as org_unit'
      )
      .orderBy(['r.name', 'ur.id'])
    const units = await this.db('user_org_units as m')
      .join('org_units as o', 'o.id', 'm.org_unit_id')
      .whereIn('m.user_id', ids)
      .select('m.user_id', 'o.id', 'o.name', 'o.path')
      .orderBy('o.path')
    return rows.map((row) => ({
      id: row.id as number,
      fullName: (row.full_name as string | null) ?? null,
      email: row.email as string,
      disabledAt: row.disabled_at ? new Date(row.disabled_at as string).toISOString() : null,
      roles: roles
        .filter((role) => role.user_id === row.id)
        .map((role) => ({
          id: role.id,
          roleId: role.role_id,
          role: role.role,
          orgUnitId: role.org_unit_id ?? null,
          orgUnit: role.org_unit ?? null,
        })),
      orgUnits: units
        .filter((unit) => unit.user_id === row.id)
        .map((unit) => ({ id: unit.id, name: unit.name, path: String(unit.path) })),
    }))
  }
}
