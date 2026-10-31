/**
 * A typed API client generated from the OpenAPI document of openApiDocument(): one
 * self-contained TypeScript module (no imports, no DOM or Node types) holding the
 * per-resource record and input types and a small fetch-based runtime. The document
 * is usually actor-filtered, so the client describes exactly what one token may use.
 */

type Schema = Record<string, unknown>
type Operation = {
  operationId?: string
  parameters?: Schema[]
  requestBody?: { content?: Record<string, { schema?: Schema }> }
}
/** The parts of an OpenAPI 3.1 document the generator reads (openApiDocument's output). */
export type ApiClientDocument = {
  info?: { title?: string; version?: string }
  servers?: { url: string }[]
  paths: Record<string, Record<string, unknown>>
  components?: { schemas?: Record<string, Schema> }
}
export type ApiClientOptions = {
  /** Default server for createAdulaClient when no baseUrl is passed; the document's server otherwise. */
  baseUrl?: string
}

const RESOURCE_OPERATIONS = [
  'list',
  'show',
  'create',
  'update',
  'delete',
  'submit',
  'cancel',
  'amend',
  'aggregate',
] as const
type ResourceOperation = (typeof RESOURCE_OPERATIONS)[number]

type ResourcePlan = {
  name: string
  type: string
  operations: Set<ResourceOperation>
  filters?: Schema
  sort: string[]
  importable: boolean
  /** Body of POST …/imports for this resource. */
  importInput?: Schema
  /** The mode query parameter of …/imports/template. */
  templateMode?: Schema
}

const RUNTIME_NAMES = [
  'AdulaApiError',
  'AdulaClient',
  'AdulaClientOptions',
  'AdulaFetch',
  'AdulaFetchResponse',
  'AdulaListQuery',
  'AdulaPage',
  'AdulaAggregateQuery',
  'AdulaAggregate',
  'AdulaTransitionOptions',
  'AdulaResourceClients',
  'AdulaImportsClient',
  'AdulaImportBatch',
  'AdulaImportInput',
  'AdulaImportInputs',
  'AdulaImportModes',
  'AdulaImportStartInput',
  'AdulaImportableResource',
  'Resources',
]

const isRecord = (value: unknown): value is Schema =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function pascal(name: string) {
  return name
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join('')
}

const identifier = /^[A-Za-z_$][A-Za-z0-9_$]*$/
const propertyKey = (key: string) => (identifier.test(key) ? key : JSON.stringify(key))
const comment = (text: unknown, indent: string) =>
  typeof text === 'string' && text ? `${indent}/** ${text.replace(/\*\//g, '* /')} */\n` : ''

/** Reads the document once: component type names and each resource's operations. */
function plan(document: ApiClientDocument) {
  const schemas = document.components?.schemas ?? {}
  const taken = new Set(RUNTIME_NAMES)
  const names = new Map<string, string>()
  for (const key of Object.keys(schemas)) {
    if (key === 'ImportBatch') {
      names.set(key, 'AdulaImportBatch')
      continue
    }
    const input = key.endsWith('_input')
    let base = pascal(input ? key.slice(0, -'_input'.length) : key) || 'Schema'
    if (/^\d/.test(base)) base = `R${base}`
    let name = `${base}${input ? 'Input' : ''}`
    if (taken.has(name)) name = `${base}Record${input ? 'Input' : ''}`
    for (let suffix = 2; taken.has(name); suffix++) name = `${base}${suffix}${input ? 'Input' : ''}`
    taken.add(name)
    names.set(key, name)
  }
  const resources = new Map<string, ResourcePlan>()
  let basePath = '/api/v1'
  let startInput: Schema | undefined
  let imports = false
  for (const [path, item] of Object.entries(document.paths)) {
    const prefix = /^(.*?)\/(resources|imports)(\/|$)/.exec(path)
    if (prefix) basePath = prefix[1]
    for (const [method, value] of Object.entries(item)) {
      if (!isRecord(value)) continue
      const operation = value as Operation
      const id = operation.operationId
      if (typeof id !== 'string') continue
      const match = /\/resources\/([^/{]+)(\/|$)/.exec(path)
      if (!match) {
        if (id.startsWith('imports.')) imports = true
        if (id === 'imports.start')
          startInput = operation.requestBody?.content?.['application/json']?.schema
        continue
      }
      const name = match[1]
      const entry: ResourcePlan = resources.get(name) ?? {
        name,
        type: names.get(name) ?? pascal(name),
        operations: new Set(),
        sort: ['id'],
        importable: false,
      }
      resources.set(name, entry)
      const kind = id.slice(id.lastIndexOf('.') + 1)
      if (kind === 'import') {
        entry.importable = true
        entry.importInput = operation.requestBody?.content?.['application/json']?.schema
        continue
      }
      if (kind === 'importTemplate') {
        const mode = operation.parameters?.find((parameter) => parameter.name === 'mode')
        if (isRecord(mode?.schema)) entry.templateMode = mode.schema
        continue
      }
      if (!(RESOURCE_OPERATIONS as readonly string[]).includes(kind) || method === 'parameters')
        continue
      entry.operations.add(kind as ResourceOperation)
      const parameters = operation.parameters ?? []
      const filters = parameters.find((parameter) => parameter.name === 'filters')
      if (filters && isRecord(filters.schema) && kind === 'list') entry.filters = filters.schema
      const sort = parameters.find((parameter) => parameter.name === 'sort')
      const values = isRecord(sort?.schema) ? sort.schema.enum : undefined
      if (kind === 'list' && Array.isArray(values)) entry.sort = values.map(String)
    }
  }
  // A stable method order, whatever the path order of the document.
  for (const entry of resources.values())
    entry.operations = new Set(
      RESOURCE_OPERATIONS.filter((operation) => entry.operations.has(operation))
    )
  return { schemas, names, resources: [...resources.values()], basePath, imports, startInput }
}

/** A JSON Schema (the subset openApiDocument emits) as a TypeScript type expression. */
function tsType(schema: unknown, names: Map<string, string>, indent: string): string {
  if (!isRecord(schema)) return 'unknown'
  if (typeof schema.$ref === 'string') {
    const key = schema.$ref.replace('#/components/schemas/', '')
    // A component the caller may not view is left out of its document.
    return names.get(key) ?? 'Record<string, unknown>'
  }
  if (Array.isArray(schema.allOf)) {
    // Inline child rows: the parent fills the inherited keys (x-adula-inherited).
    const inherited = Array.isArray(schema['x-adula-inherited'])
      ? schema['x-adula-inherited'].map(String)
      : []
    const parts = schema.allOf.map((part) => {
      const type = tsType(part, names, indent)
      return inherited.length ? `Omit<${type}, ${literal(inherited)}>` : type
    })
    if (isRecord(schema.properties)) parts.push(objectType(schema, names, indent))
    return parts.join(' & ')
  }
  if (Array.isArray(schema.enum))
    return schema.enum.map((value) => JSON.stringify(value)).join(' | ') || 'never'
  const types = Array.isArray(schema.type)
    ? schema.type.map(String)
    : typeof schema.type === 'string'
      ? [schema.type]
      : isRecord(schema.properties)
        ? ['object']
        : []
  if (!types.length) return 'unknown'
  const parts = types.map((type) => {
    switch (type) {
      case 'string':
        return 'string'
      case 'integer':
      case 'number':
        return 'number'
      case 'boolean':
        return 'boolean'
      case 'null':
        return 'null'
      case 'array':
        return `Array<${tsType(schema.items, names, indent)}>`
      case 'object':
        return objectType(schema, names, indent)
      default:
        return 'unknown'
    }
  })
  return [...new Set(parts)].join(' | ')
}

function objectType(schema: Schema, names: Map<string, string>, indent: string): string {
  if (isRecord(schema.properties)) {
    const body = members(schema, names, `${indent}  `)
    return body ? `{\n${body}${indent}}` : 'Record<string, never>'
  }
  if (isRecord(schema.additionalProperties))
    return `Record<string, ${tsType(schema.additionalProperties, names, indent)}>`
  return 'Record<string, unknown>'
}

function members(schema: Schema, names: Map<string, string>, indent: string) {
  const required = new Set(Array.isArray(schema.required) ? schema.required.map(String) : [])
  return Object.entries(isRecord(schema.properties) ? schema.properties : {})
    .map(([key, property]) => {
      const optional = required.has(key) ? '' : '?'
      return `${comment(isRecord(property) ? property.description : undefined, indent)}${indent}${propertyKey(key)}${optional}: ${tsType(property, names, indent)}\n`
    })
    .join('')
}

function declaration(name: string, schema: Schema, names: Map<string, string>) {
  const head = comment(schema.description, '')
  if (isRecord(schema.properties)) {
    const body = members(schema, names, '  ')
    return body
      ? `${head}export interface ${name} {\n${body}}\n`
      : `${head}export type ${name} = Record<string, never>\n`
  }
  return `${head}export type ${name} = ${tsType(schema, names, '')}\n`
}

const literal = (values: string[]) => values.map((value) => JSON.stringify(value)).join(' | ')

/** The types shared by apiClientSource and apiClientDeclarations. */
function typesSection(document: ApiClientDocument) {
  const { schemas, names, resources, imports, startInput, basePath } = plan(document)
  const lines: string[] = [
    `/** The part of a fetch Response the client reads. */`,
    `export interface AdulaFetchResponse {`,
    `  ok: boolean`,
    `  status: number`,
    `  statusText: string`,
    `  text(): Promise<string>`,
    `}`,
    `/** The global fetch, or any compatible implementation (tests, proxies, retries). */`,
    `export type AdulaFetch = (`,
    `  url: string,`,
    `  init: { method: string; headers: Record<string, string>; body?: string }`,
    `) => Promise<AdulaFetchResponse>`,
    `export interface AdulaClientOptions {`,
    `  /** Server origin, for example https://erp.example.com. Defaults to the server this client was generated from. */`,
    `  baseUrl?: string`,
    `  /** API prefix. Defaults to ${JSON.stringify(basePath)}. */`,
    `  basePath?: string`,
    `  /** A personal API token (Account → API tokens), sent as a bearer token. */`,
    `  token: string`,
    `  fetch?: AdulaFetch`,
    `}`,
    `export interface AdulaListQuery<Filters, Sort extends string> {`,
    `  limit?: number`,
    `  /** meta.nextCursor of the previous page. */`,
    `  cursor?: string | null`,
    `  search?: string`,
    `  sort?: Sort`,
    `  direction?: 'asc' | 'desc'`,
    `  tag?: string`,
    `  /** false skips meta.estimatedTotal. */`,
    `  estimate?: boolean`,
    `  /** Equality filters on filterable fields (filters[field]=value). */`,
    `  filters?: Filters`,
    `}`,
    `export interface AdulaPage<Row> {`,
    `  data: Row[]`,
    `  meta: { limit: number; nextCursor: string | null; estimatedTotal?: number }`,
    `}`,
    `export interface AdulaAggregateQuery<Filters> {`,
    `  /** Up to three fields. */`,
    `  groupBy?: string | readonly string[]`,
    `  /** Integer or money fields to total. */`,
    `  sum?: string | readonly string[]`,
    `  /** Conditions ($eq, $ne, $in, $lt, $gt, $like) as an object or its JSON. */`,
    `  where?: Record<string, unknown> | string`,
    `  search?: string`,
    `  count?: boolean`,
    `  filters?: Filters`,
    `}`,
    `export interface AdulaAggregate {`,
    `  truncated?: boolean`,
    `  rows: Array<{ group: Record<string, unknown>; count?: number; sum?: Record<string, string | null> }>`,
    `}`,
    `export interface AdulaTransitionOptions {`,
    `  /** The record version read last (optimistic locking). */`,
    `  version?: number`,
    `}`,
    '',
  ]
  for (const [key, schema] of Object.entries(schemas))
    lines.push(declaration(names.get(key)!, schema, names))
  const clients: string[] = []
  for (const resource of resources) {
    const record = names.get(resource.name) ?? 'Record<string, unknown>'
    const input = names.get(`${resource.name}_input`) ?? 'Record<string, unknown>'
    const type = resource.type
    lines.push(
      resource.filters
        ? declaration(`${type}Filters`, resource.filters, names)
        : `export type ${type}Filters = Record<string, never>\n`,
      `export type ${type}Sort = ${literal(resource.sort)}\n`
    )
    const methods: string[] = []
    const has = (operation: ResourceOperation) => resource.operations.has(operation)
    if (has('list'))
      methods.push(
        `  list(query?: AdulaListQuery<${type}Filters, ${type}Sort>): Promise<AdulaPage<${record}>>`
      )
    if (has('show')) methods.push(`  show(id: number): Promise<${record}>`)
    if (has('create')) methods.push(`  create(input: ${input}): Promise<${record}>`)
    if (has('update'))
      methods.push(
        `  /** Only the given fields change; pass version on versioned resources. */`,
        `  update(id: number, input: Partial<${input}>): Promise<${record}>`
      )
    if (has('delete'))
      methods.push(`  delete(id: number, options?: AdulaTransitionOptions): Promise<${record}>`)
    if (has('submit'))
      methods.push(`  submit(id: number, options?: AdulaTransitionOptions): Promise<${record}>`)
    if (has('cancel'))
      methods.push(`  cancel(id: number, options?: AdulaTransitionOptions): Promise<${record}>`)
    if (has('amend'))
      methods.push(
        `  /** A new draft copied from the cancelled document. */`,
        `  amend(id: number): Promise<${record}>`
      )
    if (has('aggregate'))
      methods.push(
        `  aggregate(query?: AdulaAggregateQuery<${type}Filters>): Promise<AdulaAggregate>`
      )
    lines.push(`export interface ${type}Client {\n${methods.join('\n')}\n}\n`)
    clients.push(`  ${propertyKey(resource.name)}: ${type}Client`)
  }
  lines.push(
    `/** The resources this client may call, by name. */`,
    `export interface Resources {`,
    ...resources.map(
      (resource) =>
        `  ${propertyKey(resource.name)}: {\n    record: ${names.get(resource.name) ?? 'Record<string, unknown>'}\n    input: ${names.get(`${resource.name}_input`) ?? 'Record<string, unknown>'}\n    filters: ${resource.type}Filters\n    sort: ${resource.type}Sort\n    operations: ${literal([...resource.operations]) || 'never'}\n  }`
    ),
    `}`,
    `export interface AdulaResourceClients {`,
    ...clients,
    `}`
  )
  const importable = resources.filter((resource) => resource.importable)
  if (imports) {
    if (!names.has('ImportBatch'))
      lines.push(`export type AdulaImportBatch = Record<string, unknown>`)
    lines.push(
      `/** The upload body per importable resource: modes and match fields differ by resource. */`,
      `export interface AdulaImportInputs {`,
      ...importable.map(
        (resource) =>
          `  ${propertyKey(resource.name)}: ${tsType(resource.importInput ?? { type: 'object' }, names, '  ')}`
      ),
      `}`,
      `export interface AdulaImportModes {`,
      ...importable.map(
        (resource) =>
          `  ${propertyKey(resource.name)}: ${resource.templateMode ? tsType(resource.templateMode, names, '  ') : '"create"'}`
      ),
      `}`,
      `export type AdulaImportableResource = keyof AdulaImportInputs`,
      `export type AdulaImportInput = AdulaImportInputs[AdulaImportableResource]`,
      declaration(
        'AdulaImportStartInput',
        startInput ?? {
          type: 'object',
          properties: { mapping: { type: 'object', additionalProperties: { type: 'string' } } },
          required: ['mapping'],
        },
        names
      ),
      `export interface AdulaImportsClient {`,
      `  /** The caller's latest batches. */`,
      `  list(): Promise<AdulaImportBatch[]>`,
      `  /** One batch; after a dry run, report holds each row's outcome. */`,
      `  show(id: number): Promise<AdulaImportBatch>`,
      `  /** Uploads a file; the batch then waits for start() with its column mapping. */`,
      `  create<R extends AdulaImportableResource>(resource: R, input: AdulaImportInputs[R]): Promise<AdulaImportBatch>`,
      `  /** Queues the batch: dryRun validates only (status validated); start again to import. */`,
      `  start(id: number, input: AdulaImportStartInput): Promise<AdulaImportBatch>`,
      `  /** The CSV header row (UTF-8 with BOM) of the fields the caller may import. */`,
      `  template<R extends AdulaImportableResource>(resource: R, options?: { mode?: AdulaImportModes[R] }): Promise<string>`,
      `}`
    )
  }
  lines.push(
    `export interface AdulaClient {`,
    `  resources: AdulaResourceClients`,
    ...(imports ? [`  imports: AdulaImportsClient`] : []),
    `  /** Any other API call: the path is relative to basePath; JSON in and out. */`,
    `  request<T = unknown>(method: string, path: string, body?: unknown): Promise<T>`,
    `}`
  )
  return { text: lines.join('\n'), resources, basePath, imports }
}

function header(document: ApiClientDocument) {
  const title = [document.info?.title, document.info?.version].filter(Boolean).join(' ')
  return [
    `// Generated by AdulaJS from the OpenAPI document${title ? ` of ${title}` : ''}.`,
    `// Do not edit: regenerate with \`node ace adula:client\` or download GET /api/v1/client.ts.`,
    `/* eslint-disable */`,
    '',
  ].join('\n')
}

const RUNTIME = `
export class AdulaApiError extends Error {
  readonly status: number
  readonly code: string
  readonly body: unknown
  constructor(status: number, code: string, message: string, body?: unknown) {
    super(message)
    this.name = 'AdulaApiError'
    this.status = status
    this.code = code
    this.body = body
  }
}

function adulaQuery(query: Record<string, unknown> | undefined) {
  const parts: string[] = []
  const add = (key: string, value: unknown) => {
    if (value === undefined || value === null || value === '') return
    parts.push(key + '=' + encodeURIComponent(String(value)))
  }
  for (const key of Object.keys(query ?? {})) {
    const value = (query as Record<string, unknown>)[key]
    if (key === 'filters' && value && typeof value === 'object') {
      const filters = value as Record<string, unknown>
      for (const field of Object.keys(filters)) add('filters[' + encodeURIComponent(field) + ']', filters[field])
    } else if ((key === 'groupBy' || key === 'sum') && Array.isArray(value)) add(key, value.join(','))
    else if (key === 'where' && value && typeof value === 'object') add(key, JSON.stringify(value))
    else add(encodeURIComponent(key), value)
  }
  return parts.length ? '?' + parts.join('&') : ''
}

export function createAdulaClient(options: AdulaClientOptions): AdulaClient {
  const globalFetch = (globalThis as unknown as { fetch?: AdulaFetch }).fetch
  const fetcher: AdulaFetch | undefined =
    options.fetch ?? (globalFetch ? (url, init) => globalFetch(url, init) : undefined)
  if (!fetcher) throw new Error('No fetch implementation: pass options.fetch')
  if (!options.token) throw new Error('A personal API token is required')
  const root =
    (options.baseUrl ?? ADULA_API_SERVER).replace(/\\/+$/, '') +
    (options.basePath ?? ADULA_API_BASE_PATH).replace(/\\/+$/, '')
  async function call(
    method: string,
    path: string,
    init: { query?: Record<string, unknown>; body?: unknown; text?: boolean } = {}
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      Authorization: 'Bearer ' + options.token,
      Accept: init.text ? 'text/csv, text/plain, */*' : 'application/json',
    }
    if (init.body !== undefined) headers['Content-Type'] = 'application/json'
    const response = await fetcher!(root + path + adulaQuery(init.query), {
      method,
      headers,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    })
    const raw = await response.text()
    if (!response.ok) {
      let parsed: unknown
      try {
        parsed = raw ? JSON.parse(raw) : undefined
      } catch {
        parsed = undefined
      }
      const error = (parsed as { error?: { code?: unknown; message?: unknown } } | undefined)?.error
      throw new AdulaApiError(
        response.status,
        typeof error?.code === 'string' ? error.code : 'E_HTTP',
        typeof error?.message === 'string'
          ? error.message
          : response.statusText || 'HTTP ' + response.status,
        parsed ?? raw
      )
    }
    if (init.text) return raw
    return raw ? JSON.parse(raw) : undefined
  }
  const data = async (promise: Promise<unknown>) => ((await promise) as { data: unknown }).data
  const segment = (value: string | number) => encodeURIComponent(String(value))
  const resources: Record<string, Record<string, unknown>> = {}
  for (const [name, operations] of Object.entries(ADULA_OPERATIONS)) {
    const path = '/resources/' + segment(name)
    const item = (id: number) => path + '/' + segment(id)
    const methods: Record<string, unknown> = {
      list: (query?: Record<string, unknown>) => call('GET', path, { query }),
      show: (id: number) => data(call('GET', item(id))),
      create: (input: unknown) => data(call('POST', path, { body: input })),
      update: (id: number, input: unknown) => data(call('PATCH', item(id), { body: input })),
      delete: (id: number, transition?: AdulaTransitionOptions) =>
        data(call('DELETE', item(id), { body: transition })),
      submit: (id: number, transition?: AdulaTransitionOptions) =>
        data(call('POST', item(id) + '/submit', { body: transition })),
      cancel: (id: number, transition?: AdulaTransitionOptions) =>
        data(call('POST', item(id) + '/cancel', { body: transition })),
      amend: (id: number) => data(call('POST', item(id) + '/amend', { body: {} })),
      aggregate: (query?: Record<string, unknown>) => data(call('GET', path + '/aggregate', { query })),
    }
    // Only the operations the document describes exist, at runtime as in the types.
    resources[name] = Object.fromEntries(
      operations.map((operation) => [operation, methods[operation]])
    )
  }
  const client: Record<string, unknown> = {
    resources,
    request: (method: string, path: string, body?: unknown) =>
      call(method.toUpperCase(), path.startsWith('/') ? path : '/' + path, { body }),
  }
  if (ADULA_IMPORTS)
    client.imports = {
      list: () => data(call('GET', '/imports')),
      show: (id: number) => data(call('GET', '/imports/' + segment(id))),
      create: (resource: string, input: unknown) =>
        data(call('POST', '/resources/' + segment(resource) + '/imports', { body: input })),
      start: (id: number, input: unknown) =>
        data(call('POST', '/imports/' + segment(id) + '/start', { body: input })),
      template: (resource: string, options?: { mode?: string }) =>
        call('GET', '/resources/' + segment(resource) + '/imports/template', {
          query: options,
          text: true,
        }),
    }
  return client as unknown as AdulaClient
}
`

/**
 * One self-contained TypeScript module for the API the document describes: record and
 * input interfaces per resource, the Resources map and createAdulaClient().
 */
export function apiClientSource(document: ApiClientDocument, options: ApiClientOptions = {}) {
  const types = typesSection(document)
  const server = options.baseUrl ?? document.servers?.[0]?.url ?? ''
  const operations = types.resources
    .filter((resource) => resource.operations.size)
    .map(
      (resource) =>
        `  ${propertyKey(resource.name)}: [${[...resource.operations].map((operation) => `'${operation}'`).join(', ')}],`
    )
  return [
    header(document),
    types.text,
    '',
    `export const ADULA_API_SERVER: string = ${JSON.stringify(server)}`,
    `export const ADULA_API_BASE_PATH: string = ${JSON.stringify(types.basePath)}`,
    `const ADULA_IMPORTS: boolean = ${types.imports}`,
    `const ADULA_OPERATIONS: Record<string, readonly string[]> = {`,
    ...operations,
    `}`,
    RUNTIME,
  ].join('\n')
}

/** The same client as a declaration file: the types plus the runtime signatures. */
export function apiClientDeclarations(document: ApiClientDocument) {
  const types = typesSection(document)
  return [
    header(document),
    types.text,
    '',
    `export declare const ADULA_API_SERVER: string`,
    `export declare const ADULA_API_BASE_PATH: string`,
    `export declare class AdulaApiError extends Error {`,
    `  readonly status: number`,
    `  readonly code: string`,
    `  readonly body: unknown`,
    `  constructor(status: number, code: string, message: string, body?: unknown)`,
    `}`,
    `export declare function createAdulaClient(options: AdulaClientOptions): AdulaClient`,
    '',
  ].join('\n')
}

/** The clients/<name> directory of a system: its package name without scope, in kebab-case. */
export function apiClientName(packageName: unknown) {
  const name = String(packageName ?? '')
    .replace(/^@[^/]+\//, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return name || 'app'
}

/** README.md written next to a generated client by adula:client. */
export function apiClientReadme(name: string, document: ApiClientDocument) {
  const resources = Object.keys(document.paths)
    .map((path) => /\/resources\/([^/{]+)$/.exec(path)?.[1])
    .filter((resource): resource is string => Boolean(resource))
  const example = resources[0] ?? '<resource>'
  return `# ${name} API client

Generated by \`node ace adula:client\` from the resource registry. Do not edit
\`index.ts\`; run the command again after resources change. A running system also serves
the client for the calling token at \`GET /api/v1/client.ts\` (types only:
\`GET /api/v1/client.d.ts\`), limited to what that token's owner may use.

## Token

Create a personal API token under **Account → API tokens** (read tokens may only call GET).
The client sends it as \`Authorization: Bearer <token>\`; every call is authorized with the
token owner's current roles, exactly as in the user interface. Keep the token in an
environment variable, never in source control.

## Usage

\`\`\`ts
import { createAdulaClient, AdulaApiError } from './index.js'

const api = createAdulaClient({ baseUrl: 'https://erp.example.com', token: process.env.ADULA_TOKEN! })
const page = await api.resources.${example}.list({ limit: 50 })
for (const record of page.data) console.log(record.id)
// The next page: list({ cursor: page.meta.nextCursor })
try {
  await api.resources.${example}.show(1)
} catch (error) {
  if (error instanceof AdulaApiError) console.error(error.status, error.code, error.message)
}
\`\`\`

Money fields are decimal strings in minor units (\`"1050"\` is 10.50). Methods exist only
for the operations the API allows on each resource; filters, sort fields and input fields
are typed from the registry. The module has no dependencies and needs a global \`fetch\`
(Node.js 18+, browsers) or \`createAdulaClient({ fetch })\`.
`
}
