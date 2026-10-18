import { subject } from '@casl/ability'
import type { Knex } from 'knex'
import type { Action, RecordData, Resource, SerializedRecord } from '../../resource/types.js'
import { columnName } from '../../resource/define_resource.js'
import { buildAbility, type Actor } from '../../auth/ability.js'
import { fromRow, serialize, systemInput, writableInput } from '../contracts.js'
import {
  AdulaError,
  documentLocked,
  forbiddenField,
  inlineScope,
  invalidDocumentState,
  invalidInline,
  missingActor,
  notFound,
  requiredField,
} from '../errors.js'
import { sequence } from '../../services/settings.js'
import type { FieldChange } from '../../events/record_mutation.js'
import {
  claimAttachment,
  isAttachmentId,
  releaseAttachment,
} from '../../attachments/attachment_service.js'
import {
  authorizeAction,
  eligibleUsers,
  fieldLevel,
  find,
  findAny,
  hydrateOne,
  normalizeValues,
  requireRecord,
  type ResourceContext,
} from './shared.js'
import {
  audit,
  requireInlineParents,
  requireVersion,
  transition,
  type ParentWrite,
} from './lifecycle.js'

/** Options of ResourceService.systemSave. */
export type SystemSaveOptions = {
  /**
   * The user recorded as the author: created/updated by, activity and events. null is an
   * unattributed update by the system itself (for example a workflow whose triggering
   * event named no user): it runs the validator, hooks and lock, keeps updated_by, and
   * writes no activity entry or domain event because there is no author. Creates need one.
   */
  actorId: number | null
  /** Write inside the module's transaction. */
  trx?: Knex.Transaction
  /** Why module code wrote the record; stored with the activity entry. */
  reason?: string
  /** Optimistic lock: when given, it must match the stored version. */
  version?: number
  /**
   * The person who chose the values, when module code writes a choice made by a user,
   * such as a supervisor reassigning a record. A new value of a user field must then be
   * eligible for them as in a user save; without it, any active member qualifies on
   * unscoped resources.
   */
  chooser?: Actor
  /**
   * Also write a submitted document (docStatus 1), as workflow update steps do. Drafts
   * are always writable; cancelled documents stay locked.
   */
  submitted?: boolean
}

/** What persist() needs to know about a write decided by module code. */
type SystemWrite = {
  reason?: string
  version?: number
  chooser?: Actor
  submitted?: boolean
  unattributed?: boolean
}

/** A module-code write; see ResourceService.systemSave. */
export async function systemSave(
  ctx: ResourceContext,
  name: string,
  values: RecordData,
  id: number | undefined,
  options: SystemSaveOptions
): Promise<RecordData> {
  const unattributed = options.actorId === null
  if (unattributed) {
    if (id === undefined) throw missingActor('systemSave requires the author user id to create')
    const resource = ctx.registry.get(name)
    // Attachments are claimed for their uploader; without one nothing can be claimed.
    if (Object.keys(values).some((key) => resource.fields[key]?.type === 'attachment'))
      throw missingActor('Attachment writes require the author user id')
  } else if (!Number.isSafeInteger(options.actorId) || Number(options.actorId) <= 0)
    throw missingActor('systemSave requires the author user id')
  const actor: Actor = {
    id: unattributed ? 0 : Number(options.actorId),
    orgPaths: [],
    permissionLevel: 0,
    rules: [],
  }
  return persist(ctx, name, actor, values, id, options.trx, undefined, {
    reason: options.reason,
    version: options.version,
    chooser: options.chooser,
    submitted: options.submitted,
    unattributed,
  })
}

/** Moves records whose scope follows a parent; see ResourceService.rehome. */
export async function rehome(
  ctx: ResourceContext,
  parentName: string,
  parentId: number,
  options: Omit<SystemSaveOptions, 'version'>
): Promise<number> {
  const run = async (trx: Knex.Transaction) => {
    const parent = await findAny(trx, ctx.registry.get(parentName), parentId)
    let moved = 0
    for (const child of ctx.registry.all()) {
      const field = child.scope && child.fields[child.scope.from]
      if (!field || field.type !== 'belongsTo' || field.resource !== parentName) continue
      const column = field.column ?? columnName(child.scope!.from)
      const ids = await trx(child.name)
        .where(column, parentId)
        .whereNull('deleted_at')
        .whereNot('org_unit_id', Number(parent.orgUnitId))
        .orderBy('id')
        .pluck('id')
      for (const id of ids) {
        await systemSave(ctx, child.name, {}, Number(id), { ...options, trx })
        moved++
      }
    }
    return moved
  }
  return options.trx ? run(options.trx) : ctx.db.transaction(run)
}

/**
 * Creates or updates one record, for a user (save) or for module code (system). Every
 * user write, every inline row and every amended copy goes through here.
 */
export async function persist(
  ctx: ResourceContext,
  name: string,
  actor: Actor,
  input: RecordData,
  id?: number,
  transaction?: Knex.Transaction,
  parentWrite?: ParentWrite,
  system?: SystemWrite
): Promise<SerializedRecord> {
  const { registry } = ctx
  const resource = registry.get(name)
  const action = id === undefined ? 'create' : 'update'
  // System writes carry no role rules; this ability is used only for serialization shape.
  const ability = system
    ? buildAbility([{ action: 'manage', subject: 'all' }], registry.all())
    : authorizeAction(ctx, resource, actor, action)
  const form = system ? systemInput(resource, input) : writableInput(resource, input)
  const load = (db: Knex, target: Resource, key: number, lock = false) =>
    system ? findAny(db, target, key, lock) : find(db, target, actor, ability, key, lock)
  const check = (target: Resource, act: Action, record: RecordData) => {
    if (!system) requireRecord(ability, actor, target, act, record)
  }
  const validated = system ? {} : await resource.validator.validate(form)
  const work = async (trx: Knex.Transaction) => {
    const existing = id === undefined ? {} : await load(trx, resource, id, true)
    if (id !== undefined) {
      check(resource, action, existing)
      if (!system || system.version !== undefined)
        requireVersion(resource, existing, system ? system.version : input.version)
      if (
        resource.submittable &&
        existing.docStatus !== 0 &&
        !(system?.submitted && existing.docStatus === 1)
      )
        throw documentLocked()
    }
    if (system) {
      // The validator sees the complete form, so a partial update keeps required values.
      const formKeys = resource.form.filter((key) => resource.fields[key].type !== 'hasMany')
      const pick = (record: RecordData) =>
        Object.fromEntries(formKeys.filter((key) => key in record).map((key) => [key, record[key]]))
      Object.assign(
        validated,
        await resource.validator.validate({ ...pick(existing), ...pick(form) }),
        Object.fromEntries(Object.entries(form).filter(([key]) => !formKeys.includes(key)))
      )
    }
    const candidate: RecordData = {
      ...existing,
      ...validated,
      createdBy: existing.createdBy ?? actor.id,
      updatedBy: system?.unattributed ? existing.updatedBy : actor.id,
    }
    if (resource.submittable) candidate.docStatus = existing.docStatus ?? 0
    normalizeValues(resource, candidate)
    const locate = async () => {
      if (!resource.scoped) return
      if (resource.scope) {
        // Inherited scope: the parent decides the unit before any authorization (#45).
        const field = resource.fields[resource.scope.from]
        const parentId = Number(candidate[resource.scope.from])
        if (field.type !== 'belongsTo' || !Number.isSafeInteger(parentId) || parentId <= 0)
          throw requiredField(resource.scope.from)
        const parentResource = registry.get(field.resource)
        const parent = await load(trx, parentResource, parentId)
        check(parentResource, 'view', parent)
        candidate.orgUnitId = parent.orgUnitId
      } else if (!system || 'orgUnitId' in input || id === undefined)
        candidate.orgUnitId = input.orgUnitId ?? existing.orgUnitId
      const unit = await trx('org_units')
        .where('id', Number(candidate.orgUnitId) || -1)
        .first('path')
      if (system && !unit) throw new AdulaError(422, 'E_ORG_UNIT', 'الوحدة التنظيمية غير موجودة')
      candidate.orgPath = unit?.path
    }
    await locate()
    check(resource, action, candidate)
    // Validators may add fields (defaults, transforms); those are written too, so check them.
    const written = new Set(
      system
        ? []
        : [...Object.keys(form), ...Object.keys(validated).filter((key) => key in resource.fields)]
    )
    for (const key of written) {
      const field = resource.fields[key]
      if (
        !ability.can(action, subject(name, candidate), key) ||
        (id !== undefined && !ability.can(action, subject(name, existing), key)) ||
        actor.permissionLevel < fieldLevel(resource, key)
      )
        throw forbiddenField(`Field is forbidden: ${key}`)
      if (field.sequence)
        throw new AdulaError(422, 'E_SEQUENCE_READONLY', 'Sequence fields are generated')
    }
    for (const [key, field] of Object.entries(resource.fields))
      if (field.sequence && id === undefined) candidate[key] = await sequence(trx, field.sequence)
    const context = { trx, userId: actor.id, action } as const
    await resource.hooks?.beforeSave?.(candidate, context)
    normalizeValues(resource, candidate)
    // A hook may change the parent of an inherited scope; the unit follows it.
    if (resource.scope) await locate()
    // A hook may also move the record: later checks use the unit it chose.
    if (resource.scoped) {
      const unit = await trx('org_units')
        .where('id', Number(candidate.orgUnitId) || -1)
        .first('path')
      candidate.orgPath = unit?.path
    }
    for (const [key, field] of Object.entries(resource.fields)) {
      if (
        field.required &&
        field.type !== 'hasMany' &&
        (candidate[key] === null || candidate[key] === undefined)
      )
        throw requiredField(key)
      if (field.type === 'belongsTo' && candidate[key] !== null && candidate[key] !== undefined) {
        const related = registry.get(field.resource)
        const target = await load(trx, related, Number(candidate[key]))
        check(related, 'view', target)
      }
      // A new user, or a record moved by a user to another unit, needs an eligible user.
      // An unchanged value never blocks other edits, even after the account is disabled.
      if (
        field.type === 'user' &&
        candidate[key] !== null &&
        candidate[key] !== undefined &&
        (Number(candidate[key]) !== Number(existing[key]) ||
          (!system &&
            resource.scoped &&
            Number(candidate.orgUnitId) !== Number(existing.orgUnitId)))
      ) {
        const eligible = await eligibleUsers(
          trx,
          resource.scoped ? String(candidate.orgPath ?? '') || null : null,
          system ? (system.chooser ?? null) : actor
        )
          .where('u.id', Number(candidate[key]))
          .first('u.id')
        if (!eligible || (resource.scoped && !candidate.orgPath))
          throw new AdulaError(
            422,
            'E_USER_FIELD',
            `${key}: اختر مستخدماً نشطاً من الوحدة التنظيمية للسجل أو الوحدات الأعلى منها`
          )
      }
      if (field.type === 'lookup' && candidate[key] !== null && candidate[key] !== undefined) {
        if (
          !(await trx('lookups')
            .where({ group: field.group, key: candidate[key], active: true })
            .first())
        )
          throw new AdulaError(422, 'E_LOOKUP', `Invalid lookup: ${key}`)
      }
      if (
        field.type === 'attachment' &&
        isAttachmentId(candidate[key]) &&
        (candidate[key] !== existing[key] ||
          (resource.scoped && Number(candidate.orgUnitId) !== Number(existing.orgUnitId)))
      )
        await claimAttachment(trx, {
          attachmentId: candidate[key],
          actor,
          resource: name,
          field: key,
          recordId: id,
          orgUnitId: resource.scoped ? Number(candidate.orgUnitId) : null,
          scoped: resource.scoped,
        })
    }
    // Hooks may calculate fields, but may never move a record past authorization.
    check(resource, action, candidate)
    await requireInlineParents(
      ctx,
      trx,
      resource,
      actor,
      candidate,
      existing,
      parentWrite,
      Boolean(system)
    )
    if (
      id !== undefined &&
      resource.scoped &&
      Number(candidate.orgUnitId) !== Number(existing.orgUnitId)
    ) {
      for (const field of Object.values(resource.fields)) {
        if (field.type !== 'hasMany' || !field.inline) continue
        const child = registry.get(field.resource)
        if (
          await trx(child.name)
            .where(child.fields[field.foreignKey].column ?? columnName(field.foreignKey), id)
            .whereNull('deleted_at')
            .first('id')
        )
          throw inlineScope('Cannot change organization while inline rows exist')
      }
    }
    const values: RecordData = { updated_at: trx.fn.now() }
    if (!system?.unattributed) values.updated_by = actor.id
    if (id === undefined) values.created_by = actor.id
    if (resource.scoped) values.org_unit_id = candidate.orgUnitId
    if (resource.version) values.version = id === undefined ? 1 : Number(existing.version) + 1
    for (const [key, field] of Object.entries(resource.fields)) {
      if (field.type !== 'hasMany' && key in candidate)
        values[field.column ?? columnName(key)] =
          field.type === 'json' ? JSON.stringify(candidate[key]) : candidate[key]
    }
    const [row] =
      id === undefined
        ? await trx(name).insert(values).returning('*')
        : await trx(name).where({ id }).update(values).returning('*')
    const saved: RecordData = { ...fromRow(row, resource), orgPath: candidate.orgPath }
    for (const [key, field] of Object.entries(resource.fields)) {
      if (field.type !== 'attachment' || !(key in candidate)) continue
      const next = isAttachmentId(candidate[key]) ? candidate[key] : null
      const previous = isAttachmentId(existing[key]) ? existing[key] : null
      if (next !== null && id === undefined)
        await claimAttachment(trx, {
          attachmentId: next,
          actor,
          resource: name,
          field: key,
          recordId: Number(row.id),
          orgUnitId: resource.scoped ? Number(candidate.orgUnitId) : null,
          scoped: resource.scoped,
        })
      if (previous !== null && previous !== next) await releaseAttachment(trx, previous)
    }
    await writeInlineRows(ctx, trx, resource, actor, form, id, row, candidate, action)
    const changes: FieldChange[] = []
    if (id !== undefined)
      for (const key of Object.keys(resource.fields)) {
        if (resource.fields[key].type === 'hasMany' || !(key in saved)) continue
        const before = existing[key] ?? null
        const after = saved[key] ?? null
        if (JSON.stringify(before) !== JSON.stringify(after))
          changes.push({ field: key, before, after })
      }
    if (!system?.unattributed)
      await audit(ctx, trx, resource, actor, action, saved, Object.keys(form), changes, system)
    await resource.hooks?.afterSave?.(saved, context)
    if (system) return (await hydrateOne(trx, resource, saved)) as SerializedRecord
    return serialize(resource, await hydrateOne(trx, resource, saved), ability, actor)
  }
  return transaction ? work(transaction) : ctx.db.transaction(work)
}

/**
 * Creates, updates and deletes the inline rows submitted with a parent write. Each row
 * is authorized and written through persist() (or transition() for deletions).
 */
async function writeInlineRows(
  ctx: ResourceContext,
  trx: Knex.Transaction,
  resource: Resource,
  actor: Actor,
  form: RecordData,
  id: number | undefined,
  row: RecordData,
  candidate: RecordData,
  action: 'create' | 'update'
) {
  const name = resource.name
  for (const [key, field] of Object.entries(resource.fields)) {
    if (field.type !== 'hasMany' || !(key in form)) continue
    if (!field.inline || !Array.isArray(form[key]) || (form[key] as unknown[]).length > 100)
      throw invalidInline('Invalid inline rows (maximum 100)')
    const childResource = ctx.registry.get(field.resource)
    const seen = new Set<number>()
    for (const child of form[key] as RecordData[]) {
      if (!child || typeof child !== 'object' || Array.isArray(child))
        throw invalidInline('Inline rows must be objects')
      const { id: childId, _delete: remove, ...data } = child
      if (remove !== undefined && typeof remove !== 'boolean')
        throw invalidInline('Invalid deletion marker')
      if (childId !== undefined) {
        if (
          id === undefined ||
          !Number.isSafeInteger(childId) ||
          Number(childId) <= 0 ||
          seen.has(Number(childId))
        )
          throw invalidInline('Invalid or repeated inline record identifier')
        seen.add(Number(childId))
        const childAbility = authorizeAction(
          ctx,
          childResource,
          actor,
          remove ? 'delete' : 'update'
        )
        const owned = await find(trx, childResource, actor, childAbility, Number(childId), true)
        if (Number(owned[field.foreignKey]) !== Number(row.id)) throw notFound()
      }
      if (remove) {
        if (childId === undefined)
          throw invalidInline('Deleting an inline row requires its identifier')
        await transition(ctx, field.resource, Number(childId), actor, 'delete', data.version, trx)
        continue
      }
      await persist(
        ctx,
        field.resource,
        actor,
        {
          ...data,
          [field.foreignKey]: row.id,
          ...(childResource.scoped && !childResource.scope
            ? { orgUnitId: candidate.orgUnitId }
            : {}),
        },
        childId === undefined ? undefined : Number(childId),
        trx,
        { name, id: Number(row.id), action }
      )
    }
  }
}

/**
 * Amend-by-copy: a cancelled document is copied into a new draft that points to
 * it through amended_from_id, together with its inline lines. The original stays
 * cancelled and unchanged; sequence fields receive new numbers.
 */
export async function amend(
  ctx: ResourceContext,
  name: string,
  id: number,
  actor: Actor,
  transaction?: Knex.Transaction
) {
  const resource = ctx.registry.get(name)
  if (!resource.submittable) throw invalidDocumentState('Only submittable documents can be amended')
  const ability = authorizeAction(ctx, resource, actor, 'amend')
  const work = async (trx: Knex.Transaction) => {
    const source = await find(trx, resource, actor, ability, id, true)
    requireRecord(ability, actor, resource, 'amend', source)
    if (source.docStatus !== 2)
      throw invalidDocumentState('Only cancelled documents can be amended')
    const existing = await trx(name)
      .where('amended_from_id', id)
      .whereNull('deleted_at')
      .first('id')
    if (existing)
      throw new AdulaError(409, 'E_ALREADY_AMENDED', 'تم تعديل هذا المستند بالنسخ من قبل')
    const values: RecordData = {
      created_by: actor.id,
      updated_by: actor.id,
      doc_status: 0,
      amended_from_id: id,
    }
    if (resource.scoped) values.org_unit_id = source.orgUnitId
    if (resource.version) values.version = 1
    const copied: string[] = []
    for (const [key, field] of Object.entries(resource.fields)) {
      if (field.type === 'hasMany' || !(key in source)) continue
      const column = field.column ?? columnName(key)
      if (field.sequence) values[column] = await sequence(trx, field.sequence)
      else if (field.type === 'attachment') continue
      else {
        values[column] = field.type === 'json' ? JSON.stringify(source[key]) : source[key]
        copied.push(key)
      }
    }
    const [row] = await trx(name).insert(values).returning('*')
    const saved: RecordData = { ...fromRow(row, resource), orgPath: source.orgPath }
    for (const [lineKey, field] of Object.entries(resource.fields)) {
      if (field.type !== 'hasMany' || !field.inline) continue
      const child = ctx.registry.get(field.resource)
      const foreign = child.fields[field.foreignKey].column ?? columnName(field.foreignKey)
      const lines = await trx(child.name).where(foreign, id).whereNull('deleted_at').orderBy('id')
      if (!lines.length) continue
      if (
        !ability.can('amend', subject(name, source), lineKey) ||
        actor.permissionLevel < fieldLevel(resource, lineKey)
      )
        throw forbiddenField('ليس لديك صلاحية تعديل البنود')
      // Copies are new child records: they go through persist(), so the actor needs
      // create on the child resource and its field rules, validator and hooks apply.
      const childAbility = authorizeAction(ctx, child, actor, 'create')
      for (const line of lines) {
        const stored = fromRow(line, child)
        const data: RecordData = {}
        for (const key of child.form) {
          const childField = child.fields[key]
          if (
            key === field.foreignKey ||
            !(key in stored) ||
            childField.type === 'hasMany' ||
            childField.type === 'attachment' ||
            childField.sequence ||
            // Values the actor could not have entered are not carried into the copy.
            !childAbility.can('create', child.name, key) ||
            actor.permissionLevel < fieldLevel(child, key)
          )
            continue
          data[key] = stored[key]
        }
        await persist(
          ctx,
          child.name,
          actor,
          {
            ...data,
            [field.foreignKey]: row.id,
            ...(child.scoped && !child.scope ? { orgUnitId: saved.orgUnitId } : {}),
          },
          undefined,
          trx,
          { name, id: Number(row.id), action: 'amend' }
        )
      }
    }
    await audit(ctx, trx, resource, actor, 'amend', saved, copied)
    return serialize(resource, await hydrateOne(trx, resource, saved), ability, actor)
  }
  return transaction ? work(transaction) : ctx.db.transaction(work)
}
