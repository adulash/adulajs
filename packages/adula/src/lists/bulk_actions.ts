import { subject } from '@casl/ability'
import type { Knex } from 'knex'
import type { ResourceRegistry } from '../resource/registry.js'
import type { Label, RecordData, Resource } from '../resource/types.js'
import { fieldValue } from '../resource/values.js'
import { buildAbility, type Actor } from '../auth/ability.js'
import type { ResourceService } from '../admin/resource_service.js'
import { AdulaError, forbiddenAction } from '../admin/errors.js'
import { labelText, translate } from '../languages/catalog.js'
import { fieldLevel } from '../admin/resource/shared.js'
import { fromRow } from '../admin/contracts.js'

/** A resource-defined bulk action: an ordinary update that writes fixed values (ADR 046). */
export type BulkActionDefinition = {
  /** camelCase key, unique per resource and never a built-in action name. */
  key: string
  label: Label
  /** Field values written to every selected record, through ResourceService.save. */
  values: RecordData
  /** Confirmation question shown before the action runs. */
  confirm?: Label
  destructive?: boolean
}
export type BulkActionSet = {
  resource: string
  actions: readonly BulkActionDefinition[]
}
/** One action the list may offer the actor; per-row refusal is still decided per row. */
export type BulkActionOption = {
  key: string
  label: string
  /** delete, restore, submit and cancel are built in; others come from defineBulkActions. */
  builtIn: boolean
  /** `trash` actions apply to the trashed list (restore); `records` to the live list. */
  scope: 'records' | 'trash'
  confirm: string | null
  destructive: boolean
}
export type BulkRequest = {
  action: unknown
  ids: unknown
  /** Versioned resources: the version of each selected record, by id. */
  versions?: unknown
}
export type BulkFailure = { id: number; code: string; message: string }
export type BulkActionsOptions = {
  /**
   * Receives an unexpected row failure (not an AdulaError, validation or constraint
   * error); pass the application logger. Defaults to console.error with no record data.
   */
  report?: (error: unknown, context: { resource: string; action: string; id: number }) => void
}
export type BulkResult = { succeeded: number[]; failed: BulkFailure[] }

/** Most records one bulk request may change. */
export const BULK_ID_LIMIT = 100
const BUILT_IN = ['delete', 'restore', 'submit', 'cancel'] as const
type BuiltIn = (typeof BUILT_IN)[number]
const KEY = /^[a-z][a-zA-Z0-9_]*$/

/**
 * Declares bulk actions for one resource. Register the result on the BulkActions service.
 * Definitions are checked here for shape and against the resource when registered.
 */
export function defineBulkActions(
  resource: string,
  actions: BulkActionDefinition[]
): BulkActionSet {
  if (typeof resource !== 'string' || !resource) throw new Error('Bulk actions need a resource')
  const keys = new Set<string>()
  for (const action of actions) {
    if (typeof action?.key !== 'string' || !KEY.test(action.key))
      throw new Error(`${resource}: invalid bulk action key ${String(action?.key)}`)
    if ((BUILT_IN as readonly string[]).includes(action.key))
      throw new Error(`${resource}: ${action.key} is a built-in bulk action`)
    if (keys.has(action.key)) throw new Error(`${resource}: duplicate bulk action ${action.key}`)
    keys.add(action.key)
    if (!action.label?.ar?.trim())
      throw new Error(`${resource}.${action.key}: label.ar is required`)
    if (action.confirm !== undefined && !action.confirm?.ar?.trim())
      throw new Error(`${resource}.${action.key}: confirm.ar is required`)
    if (
      !action.values ||
      typeof action.values !== 'object' ||
      Array.isArray(action.values) ||
      !Object.keys(action.values).length
    )
      throw new Error(`${resource}.${action.key}: values must set at least one field`)
  }
  return Object.freeze({ resource, actions: Object.freeze([...actions]) })
}

/**
 * Runs one action over selected records. Every record runs in its own transaction
 * through the ordinary paths (transition, restore, save), with the actor's per-row
 * policy check and audit, so one refused row does not undo the others.
 */
export class BulkActions {
  private defined: Map<string, Map<string, BulkActionDefinition>>

  constructor(
    private registry: ResourceRegistry,
    private resources: ResourceService,
    definitions: readonly BulkActionSet[] = [],
    private options: BulkActionsOptions = {}
  ) {
    this.defined = BulkActions.validate(registry, definitions)
  }

  /**
   * Checks bulk action sets against the registered resources: each set names a resource,
   * keys are unique per resource and every value is a writable form field value. Call it
   * when the application loads its definitions, so a bad definition fails at boot.
   */
  static validate(registry: ResourceRegistry, definitions: readonly BulkActionSet[]) {
    const defined = new Map<string, Map<string, BulkActionDefinition>>()
    for (const set of definitions) {
      const resource = registry.get(set.resource)
      const actions = defined.get(resource.name) ?? new Map<string, BulkActionDefinition>()
      for (const action of set.actions) {
        if (actions.has(action.key))
          throw new Error(`${resource.name}: duplicate bulk action ${action.key}`)
        for (const [key, value] of Object.entries(action.values)) {
          const field = resource.fields[key]
          if (!field || !resource.form.includes(key) || field.type === 'hasMany' || field.sequence)
            throw new Error(`${resource.name}.${action.key}: ${key} is not a writable form field`)
          try {
            fieldValue(field, value)
          } catch (error) {
            throw new Error(`${resource.name}.${action.key}.${key}: ${(error as Error).message}`)
          }
        }
        actions.set(action.key, action)
      }
      defined.set(resource.name, actions)
    }
    return defined
  }

  /**
   * The actions the actor may offer on this resource's list (resource-level permission).
   * 403 E_FORBIDDEN when the actor may not view the resource at all.
   */
  available(name: string, actor: Actor): BulkActionOption[] {
    const resource = this.registry.get(name)
    const ability = buildAbility(actor.rules, this.registry.all())
    const holds = (action: 'delete' | 'submit' | 'cancel' | 'update') =>
      resource.actions.includes(action) && ability.can(action, resource.name)
    const options: BulkActionOption[] = []
    if (!resource.actions.includes('view') || !ability.can('view', resource.name))
      throw forbiddenAction()
    if (holds('delete')) options.push(builtIn('delete'))
    if (resource.submittable && holds('submit')) options.push(builtIn('submit'))
    if (resource.submittable && holds('cancel')) options.push(builtIn('cancel'))
    if (holds('delete')) options.push(builtIn('restore'))
    if (holds('update'))
      for (const action of this.defined.get(resource.name)?.values() ?? [])
        if (
          Object.keys(action.values).every(
            (key) =>
              ability.can('update', resource.name, key) &&
              actor.permissionLevel >= fieldLevel(resource, key)
          )
        )
          options.push({
            key: action.key,
            label: labelText(action.label),
            builtIn: false,
            scope: 'records',
            confirm: action.confirm ? labelText(action.confirm) : null,
            destructive: Boolean(action.destructive),
          })
    return options
  }

  async run(name: string, actor: Actor, request: BulkRequest): Promise<BulkResult> {
    const resource = this.registry.get(name)
    const offered = this.available(name, actor)
    const { action, ids, versions } = parse(request)
    const known =
      (BUILT_IN as readonly string[]).includes(action) ||
      Boolean(this.defined.get(resource.name)?.has(action))
    if (!known) throw new AdulaError(422, 'E_BULK', 'الإجراء الجماعي غير معروف')
    if (!offered.some((option) => option.key === action)) throw forbiddenAction()
    const result: BulkResult = { succeeded: [], failed: [] }
    for (const id of ids) {
      try {
        await this.one(resource, actor, action, id, versions[id])
        result.succeeded.push(id)
      } catch (error) {
        const failure = failureOf(error)
        if (failure.code === 'E_BULK_ROW') this.report(error, { resource: name, action, id })
        result.failed.push({ id, ...failure })
      }
    }
    return result
  }

  private async one(
    resource: Resource,
    actor: Actor,
    action: string,
    id: number,
    version: number | undefined
  ) {
    const name = resource.name
    if (action === 'restore') return this.resources.restore(name, id, actor)
    if (action === 'delete' || action === 'submit' || action === 'cancel')
      return this.resources.transition(name, id, actor, action, version)
    const definition = this.defined.get(name)!.get(action)!
    const ability = buildAbility(actor.rules, this.registry.all())
    // Read and write under one row lock, so a concurrent edit between reading the stored
    // values and saving them cannot be overwritten. Authorization stays in save().
    return this.resources.transaction(async (trx: Knex.Transaction) => {
      // Authorize the row (organization scope and update conditions) before locking it, so
      // an actor cannot hold locks on records outside their reach.
      await this.resources.access(name, id, actor, 'update', trx)
      const row = await trx(name).where({ id }).whereNull('deleted_at').forUpdate().first()
      const stored = row ? fromRow(row, resource) : {}
      const after = { ...stored, ...definition.values }
      // The edit form resubmits the stored values the actor may write on this record (the
      // same per-record checks save() applies); the action's values replace their fields,
      // so validation sees a complete record. Attachments resend their stored id, which
      // save() treats as unchanged.
      const input: RecordData = {}
      for (const key of resource.form) {
        const field = resource.fields[key]
        if (
          field.type === 'hasMany' ||
          field.sequence ||
          !(key in stored) ||
          !ability.can('update', subject(name, stored), key) ||
          !ability.can('update', subject(name, after), key) ||
          actor.permissionLevel < fieldLevel(resource, key)
        )
          continue
        input[key] = stored[key]
      }
      Object.assign(input, definition.values)
      if (resource.version) input.version = version
      return this.resources.save(name, actor, input, id, trx)
    })
  }

  private report(error: unknown, context: { resource: string; action: string; id: number }) {
    if (this.options.report) return this.options.report(error, context)
    // No record values: only where it happened and what kind of error it was.
    console.error('Bulk action row failed', {
      ...context,
      error: error instanceof Error ? error.name : typeof error,
      code: (error as { code?: unknown })?.code,
    })
  }
}

function builtIn(key: BuiltIn): BulkActionOption {
  return {
    key,
    label: translate(`list.bulk.${key}`),
    builtIn: true,
    scope: key === 'restore' ? 'trash' : 'records',
    confirm: key === 'restore' ? null : translate(`list.bulk.${key}Confirm`),
    destructive: key === 'delete' || key === 'cancel',
  }
}

function parse(request: BulkRequest) {
  const invalid = () =>
    new AdulaError(422, 'E_BULK', 'اختر من سجل واحد إلى 100 سجل لتنفيذ الإجراء الجماعي')
  if (!request || typeof request !== 'object') throw invalid()
  const action = request.action
  if (typeof action !== 'string' || !KEY.test(action))
    throw new AdulaError(422, 'E_BULK', 'الإجراء الجماعي غير معروف')
  const positive = (value: unknown) => {
    const number = typeof value === 'string' && /^\d{1,10}$/.test(value) ? Number(value) : value
    return Number.isSafeInteger(number) && Number(number) > 0 && Number(number) <= 2147483647
      ? Number(number)
      : null
  }
  if (!Array.isArray(request.ids) || !request.ids.length || request.ids.length > BULK_ID_LIMIT)
    throw invalid()
  const ids = request.ids.map(positive)
  if (ids.some((id) => id === null) || new Set(ids).size !== ids.length) throw invalid()
  const versions: Record<number, number | undefined> = {}
  if (request.versions !== undefined && request.versions !== null) {
    if (typeof request.versions !== 'object' || Array.isArray(request.versions)) throw invalid()
    for (const [key, value] of Object.entries(request.versions as Record<string, unknown>)) {
      const id = positive(key)
      const version = typeof value === 'string' && /^\d{1,10}$/.test(value) ? Number(value) : value
      if (id === null || !Number.isSafeInteger(version)) throw invalid()
      versions[id] = version as number
    }
  }
  return { action, ids: ids as number[], versions }
}

/** Catalog text for row refusals whose service message is a developer (English) string. */
const ROW_MESSAGES: Record<string, string> = {
  E_DOCUMENT_STATE: 'errors.E_DOCUMENT_STATE',
  E_DOCUMENT_LOCKED: 'errors.E_DOCUMENT_LOCKED.2',
}

/** The code and Arabic message of one refused row; unexpected errors stay generic. */
function failureOf(error: unknown): Omit<BulkFailure, 'id'> {
  if (error instanceof AdulaError)
    return {
      code: error.code,
      // Catalog or Arabic text is user text; a developer (English) message is replaced
      // by the code's catalog message.
      message:
        error.messageKey || /[؀-ۿ]/.test(error.message)
          ? error.message
          : translate(ROW_MESSAGES[error.code] ?? 'errors.E_BULK_ROW'),
    }
  const code = (error as { code?: string })?.code
  if (code === 'E_VALIDATION_ERROR') {
    // VineJS messages are already in the request language (installCatalogMessages).
    const [first] = ((error as { messages?: { message?: unknown }[] }).messages ?? []) as {
      message?: unknown
    }[]
    return {
      code: 'E_VALIDATION',
      message:
        typeof first?.message === 'string' && first.message
          ? first.message
          : translate('validation.invalid'),
    }
  }
  if (code === '23505') return { code: 'E_DUPLICATE', message: translate('errors.E_DUPLICATE') }
  if (code === '23503') return { code: 'E_RELATION', message: translate('errors.E_RELATION') }
  return { code: 'E_BULK_ROW', message: translate('errors.E_BULK_ROW') }
}
