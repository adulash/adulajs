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
 * source matched against the whole value, trimmed except for text (wrapped in `^(?:…)$`).
 */
export type TextConstraints = {
  /** Minimum length in characters. */
  min?: number
  /**
   * Maximum length in characters. The column caps it: 255 for string, 254 for email,
   * 32 for phone and 2048 for url.
   */
  max?: number
  /** RegExp source the whole value must match (trimmed except for text): `'\\d{10}'` means ten digits. */
  pattern?: string
}
/**
 * Numeric limits. Money limits are canonical minor units (integer strings or safe
 * integers); decimal and percent limits are decimal strings or numbers.
 */
export type NumberConstraints = {
  /** Smallest allowed value. */
  min?: number | string
  /** Largest allowed value. */
  max?: number | string
}
export type Field = {
  /** Field label in forms, list headers and messages. */
  label: Label
  /**
   * Column name when it is not the snake_case form of the field key.
   * @default the field key in snake_case
   */
  column?: string
  /**
   * A value is needed (at least one for multiSelect and manyToMany). The column is
   * `NOT NULL` unless the field has `visibleWhen`.
   * @default false
   */
  required?: boolean
  /**
   * A partial unique index over live rows (`WHERE deleted_at IS NULL`); on a submittable
   * resource cancelled documents do not count. Not on multiSelect, manyToMany or hasMany.
   * @default false
   */
  unique?: boolean
  /**
   * Allowed in the list `sort` parameter. Not on multiSelect, manyToMany or hasMany.
   * @default false
   */
  sortable?: boolean
  /**
   * Part of the generated full-text search vector. Only string, text, email, url, phone,
   * enum and lookup.
   * @default false
   */
  searchable?: boolean
  /**
   * Offered as a list filter (`filters[key]=value`).
   * @default false
   */
  filterable?: boolean
  /**
   * The actor permission level needed to see or write the field. A field listed in the
   * resource's `hidden` needs at least 1.
   * @default 0
   */
  permissionLevel?: number
  /**
   * Numbering sequence key; the next number is assigned on create and the field is not
   * part of the form input.
   */
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
} &
  /** A single-line trimmed string, varchar(255). */
  (
    | ({ type: 'string' } & TextConstraints & {
          /** Also check the value as an e-mail address, URL or phone number. */
          format?: 'email' | 'url' | 'phone'
        })
    /**
     * `text`: unlimited text, not trimmed. `email`: a trimmed, lower-case address.
     * `url`: an absolute http(s) URL. `phone`: `+?digits`, 7 to 15 digits.
     */
    | ({ type: 'text' | 'email' | 'url' | 'phone' } & TextConstraints)
    /** `integer`: a whole number. `money`: an integer string of minor units (bigint). */
    | ({ type: 'integer' | 'money' } & NumberConstraints)
    /** A fixed-point number; for `percent`, '12.50' means 12.5 %. */
    | ({
        /** numeric(precision, scale); the wire value is a decimal string with `scale` digits. */
        type: 'decimal' | 'percent'
        /**
         * Total significant digits, 1 to 1000.
         * @default 18 (decimal), 7 (percent)
         */
        precision?: number
        /**
         * Fractional digits, 0 to `precision`.
         * @default 2
         */
        scale?: number
      } & NumberConstraints)
    /**
     * `boolean`: true or false. `date`: a calendar date `YYYY-MM-DD`. `datetime`: a UTC
     * ISO timestamp with milliseconds. `json`: any JSON value (jsonb).
     */
    | { type: 'boolean' | 'date' | 'datetime' | 'json' }
    /** One value from `options`, stored as its `value`. */
    | {
        type: 'enum'
        /** The choices; values are unique and at most 255 characters. */
        options: FieldOption[]
      }
    /** Distinct values from `options` stored as a JSON array in `options` order; min/max count. */
    | {
        type: 'multiSelect'
        /** The choices; values are unique and at most 255 characters. */
        options: FieldOption[]
        /** Minimum number of selected values. */
        min?: number
        /** Maximum number of selected values. */
        max?: number
      }
    /**
     * Records of another resource linked through a join table (not a column). The value is
     * the array of linked ids; the actor must be able to view every record they add.
     */
    | {
        type: 'manyToMany'
        /** Name of the linked resource. */
        resource: string
        /**
         * Join table name.
         * @default `<owner table>_<field key in snake_case>`
         */
        table?: string
      }
    /** One uploaded file, stored as the id of its attachments row. */
    | {
        type: 'attachment'
        /**
         * Lower-case file extensions accepted for upload, or 'any'.
         * DEFAULT_ATTACHMENT_EXTENSIONS lists documents, images and archives.
         * @default DEFAULT_ATTACHMENT_EXTENSIONS
         */
        accept?: string[] | 'any'
        /**
         * Upload size limit such as '5mb'.
         * @default '20mb'
         */
        maxSize?: string
      }
    /** A record of another resource (integer foreign key, `RESTRICT`). */
    | {
        type: 'belongsTo'
        /** Name of the target resource. */
        resource: string
      }
    /**
     * A user of this deployment (foreign key to users). Choices are active members of
     * the record's organization unit or its ancestors; readers see only the display name.
     */
    | { type: 'user' }
    /** Child records of another resource that point back to this one (no column). */
    | {
        type: 'hasMany'
        /** Name of the child resource. */
        resource: string
        /** The child's belongsTo field key that references this record. */
        foreignKey: string
        /**
         * Edit the child rows inside the parent form; they are saved in the parent's
         * transaction.
         * @default false
         */
        inline?: boolean
      }
    /** A key of a lookup group managed on /admin/lookups. */
    | {
        type: 'lookup'
        /** Lookup group key, for example one declared in the module's `lookups`. */
        group: string
      }
  )
export type Resource = {
  /** Table and resource name: a lower-case letter, then lower-case letters, digits and `_`; at most 63 characters. */
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
  /** `true` adds `org_unit_id`: records belong to an organization unit and follow its scope. */
  scoped: boolean
  /**
   * The organization unit of a scoped record follows a required belongsTo parent, for
   * example a clinic follows its facility. The unit is copied from the parent before
   * authorization, the actor must be able to view the parent, and the form has no unit
   * picker. `ResourceService.rehome` moves the children after the parent moves.
   */
  scope?: { from: string }
  /**
   * Records are documents: draft, submit, cancel and amend-by-copy, with workflows.
   * @default false
   */
  submittable?: boolean
  /**
   * Optimistic versions: updates send the current version and stale writes are 409.
   * @default the value of `submittable`
   */
  version?: boolean
  /** The fields by key (camelCase; the column is the snake_case key unless `column` is set). */
  fields: Record<string, Field>
  /** Field keys shown as list columns, in order. */
  list: readonly string[]
  /** Field keys of the create and edit form, in order. */
  form: readonly string[]
  /** Field keys of the record details view, in order. */
  show: readonly string[]
  /**
   * Field keys returned by reads and the API.
   * @default the keys of `list` and `show`
   */
  serialize?: readonly string[]
  /** Field keys that need permission level 1 or more to see or write. */
  hidden?: readonly string[]
  /**
   * Fields that name a record wherever it is referenced: relation cells and pickers,
   * "My tasks" and the approvals inbox. Joined with « · ».
   * @default the first sequence field and the first text field in `list`
   */
  title?: readonly string[]
  /**
   * Operations the resource offers: view, create, update, delete, and submit, cancel and
   * amend on a submittable resource. Role rules still decide who may use each one.
   */
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
  /** Functions called inside the write transaction, before and after a record is stored. */
  hooks?: {
    beforeSave?: (record: RecordData, context: HookContext) => Promise<void>
    afterSave?: (record: RecordData, context: HookContext) => Promise<void>
  }
}
/** What a hook receives: the write transaction, the acting user's id and the action. */
export type HookContext = { trx: Knex.Transaction; userId: number; action: Action }
/** A changeable list value a module needs before its records can be saved. */
export type ModuleLookup = {
  /** The stored value. */
  key: string
  /** Display label. */
  label: Label
  /** Position in the lookup's list. */
  sort?: number
}
/** A role a module ships; its rules go through the same validation as the roles screen. */
export type ModuleRole = {
  /** Stable key that workflows address ({ role: key }); see roles.key. */
  key: string
  /** Arabic display name; administrators may rename it later. */
  name: string
  /**
   * Permission level of the role's holders (compared with Field.permissionLevel).
   * @default 0
   */
  permissionLevel?: number
  /**
   * Role rules: `subject` is a resource name or 'all', `fields` limits a rule to those
   * fields, `conditions` to matching records and `inverted` makes it a denial.
   */
  rules: readonly {
    subject: string
    action: string
    inverted?: boolean
    conditions?: Conditions | null
    fields?: string[] | null
  }[]
}
/** One application of a system, exported by `app/modules/<name>/module.ts`. */
export type Module = {
  /** Module (application) name: its folder under app/modules. */
  name: string
  /**
   * An example module that `adula:module:remove` may unregister and archive (its tables are kept).
   * @default false
   */
  reference?: boolean
  /** The application's menu group label. */
  label: Label
  /** Names of the modules whose resources this module's relations may reference. */
  dependsOn: readonly string[]
  /** The module's resource definitions. */
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
