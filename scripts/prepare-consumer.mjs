import { access, cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { randomBytes, randomInt } from 'node:crypto'

export const repo = fileURLToPath(new URL('../', import.meta.url))
export const work = join(repo, '.work')
// Recovered from the GitHub archive's pax_global_header comment in .work/starters.tar.gz.
// CI checks out this immutable official revision, not the moving main branch.
export const starterRevision = '7e1c7930ec260ea38c3eb394eb192e05c12d3f7b'

async function readConnection() {
  if (process.env.TEST_DATABASE_URL) {
    const url = new URL(process.env.TEST_DATABASE_URL)
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.search || url.hash)
      throw new Error('TEST_DATABASE_URL must be a PostgreSQL test URL without query parameters')
    return {
      host: url.hostname,
      port: Number(url.port || 5432),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: decodeURIComponent(url.pathname.slice(1)),
    }
  }
  try {
    return JSON.parse(await readFile(join(work, 'test-database.json'), 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    throw new Error('Set TEST_DATABASE_URL or create the isolated .work/test-database.json profile')
  }
}

/** Releases before 2.0 published the core package under its 1.x name (ADR 039). */
export const coreName = (baseline) =>
  baseline && Number(baseline.split('.')[0]) < 2 ? '@adula/kit' : 'adula'

/** `baseline` installs published npm versions instead of the local archives. */
export async function prepareConsumer({ baseline } = {}) {
  const source = resolve(process.env.ADULA_STARTER_PATH || join(work, 'starter-kits-main/inertia-react'))
  try {
    await access(join(source, 'package.json'))
  } catch {
    throw new Error(`Official React starter missing: checkout adonisjs/starter-kits at ${starterRevision} under .work/starter-kits-main, or set ADULA_STARTER_PATH to its inertia-react directory`)
  }
  const connection = await readConnection()
  if (!/^[a-zA-Z0-9_]+_test$/.test(connection.database ?? ''))
    throw new Error('The PostgreSQL profile must name a dedicated *_test database')

  const require = createRequire(join(repo, 'apps/reference/package.json'))
  const { Client } = require('pg')
  const client = new Client({ ...connection, database: 'postgres' })
  // Numeric suffix also satisfies the independent HTTP test's database isolation assertion.
  const database = `adula_consumer_${Date.now()}${randomInt(100000, 1000000)}_test`
  try {
    await client.connect()
    const version = Number((await client.query('SHOW server_version_num')).rows[0].server_version_num)
    if (version < 170000 || version >= 180000)
      throw new Error('The packed consumer acceptance test requires PostgreSQL 17')
    await client.query(`CREATE DATABASE "${database}"`)
  } finally {
    await client.end()
  }

  await mkdir(work, { recursive: true })
  const target = await mkdtemp(join(work, 'consumer-'))
  await cp(source, target, { recursive: true })
  // The official snapshot's flash payload is unknown; narrow it before passing to React toast.
  const layoutPath = join(target, 'inertia/layouts/default.tsx')
  let layout = await readFile(layoutPath, 'utf8')
  layout = layout.replace('if (flash.success)', "if (typeof flash.success === 'string')")
    .replace('if (flash.error)', "if (typeof flash.error === 'string')")
  await writeFile(layoutPath, layout)

  const pkg = JSON.parse(await readFile(join(target, 'package.json'), 'utf8'))
  const pins = JSON.parse(await readFile(join(repo, 'apps/reference/package.json'), 'utf8'))
  const workspace = JSON.parse(await readFile(join(repo, 'package.json'), 'utf8'))
  const core = JSON.parse(await readFile(join(repo, 'packages/adula/package.json'), 'utf8'))
  const ui = JSON.parse(await readFile(join(repo, 'packages/ui/package.json'), 'utf8'))
  for (const kind of ['dependencies', 'devDependencies']) {
    for (const name of Object.keys(pkg[kind] ?? {})) {
      if (name === 'better-sqlite3') delete pkg[kind][name]
      else pkg[kind][name] = pins[kind][name] ?? pkg[kind][name]
    }
  }
  pkg.name = 'adula-packed-consumer'
  pkg.packageManager = workspace.packageManager
  pkg.license = 'MIT'
  delete pkg.pnpm
  pkg.dependencies.pg = pins.dependencies.pg
  pkg.dependencies['@inertiajs/core'] = pins.dependencies['@inertiajs/core']
  pkg.dependencies[coreName(baseline)] = baseline ?? `file:../adula-${core.version}.tgz`
  pkg.dependencies['@adula/ui'] = baseline ?? `file:../adula-ui-${ui.version}.tgz`
  pkg.dependencies.tailwindcss = pins.dependencies.tailwindcss
  for (const name of ['shadcn', '@tailwindcss/vite', '@japa/api-client'])
    pkg.devDependencies[name] = pins.devDependencies[name]
  await writeFile(join(target, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`)
  // An independent workspace installs tarballs rather than resolving the source packages.
  await writeFile(join(target, 'pnpm-workspace.yaml'), `packages:\n  - '.'\nallowBuilds:\n  '@swc/core': true\n  esbuild: true\n  '@parcel/watcher': true\n  sharp: true\noverrides:\n  'eslint-plugin-react>eslint': '${pins.devDependencies.eslint}'\n`)
  const env = {
    TZ: 'UTC', NODE_ENV: 'development', HOST: '127.0.0.1', PORT: 3341, LOG_LEVEL: 'error',
    APP_KEY: randomBytes(32).toString('base64url'), APP_URL: 'http://127.0.0.1:3341', SESSION_DRIVER: 'memory',
    DB_HOST: connection.host, DB_PORT: connection.port, DB_USER: connection.user,
    DB_PASSWORD: connection.password, DB_DATABASE: database,
  }
  for (const mode of ['', '.test']) {
    const values = { ...env, ...(mode ? { NODE_ENV: 'test' } : {}) }
    await writeFile(join(target, `.env${mode}`), `${Object.entries(values).map(([key, value]) => `${key}=${JSON.stringify(String(value))}`).join('\n')}\n`)
  }
  await mkdir(join(target, 'tests/functional'), { recursive: true })
  await cp(join(repo, 'tests/consumer/roundtrip.stub'), join(target, 'tests/functional/packed.spec.ts'))
  const consumer = { root: target, database, starterRevision, core: coreName(baseline) }
  await writeFile(join(work, 'consumer-latest.json'), `${JSON.stringify(consumer, null, 2)}\n`)
  return consumer
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(JSON.stringify(await prepareConsumer()))
}
