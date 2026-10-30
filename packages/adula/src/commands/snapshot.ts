import type { Field, Resource } from '../resource/types.js'
import { decimalShape } from '../resource/values.js'

const EMBEDDED = /(createResourceTable\([^,]+,\s*)(\{[\s\S]*\})(\s*\)\s*\})/

/**
 * The parts of one field that decide its table shape (and keep the snapshot a valid
 * Field): type and label, relation target and join table, column, constraints that
 * become indexes or NOT NULL, numeric shape, the column default and enum options.
 */
export function fieldSnapshot(field: Field): Field {
  return {
    type: field.type,
    label: field.label,
    ...('resource' in field && field.type !== 'hasMany' ? { resource: field.resource } : {}),
    ...(field.type === 'manyToMany' && field.table ? { table: field.table } : {}),
    ...(field.column ? { column: field.column } : {}),
    ...(field.required ? { required: true } : {}),
    ...(field.unique ? { unique: true } : {}),
    ...(field.searchable ? { searchable: true } : {}),
    ...(field.sequence ? { sequence: field.sequence } : {}),
    // The resolved numeric shape: replay never depends on the package's defaults.
    ...(field.type === 'decimal' || field.type === 'percent' ? decimalShape(field) : {}),
    // Decides nullability: a required field that visibleWhen may hide is a nullable column.
    ...(field.visibleWhen !== undefined ? { visibleWhen: field.visibleWhen } : {}),
    ...(field.default !== undefined && !Array.isArray(field.default)
      ? { default: field.default }
      : {}),
    ...('options' in field ? { options: field.options } : {}),
    // A multiple attachment field is a jsonb column instead of a foreign key.
    ...(field.type === 'attachment' && field.multiple ? { multiple: true } : {}),
  } as Field
}

/**
 * The part of a resource definition createResourceTable reads, as a generated
 * create-migration embeds it. Labels are kept so the migration stays readable.
 */
export function resourceSnapshot(
  resource: Pick<Resource, 'name' | 'scoped' | 'version' | 'submittable' | 'fields' | 'unique'>
) {
  return {
    name: resource.name,
    scoped: resource.scoped,
    ...(resource.version ? { version: true } : {}),
    ...(resource.submittable ? { submittable: true } : {}),
    ...(resource.unique?.length ? { unique: resource.unique.map((keys) => [...keys]) } : {}),
    fields: Object.fromEntries(
      Object.entries(resource.fields)
        .filter(([, field]) => field.type !== 'hasMany')
        .map(([key, field]) => [key, fieldSnapshot(field)])
    ),
  }
}

/** The resource name embedded in a generated create-migration, if the source is one. */
export function embeddedResource(source: string): string | undefined {
  const embedded = EMBEDDED.exec(source)?.[2]
  if (!embedded) return undefined
  try {
    const parsed = JSON.parse(embedded)
    return typeof parsed?.name === 'string' ? parsed.name : undefined
  } catch {
    return undefined
  }
}

/** Replaces the embedded definition of a generated create-migration (#20). */
export function rewriteResourceSnapshot(
  source: string,
  snapshot: ReturnType<typeof resourceSnapshot>
) {
  if (embeddedResource(source) !== snapshot.name)
    throw new Error(`The migration does not embed the ${snapshot.name} definition`)
  return source.replace(
    EMBEDDED,
    (_, before: string, _old: string, after: string) =>
      `${before}${JSON.stringify(snapshot, null, 2)}${after}`
  )
}
