import type { Knex } from 'knex'
import type { ResourceRegistry } from '../resource/registry.js'
import type { JsonValue, Label, Resource } from '../resource/types.js'
import type { Conditions } from '../auth/conditions.js'
import { buildAbility, type Actor, type AdulaAbility } from '../auth/ability.js'
import type { ResourceService } from '../admin/resource_service.js'
import { canQueryField } from '../admin/resource/shared.js'
import { AdulaError, notFound } from '../admin/errors.js'
import { labelText, translate } from '../languages/catalog.js'
import { cellText } from '../admin/resource/export.js'

export type DashboardMeasure = 'count' | { sum: string }
export type DashboardWidgetDefinition = {
  /** Unique within the dashboard: /^[a-z][a-zA-Z0-9_]*$/. */
  key: string
  label: Label
  resource: string
  measure: DashboardMeasure
  /** One queryable field (or docStatus / orgUnitId) to group the measure by. */
  groupBy?: string
  /** List filters, including the operators of ADR 046. */
  filters?: Record<string, unknown>
  /** Role-rule style conditions, as in ResourceService.aggregate. */
  where?: Conditions
}
export type DashboardDefinition = {
  /** /^[a-z][a-z0-9_]*$/, used in the URL /dashboards/:name. */
  name: string
  label: Label
  description?: Label
  widgets: DashboardWidgetDefinition[]
}
export type DashboardSummary = { name: string; label: string }
export type DashboardGroupRow = {
  value: JsonValue
  label: string
  measure: number | string | null
}
export type DashboardWidgetResult = {
  key: string
  label: string
  resource: string
  /** The list page of the widget's resource. */
  href: string
  measure: DashboardMeasure
  /**
   * count: an integer; integer, decimal and percent: a decimal string total (percent points
   * for percent); money: minor units as a string.
   */
  format: DashboardFormat
  kind: 'total' | 'grouped'
  groupBy: string | null
  value?: number | string | null
  rows?: DashboardGroupRow[]
  truncated: boolean
}
export type DashboardResult = {
  name: string
  label: string
  description: string | null
  widgets: DashboardWidgetResult[]
}

/** How a widget's measure reads: a count, or the sum's field type. */
export type DashboardFormat = 'count' | 'integer' | 'money' | 'decimal' | 'percent'
/** Field types a widget may total, as ResourceService.aggregate sums them. */
const SUMMABLE = ['integer', 'money', 'decimal', 'percent']

const NAME = /^[a-z][a-z0-9_]*$/
const KEY = /^[a-z][a-zA-Z0-9_]*$/

/** Declares an indicators page outside the resource type (ADR 046). */
export function defineDashboard(definition: DashboardDefinition): DashboardDefinition {
  const { name } = definition ?? {}
  if (typeof name !== 'string' || !NAME.test(name))
    throw new Error(`Invalid dashboard name: ${String(name)}`)
  if (!definition.label?.ar?.trim()) throw new Error(`${name}: label.ar is required`)
  if (definition.description !== undefined && !definition.description?.ar?.trim())
    throw new Error(`${name}: description.ar is required`)
  if (!Array.isArray(definition.widgets) || !definition.widgets.length)
    throw new Error(`${name}: a dashboard needs at least one widget`)
  const keys = new Set<string>()
  for (const widget of definition.widgets) {
    if (typeof widget?.key !== 'string' || !KEY.test(widget.key))
      throw new Error(`${name}: invalid widget key ${String(widget?.key)}`)
    if (keys.has(widget.key)) throw new Error(`${name}: duplicate widget ${widget.key}`)
    keys.add(widget.key)
    const where = `${name}.${widget.key}`
    if (!widget.label?.ar?.trim()) throw new Error(`${where}: label.ar is required`)
    if (typeof widget.resource !== 'string' || !widget.resource)
      throw new Error(`${where}: resource is required`)
    const measure = widget.measure
    if (
      measure !== 'count' &&
      !(
        measure &&
        typeof measure === 'object' &&
        Object.keys(measure).length === 1 &&
        typeof measure.sum === 'string'
      )
    )
      throw new Error(`${where}: measure is 'count' or { sum: field }`)
    if (widget.groupBy !== undefined && typeof widget.groupBy !== 'string')
      throw new Error(`${where}: groupBy is one field name`)
    for (const [option, value] of [
      ['filters', widget.filters],
      ['where', widget.where],
    ] as const)
      if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value)))
        throw new Error(`${where}: ${option} must be an object`)
  }
  return Object.freeze({ ...definition, widgets: Object.freeze([...definition.widgets]) }) as never
}

/**
 * Renders dashboards as the viewer: every widget runs through ResourceService.aggregate
 * with the viewer's rules, scope and field access, and a widget the viewer cannot read
 * is omitted rather than failed.
 */
export class Dashboards {
  private dashboards: Map<string, DashboardDefinition>

  constructor(
    private db: Knex,
    private registry: ResourceRegistry,
    private resources: ResourceService,
    definitions: readonly DashboardDefinition[] = []
  ) {
    this.dashboards = Dashboards.validate(registry, definitions)
  }

  /**
   * Checks dashboards against the registered resources: unique names, existing widget
   * resources, integer, money, decimal or percent totals, groupable fields and filter or condition keys
   * that exist on the resource. Call it when the application loads its definitions, so a
   * bad definition fails at boot.
   */
  static validate(registry: ResourceRegistry, definitions: readonly DashboardDefinition[]) {
    const dashboards = new Map<string, DashboardDefinition>()
    for (const dashboard of definitions) {
      if (dashboards.has(dashboard.name)) throw new Error(`Duplicate dashboard: ${dashboard.name}`)
      for (const widget of dashboard.widgets) {
        const resource = registry.get(widget.resource)
        const where = `${dashboard.name}.${widget.key}`
        if (typeof widget.measure === 'object') {
          const field = resource.fields[widget.measure.sum]
          if (!field || !SUMMABLE.includes(field.type))
            throw new Error(
              `${where}: ${widget.measure.sum} is not an integer, money, decimal or percent field`
            )
        }
        if (widget.groupBy !== undefined && !groupable(resource, widget.groupBy))
          throw new Error(`${where}: ${widget.groupBy} cannot be grouped`)
        for (const key of Object.keys(widget.filters ?? {}))
          if (!Object.hasOwn(resource.fields, key) || !resource.fields[key].filterable)
            throw new Error(`${where}: ${key} is not a filterable field`)
        for (const key of Object.keys(widget.where ?? {}))
          if (!groupable(resource, key)) throw new Error(`${where}: ${key} cannot be a condition`)
      }
      dashboards.set(dashboard.name, dashboard)
    }
    return dashboards
  }

  /**
   * Whether the actor may read this widget: the resource is viewable and every field it
   * totals, groups, filters or conditions on is one the actor may query.
   */
  private readable(widget: DashboardWidgetDefinition, actor: Actor, ability: AdulaAbility) {
    const resource = this.registry.get(widget.resource)
    const standard = new Set(['docStatus', 'orgUnitId'])
    const fields = [
      ...(typeof widget.measure === 'object' ? [widget.measure.sum] : []),
      ...(widget.groupBy ? [widget.groupBy] : []),
      ...Object.keys(widget.filters ?? {}),
      ...Object.keys(widget.where ?? {}),
    ].filter((key) => !standard.has(key))
    return (
      resource.actions.includes('view') &&
      ability.can('view', resource.name) &&
      (!resource.scoped || actor.orgPaths.length > 0) &&
      fields.every((key) => canQueryField(resource, actor, ability, key))
    )
  }

  /** Dashboards with at least one widget the actor may read. */
  list(actor: Actor): DashboardSummary[] {
    const ability = buildAbility(actor.rules, this.registry.all())
    return [...this.dashboards.values()]
      .filter((dashboard) =>
        dashboard.widgets.some((widget) => this.readable(widget, actor, ability))
      )
      .map((dashboard) => ({ name: dashboard.name, label: labelText(dashboard.label) }))
  }

  async render(name: string, actor: Actor): Promise<DashboardResult> {
    const dashboard = typeof name === 'string' ? this.dashboards.get(name) : undefined
    if (!dashboard) throw notFound('لوحة المؤشرات غير موجودة')
    const widgets: DashboardWidgetResult[] = []
    for (const widget of dashboard.widgets) {
      const rendered = await this.widget(widget, actor)
      if (rendered) widgets.push(rendered)
    }
    // A dashboard whose widgets are all hidden from the viewer does not exist for them.
    if (!widgets.length) throw notFound('لوحة المؤشرات غير موجودة')
    return {
      name: dashboard.name,
      label: labelText(dashboard.label),
      description: dashboard.description ? labelText(dashboard.description) : null,
      widgets,
    }
  }

  private async widget(
    widget: DashboardWidgetDefinition,
    actor: Actor
  ): Promise<DashboardWidgetResult | null> {
    const resource = this.registry.get(widget.resource)
    // A widget filtered or conditioned on a field the viewer may not query is omitted,
    // never a refusal of the whole page.
    if (!this.readable(widget, actor, buildAbility(actor.rules, this.registry.all()))) return null
    const sum = typeof widget.measure === 'object' ? widget.measure.sum : null
    let aggregate
    try {
      aggregate = await this.resources.aggregate(resource.name, actor, {
        groupBy: widget.groupBy ? [widget.groupBy] : [],
        count: sum === null,
        sum: sum ? [sum] : [],
        filters: widget.filters,
        where: widget.where,
      })
    } catch (error) {
      if (error instanceof AdulaError && error.status === 403) return null
      throw error
    }
    const measureOf = (row: (typeof aggregate.rows)[number]) =>
      sum === null ? (row.count ?? 0) : (row.sum?.[sum] ?? null)
    const base = {
      key: widget.key,
      label: labelText(widget.label),
      resource: resource.name,
      href: `/resources/${resource.name}`,
      measure: widget.measure,
      format: (sum === null ? 'count' : resource.fields[sum].type) as DashboardFormat,
      groupBy: widget.groupBy ?? null,
      truncated: aggregate.truncated,
    }
    if (!widget.groupBy) {
      const [row] = aggregate.rows
      return { ...base, kind: 'total', value: row ? measureOf(row) : sum === null ? 0 : null }
    }
    const key = widget.groupBy
    const values = aggregate.rows.map((row) => row.group[key] ?? null)
    const label = await this.labeller(resource, key, values, actor)
    return {
      ...base,
      kind: 'grouped',
      rows: aggregate.rows.map((row, index) => ({
        value: values[index],
        label: label(values[index]),
        measure: measureOf(row),
      })),
    }
  }

  /** Display labels of one grouped field: lookups, titles, user names, «نعم/لا». */
  private async labeller(resource: Resource, key: string, values: JsonValue[], actor: Actor) {
    const none = translate('list.value.none')
    const ids = [
      ...new Set(values.filter((value): value is number => typeof value === 'number')),
    ].filter((id) => Number.isSafeInteger(id) && id > 0)
    if (key === 'docStatus')
      return (value: JsonValue) =>
        value === null ? none : translate(`list.status.${Number(value)}`)
    if (key === 'orgUnitId') {
      const names = new Map<number, string>()
      if (ids.length)
        for (const row of await this.db('org_units').whereIn('id', ids).select('id', 'name'))
          names.set(Number(row.id), String(row.name))
      return (value: JsonValue) =>
        value === null ? none : (names.get(Number(value)) ?? `#${value}`)
    }
    const field = resource.fields[key]
    const titles = new Map<number, string>()
    const lookups = new Map<string, string>()
    if (field.type === 'belongsTo' && ids.length)
      for (const [id, title] of await this.resources.titles(field.resource, ids, actor))
        titles.set(id, title)
    if (field.type === 'user' && ids.length)
      // A display name only, as list() shows it: readers need not read account e-mails.
      for (const row of await this.db('users').whereIn('id', ids).select('id', 'full_name'))
        if (row.full_name) titles.set(Number(row.id), String(row.full_name))
    if (field.type === 'lookup')
      for (const row of await this.db('lookups')
        .where('group', field.group)
        .select('key', 'label_ar'))
        lookups.set(String(row.key), String(row.label_ar))
    return (value: JsonValue) =>
      value === null || value === ''
        ? none
        : cellText(field, value, {
            lookup: (_, entry) => lookups.get(entry),
            title: (id) => titles.get(id),
          })
  }
}

function groupable(resource: Resource, key: string) {
  if (key === 'docStatus') return Boolean(resource.submittable)
  if (key === 'orgUnitId') return resource.scoped
  const field = Object.hasOwn(resource.fields, key) ? resource.fields[key] : undefined
  // As aggregate(): a manyToMany field has no single value to group or compare.
  return Boolean(field) && !['hasMany', 'manyToMany', 'json', 'attachment'].includes(field!.type)
}
