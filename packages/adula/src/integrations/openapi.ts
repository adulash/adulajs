import { buildAbility, type Actor } from '../auth/ability.js'
import type { ResourceRegistry } from '../resource/registry.js'
import type { Field, Resource } from '../resource/types.js'

type Schema = Record<string, unknown>

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
          }
    case 'hasMany': {
      const child = registry.get(field.resource)
      return {
        type: 'array',
        maxItems: 100,
        description,
        items: { $ref: `#/components/schemas/${child.name}_input` },
      }
    }
    default:
      return { type: 'string', description }
  }
}

function nullable(schema: Schema, required: boolean) {
  if (required) return schema
  if (typeof schema.type === 'string') return { ...schema, type: [schema.type, 'null'] }
  return schema
}

function schemas(resource: Resource, registry: ResourceRegistry) {
  const readKeys = (
    resource.serialize ?? [...new Set([...resource.list, ...resource.show])]
  ).filter((key) => resource.fields[key]?.type !== 'hasMany')
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
    required: ['id'],
  }
  const writable = resource.form.filter((key) => !resource.fields[key].sequence)
  const input: Schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      ...Object.fromEntries(
        writable.map((key) => [
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
      ...writable.filter((key) => resource.fields[key].required),
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
          },
        },
      },
    },
  },
}

/**
 * OpenAPI 3.1 description of the resource API, generated from the registry. When
 * an actor is given, only resources and actions it may use are described.
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
  for (const resource of registry.all()) {
    const ability = options.actor ? buildAbility(options.actor.rules, registry.all()) : undefined
    const allowed = new Set(
      resource.actions.filter((action) => !ability || ability.can(action, resource.name))
    )
    if (ability && !allowed.has('view')) continue
    const { read, input } = schemas(resource, registry)
    components[resource.name] = read
    components[`${resource.name}_input`] = input
    if (children.has(resource.name)) continue
    const ref = { $ref: `#/components/schemas/${resource.name}` }
    const inputRef = { $ref: `#/components/schemas/${resource.name}_input` }
    // The API document is English; a resource without label.en falls back to Arabic.
    const tag = resource.label.en ?? resource.label.ar
    const one = (description: string) => ({
      description,
      content: { 'application/json': { schema: { type: 'object', properties: { data: ref } } } },
    })
    const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'integer' } }
    const collection: Schema = {}
    const item: Schema = {}
    if (allowed.has('view')) {
      collection.get = {
        tags: [tag],
        summary: `List ${tag}`,
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 100 } },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'sort', in: 'query', schema: { type: 'string' } },
          { name: 'direction', in: 'query', schema: { enum: ['asc', 'desc'] } },
          { name: 'tag', in: 'query', schema: { type: 'string' } },
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
                    },
                  },
                },
              },
            },
          },
          403: error,
        },
      }
      item.get = {
        tags: [tag],
        summary: `Show one ${tag} record`,
        parameters: [idParam],
        responses: { 200: one('Record'), 403: error, 404: error },
      }
    }
    if (allowed.has('create'))
      collection.post = {
        tags: [tag],
        summary: `Create ${tag}`,
        requestBody: { required: true, content: { 'application/json': { schema: inputRef } } },
        responses: { 201: one('Created'), 403: error, 409: error, 422: error },
      }
    if (allowed.has('update'))
      item.patch = {
        tags: [tag],
        summary: `Update ${tag}`,
        parameters: [idParam],
        requestBody: { required: true, content: { 'application/json': { schema: inputRef } } },
        responses: { 200: one('Updated'), 403: error, 404: error, 409: error, 422: error },
      }
    if (allowed.has('delete'))
      item.delete = {
        tags: [tag],
        summary: `Soft-delete ${tag}`,
        parameters: [idParam],
        responses: { 200: one('Deleted'), 403: error, 404: error, 409: error },
      }
    if (allowed.has('view'))
      paths[`${base}/resources/${resource.name}/aggregate`] = {
        get: {
          tags: [tag],
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
                            },
                          },
                        },
                      },
                    },
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
