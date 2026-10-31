import type { Action, Field, Label } from '../resource/types.js'

export type ResourceField = Field & { key: string }
/** Per-record permissions; `restore` appears on rows of a trashed list (ADR 046). */
export type RecordPermissions = Partial<Record<Action | 'restore', boolean>>
export type ResourceDescription = {
  name: string
  label: string
  /** Singular record noun in Arabic, or null when the resource does not declare one. */
  recordLabel: string | null
  /** Arabic create-button text, or null to derive «إضافة <recordLabel>» (or «إضافة سجل»). */
  createLabel: string | null
  fields: ResourceField[]
  list: string[]
  show: string[]
  searchable: boolean
  canCreate: boolean
  scoped: boolean
  submittable: boolean
  /**
   * Whether the actor may open «المحذوفات» (the trashed list) and restore records: the
   * resource offers delete and the actor holds it (ADR 046). Optional for compatibility
   * with descriptions built by older code.
   */
  trash?: boolean
  /** The list can be exported as CSV through GET …/export (ADR 046). */
  exportable?: boolean
  /** Whether GET …/bulk may offer any action to this actor; the list decides each action. */
  bulk?: boolean
  /**
   * Print templates declared in code (ADR 048); present only when the resource has some.
   * GET …/print-templates also lists administrator templates.
   */
  printTemplates?: { key: string; label: Label }[]
}
export type ResourceNavigation = {
  name: string
  label: string
  href: string
  module: string
  /** Arabic module label, for grouping the navigation by module (1.2; optional for compatibility). */
  moduleLabel?: string
}[]
