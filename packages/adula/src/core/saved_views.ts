import type { Knex } from 'knex'
import type { ResourceRegistry } from '../resource/registry.js'
import type { Resource } from '../resource/types.js'
import { buildAbility, type Actor, type AdulaAbility } from '../auth/ability.js'
import { AdulaError } from '../admin/errors.js'
import { canQueryField } from '../admin/resource_service.js'
import { logActivity } from './activity.js'
import { filterCondition, type ListFilterValue } from '../admin/resource/query.js'

export type SavedViewQuery = {
  search?: string
  sort?: string
  direction?: 'asc' | 'desc'
  /** Equality values or the operator objects of ADR 046 ({ in }, { gte, lte }, { empty }). */
  filters?: Record<string, ListFilterValue>
}
export type SavedView = {
  id: number
  name: string
  query: SavedViewQuery
  shared: boolean
  own: boolean
}

const NAME_LIMIT = 60
const VIEW_LIMIT = 50
/** Shared views are visible to every viewer of a resource; cap them per resource. */
const SHARED_LIMIT = 100
const ACTIVITY_RESOURCE = 'core.saved_views'

/**
 * A saved view is stored user input that later drives a list query, so every key
 * is validated against the resource definition before it is written and again
 * when it is read back: a field that stopped being sortable or filterable must
 * not resurrect as an unchecked query parameter after an upgrade.
 */
export class SavedViews {
  constructor(
    private db: Knex,
    private registry: ResourceRegistry
  ) {}

  async list(name: string, actor: Actor): Promise<SavedView[]> {
    const { resource } = this.authorize(name, actor)
    // Own views first, so colleagues' shared views can never crowd them out.
    const rows = await this.db('saved_views')
      .where('resource', resource.name)
      .where((where) => where.where('user_id', actor.id).orWhere('shared', true))
      .orderByRaw('(user_id = ?) DESC', [actor.id])
      .orderBy('name')
      .limit(VIEW_LIMIT + SHARED_LIMIT)
    return rows.flatMap((row) => {
      const query = this.sanitize(resource, row.query)
      return query
        ? [
            {
              id: Number(row.id),
              name: String(row.name),
              query,
              shared: Boolean(row.shared),
              own: Number(row.user_id) === actor.id,
            },
          ]
        : []
    })
  }

  async save(
    name: string,
    actor: Actor,
    input: { name: string; query: unknown; shared?: boolean }
  ): Promise<SavedView> {
    const { resource, ability } = this.authorize(name, actor)
    const label = typeof input.name === 'string' ? input.name.trim() : ''
    if (!label || label.length > NAME_LIMIT)
      throw new AdulaError(422, 'E_VIEW_NAME', 'اسم العرض مطلوب ولا يتجاوز 60 حرفاً')
    const query = this.sanitize(resource, input.query, true)!
    // A view may only query what its author may query; stored filters must not probe hidden fields.
    const queried = [
      ...(query.sort ? [query.sort] : []),
      ...Object.keys(query.filters ?? {}),
      ...(query.search
        ? Object.entries(resource.fields)
            .filter(([, field]) => field.searchable)
            .map(([key]) => key)
        : []),
    ]
    for (const key of queried)
      if (!canQueryField(resource, actor, ability, key))
        throw new AdulaError(403, 'E_FIELD_FORBIDDEN', `لا يمكنك الاستعلام بهذا الحقل: ${key}`)
    const shared = input.shared === true
    const existing = await this.db('saved_views')
      .where({ user_id: actor.id, resource: resource.name, name: label })
      .first('id', 'shared')
    if (shared && !existing?.shared) {
      const [{ count }] = await this.db('saved_views')
        .where({ resource: resource.name, shared: true })
        .count<{ count: string }[]>('* as count')
      if (Number(count) >= SHARED_LIMIT)
        throw new AdulaError(422, 'E_VIEW_LIMIT', 'بلغ هذا الكيان الحد الأقصى للعروض المشتركة')
    }
    if (!existing) {
      const [{ count }] = await this.db('saved_views')
        .where({ user_id: actor.id, resource: resource.name })
        .count<{ count: string }[]>('* as count')
      if (Number(count) >= VIEW_LIMIT)
        throw new AdulaError(422, 'E_VIEW_LIMIT', 'بلغت الحد الأقصى للعروض المحفوظة لهذا الكيان')
    }
    const values = {
      user_id: actor.id,
      resource: resource.name,
      name: label,
      query: JSON.stringify(query),
      shared,
      updated_at: this.db.fn.now(),
    }
    const [row] = existing
      ? await this.db('saved_views').where('id', existing.id).update(values).returning('*')
      : await this.db('saved_views').insert(values).returning('*')
    await this.auditImpersonation(actor, Number(row.id), 'saved_view_saved', {
      resource: resource.name,
      name: label,
      shared,
    })
    return { id: Number(row.id), name: label, query, shared, own: true }
  }

  async remove(name: string, actor: Actor, id: number) {
    const { resource } = this.authorize(name, actor)
    const removed = await this.db('saved_views')
      .where({ id, resource: resource.name, user_id: actor.id })
      .del()
    if (!removed) throw new AdulaError(404, 'E_VIEW_NOT_FOUND', 'العرض المحفوظ غير موجود')
    await this.auditImpersonation(actor, id, 'saved_view_removed', { resource: resource.name })
  }

  /**
   * Saved views are personal preferences and are not audited for their owner; a change
   * made by an administrator impersonating the owner is recorded with both identities.
   */
  private async auditImpersonation(
    actor: Actor,
    viewId: number,
    action: string,
    changes: Record<string, unknown>
  ) {
    if (!actor.impersonatorId) return
    await logActivity(this.db, {
      resource: ACTIVITY_RESOURCE,
      recordId: viewId,
      actorId: actor.id,
      impersonatorId: actor.impersonatorId,
      action,
      changes,
    })
  }

  private authorize(name: string, actor: Actor): { resource: Resource; ability: AdulaAbility } {
    const resource = this.registry.get(name)
    const ability = buildAbility(actor.rules, this.registry.all())
    if (!resource.actions.includes('view') || !ability.can('view', resource.name))
      throw new AdulaError(403, 'E_FORBIDDEN', 'ليس لديك صلاحية لهذا الكيان')
    return { resource, ability }
  }

  /** Returns null for a stored view the resource no longer supports; throws on user input. */
  private sanitize(resource: Resource, value: unknown, strict = false): SavedViewQuery | null {
    const reject = (code: string, message: string) => {
      if (strict) throw new AdulaError(422, code, message)
      return null
    }
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return reject('E_VIEW_QUERY', 'تعريف العرض غير صالح')
    const input = value as Record<string, unknown>
    for (const key of Object.keys(input))
      if (!['search', 'sort', 'direction', 'filters'].includes(key))
        return reject('E_VIEW_QUERY', `مفتاح غير مدعوم في العرض: ${key}`)
    const query: SavedViewQuery = {}
    if (input.search !== undefined && input.search !== null && input.search !== '') {
      if (typeof input.search !== 'string' || input.search.length > 200)
        return reject('E_VIEW_QUERY', 'نص البحث غير صالح')
      if (!Object.values(resource.fields).some((field) => field.searchable))
        return reject('E_VIEW_QUERY', 'هذا الكيان لا يدعم البحث النصي')
      query.search = input.search
    }
    if (input.sort !== undefined && input.sort !== null && input.sort !== '') {
      if (typeof input.sort !== 'string' || !resource.fields[input.sort]?.sortable)
        return reject('E_VIEW_QUERY', 'حقل الفرز غير مدعوم')
      query.sort = input.sort
      if (input.direction !== undefined && input.direction !== null) {
        if (input.direction !== 'asc' && input.direction !== 'desc')
          return reject('E_VIEW_QUERY', 'اتجاه الفرز غير صالح')
        query.direction = input.direction
      }
    } else if (input.direction !== undefined && input.direction !== null && input.direction !== '')
      return reject('E_VIEW_QUERY', 'اتجاه الفرز يحتاج حقل فرز')
    if (input.filters !== undefined && input.filters !== null) {
      if (typeof input.filters !== 'object' || Array.isArray(input.filters))
        return reject('E_VIEW_QUERY', 'تصفية العرض غير صالحة')
      const filters: Record<string, ListFilterValue> = {}
      for (const [key, entry] of Object.entries(input.filters as Record<string, unknown>)) {
        if (!resource.fields[key]?.filterable)
          return reject('E_VIEW_QUERY', `حقل التصفية غير مدعوم: ${key}`)
        if (entry === undefined || entry === '') continue
        if (
          entry !== null &&
          typeof entry !== 'string' &&
          typeof entry !== 'number' &&
          typeof entry !== 'boolean'
        ) {
          // An operator object is checked exactly as the list will check it.
          try {
            filterCondition(key, resource.fields[key], entry)
          } catch {
            return reject('E_VIEW_QUERY', `قيمة التصفية غير صالحة: ${key}`)
          }
          filters[key] = JSON.parse(JSON.stringify(entry)) as ListFilterValue
          continue
        }
        filters[key] = entry
      }
      if (Object.keys(filters).length) query.filters = filters
    }
    return query
  }
}
