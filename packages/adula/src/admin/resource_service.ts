import type { Knex } from 'knex'
import type { ResourceRegistry } from '../resource/registry.js'
import type { Action, RecordData, SerializedRecord } from '../resource/types.js'
import type { Actor } from '../auth/ability.js'
import type { ResourceDescription, ResourceNavigation } from './presentation.js'
import type { ResourceContext } from './resource/shared.js'
import * as read from './resource/read.js'
import * as query from './resource/query.js'
import * as form from './resource/editor.js'
import * as write from './resource/write.js'
import { transition } from './resource/lifecycle.js'
import type { AggregateOptions, AggregateRow, ListOptions } from './resource/query.js'
import type { SystemSaveOptions } from './resource/write.js'

export { canQueryField } from './resource/shared.js'
export type { AggregateOptions, AggregateRow, ListOptions } from './resource/query.js'
export type { SystemSaveOptions } from './resource/write.js'

/**
 * Authorized reads and writes of registered resources. The work is done by the modules
 * under ./resource (query, read, editor, write, lifecycle); this class keeps the public
 * surface and hands them its database and registry.
 */
export class ResourceService {
  private context: ResourceContext

  constructor(
    private db: Knex,
    private registry: ResourceRegistry
  ) {
    this.context = { db, registry }
  }

  /** The Arabic label of a registered resource, for notifications and titles. */
  label(name: string) {
    return this.registry.get(name).label.ar
  }

  /** Project navigation is derived from registered resources and the current actor. */
  navigation(actor: Actor): ResourceNavigation {
    return read.navigation(this.context, actor)
  }

  describe(name: string, actor: Actor): ResourceDescription {
    return read.describe(this.context, name, actor)
  }

  /**
   * Authorizes one record for collaboration features (comments, tags, assignments...).
   * Scope and conditional rules apply exactly as for show/update.
   */
  async access(
    name: string,
    id: number,
    actor: Actor,
    action: Action = 'view',
    db: Knex = this.db
  ) {
    return read.access(this.context, name, id, actor, action, db)
  }

  /** Whether a (possibly other) actor may perform an action on a record; never throws for denial. */
  async permits(name: string, id: number, actor: Actor, action: Action = 'view') {
    return read.permits(this.context, name, id, actor, action)
  }

  async list(name: string, actor: Actor, options: ListOptions = {}) {
    return query.list(this.context, name, actor, options)
  }

  /**
   * Counts and totals over the records the actor may view, grouped by queryable fields,
   * for dashboards. Authorization is list()'s: the same rules, organization scope and
   * soft-delete filter apply, and every grouped, totalled or filtered field must be one
   * the actor may query (E_FIELD_FORBIDDEN otherwise), so no hidden value leaks.
   */
  async aggregate(
    name: string,
    actor: Actor,
    options: AggregateOptions = {}
  ): Promise<{ rows: AggregateRow[]; truncated: boolean }> {
    return query.aggregate(this.context, name, actor, options)
  }

  /**
   * Titles of records the actor may view, read under the actor's field access (#32).
   * Records the actor cannot view are left out; callers fall back to the record id.
   */
  async titles(name: string, ids: readonly number[], actor: Actor): Promise<Map<number, string>> {
    return read.titles(this.context, name, ids, actor)
  }

  async show(name: string, id: number, actor: Actor) {
    return read.show(this.context, name, id, actor)
  }

  async relationOptions(
    name: string,
    key: string,
    actor: Actor,
    options: {
      id?: number
      search?: string
      cursor?: string
      /** User fields: the organization unit chosen in the form. */
      orgUnitId?: number
      /** User fields: choices for a list filter instead of a form. */
      purpose?: 'form' | 'filter'
    } = {}
  ) {
    return form.relationOptions(this.context, name, key, actor, options)
  }

  /** Deferred relation reads re-authorize the parent and each child on every request. */
  async children(name: string, id: number, actor: Actor) {
    return read.recordChildren(this.context, name, id, actor)
  }

  /** Active lookup labels for the lookup fields the actor may read on this resource. */
  async lookups(name: string, actor: Actor) {
    return read.lookups(this.context, name, actor)
  }

  /** The last 50 recorded mutations of one record, after authorizing the record itself. */
  async activity(name: string, id: number, actor: Actor) {
    return read.activity(this.context, name, id, actor)
  }

  /**
   * Inline children and recent activity of one record, authorized with a single record
   * read (for deferred page props that would otherwise read the record twice).
   */
  async details(name: string, id: number, actor: Actor) {
    return read.details(this.context, name, id, actor)
  }

  /** show(), children() and activity() of one record from a single record read. */
  async record(name: string, id: number, actor: Actor) {
    return read.recordPage(this.context, name, id, actor)
  }

  /**
   * The form description for create (no id) or update. `defaults` pre-fills a create form
   * (#48), for example `?defaults[violation]=13`: only visible form fields are used, a
   * related record must be viewable by the actor and a lookup must be active. Anything else
   * is dropped. Defaults are only initial values; saving validates as usual.
   */
  async editor(
    name: string,
    actor: Actor,
    id?: number,
    request: { defaults?: Record<string, unknown> } = {}
  ) {
    return form.editor(this.context, name, actor, id, request)
  }

  async save(
    name: string,
    actor: Actor,
    input: RecordData,
    id?: number,
    transaction?: Knex.Transaction
  ): Promise<SerializedRecord> {
    return write.persist(this.context, name, actor, input, id, transaction)
  }

  /**
   * A write decided by module code rather than by a user's role rules: state transitions,
   * snapshots and listener updates. It runs the validator, hooks, lookup, relation and
   * attachment checks, versioning and the audit trail exactly like save(), and skips only
   * the actor's role rules and organization scope. Values may set any stored field except
   * sequences and inline children. Updates merge the given values into the stored record.
   * Returns the full stored record; module code must not send it to users unfiltered.
   */
  async systemSave(
    name: string,
    values: RecordData,
    id: number | undefined,
    options: SystemSaveOptions
  ): Promise<RecordData> {
    return write.systemSave(this.context, name, values, id, options)
  }

  /**
   * Moves the records whose scope follows this parent (`scope: { from }`) to the parent's
   * current organization unit, through systemSave. Call it from a listener on the parent's
   * `updated` event, or right after moving the parent. Returns the number of moved records.
   */
  async rehome(
    parentName: string,
    parentId: number,
    options: Omit<SystemSaveOptions, 'version'>
  ): Promise<number> {
    return write.rehome(this.context, parentName, parentId, options)
  }

  async transition(
    name: string,
    id: number,
    actor: Actor,
    action: 'delete' | 'submit' | 'cancel',
    version?: unknown,
    transaction?: Knex.Transaction
  ) {
    return transition(this.context, name, id, actor, action, version, transaction)
  }

  /**
   * Amend-by-copy: a cancelled document is copied into a new draft that points to
   * it through amended_from_id, together with its inline lines. The original stays
   * cancelled and unchanged; sequence fields receive new numbers.
   */
  async amend(name: string, id: number, actor: Actor, transaction?: Knex.Transaction) {
    return write.amend(this.context, name, id, actor, transaction)
  }
}
