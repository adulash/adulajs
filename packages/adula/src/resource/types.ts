import type { Knex } from 'knex'
import type { LucidModel } from '@adonisjs/lucid/types/model'
import type { WorkflowDefinition } from '../workflows/define_workflow.js'
import type { Conditions } from '../auth/conditions.js'

/**
 * A display label. Arabic is required: it is the base language of every system.
 * Other languages are optional; a missing `label.<lang>` falls back to `label.ar`.
 */
export type Label = { ar: string; en?: string; [language: string]: string | undefined }
export type Action = 'view' | 'create' | 'update' | 'delete' | 'submit' | 'cancel' | 'amend'
export type Scalar = string | number | boolean | null
export type RecordData = Record<string, unknown>
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
export type SerializedRecord = Record<string, JsonValue>
/** One choice of an enum or multiSelect field: the stored value and its display label. */
export type FieldOption = { value: string; label: Label }
/**
 * Length limits and an anchored pattern of a text-like field. `pattern` is a RegExp
 * source matched against the whole trimmed value (it is wrapped in `^(?:…)$`).
 */
export type TextConstraints = { min?: number; max?: number; pattern?: string }
/**
 * Numeric limits. Money limits are canonical minor units (integer strings or safe
 * integers); decimal and percent limits are decimal strings or numbers.
 */
export type NumberConstraints = { min?: number | string; max?: number | string }
export type Field = {
  label: Label
  column?: string
  required?: boolean
  unique?: boolean
  sortable?: boolean
  searchable?: boolean
  filterable?: boolean
  permissionLevel?: number
  sequence?: string
  /**
   * Applied on create when the input omits the key (server side, before validation),
   * prefilled in the create form, and the column default for scalar types. An array
   * only for multiSelect. Not allowed on relations, attachments, json or sequences.
   */
  default?: Scalar | string[]
  /**
   * The field applies only while every named sibling field equals the value (or one of
   * the listed values; a multiSelect sibling must contain it). While it does not apply
   * the form hides the field, `required` is not enforced and the server stores null
   * (an empty list for manyToMany), on create and on update alike, except that an
   * update keeps the stored value of a field the actor may not write. Values are
   * canonical values of the sibling (checked by defineResource), for example '12.50'
   * for a decimal sibling with scale 2.
   */
  visibleWhen?: Record<string, Scalar | Scalar[]>
} & (
  | ({ type: 'string' } & TextConstraints & {
        /** Also check the value as an e-mail address, URL or phone number. */
        format?: 'email' | 'url' | 'phone'
      })
  | ({ type: 'text' | 'email' | 'url' | 'phone' } & TextConstraints)
  | ({ type: 'integer' | 'money' } & NumberConstraints)
  | ({
      /** numeric(precision, scale); the wire value is a decimal string with `scale` digits. */
      type: 'decimal' | 'percent'
      /** Total significant digits; defaults to 18 (decimal) or 7 (percent). */
      precision?: number
      /** Fractional digits; defaults to 2. */
      scale?: number
    } & NumberConstraints)
  | { type: 'boolean' | 'date' | 'datetime' | 'json' }
  /** One value from `options`, stored as its `value`. */
  | { type: 'enum'; options: FieldOption[] }
  /** Distinct values from `options` stored as a JSON array in `options` order; min/max count. */
  | { type: 'multiSelect'; options: FieldOption[]; min?: number; max?: number }
  /**
   * Records of another resource linked through a join table (not a column). The value is
   * the array of linked ids; the actor must be able to view every record they add.
   */
  | {
      type: 'manyToMany'
      resource: string
      /** Join table name; defaults to `<owner table>_<field key in snake_case>`. */
      table?: string
    }
  | {
      type: 'attachment'
      /**
       * Lower-case file extensions accepted for upload, or 'any'. Defaults to
       * DEFAULT_ATTACHMENT_EXTENSIONS (documents, images and archives).
       */
      accept?: string[] | 'any'
      /** Upload size limit such as '5mb'. Defaults to '20mb'. */
      maxSize?: string
    }
  | { type: 'belongsTo'; resource: string }
  /**
   * A user of this deployment (foreign key to users). Choices are active members of
   * the record's organization unit or its ancestors; readers see only the display name.
   */
  | { type: 'user' }
  | { type: 'hasMany'; resource: string; foreignKey: string; inline?: boolean }
  | { type: 'lookup'; group: string }
)
export type Resource = {
  name: string
  /** The list heading, usually plural (for example «الحسابات»). */
  label: Label
  /**
   * The singular record noun (for example «حساب»). Generated pages say «إضافة حساب»
   * instead of the generic «إضافة سجل».
   */
  recordLabel?: Label
  /** Full create-button text when «إضافة <recordLabel>» does not fit (for example «مهمة جديدة»). */
  createLabel?: Label
  /**
   * Optional: AdulaJS persists through Knex and never reads it. Applications that use
   * Lucid models in their own code may keep declaring it.
   */
  model?: LucidModel
  scoped: boolean
  /**
   * The organization unit of a scoped record follows a required belongsTo parent, for
   * example a clinic follows its facility. The unit is copied from the parent before
   * authorization, the actor must be able to view the parent, and the form has no unit
   * picker. `ResourceService.rehome` moves the children after the parent moves.
   */
  scope?: { from: string }
  submittable?: boolean
  version?: boolean
  fields: Record<string, Field>
  list: readonly string[]
  form: readonly string[]
  show: readonly string[]
  serialize?: readonly string[]
  hidden?: readonly string[]
  /**
   * Fields that name a record wherever it is referenced: relation cells and pickers,
   * "My tasks" and the approvals inbox. Joined with « · ». Defaults to the first
   * sequence field and the first text field in `list`.
   */
  title?: readonly string[]
  actions: readonly Action[]
  /**
   * Field combinations that must be unique among live records (a partial unique index
   * `WHERE deleted_at IS NULL`, and `AND doc_status <> 2` on a submittable resource so
   * cancelled documents do not count), for example `[['customerId', 'code']]`. Every key
   * is a stored field, or `orgUnitId` on a scoped resource (a code unique per unit).
   */
  unique?: readonly (readonly string[])[]
  /**
   * Optional: without it, writes are validated by the VineJS validator derived from the
   * fields (see definitionValidator). A given validator replaces the derived one; field
   * constraints are enforced again when values are stored, whatever the validator returns.
   */
  validator?: { validate(data: unknown): Promise<RecordData> }
  hooks?: {
    beforeSave?: (record: RecordData, context: HookContext) => Promise<void>
    afterSave?: (record: RecordData, context: HookContext) => Promise<void>
  }
}
export type HookContext = { trx: Knex.Transaction; userId: number; action: Action }
/** A changeable list value a module needs before its records can be saved. */
export type ModuleLookup = { key: string; label: Label; sort?: number }
/** A role a module ships; its rules go through the same validation as the roles screen. */
export type ModuleRole = {
  /** Stable key that workflows address ({ role: key }); see roles.key. */
  key: string
  /** Arabic display name; administrators may rename it later. */
  name: string
  permissionLevel?: number
  rules: readonly {
    subject: string
    action: string
    inverted?: boolean
    conditions?: Conditions | null
    fields?: string[] | null
  }[]
}
export type Module = {
  name: string
  reference?: boolean
  label: Label
  dependsOn: readonly string[]
  resources: readonly Resource[]
  /** Versioned workflows of this module's submittable resources (phase 4). */
  workflows?: readonly WorkflowDefinition[]
  /**
   * Lookup rows by group. adula:install inserts missing rows and never changes or
   * removes existing ones, so administrator edits survive upgrades.
   */
  lookups?: Readonly<Record<string, readonly ModuleLookup[]>>
  /**
   * Roles created by adula:install when no role has their key yet. An existing role
   * is never modified, so administrators own every role after installation.
   */
  defaultRoles?: readonly ModuleRole[]
}
export type ResourceInput<F extends Record<string, Field>> = Omit<
  Resource,
  'fields' | 'list' | 'form' | 'show' | 'hidden' | 'serialize' | 'title' | 'unique'
> & {
  fields: F
  unique?: readonly (readonly ((keyof F & string) | 'orgUnitId')[])[]
  list: readonly (keyof F & string)[]
  form: readonly (keyof F & string)[]
  show: readonly (keyof F & string)[]
  hidden?: readonly (keyof F & string)[]
  serialize?: readonly (keyof F & string)[]
  title?: readonly (keyof F & string)[]
}
