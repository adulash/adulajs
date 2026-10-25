import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test } from '@japa/runner'
import ts from 'typescript'
import { apiClientDeclarations, apiClientSource, openApiDocument } from '../index.js'
import type { Actor } from '../index.js'
import { admin, reader, registry } from './helpers.js'

const documentFor = (actor?: Actor) =>
  openApiDocument(registry, {
    title: 'Test',
    version: '1.0.0',
    serverUrl: 'https://erp.example.test',
    actor,
  })

/** Strict type-check of a consumer against a generated client, with no ambient types at all. */
async function compile(files: Record<string, string>, entry: string) {
  const directory = await mkdtemp(join(tmpdir(), 'adula-client-'))
  try {
    await writeFile(join(directory, 'package.json'), JSON.stringify({ type: 'module' }))
    for (const [name, content] of Object.entries(files))
      await writeFile(join(directory, name), content)
    const program = ts.createProgram([join(directory, entry)], {
      strict: true,
      noEmit: true,
      noUncheckedIndexedAccess: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      lib: ['lib.es2022.d.ts'],
      types: [],
    })
    return ts.getPreEmitDiagnostics(program).map((diagnostic) => ({
      code: diagnostic.code,
      line: diagnostic.file
        ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line + 1
        : 0,
      file: diagnostic.file?.fileName.split(/[\\/]/).pop(),
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
    }))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

/** Valid calls an integration makes against the administrator's client. */
const validConsumer = `import { createAdulaClient, AdulaApiError } from './index.js'
import type { Orders, Resources } from './index.js'

const api = createAdulaClient({ baseUrl: 'https://erp.example.test', token: 'adula_token' })

export async function main() {
  const page = await api.resources.orders.list({
    limit: 10,
    sort: 'total',
    direction: 'desc',
    filters: { status: 'open' },
  })
  const first: Orders | undefined = page.data[0]
  const total: string | null | undefined = first?.total
  const next: string | null = page.meta.nextCursor
  const created = await api.resources.orders.create({
    orgUnitId: 1,
    notes: 'عبر العميل',
    total: '1050',
    lines: [{ name: 'بند' }],
  })
  const state: 0 | 1 | 2 = created.docStatus
  await api.resources.orders.update(created.id, { notes: 'تعديل' })
  await api.resources.orders.submit(created.id)
  await api.resources.orders.cancel(created.id, { version: 2 })
  const amended: Orders = await api.resources.orders.amend(created.id)
  const counted = await api.resources.orders.aggregate({ groupBy: ['status'], sum: 'total' })
  const customer = await api.resources.customers.create({ name: 'عميل' })
  await api.resources.customers.delete(customer.id)
  const input: Resources['orders']['input'] = { orgUnitId: 1 }
  const batch = await api.imports.create('customers', {
    fileName: 'a.csv',
    content: 'bmFtZQ==',
    encoding: 'base64',
    mode: 'upsert',
    matchField: 'name',
    dryRun: true,
  })
  await api.imports.create('orders', { fileName: 'o.csv', content: 'notes', format: 'csv' })
  const checked = await api.imports.start(batch.id, {
    mapping: { '0': 'name' },
    mode: 'upsert',
    matchField: 'name',
    dryRun: true,
  })
  const outcome: boolean | undefined = checked.report[0]?.ok
  const action: 'create' | 'update' | undefined = checked.report[0]?.action
  const counts: number = checked.created + checked.updated + checked.failed
  const unique: boolean | undefined = checked.targets[0]?.unique
  const validated: boolean = checked.status === 'validated'
  const batches = await api.imports.list()
  const csv: string = await api.imports.template('orders')
  await api.imports.template('customers', { mode: 'upsert' })
  try {
    await api.resources.customers.show(999)
  } catch (error) {
    if (error instanceof AdulaApiError) {
      const code: string = error.code
      const status: number = error.status
      return [code, status]
    }
  }
  return { total, next, state, amended, counted, input, batches, csv, outcome, action, counts, unique, validated }
}
`

/** Each line must fail type-checking; the directive itself fails when it does not. */
const wrongUsages = [
  [
    'unknown field in create input',
    `api.resources.customers.create({ name: 'x', unknownField: 1 })`,
  ],
  ['number for a money field', `api.resources.orders.create({ orgUnitId: 1, total: 1050 })`],
  ['submit on a non-submittable resource', `api.resources.customers.submit(1)`],
  ['missing required organization unit', `api.resources.orders.create({ notes: 'x' })`],
  [
    'sorting by a field that is not sortable',
    `api.resources.orders.list({ sort: 'internalNote' })`,
  ],
  [
    'filtering by a field that is not filterable',
    `api.resources.orders.list({ filters: { notes: 'x' } })`,
  ],
  ['importing into a child resource', `api.imports.template('order_lines')`],
  ['upsert where no unique field can match', `api.imports.template('orders', { mode: 'upsert' })`],
  [
    'an upsert match field that is not unique',
    `api.imports.create('customers', { fileName: 'a', content: 'x', mode: 'upsert', matchField: 'nope' })`,
  ],
  ['an unknown start option', `api.imports.start(1, { mapping: {}, force: true })`],
] as const

const wrongConsumer = (directive: boolean) => `import { createAdulaClient } from './index.js'
const api = createAdulaClient({ token: 'adula_token' })
export async function wrong() {
${wrongUsages.map(([reason, line]) => `${directive ? `  // @ts-expect-error ${reason}\n` : ''}  await ${line}`).join('\n')}
}
`

/** A permission-level-0 reader: hidden and level-1 fields and cancel do not exist. */
const readerConsumer = `import { createAdulaClient } from './index.js'
const api = createAdulaClient({ token: 'adula_token' })
export async function read() {
  const shown = await api.resources.orders.show(1)
  const notes: string | null | undefined = shown.notes
  // @ts-expect-error a hidden field
  shown.internalNote
  // @ts-expect-error a field above the reader's permission level
  shown.total
  // @ts-expect-error the reader may not cancel orders
  await api.resources.orders.cancel(1)
  // @ts-expect-error a hidden field is not writable either
  await api.resources.orders.create({ orgUnitId: 1, internalNote: 'x' })
  return notes
}
`

test.group('Typed API client', () => {
  test('emits record, input, filter and client types from the document', ({ assert }) => {
    const source = apiClientSource(documentFor(admin))
    assert.include(source, 'export interface Orders {')
    assert.include(source, 'export interface OrdersInput {')
    assert.match(source, /docStatus: 0 \| 1 \| 2/)
    assert.match(source, /total\?: string \| null/)
    assert.match(source, /orgUnitId: number/)
    // Inline rows: the parent sets the foreign key and the unit.
    assert.include(source, `Omit<OrderLinesInput, "orderId" | "orgUnitId">`)
    assert.include(source, 'export interface OrdersFilters {')
    assert.match(source, /export type OrdersSort = "id" \| "total" \| "notes"/)
    assert.match(source, /export interface OrdersClient \{[^}]*submit\([^}]*amend\(/s)
    assert.notMatch(source, /export interface CustomersClient \{[^}]*submit\(/s)
    assert.match(
      source,
      /export interface AdulaImportInputs \{\n {2}customers: \{[^}]*matchField\?: "name"/
    )
    assert.include(
      source,
      'export interface AdulaImportModes {\n  customers: "create" | "upsert"\n  orders: "create"\n}'
    )
    assert.match(source, /report: Array<\{\n\s+row: number\n\s+ok: boolean/)
    assert.match(source, /unique: boolean/)
    assert.match(source, /export interface AdulaImportStartInput \{[^}]*dryRun\?: boolean/)
    assert.include(source, `export const ADULA_API_SERVER: string = "https://erp.example.test"`)
    assert.include(
      source,
      `orders: ['list', 'show', 'create', 'update', 'delete', 'submit', 'cancel', 'amend', 'aggregate'],`
    )
    const declarations = apiClientDeclarations(documentFor(admin))
    assert.include(declarations, 'export declare function createAdulaClient(')
    assert.notInclude(declarations, 'function adulaQuery')
  })

  test('describes only the fields and operations the actor may use', ({ assert }) => {
    const document = documentFor(reader)
    const read = document.components.schemas.orders as { properties: Record<string, unknown> }
    assert.notProperty(read.properties, 'internalNote')
    assert.notProperty(read.properties, 'total')
    assert.property(read.properties, 'notes')
    const input = document.components.schemas.orders_input as {
      properties: Record<string, unknown>
    }
    assert.notProperty(input.properties, 'internalNote')
    assert.notProperty(document.paths, '/api/v1/resources/orders/{id}/amend')
    assert.property(document.paths, '/api/v1/resources/orders/{id}/submit')
    // Customers are only viewable: neither create nor import is described.
    assert.notProperty(document.paths, '/api/v1/resources/customers/imports')
    assert.property(document.paths, '/api/v1/resources/orders/imports')
    const source = apiClientSource(document)
    assert.notInclude(source, 'internalNote')
    assert.match(source, /export interface AdulaImportInputs \{\n {2}orders: /)
    assert.notMatch(source, /AdulaImportInputs \{[^}]*customers:/)
  })

  test('a strict consumer compiles and wrong usages are refused by the compiler', async ({
    assert,
  }) => {
    const source = apiClientSource(documentFor(admin))
    const valid = await compile({ 'index.ts': source, 'consumer.ts': validConsumer }, 'consumer.ts')
    assert.deepEqual(valid, [])
    const directives = await compile(
      { 'index.ts': source, 'wrong.ts': wrongConsumer(true) },
      'wrong.ts'
    )
    assert.deepEqual(directives, [], 'every @ts-expect-error line must fail on its own')
    // Without the directives, each wrong line reports its own error.
    const errors = await compile(
      { 'index.ts': source, 'wrong.ts': wrongConsumer(false) },
      'wrong.ts'
    )
    const lines = new Set(errors.filter((error) => error.file === 'wrong.ts').map((e) => e.line))
    wrongUsages.forEach(([reason], index) => assert.isTrue(lines.has(4 + index), reason))
    assert.isTrue(errors.every((error) => error.file === 'wrong.ts'))

    const readerSource = apiClientSource(documentFor(reader))
    assert.deepEqual(
      await compile({ 'index.ts': readerSource, 'consumer.ts': readerConsumer }, 'consumer.ts'),
      []
    )
    // The declaration flavour types the same consumer.
    assert.deepEqual(
      await compile(
        { 'index.d.ts': apiClientDeclarations(documentFor(admin)), 'consumer.ts': validConsumer },
        'consumer.ts'
      ),
      []
    )
  })

  test('the runtime calls the API with the token and raises AdulaApiError', async ({ assert }) => {
    const directory = await mkdtemp(join(tmpdir(), 'adula-client-runtime-'))
    try {
      const output = ts.transpileModule(apiClientSource(documentFor(admin)), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }).outputText
      const file = join(directory, 'client.mjs')
      await writeFile(file, output)
      const generated = await import(pathToFileURL(file).href)
      const calls: {
        url: string
        method: string
        headers: Record<string, string>
        body?: string
      }[] = []
      const replies: { status: number; body: string }[] = []
      const fetch = async (
        url: string,
        init: { method: string; headers: Record<string, string>; body?: string }
      ) => {
        calls.push({ url, ...init })
        const reply = replies.shift() ?? { status: 200, body: '{"data":{"id":1}}' }
        return {
          ok: reply.status < 300,
          status: reply.status,
          statusText: 'Status',
          text: async () => reply.body,
        }
      }
      const api = generated.createAdulaClient({
        baseUrl: 'https://erp.example.test/',
        token: 'adula_secret',
        fetch,
      })
      replies.push({
        status: 200,
        body: '{"data":[{"id":7}],"meta":{"limit":5,"nextCursor":null}}',
      })
      const page = await api.resources.orders.list({
        limit: 5,
        sort: 'total',
        direction: 'desc',
        filters: { status: 'open now' },
        search: undefined,
      })
      assert.deepEqual(page.data, [{ id: 7 }])
      assert.equal(
        calls[0].url,
        'https://erp.example.test/api/v1/resources/orders?limit=5&sort=total&direction=desc&filters[status]=open%20now'
      )
      assert.equal(calls[0].method, 'GET')
      assert.equal(calls[0].headers.Authorization, 'Bearer adula_secret')
      assert.notProperty(calls[0].headers, 'Content-Type')

      assert.deepEqual(await api.resources.orders.create({ notes: 'x' }), { id: 1 })
      assert.equal(calls[1].method, 'POST')
      assert.equal(calls[1].body, '{"notes":"x"}')
      assert.equal(calls[1].headers['Content-Type'], 'application/json')
      await api.resources.orders.submit(3, { version: 2 })
      assert.equal(calls[2].url, 'https://erp.example.test/api/v1/resources/orders/3/submit')
      assert.equal(calls[2].body, '{"version":2}')
      await api.resources.orders.aggregate({
        groupBy: ['status', 'customerId'],
        where: { notes: 'a' },
      })
      assert.equal(
        calls[3].url,
        `https://erp.example.test/api/v1/resources/orders/aggregate?groupBy=status%2CcustomerId&where=${encodeURIComponent('{"notes":"a"}')}`
      )
      replies.push({ status: 200, body: 'name\n' })
      assert.equal(await api.imports.template('customers', { mode: 'upsert' }), 'name\n')
      assert.equal(
        calls[4].url,
        'https://erp.example.test/api/v1/resources/customers/imports/template?mode=upsert'
      )
      await api.imports.start(9, { mapping: { 0: 'name' }, dryRun: true })
      assert.equal(calls[5].url, 'https://erp.example.test/api/v1/imports/9/start')
      assert.equal(calls[5].body, '{"mapping":{"0":"name"},"dryRun":true}')

      // Operations the document does not describe do not exist at runtime either.
      assert.isUndefined(api.resources.customers.submit)
      assert.isUndefined(api.resources.order_lines)

      replies.push({
        status: 403,
        body: JSON.stringify({ error: { code: 'E_FORBIDDEN', message: 'ليس لديك صلاحية' } }),
      })
      type Failure = { status: number; code: string; message: string }
      const error = (await api.resources.customers
        .show(1)
        .catch((caught: unknown) => caught)) as Failure
      assert.instanceOf(error, generated.AdulaApiError)
      assert.equal(error.status, 403)
      assert.equal(error.code, 'E_FORBIDDEN')
      assert.equal(error.message, 'ليس لديك صلاحية')
      replies.push({ status: 502, body: '<html>bad gateway</html>' })
      const gateway = (await api.resources.customers
        .show(1)
        .catch((caught: unknown) => caught)) as Failure
      assert.equal(gateway.code, 'E_HTTP')
      assert.equal(gateway.status, 502)
      assert.throws(() => generated.createAdulaClient({ token: '', fetch }), /token/)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
