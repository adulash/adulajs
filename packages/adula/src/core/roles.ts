import type { Knex } from 'knex'
import type { ResourceRegistry } from '../resource/registry.js'
import type { Action, Label, ModuleRole, Resource } from '../resource/types.js'
import type { Conditions } from '../auth/conditions.js'
import { conditionSql } from '../auth/sql.js'
import { resolveActorConditions, usesActor } from '../auth/conditions.js'
import { AdulaError } from '../admin/errors.js'
import { logActivity } from './activity.js'
import { administrationGuard } from './administration_guard.js'

export type RoleSummary = {
  id: number
  /**
   * Stable identifier addressed by workflows and module defaults. The display name
   * can change freely; the key is set once.
   */
  key: string | null
  name: string
  permissionLevel: number
  rules: number
  users: number
}
export type RoleRule = {
  id: number
  subject: string
  action: string
  inverted: boolean
  conditions: Conditions | null
  fields: string[] | null
}
export type RoleDetail = Omit<RoleSummary, 'rules'> & { rules: RoleRule[] }
export type RuleInput = {
  subject: string
  action: string
  inverted?: boolean
  conditions?: Conditions | null
  fields?: string[] | null
}
export type MatrixField = {
  key: string
  label: Label
  type: string
  conditionable: boolean
  /** Accepts the current user ("$actor.id") as a condition value: user fields, createdBy, updatedBy. */
  actor?: boolean
}
export type MatrixSubject = {
  name: string
  label: Label
  actions: string[]
  fields: MatrixField[]
  /** Standard columns the resource actually has plus its conditionable fields. */
  conditionFields: MatrixField[]
}
export type RoleMatrix = { actions: string[]; subjects: MatrixSubject[] }

const RESOURCE = 'core.roles'
const ACTION_ORDER: Action[] = ['view', 'create', 'update', 'delete', 'submit', 'cancel', 'amend']
export const ALL_SUBJECT_LABEL: Label = { ar: 'كل الكيانات', en: 'All resources' }

function standardConditionFields(resource: Resource): MatrixField[] {
  const field = (key: string, ar: string, en: string): MatrixField => ({
    key,
    label: { ar, en },
    type: 'integer',
    conditionable: true,
    ...(['createdBy', 'updatedBy'].includes(key) ? { actor: true } : {}),
  })
  return [
    field('id', 'المعرّف', 'ID'),
    field('createdBy', 'أنشأه', 'Created by'),
    field('updatedBy', 'عدّله', 'Updated by'),
    ...(resource.scoped ? [field('orgUnitId', 'الوحدة التنظيمية', 'Organization unit')] : []),
    ...(resource.submittable ? [field('docStatus', 'حالة المستند', 'Document status')] : []),
    ...(resource.version ? [field('version', 'الإصدار', 'Version')] : []),
  ]
}
function matrixFields(resource: Resource): MatrixField[] {
  return Object.entries(resource.fields).map(([key, field]) => ({
    key,
    label: field.label,
    type: field.type,
    conditionable: !['hasMany', 'json', 'attachment'].includes(field.type),
    ...(field.type === 'user' ? { actor: true } : {}),
  }))
}

function roleName(value: unknown) {
  const name = typeof value === 'string' ? value.trim() : ''
  if (!name || name.length > 100)
    throw new AdulaError(422, 'E_ROLE_NAME', 'اسم الدور مطلوب (حتى 100 حرف)')
  return name
}
/** A role key: lower-case letters, digits and underscores, starting with a letter. */
export function roleKey(value: unknown) {
  const key = typeof value === 'string' ? value.trim() : ''
  if (!/^[a-z][a-z0-9_]{0,99}$/.test(key))
    throw new AdulaError(
      422,
      'E_ROLE_KEY',
      'مفتاح الدور حروف إنجليزية صغيرة وأرقام وشرطة سفلية، ويبدأ بحرف (مثل project_manager)'
    )
  return key
}
function permissionLevel(value: unknown) {
  const level = Number(value ?? 0)
  if (!Number.isSafeInteger(level) || level < 0 || level > 9)
    throw new AdulaError(422, 'E_ROLE_LEVEL', 'مستوى الصلاحية رقم بين 0 و9')
  return level
}
function toRule(row: Record<string, unknown>): RoleRule {
  return {
    id: Number(row.id),
    subject: String(row.subject),
    action: String(row.action),
    inverted: Boolean(row.inverted),
    conditions: (row.conditions as Conditions | null) ?? null,
    fields: (row.fields as string[] | null) ?? null,
  }
}

export class RolesAdmin {
  constructor(
    private db: Knex,
    private registry: ResourceRegistry
  ) {}

  async list(): Promise<RoleSummary[]> {
    const rows = await this.db('roles as r')
      .select(
        'r.id',
        'r.key',
        'r.name',
        'r.permission_level',
        this.db.raw('(SELECT count(*) FROM role_rules rr WHERE rr.role_id = r.id) AS rules'),
        this.db.raw(
          '(SELECT count(DISTINCT ur.user_id) FROM user_roles ur WHERE ur.role_id = r.id) AS users'
        )
      )
      .orderBy('r.name')
    return rows.map((row) => ({
      id: row.id,
      key: row.key ?? null,
      name: row.name,
      permissionLevel: row.permission_level,
      rules: Number(row.rules),
      users: Number(row.users),
    }))
  }

  async get(id: number): Promise<RoleDetail> {
    const role = await this.find(this.db, id)
    const rules = await this.db('role_rules')
      .where('role_id', id)
      .orderBy(['subject', 'action', 'inverted'])
    const users = await this.db('user_roles')
      .where('role_id', id)
      .countDistinct('user_id as count')
      .first()
    return {
      id: role.id,
      key: role.key ?? null,
      name: role.name,
      permissionLevel: role.permission_level,
      users: Number(users?.count ?? 0),
      rules: rules.map(toRule),
    }
  }

  async create(
    actorId: number,
    input: { name: string; key?: string | null; permissionLevel?: number }
  ) {
    const name = roleName(input.name)
    const key =
      input.key === undefined || input.key === null || input.key === '' ? null : roleKey(input.key)
    const level = permissionLevel(input.permissionLevel)
    return this.db.transaction(async (trx) => {
      if (await trx('roles').where('name', name).first())
        throw new AdulaError(409, 'E_ROLE_EXISTS', 'يوجد دور بهذا الاسم')
      if (key && (await trx('roles').where('key', key).first()))
        throw new AdulaError(409, 'E_ROLE_KEY_EXISTS', 'يوجد دور بهذا المفتاح')
      const [role] = await trx('roles')
        .insert({ name, key, permission_level: level })
        .returning('*')
      await logActivity(trx, {
        resource: RESOURCE,
        recordId: role.id,
        actorId,
        action: 'create',
        changes: { name, key, permissionLevel: level },
      })
      return { id: role.id as number, key, name, permissionLevel: level }
    })
  }

  /**
   * Gives a role its stable key. A key is set once: workflows and module defaults
   * depend on it, so changing it would silently detach them.
   */
  async setKey(actorId: number, id: number, value: string) {
    const key = roleKey(value)
    return this.db.transaction(async (trx) => {
      const role = await this.find(trx, id)
      if (role.key === key) return
      if (role.key)
        throw new AdulaError(
          409,
          'E_ROLE_KEY_FIXED',
          'مفتاح الدور ثابت بعد تعيينه لأن تدفقات العمل والتطبيقات تعتمد عليه'
        )
      if (await trx('roles').where('key', key).whereNot('id', id).first())
        throw new AdulaError(409, 'E_ROLE_KEY_EXISTS', 'يوجد دور بهذا المفتاح')
      await trx('roles').where('id', id).update({ key })
      await logActivity(trx, {
        resource: RESOURCE,
        recordId: id,
        actorId,
        action: 'set_key',
        changes: { key },
      })
    })
  }

  async rename(actorId: number, id: number, value: string) {
    const name = roleName(value)
    return this.db.transaction(async (trx) => {
      const role = await this.find(trx, id)
      if (role.name === 'administrator' && name !== role.name)
        throw new AdulaError(
          409,
          'E_BOOTSTRAP_ROLE',
          'اسم دور مدير النظام الأساسي محمي لاستعادة الوصول عند الحاجة'
        )
      if (await trx('roles').where('name', name).whereNot('id', id).first())
        throw new AdulaError(409, 'E_ROLE_EXISTS', 'يوجد دور بهذا الاسم')
      await trx('roles').where('id', id).update({ name })
      await logActivity(trx, {
        resource: RESOURCE,
        recordId: id,
        actorId,
        action: 'rename',
        changes: { from: role.name, to: name },
      })
    })
  }

  async setPermissionLevel(actorId: number, id: number, value: number) {
    const level = permissionLevel(value)
    return this.db.transaction(async (trx) => {
      const role = await this.find(trx, id)
      await trx('roles').where('id', id).update({ permission_level: level })
      await logActivity(trx, {
        resource: RESOURCE,
        recordId: id,
        actorId,
        action: 'set_level',
        changes: { from: role.permission_level, to: level },
      })
    })
  }

  async delete(actorId: number, id: number) {
    return this.db.transaction(async (trx) => {
      const role = await this.find(trx, id)
      const assigned = await trx('user_roles').where('role_id', id).first()
      if (assigned) throw new AdulaError(409, 'E_ROLE_IN_USE', 'لا يمكن حذف دور مسند إلى مستخدمين')
      await trx('roles').where('id', id).delete()
      await logActivity(trx, {
        resource: RESOURCE,
        recordId: id,
        actorId,
        action: 'delete',
        changes: { name: role.name },
      })
    })
  }

  /** Subjects × actions derived from the registry; the UI never hard-codes resources. */
  matrix(): RoleMatrix {
    const resources = this.registry.all()
    const union = ACTION_ORDER.filter((action) =>
      resources.some((resource) => resource.actions.includes(action))
    )
    return {
      actions: [...union, 'invite', 'manage'],
      subjects: [
        {
          name: 'all',
          label: ALL_SUBJECT_LABEL,
          actions: [...union, 'invite', 'manage'],
          fields: [],
          conditionFields: [],
        },
        {
          name: 'core.users',
          label: { ar: 'دعوات المستخدمين', en: 'User invitations' },
          actions: ['invite', 'manage'],
          fields: [],
          conditionFields: [],
        },
        ...resources.map((resource) => {
          const fields = matrixFields(resource)
          return {
            name: resource.name,
            label: resource.label,
            actions: [...ACTION_ORDER.filter((a) => resource.actions.includes(a)), 'manage'],
            fields,
            conditionFields: [
              ...standardConditionFields(resource),
              ...fields.filter((field) => field.conditionable),
            ],
          }
        }),
      ],
    }
  }

  async setRule(actorId: number, roleId: number, input: RuleInput): Promise<RoleRule> {
    const rule = this.validateRule(input)
    return this.db.transaction(async (trx) => {
      const verifyAccess = await administrationGuard(trx, actorId)
      await this.find(trx, roleId)
      const values = {
        conditions: rule.conditions ? JSON.stringify(rule.conditions) : null,
        fields: rule.fields ? JSON.stringify(rule.fields) : null,
      }
      const existing = await trx('role_rules')
        .where({
          role_id: roleId,
          subject: rule.subject,
          action: rule.action,
          inverted: rule.inverted,
        })
        .first()
      const [row] = existing
        ? await trx('role_rules').where('id', existing.id).update(values).returning('*')
        : await trx('role_rules')
            .insert({
              role_id: roleId,
              subject: rule.subject,
              action: rule.action,
              inverted: rule.inverted,
              ...values,
            })
            .returning('*')
      const saved = toRule(row)
      await verifyAccess()
      await logActivity(trx, {
        resource: RESOURCE,
        recordId: roleId,
        actorId,
        action: 'set_rule',
        changes: { rule: saved },
      })
      return saved
    })
  }

  async removeRule(actorId: number, roleId: number, ruleId: number) {
    return this.db.transaction(async (trx) => {
      const verifyAccess = await administrationGuard(trx, actorId)
      await this.find(trx, roleId)
      const [row] = await trx('role_rules')
        .where({ id: ruleId, role_id: roleId })
        .delete()
        .returning('*')
      if (!row) throw new AdulaError(404, 'E_RULE_NOT_FOUND', 'القاعدة غير موجودة')
      await verifyAccess()
      await logActivity(trx, {
        resource: RESOURCE,
        recordId: roleId,
        actorId,
        action: 'remove_rule',
        changes: { rule: toRule(row) },
      })
    })
  }

  /**
   * Creates module default roles that no role holds the key of yet, with their rules
   * validated exactly like setRule. Existing roles are never modified. A keyless role
   * with the same display name is adopted by receiving the key, rules untouched.
   */
  async ensureDefaults(actorId: number, roles: readonly ModuleRole[]) {
    const prepared = roles.map((role) => {
      const key = roleKey(role.key)
      const name = roleName(role.name)
      const level = permissionLevel(role.permissionLevel)
      const rules = role.rules.map((rule) => {
        try {
          return this.validateRule(rule)
        } catch (error) {
          throw new Error(`Default role ${key}: ${(error as Error).message}`)
        }
      })
      return { key, name, level, rules }
    })
    const result = { created: [] as string[], adopted: [] as string[], kept: [] as string[] }
    await this.db.transaction(async (trx) => {
      for (const role of prepared) {
        if (await trx('roles').where('key', role.key).first('id')) {
          result.kept.push(role.key)
          continue
        }
        const named = await trx('roles').where('name', role.name).first()
        if (named) {
          // A role with this name but another key belongs to the administrator.
          if (named.key) {
            result.kept.push(role.key)
            continue
          }
          await trx('roles').where('id', named.id).update({ key: role.key })
          await logActivity(trx, {
            resource: RESOURCE,
            recordId: named.id,
            actorId,
            action: 'set_key',
            changes: { key: role.key, source: 'module default' },
          })
          result.adopted.push(role.key)
          continue
        }
        const [created] = await trx('roles')
          .insert({ key: role.key, name: role.name, permission_level: role.level })
          .returning('id')
        for (const rule of role.rules)
          await trx('role_rules').insert({
            role_id: created.id,
            subject: rule.subject,
            action: rule.action,
            inverted: rule.inverted,
            conditions: rule.conditions ? JSON.stringify(rule.conditions) : null,
            fields: rule.fields ? JSON.stringify(rule.fields) : null,
          })
        await logActivity(trx, {
          resource: RESOURCE,
          recordId: created.id,
          actorId,
          action: 'create',
          changes: {
            name: role.name,
            key: role.key,
            permissionLevel: role.level,
            rules: role.rules.length,
            source: 'module default',
          },
        })
        result.created.push(role.key)
      }
    })
    return result
  }

  private validateRule(input: RuleInput) {
    const subject = typeof input.subject === 'string' ? input.subject : ''
    let resource: Resource | undefined
    if (subject !== 'all' && subject !== 'core.users') {
      try {
        resource = this.registry.get(subject)
      } catch {
        throw new AdulaError(422, 'E_RULE_SUBJECT', 'الكيان غير معروف')
      }
    }
    const action = typeof input.action === 'string' ? input.action : ''
    const allowed: string[] =
      subject === 'core.users'
        ? ['invite', 'manage']
        : resource
          ? [...resource.actions, 'manage']
          : [...new Set(this.registry.all().flatMap((r) => [...r.actions])), 'invite', 'manage']
    if (!allowed.includes(action as Action))
      throw new AdulaError(422, 'E_RULE_ACTION', 'الإجراء غير متاح لهذا الكيان')
    const inverted = Boolean(input.inverted)
    let conditions: Conditions | null = null
    if (
      input.conditions !== undefined &&
      input.conditions !== null &&
      !(
        typeof input.conditions === 'object' &&
        !Array.isArray(input.conditions) &&
        !Object.keys(input.conditions).length
      )
    ) {
      if (!resource) throw new AdulaError(422, 'E_RULE_CONDITIONS', 'الشروط تتطلب اختيار كيان محدد')
      if (typeof input.conditions !== 'object' || Array.isArray(input.conditions))
        throw new AdulaError(422, 'E_RULE_CONDITIONS', 'الشروط يجب أن تكون كائناً')
      if ('orgPath' in input.conditions)
        throw new AdulaError(422, 'E_RULE_CONDITIONS', 'orgPath محجوز لنطاق الدور')
      const conditionable = new Set(
        [...standardConditionFields(resource), ...matrixFields(resource)]
          .filter((field) => field.conditionable)
          .map((field) => field.key)
      )
      for (const field of Object.keys(input.conditions))
        if (!conditionable.has(field))
          throw new AdulaError(422, 'E_RULE_CONDITIONS', `الحقل ${field} لا يقبل الشروط`)
      const actorFields = new Set(
        [...standardConditionFields(resource), ...matrixFields(resource)]
          .filter((field) => field.actor)
          .map((field) => field.key)
      )
      for (const [field, condition] of Object.entries(input.conditions))
        if (usesActor({ [field]: condition } as Conditions)) {
          if (!actorFields.has(field))
            throw new AdulaError(
              422,
              'E_RULE_CONDITIONS',
              `المستخدم الحالي يُستخدم مع حقول المستخدمين وأنشأه وعدّله فقط: ${field}`
            )
          const operators =
            condition !== null && typeof condition === 'object' ? Object.keys(condition) : ['$eq']
          if (operators.some((operator) => !['$eq', '$ne', '$in'].includes(operator)))
            throw new AdulaError(
              422,
              'E_RULE_CONDITIONS',
              'المستخدم الحالي يقبل عوامل يساوي ولا يساوي وضمن قائمة فقط'
            )
        }
      try {
        // The placeholder is an integer id at request time; validate it as one.
        conditionSql(resolveActorConditions(input.conditions, 1), resource)
      } catch (error) {
        throw new AdulaError(422, 'E_RULE_CONDITIONS', `شرط غير مدعوم: ${(error as Error).message}`)
      }
      conditions = input.conditions
    }
    let fields: string[] | null = null
    if (
      input.fields !== undefined &&
      input.fields !== null &&
      !(Array.isArray(input.fields) && !input.fields.length)
    ) {
      if (!resource)
        throw new AdulaError(422, 'E_RULE_FIELDS', 'قائمة الحقول تتطلب اختيار كيان محدد')
      if (!Array.isArray(input.fields) || !input.fields.every((f) => typeof f === 'string'))
        throw new AdulaError(422, 'E_RULE_FIELDS', 'قائمة الحقول غير صالحة')
      for (const field of input.fields)
        if (!(field in resource.fields))
          throw new AdulaError(422, 'E_RULE_FIELDS', `الحقل ${field} غير معروف`)
      fields = [...new Set(input.fields)]
    }
    return { subject, action, inverted, conditions, fields }
  }

  private async find(db: Knex, id: number) {
    const role = await db('roles').where('id', id).first()
    if (!role) throw new AdulaError(404, 'E_ROLE_NOT_FOUND', 'الدور غير موجود')
    return role
  }
}
