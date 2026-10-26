import { buildAbility, type Actor, type AdulaAbility } from '../auth/ability.js'
import { canQueryField, fieldLevel } from '../admin/resource/shared.js'
import type { ResourceRegistry } from '../resource/registry.js'
import type { Field, Resource } from '../resource/types.js'

type Schema = Record<string, unknown>

/** The described actor; fields it can never read or write are left out of its schemas. */
type Access = { actor: Actor; ability: AdulaAbility }

function readable(resource: Resource, key: string, access?: Access) {
  return (
    !access ||
    (access.actor.permissionLevel >= fieldLevel(resource, key) &&
      access.ability.can('view', resource.name, key))
  )
}

function writable(resource: Resource, key: string, access?: Access) {
  return (
    !access ||
    (access.actor.permissionLevel >= fieldLevel(resource, key) &&
      (access.ability.can('create', resource.name, key) ||
        access.ability.can('update', resource.name, key)))
  )
}

/** Sorting and filtering need unconditional view access at the field's level (canQueryField). */
function queryable(resource: Resource, key: string, access?: Access) {
  return !access || canQueryField(resource, access.actor, access.ability, key)
}

function fieldSchema(field: Field, mode: 'read' | 'write', registry: ResourceRegistry): Schema {
  const description = field.label.ar
  switch (field.type) {
    case 'integer':
      return { type: 'integer', description }
    case 'money':
      return {
        type: 'string',
        pattern: '^-?\\d+$',
        description: `${description} (minor units as a decimal string)`,
      }
    case 'boolean':
      return { type: 'boolean', description }
    case 'date':
      return { type: 'string', format: 'date', description }
    case 'datetime':
      return { type: 'string', format: 'date-time', description }
    case 'json':
      return { description }
    case 'decimal':
    case 'percent':
      return {
        type: 'string',
        pattern: '^-?\\d+(\\.\\d+)?$',
        description: `${description} (decimal string)`,
      }
    case 'enum':
      return { type: 'string', enum: field.options.map((option) => option.value), description }
    case 'multiSelect':
      return {
        type: 'array',
        uniqueItems: true,
        items: { type: 'string', enum: field.options.map((option) => option.value) },
        description,
      }
    case 'manyToMany':
      return {
        type: 'array',
        uniqueItems: true,
        items: { type: 'integer' },
        description: `${description} → ${field.resource} ids`,
      }
    case 'email':
      return { type: 'string', format: 'email', description }
    case 'url':
      return { type: 'string', format: 'uri', description }
    case 'belongsTo':
      return { type: 'integer', description: `${description} → ${field.resource}` }
    case 'user':
      return { type: 'integer', description: `${description} → user id (related: id, fullName)` }
    case 'lookup':
      return { type: 'string', description: `${description} (lookup group ${field.group})` }
    case 'attachment':
      return mode === 'write'
        ? { type: 'integer', description: `${description} (id returned by POST /attachments)` }
        : {
            type: 'object',
            description,
            properties: {
              id: { type: 'integer' },
              name: { type: 'string' },
              size: { type: 'integer' },
              mimeType: { type: 'string' },
            },
            required: ['id', 'name', 'size', 'mimeType'],
          }
    case 'hasMany': {
      const child = registry.get(field.resource)
      // Rows are saved with the parent: it sets the foreign key (and a scoped child's unit);
      // `id` updates an existing row and `_delete: true` with `id` removes it.
      const inherited = [field.foreignKey, ...(child.scoped && !child.scope ? ['orgUnitId'] : [])]
      return {
        type: 'array',
        maxItems: 100,
        description,
        items: {
          'allOf': [{ $ref: `#/components/schemas/${child.name}_input` }],
          'properties': { id: { type: 'integer' }, _delete: { type: 'boolean' } },
          'x-adula-inherited': inherited,
        },
      }
    }
    default:
      return { type: 'string', description }
  }
}

/** The JSON type a query-string filter value is coerced to (see queryValue in admin/resource/query.ts). */
function filterSchema(field: Field): Schema | undefined {
  switch (field.type) {
    case 'integer':
    case 'belongsTo':
    case 'user':
    case 'attachment':
      return { type: 'integer' }
    case 'boolean':
      return { type: 'boolean' }
    case 'money':
      return { type: 'string', pattern: '^-?\\d+$' }
    case 'date':
      return { type: 'string', format: 'date' }
    case 'datetime':
      return { type: 'string', format: 'date-time' }
    case 'string':
    case 'text':
    case 'lookup':
      return { type: 'string' }
    default:
      return undefined
  }
}

/** Equality filters on filterable fields, sent as `filters[field]=value` (deepObject). */
function filtersParameter(resource: Resource, access?: Access): Schema[] {
  const properties = Object.fromEntries(
    Object.entries(resource.fields).flatMap(([key, field]) => {
      const schema = field.filterable && queryable(resource, key, access) && filterSchema(field)
      return schema ? [[key, { ...schema, description: field.label.en ?? field.label.ar }]] : []
    })
  )
  if (!Object.keys(properties).length) return []
  return [
    {
      name: 'filters',
      in: 'query',
      style: 'deepObject',
      explode: true,
      description: 'Equality filters on filterable fields, as filters[field]=value',
      schema: { type: 'object', additionalProperties: false, properties },
    },
  ]
}

function nullable(schema: Schema, required: boolean) {
  if (required) return schema
  if (typeof schema.type === 'string') return { ...schema, type: [schema.type, 'null'] }
  return schema
}

function schemas(resource: Resource, registry: ResourceRegistry, access?: Access) {
  const readKeys = (
    resource.serialize ?? [...new Set([...resource.list, ...resource.show])]
  ).filter((key) => resource.fields[key]?.type !== 'hasMany' && readable(resource, key, access))
  const read: Schema = {
    type: 'object',
    description: `${resource.label.ar}. Fields the caller may not read are omitted.`,
    properties: {
      id: { type: 'integer' },
      ...Object.fromEntries(
        readKeys.map((key) => [
          key,
          nullable(fieldSchema(resource.fields[key], 'read', registry), false),
        ])
      ),
      ...(resource.version ? { version: { type: 'integer' } } : {}),
      ...(resource.submittable
        ? {
            docStatus: {
              type: 'integer',
              enum: [0, 1, 2],
              description: '0 draft, 1 submitted, 2 cancelled',
            },
          }
        : {}),
      ...(resource.scoped ? { orgUnitId: { type: 'integer' } } : {}),
    },
    // serialize() always adds the lifecycle columns; other fields depend on row rules.
    required: [
      'id',
      ...(resource.version ? ['version'] : []),
      ...(resource.submittable ? ['docStatus'] : []),
      ...(resource.scoped ? ['orgUnitId'] : []),
    ],
  }
  const inputKeys = resource.form.filter(
    (key) => !resource.fields[key].sequence && writable(resource, key, access)
  )
  const input: Schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      ...Object.fromEntries(
        inputKeys.map((key) => [
          key,
          nullable(
            fieldSchema(resource.fields[key], 'write', registry),
            Boolean(resource.fields[key].required)
          ),
        ])
      ),
      ...(resource.scoped && !resource.scope ? { orgUnitId: { type: 'integer' } } : {}),
      ...(resource.version
        ? { version: { type: 'integer', description: 'Required on update (optimistic locking)' } }
        : {}),
    },
    required: [
      ...inputKeys.filter((key) => resource.fields[key].required),
      ...(resource.scoped && !resource.scope ? ['orgUnitId'] : []),
    ],
  }
  return { read, input }
}

const error = {
  description: 'Error',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: { code: { type: 'string' }, message: { type: 'string' } },
            required: ['code', 'message'],
          },
        },
        required: ['error'],
      },
    },
  },
}

/** An import batch as ImportBatches returns it (ImportBatchRecord); every key is always present. */
const importBatchSchema: Schema = {
  type: 'object',
  properties: {
    id: { type: 'integer' },
    resource: { type: 'string' },
    resourceLabel: { type: 'string' },
    fileName: { type: 'string' },
    status: {
      enum: ['mapping', 'validated', 'queued', 'running', 'done', 'failed'],
      description: 'validated: a dry run finished; start again to import for real',
    },
    mode: { enum: ['create', 'upsert'] },
    matchField: { type: ['string', 'null'], description: 'Unique field matched on upsert' },
    dryRun: { type: 'boolean' },
    headers: { type: 'array', items: { type: 'string' } },
    mapping: {
      type: 'object',
      description: 'Column index → field key',
      additionalProperties: { type: 'string' },
    },
    sample: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
    total: { type: 'integer' },
    processed: { type: 'integer' },
    created: { type: 'integer', description: 'Created (in a dry run: would be created)' },
    updated: { type: 'integer', description: 'Updated by upsert (in a dry run: would be updated)' },
    failed: { type: 'integer' },
    errors: {
      type: 'array',
      items: {
        type: 'object',
        properties: { row: { type: 'integer' }, message: { type: 'string' } },
        required: ['row', 'message'],
      },
    },
    report: {
      type: 'array',
      description: 'Per-row outcome; row is the file line (the header is line 1)',
      items: {
        type: 'object',
        properties: {
          row: { type: 'integer' },
          ok: { type: 'boolean' },
          action: { enum: ['create', 'update'] },
          message: { type: 'string' },
        },
        required: ['row', 'ok'],
      },
    },
    createdAt: { type: 'string', format: 'date-time' },
    finishedAt: { type: ['string', 'null'], format: 'date-time' },
    targets: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          label: { type: 'string' },
          type: { type: 'string' },
          required: { type: 'boolean' },
          unique: { type: 'boolean', description: 'Usable as the upsert match field' },
        },
        required: ['key', 'label', 'type', 'required', 'unique'],
      },
    },
  },
  required: [
    'id',
    'resource',
    'resourceLabel',
    'fileName',
    'status',
    'mode',
    'matchField',
    'dryRun',
    'headers',
    'mapping',
    'sample',
    'total',
    'processed',
    'created',
    'updated',
    'failed',
    'errors',
    'report',
    'createdAt',
    'finishedAt',
    'targets',
  ],
}

/**
 * OpenAPI 3.1 description of the resource API, generated from the registry. When
 * an actor is given, only resources, actions and fields it may use are described.
 * Every operation carries an `operationId` of the form `<resource>.<operation>`
 * (or `imports.<operation>`), which apiClientSource turns into typed client methods.
 */
export function openApiDocument(
  registry: ResourceRegistry,
  options: {
    title: string
    version: string
    serverUrl: string
    basePath?: string
    /** Describe only what this actor may use (row conditions still apply at runtime). */
    actor?: Actor
  }
) {
  const base = options.basePath ?? '/api/v1'
  const paths: Record<string, Schema> = {}
  const components: Record<string, Schema> = {}
  const children = new Set(
    registry
      .all()
      .flatMap((resource) =>
        Object.values(resource.fields).flatMap((field) =>
          field.type === 'hasMany' ? [field.resource] : []
        )
      )
  )
  const ability = options.actor ? buildAbility(options.actor.rules, registry.all()) : undefined
  const access = options.actor && ability ? { actor: options.actor, ability } : undefined
  const batchRef = { $ref: '#/components/schemas/ImportBatch' }
  const batch = (description: string) => ({
    description,
    content: {
      'application/json': {
        schema: { type: 'object', properties: { data: batchRef }, required: ['data'] },
      },
    },
  })
  let importable = false
  for (const resource of registry.all()) {
    const allowed = new Set(
      resource.actions.filter((action) => !ability || ability.can(action, resource.name))
    )
    if (ability && !allowed.has('view')) continue
    const { read, input } = schemas(resource, registry, access)
    components[resource.name] = read
    components[`${resource.name}_input`] = input
    if (children.has(resource.name)) continue
    const ref = { $ref: `#/components/schemas/${resource.name}` }
    const inputRef = { $ref: `#/components/schemas/${resource.name}_input` }
    // The API document is English; a resource without label.en falls back to Arabic.
    const tag = resource.label.en ?? resource.label.ar
    const one = (description: string) => ({
      description,
      content: {
        'application/json': {
          schema: { type: 'object', properties: { data: ref }, required: ['data'] },
        },
      },
    })
    const operationId = (operation: string) => `${resource.name}.${operation}`
    const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'integer' } }
    const sortable = [
      'id',
      ...Object.entries(resource.fields)
        .filter(([key, field]) => field.sortable && queryable(resource, key, access))
        .map(([key]) => key),
    ]
    const collection: Schema = {}
    const item: Schema = {}
    if (allowed.has('view')) {
      collection.get = {
        tags: [tag],
        operationId: operationId('list'),
        summary: `List ${tag}`,
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 100 } },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'sort', in: 'query', schema: { enum: sortable } },
          { name: 'direction', in: 'query', schema: { enum: ['asc', 'desc'] } },
          { name: 'tag', in: 'query', schema: { type: 'string' } },
          {
            name: 'estimate',
            in: 'query',
            description: 'false skips the estimated total',
            schema: { type: 'boolean' },
          },
          ...filtersParameter(resource, access),
        ],
        responses: {
          200: {
            description: 'Keyset page',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: { type: 'array', items: ref },
                    meta: {
                      type: 'object',
                      properties: {
                        limit: { type: 'integer' },
                        nextCursor: { type: ['string', 'null'] },
                        estimatedTotal: { type: 'integer' },
                      },
                      required: ['limit', 'nextCursor'],
                    },
                  },
                  required: ['data', 'meta'],
                },
              },
            },
          },
          403: error,
          422: error,
        },
      }
      item.get = {
        tags: [tag],
        operationId: operationId('show'),
        summary: `Show one ${tag} record`,
        parameters: [idParam],
        responses: { 200: one('Record'), 403: error, 404: error },
      }
    }
    if (allowed.has('create'))
      collection.post = {
        tags: [tag],
        operationId: operationId('create'),
        summary: `Create ${tag}`,
        requestBody: { required: true, content: { 'application/json': { schema: inputRef } } },
        responses: { 201: one('Created'), 403: error, 409: error, 422: error },
      }
    if (allowed.has('update'))
      item.patch = {
        tags: [tag],
        operationId: operationId('update'),
        summary: `Update ${tag}`,
        parameters: [idParam],
        requestBody: { required: true, content: { 'application/json': { schema: inputRef } } },
        responses: { 200: one('Updated'), 403: error, 404: error, 409: error, 422: error },
      }
    if (allowed.has('delete'))
      item.delete = {
        tags: [tag],
        operationId: operationId('delete'),
        summary: `Soft-delete ${tag}`,
        parameters: [idParam],
        responses: { 200: one('Deleted'), 403: error, 404: error, 409: error },
      }
    if (allowed.has('view'))
      paths[`${base}/resources/${resource.name}/aggregate`] = {
        get: {
          tags: [tag],
          operationId: operationId('aggregate'),
          summary: `Count and total ${tag} by group`,
          description:
            'Only records the token may view are counted; grouped, totalled and filtered fields must be readable without conditions.',
          parameters: [
            {
              name: 'groupBy',
              in: 'query',
              description: 'Up to three comma-separated fields',
              schema: { type: 'string' },
            },
            {
              name: 'sum',
              in: 'query',
              description: 'Comma-separated integer or money fields',
              schema: { type: 'string' },
            },
            {
              name: 'where',
              in: 'query',
              description: 'JSON conditions ($eq, $ne, $in, $lt, $gt, $like)',
              schema: { type: 'string' },
            },
            { name: 'search', in: 'query', schema: { type: 'string' } },
            {
              name: 'count',
              in: 'query',
              description: 'false leaves out the group counts',
              schema: { type: 'boolean' },
            },
            ...filtersParameter(resource, access),
          ],
          responses: {
            200: {
              description: 'Groups (at most 1000)',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'object',
                        properties: {
                          truncated: { type: 'boolean' },
                          rows: {
                            type: 'array',
                            items: {
                              type: 'object',
                              properties: {
                                group: { type: 'object' },
                                count: { type: 'integer' },
                                sum: {
                                  type: 'object',
                                  additionalProperties: { type: ['string', 'null'] },
                                },
                              },
                              required: ['group'],
                            },
                          },
                        },
                        required: ['rows'],
                      },
                    },
                    required: ['data'],
                  },
                },
              },
            },
            403: error,
            422: error,
          },
        },
      }
    if (Object.keys(collection).length) paths[`${base}/resources/${resource.name}`] = collection
    if (Object.keys(item).length) paths[`${base}/resources/${resource.name}/{id}`] = item
    for (const action of ['submit', 'cancel'] as const)
      if (resource.submittable && allowed.has(action))
        paths[`${base}/resources/${resource.name}/{id}/${action}`] = {
          post: {
            tags: [tag],
            operationId: operationId(action),
            summary: `${action === 'submit' ? 'Submit' : 'Cancel'} ${tag}`,
            parameters: [idParam],
            requestBody: {
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { version: { type: 'integer' } } },
                },
              },
            },
            responses: { 200: one('Transitioned'), 403: error, 404: error, 409: error },
          },
        }
    if (resource.submittable && allowed.has('amend'))
      paths[`${base}/resources/${resource.name}/{id}/amend`] = {
        post: {
          tags: [tag],
          operationId: operationId('amend'),
          summary: `Amend a cancelled ${tag} record by copy`,
          description: 'Creates a new draft copied from the cancelled document.',
          parameters: [idParam],
          responses: { 201: one('Amended draft'), 403: error, 404: error, 409: error, 422: error },
        },
      }
    // Imports save each row through the same create (and, on upsert, update) authorization
    // as ImportBatches.targets; upsert matches on a unique importable field.
    if (allowed.has('create')) {
      importable = true
      const matchFields = resource.form.filter(
        (key) =>
          resource.fields[key].unique &&
          !resource.fields[key].sequence &&
          !['hasMany', 'attachment', 'json'].includes(resource.fields[key].type) &&
          writable(resource, key, access)
      )
      const modes = allowed.has('update') && matchFields.length ? ['create', 'upsert'] : ['create']
      paths[`${base}/resources/${resource.name}/imports`] = {
        post: {
          tags: [tag, 'Imports'],
          operationId: operationId('import'),
          summary: `Upload a CSV import of ${tag}`,
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    fileName: { type: 'string' },
                    content: {
                      type: 'string',
                      description: 'The file text (CSV), or base64 bytes with encoding base64',
                    },
                    format: {
                      type: 'string',
                      description: "Import adapter name, for example 'csv' (default: detected)",
                    },
                    encoding: {
                      enum: ['base64'],
                      description: 'content is base64 (binary formats)',
                    },
                    mode: { enum: modes },
                    ...(modes.includes('upsert')
                      ? {
                          matchField: {
                            enum: matchFields,
                            description: 'Unique field matched on upsert',
                          },
                        }
                      : {}),
                    dryRun: {
                      type: 'boolean',
                      description:
                        'Validate every row in a rolled-back transaction (status validated)',
                    },
                  },
                  required: ['fileName', 'content'],
                },
              },
            },
          },
          responses: { 201: batch('Batch awaiting its column mapping'), 403: error, 422: error },
        },
      }
      paths[`${base}/resources/${resource.name}/imports/template`] = {
        get: {
          tags: [tag, 'Imports'],
          operationId: operationId('importTemplate'),
          summary: `CSV template for importing ${tag}`,
          parameters: [
            {
              name: 'mode',
              in: 'query',
              description: 'upsert also needs update permission',
              schema: { enum: modes },
            },
          ],
          responses: {
            200: {
              description: 'CSV header row',
              content: { 'text/csv': { schema: { type: 'string' } } },
            },
            403: error,
          },
        },
      }
    }
  }
  if (importable) {
    components.ImportBatch = importBatchSchema
    const batchId = { name: 'id', in: 'path', required: true, schema: { type: 'integer' } }
    paths[`${base}/imports`] = {
      get: {
        tags: ['Imports'],
        operationId: 'imports.list',
        summary: "The caller's latest import batches",
        responses: {
          200: {
            description: 'Batches',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { data: { type: 'array', items: batchRef } },
                  required: ['data'],
                },
              },
            },
          },
        },
      },
    }
    paths[`${base}/imports/{id}`] = {
      get: {
        tags: ['Imports'],
        operationId: 'imports.show',
        summary: 'One import batch of the caller',
        parameters: [batchId],
        responses: { 200: batch('Batch'), 404: error },
      },
    }
    paths[`${base}/imports/{id}/start`] = {
      post: {
        tags: ['Imports'],
        operationId: 'imports.start',
        summary: 'Store the column mapping and queue the batch (again after a dry run)',
        parameters: [batchId],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  mapping: {
                    type: 'object',
                    description: 'Column index → field key',
                    additionalProperties: { type: 'string' },
                  },
                  mode: { enum: ['create', 'upsert'] },
                  matchField: { type: 'string', description: 'Unique field matched on upsert' },
                  dryRun: {
                    type: 'boolean',
                    description: 'Validate only; defaults to false for a validated batch',
                  },
                },
                additionalProperties: false,
                required: ['mapping'],
              },
            },
          },
        },
        responses: { 200: batch('Queued'), 403: error, 404: error, 409: error, 422: error },
      },
    }
  }
  return {
    openapi: '3.1.0',
    info: { title: options.title, version: options.version },
    servers: [{ url: options.serverUrl }],
    security: [{ bearer: [] }],
    paths,
    components: {
      schemas: components,
      securitySchemes: {
        bearer: {
          type: 'http',
          scheme: 'bearer',
          description: 'Personal API token. Read tokens are limited to GET requests.',
        },
      },
    },
  }
}
