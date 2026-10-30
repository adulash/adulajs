import { subject } from '@casl/ability'
import type { RecordData, SerializedRecord } from '../../resource/types.js'
import { columnName } from '../../resource/define_resource.js'
import { inOrgScope, type Actor } from '../../auth/ability.js'
import { accessibleBy } from '../../auth/sql.js'
import { fromRow, serialize } from '../contracts.js'
import { AdulaError, documentLocked, forbiddenField, invalidCursor } from '../errors.js'
import { attachmentLimit, fieldValue } from '../../resource/values.js'
import type { Field } from '../../resource/types.js'
import { escapeLike } from '../../core/like.js'
import { labelText } from '../../languages/catalog.js'
import type { ResourceField } from '../presentation.js'
import {
  authorizeAction,
  columns,
  eligibleUsers,
  fieldLevel,
  find,
  hydrate,
  hydrateOne,
  requireRecord,
  type ResourceContext,
} from './shared.js'
import { describe, show, titler } from './read.js'
import { list } from './query.js'

/** Options of relationOptions(). */
export type RelationOptionsRequest = {
  id?: number
  search?: string
  cursor?: string
  /** User fields: the organization unit chosen in the form. */
  orgUnitId?: number
  /** User fields: choices for a list filter instead of a form. */
  purpose?: 'form' | 'filter'
}

/** Whether an error only means the actor cannot open a related record. */
const unreachable = (error: unknown) =>
  error instanceof AdulaError && [403, 404].includes(error.status)

/** The form description for create (no id) or update; see ResourceService.editor. */
export async function editor(
  ctx: ResourceContext,
  name: string,
  actor: Actor,
  id?: number,
  request: { defaults?: Record<string, unknown> } = {}
) {
  const { db, registry } = ctx
  const resource = registry.get(name)
  const action = id === undefined ? 'create' : 'update'
  const ability = authorizeAction(ctx, resource, actor, action)
  const record = id === undefined ? undefined : await find(db, resource, actor, ability, id)
  if (record) {
    requireRecord(ability, actor, resource, action, record)
    if (resource.submittable && record.docStatus !== 0) throw documentLocked()
  }
  const fields = resource.form
    .filter((key) => {
      const field = resource.fields[key]
      return (
        !field.sequence &&
        actor.permissionLevel >= fieldLevel(resource, key) &&
        ability.can(action, record ? subject(name, record) : name, key)
      )
    })
    .map((key) => editorField(key, resource.fields[key]))
  const options: Record<string, { value: string; label: string }[]> = {}
  const relationSearch: Record<string, boolean> = {}
  const inline: Record<
    string,
    {
      rows: SerializedRecord[]
      hasMore: boolean
      canCreate: boolean
      permissions: Record<string, { update: boolean; delete: boolean }>
      fields: ResourceField[]
      createFields: string[]
      updateFields: Record<string, string[]>
    }
  > = {}
  for (const field of fields) {
    if (field.type === 'hasMany' && field.inline) {
      const child = registry.get(field.resource)
      const rows: RecordData[] =
        record && ability.can('view', child.name)
          ? await accessibleBy(
              db(`${child.name} as r`).whereNull('r.deleted_at'),
              ability,
              actor,
              'view',
              child
            )
              .where(
                `r.${child.fields[field.foreignKey].column ?? columnName(field.foreignKey)}`,
                id
              )
              .select([
                ...columns(child, ability),
                ...(child.scoped ? ['ou.path as org_path'] : []),
              ])
              .orderBy('r.id')
              .limit(101)
          : []
      const records = rows.slice(0, 100).map((row) => fromRow(row, child))
      const hydratedRows = await hydrate(db, child, records)
      // Inline rows do not edit many-to-many links: rows load without them, and an
      // inline payload's manyToMany keys are ignored (write.ts writeInlineRows).
      const childFields = child.form.filter(
        (key) =>
          key !== field.foreignKey &&
          child.fields[key].type !== 'manyToMany' &&
          !child.fields[key].sequence &&
          actor.permissionLevel >= fieldLevel(child, key)
      )
      inline[field.key] = {
        fields: childFields.map((key) => editorField(key, child.fields[key])),
        createFields: childFields.filter((key) => ability.can('create', child.name, key)),
        updateFields: Object.fromEntries(
          records.map((row) => [
            String(row.id),
            childFields.filter((key) => ability.can('update', subject(child.name, row), key)),
          ])
        ),
        rows: hydratedRows.map((row) => serialize(child, row, ability, actor)),
        hasMore: rows.length > 100,
        canCreate: child.actions.includes('create') && ability.can('create', child.name),
        permissions: Object.fromEntries(
          records.map((row) => [
            String(row.id),
            {
              update:
                child.actions.includes('update') && ability.can('update', subject(child.name, row)),
              delete:
                child.actions.includes('delete') && ability.can('delete', subject(child.name, row)),
            },
          ])
        ),
      }
    }
    if (field.type === 'lookup') {
      const lookups = await db('lookups')
        .where({ group: field.group, active: true })
        .orderBy('id')
        .select('key', 'label_ar')
      options[field.key] = lookups.map((row) => ({ value: row.key, label: row.label_ar }))
    } else if (field.type === 'enum' || field.type === 'multiSelect') {
      options[field.key] = field.options.map((option) => ({
        value: option.value,
        label: labelText(option.label),
      }))
    } else if (field.type === 'belongsTo' || field.type === 'manyToMany') {
      const target = registry.get(field.resource)
      if (ability.can('view', target.name)) {
        relationSearch[field.key] = describe(ctx, target.name, actor).searchable
        const page = await list(ctx, target.name, actor, { limit: 50, estimate: false })
        const title = await titler(ctx, target)
        options[field.key] = page.data.map((row) => ({
          value: String(row.id),
          label: title(row) ?? `#${row.id}`,
        }))
        const value = record?.[field.key]
        // Current values outside the first page keep a labelled choice when still viewable.
        for (const selected of Array.isArray(value) ? value : [value]) {
          if (
            selected === null ||
            selected === undefined ||
            options[field.key].some((option) => option.value === String(selected))
          )
            continue
          try {
            const current = await show(ctx, target.name, Number(selected), actor)
            options[field.key].push({
              value: String(current.data.id),
              label: title(current.data) ?? `#${current.data.id}`,
            })
          } catch (error) {
            if (!unreachable(error)) throw error
          }
        }
      } else options[field.key] = []
    } else if (field.type === 'user') {
      // Choices depend on the unit chosen in the form; they load from relationOptions.
      relationSearch[field.key] = true
      options[field.key] = []
      const selected = record?.[field.key]
      if (selected !== null && selected !== undefined) {
        const current = await db('users').where('id', Number(selected)).first('id', 'full_name')
        if (current)
          options[field.key].push({
            value: String(current.id),
            label: String(current.full_name || `#${current.id}`),
          })
      }
    }
  }
  const units =
    resource.scoped && !resource.scope
      ? await db('org_units')
          .where((query) => {
            if (!actor.orgPaths.length) query.whereRaw('FALSE')
            for (const path of actor.orgPaths) query.orWhereRaw('path <@ ?::ltree', [path])
          })
          .orderBy('path')
          .limit(100)
          .select('id', 'name')
      : []
  if (record?.orgUnitId && !units.some((unit) => Number(unit.id) === Number(record.orgUnitId))) {
    const current = await db('org_units').where('id', Number(record.orgUnitId)).first('id', 'name')
    if (current) units.push(current)
  }
  const defaults: SerializedRecord = {}
  // Declared field defaults prefill a create form; requested defaults below override them.
  if (id === undefined)
    for (const field of fields)
      if (field.default !== undefined && field.default !== null)
        defaults[field.key] = Array.isArray(field.default)
          ? [...(field.default as string[])]
          : (field.default as string | number | boolean)
  const requested = request.defaults
  if (id === undefined && requested && typeof requested === 'object')
    for (const field of fields) {
      const raw = Object.hasOwn(requested, field.key) ? requested[field.key] : undefined
      if (typeof raw !== 'string' && typeof raw !== 'number' && typeof raw !== 'boolean') continue
      let value: unknown = raw
      try {
        if (['integer', 'belongsTo', 'user'].includes(field.type)) value = Number(raw)
        else if (field.type === 'boolean') value = raw === true || raw === 'true'
        else value = String(raw)
        value = fieldValue(field, value)
      } catch {
        continue
      }
      if (['attachment', 'json', 'hasMany'].includes(field.type)) continue
      if (field.type === 'user') {
        // The unit is chosen later in the form; saving checks the record's unit.
        const user = await eligibleUsers(db, null, actor)
          .where('u.id', Number(value))
          .first('u.id', 'u.full_name')
        if (!user) continue
        const choices = options[field.key] ?? (options[field.key] = [])
        if (!choices.some((option) => option.value === String(user.id)))
          choices.push({ value: String(user.id), label: String(user.full_name || `#${user.id}`) })
      }
      if (field.type === 'lookup' || field.type === 'belongsTo') {
        const choices = options[field.key] ?? []
        if (!choices.some((option) => option.value === String(value))) {
          if (field.type === 'lookup') continue
          try {
            // Authorized exactly like opening the related record.
            const target = registry.get(field.resource)
            const current = await show(ctx, target.name, Number(value), actor)
            const title = await titler(ctx, target)
            choices.push({
              value: String(current.data.id),
              label: title(current.data) ?? `#${current.data.id}`,
            })
          } catch (error) {
            if (!unreachable(error)) throw error
            continue
          }
        }
      }
      defaults[field.key] = value as SerializedRecord[string]
    }
  return {
    mode: action,
    name,
    label: resource.label.ar,
    recordLabel: resource.recordLabel?.ar ?? null,
    fields,
    /** Initial values of a create form, already checked against the actor's access. */
    defaults,
    inline,
    options,
    relationSearch,
    orgUnits: units.map((row) => ({ value: String(row.id), label: String(row.name) })),
    scoped: resource.scoped,
    /** The belongsTo field whose record decides the unit; the form shows no unit picker. */
    scopeFrom: resource.scope?.from ?? null,
    record: record
      ? serialize(resource, await hydrateOne(db, resource, record), ability, actor)
      : null,
  }
}

/** Choices of a belongsTo or user field in a form or filter; see ResourceService.relationOptions. */
export async function relationOptions(
  ctx: ResourceContext,
  name: string,
  key: string,
  actor: Actor,
  options: RelationOptionsRequest = {}
) {
  if (ctx.registry.get(name).fields[key]?.type === 'user')
    return userOptions(ctx, name, key, actor, options)
  const form = await editor(ctx, name, actor, options.id)
  const field = form.fields.find((entry) => entry.key === key)
  if (!field || (field.type !== 'belongsTo' && field.type !== 'manyToMany'))
    throw forbiddenField('ليس لديك صلاحية لهذا الحقل')
  const target = ctx.registry.get(field.resource)
  const page = await list(ctx, target.name, actor, {
    search: options.search,
    cursor: options.cursor,
    limit: 50,
    estimate: false,
  })
  const title = await titler(ctx, target)
  return {
    data: page.data.map((row) => ({
      value: String(row.id),
      label: title(row) ?? `#${row.id}`,
    })),
    nextCursor: page.meta.nextCursor,
  }
}

/**
 * Choices for a user field. A form lists active members of the record's unit or its
 * ancestors (the users the record is visible to through membership); a filter lists
 * active users who share organization scope with the actor. Only names are returned.
 */
async function userOptions(
  ctx: ResourceContext,
  name: string,
  key: string,
  actor: Actor,
  options: { id?: number; search?: string; cursor?: string; orgUnitId?: number; purpose?: string }
) {
  const resource = ctx.registry.get(name)
  let path: string | null = null
  if (options.purpose === 'filter') {
    const field = describe(ctx, name, actor).fields.find((entry) => entry.key === key)
    if (!field?.filterable) throw forbiddenField('ليس لديك صلاحية لهذا الحقل')
  } else {
    const form = await editor(ctx, name, actor, options.id)
    if (!form.fields.some((entry) => entry.key === key))
      throw forbiddenField('ليس لديك صلاحية لهذا الحقل')
    if (resource.scoped) {
      const unit =
        options.orgUnitId ??
        (form.record?.orgUnitId === undefined ? undefined : Number(form.record.orgUnitId))
      // Without a unit (for example an inline row) the choices follow the actor's scope;
      // saving still checks the record's unit.
      if (unit !== undefined) {
        const row = await ctx.db('org_units').where('id', unit).first('path')
        // Only units the actor works in (or the record's current unit) may be probed.
        if (
          !row ||
          (!inOrgScope(row.path, actor.orgPaths) && Number(unit) !== Number(form.record?.orgUnitId))
        )
          return { data: [], nextCursor: null }
        path = String(row.path)
      }
    }
  }
  let after = 0
  if (options.cursor !== undefined && options.cursor !== '') {
    after = Number(options.cursor)
    if (!Number.isSafeInteger(after) || after < 0) throw invalidCursor()
  }
  const query = eligibleUsers(ctx.db, path, actor)
    .where('u.id', '>', after)
    .orderBy('u.id')
    .limit(51)
    .select('u.id', 'u.full_name')
  if (options.search) query.whereILike('u.full_name', `%${escapeLike(options.search)}%`)
  const rows = await query
  return {
    data: rows.slice(0, 50).map((row) => ({
      value: String(row.id),
      label: String(row.full_name || `#${row.id}`),
    })),
    nextCursor: rows.length > 50 ? String(rows[49].id) : null,
  }
}

/** A form field as the editor sends it: a multiple attachment field carries its resolved limit. */
function editorField(key: string, field: Field): ResourceField {
  return field.type === 'attachment' && field.multiple
    ? { key, ...field, max: attachmentLimit(field) }
    : { key, ...field }
}
