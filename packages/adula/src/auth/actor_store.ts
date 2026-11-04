import type { Knex } from 'knex'
import type { Actor, Rule } from './ability.js'
import { actorConditionField, resolveActorConditions } from './conditions.js'
import type { ResourceRegistry } from '../resource/registry.js'

export interface ActorCache {
  get(key: string): Promise<Actor | undefined>
  set(key: string, value: Actor): Promise<void>
}

export class ActorStore {
  constructor(
    private db: Knex,
    private registry: ResourceRegistry,
    private cache?: ActorCache
  ) {}
  /**
   * Loads a user's actor. A caller holding a transaction passes it as `db`, so the load
   * never waits for a second pool connection while that transaction holds one.
   */
  async load(id: number, db: Knex = this.db): Promise<Actor> {
    // Revision is read on every request; DB triggers invalidate across workers and tree moves.
    const { version } = await db('authorization_revision').where({ id: 1 }).first('version')
    const key = `ability:${id}:${version}`
    const cached = await this.cache?.get(key)
    if (cached) return cached
    const memberships = await db('user_org_units as u')
      .join('org_units as o', 'o.id', 'u.org_unit_id')
      .where('u.user_id', id)
      .select('o.path')
    const assignments = await db('user_roles as ur')
      .join('roles as r', 'r.id', 'ur.role_id')
      .leftJoin('org_units as o', 'o.id', 'ur.org_unit_id')
      .join('role_rules as rr', 'rr.role_id', 'r.id')
      .where('ur.user_id', id)
      .select('rr.*', 'r.permission_level', 'o.path as role_path')
    const rules: Rule[] = []
    let permissionLevel = 0
    for (const row of assignments) {
      // Privileged field access only comes from deployment-wide roles.
      if (!row.role_path) permissionLevel = Math.max(permissionLevel, row.permission_level)
      const subject = this.registry.all().find((resource) => resource.name === row.subject)
      const rule: Rule = {
        subject: row.subject,
        action: row.action,
        // "$actor.id" becomes this user's id, so CASL and SQL compare a bound integer.
        // On another field of a registered resource it stays, and buildAbility refuses the
        // rule (fail closed). A store built without that resource cannot judge its fields.
        conditions: resolveActorConditions(row.conditions ?? undefined, id, (field) =>
          subject ? actorConditionField(subject, field) : true
        ),
        fields: row.fields ?? undefined,
        inverted: row.inverted,
      }
      if (!row.role_path) {
        rules.push(rule)
        continue
      }
      for (const resource of this.registry
        .all()
        .filter((r) => r.scoped && (rule.subject === 'all' || rule.subject === r.name))) {
        if (rule.conditions?.orgPath) throw new Error('orgPath is reserved for role scope')
        rules.push({
          ...rule,
          subject: resource.name,
          conditions: { ...rule.conditions, orgPath: row.role_path },
        })
        rules.push({
          ...rule,
          subject: resource.name,
          conditions: { ...rule.conditions, orgPath: { $like: `${row.role_path}.%` } },
        })
      }
    }
    const actor: Actor = { id, orgPaths: memberships.map((r) => r.path), permissionLevel, rules }
    await this.cache?.set(key, actor)
    return actor
  }
}
