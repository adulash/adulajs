import { detectDocker } from './docker-runtime.mjs'
import { spawn } from 'node:child_process'
import { access, readFile, open } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createServer, createConnection } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

export async function run(
  command,
  args,
  { cwd = undefined, env = process.env, quiet = false, logFile = undefined } = {}
) {
  const log = logFile ? await open(logFile, 'a', 0o600) : undefined
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        env,
        shell: false,
        windowsHide: true,
        stdio: log ? ['ignore', log.fd, log.fd] : quiet ? 'ignore' : 'inherit',
      })
      child.once('error', () => {
        reject(
          new Error(`Cannot start ${command}. Check that it is installed and available in PATH.`)
        )
      })
      child.once('close', (code, signal) => {
        code === 0
          ? resolve(undefined)
          : reject(
              new Error(
                `Command failed: ${args[0] ?? command} (${signal ?? code}). Review ${logFile ?? 'the output above'}.`
              )
            )
      })
    })
  } finally {
    await log?.close()
  }
}

/**
 * Splits arguments so no command line exceeds `limit` characters. pnpm exec reaches a
 * `.cmd` shim on Windows, and cmd.exe refuses a line above 8191 characters.
 */
export function argumentBatches(items, limit = 4000) {
  const batches = []
  let length = 0
  for (const item of items) {
    if (batches.length === 0 || length + item.length + 1 > limit) {
      batches.push([])
      length = 0
    }
    batches.at(-1).push(item)
    length += item.length + 1
  }
  return batches
}

export async function checkDocker(execute = run, platform = process.platform) {
  return detectDocker(execute, platform)
}

export async function packageManager() {
  // Keep the installer outside the project whose dependency tree it updates.
  // Direct JavaScript entries also avoid shell interpretation on Windows.
  const require = createRequire(import.meta.url)
  const manifest = require.resolve('pnpm')
  const packageJson = JSON.parse(await readFile(manifest, 'utf8'))
  return [process.execPath, resolve(dirname(manifest), packageJson.bin.pnpm)]
}

export async function packageManagerBin() {
  let directory = fileURLToPath(new URL('../', import.meta.url))
  while (directory) {
    const bin = join(directory, 'node_modules/.bin')
    try {
      await access(join(bin, process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'))
      return bin
    } catch {
      const parent = dirname(directory)
      if (parent === directory) break
      directory = parent
    }
  }
  throw new Error('Cannot find the bundled pnpm. Run npx create-adulajs again.')
}

export async function npmEntry() {
  const candidates = [
    process.env.npm_execpath,
    join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
    join(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'),
  ].filter(Boolean)
  for (const candidate of candidates) {
    if (!candidate.endsWith('npm-cli.js')) continue
    try {
      await access(candidate)
    } catch {
      continue
    }
    return candidate
  }
  throw new Error('Cannot find npm. Run npx create-adulajs with Node.js 24 or later.')
}

export async function freePort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(undefined))
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise((resolve) => server.close(resolve))
  return port
}

export async function pingRedis(connection) {
  const frame = (parts) =>
    `*${parts.length}\r\n${parts.map((part) => `$${Buffer.byteLength(String(part))}\r\n${part}\r\n`).join('')}`
  await new Promise((resolve, reject) => {
    const socket = createConnection({
      host: connection.host,
      port: connection.port,
    })
    let output = ''
    let finished = false
    const fail = () => {
      if (finished) return
      finished = true
      socket.destroy()
      reject(new Error('Cannot connect to Redis. Check the connection and password.'))
    }
    socket.setTimeout(10000, fail)
    socket.on('error', fail)
    socket.on('close', fail)
    socket.on('connect', () =>
      socket.write(
        (connection.password ? frame(['AUTH', connection.password]) : '') + frame(['PING'])
      )
    )
    socket.on('data', (chunk) => {
      output += chunk.toString()
      if (output.includes('-')) return fail()
      if (output.endsWith('+PONG\r\n')) {
        finished = true
        socket.destroy()
        resolve(undefined)
      }
    })
  })
}

export function databaseNames(name, suffix) {
  const database = `${name.replaceAll('-', '_').slice(0, 35)}_${suffix}`
  if (!/^[a-z][a-z0-9_]{0,49}$/.test(database)) throw new Error('Invalid database name.')
  return { database, testDatabase: `${database}_test` }
}

export async function createDatabases(connection, names) {
  // Always create new databases. A failed retry never migrates or erases a
  // pre-existing database, even if it happens to be empty.
  for (const name of [names.database, names.testDatabase])
    if (!/^[a-z][a-z0-9_]{0,60}$/.test(name)) throw new Error('Invalid database name.')
  const client = new pg.Client({
    ...connection,
    database: connection.maintenanceDatabase ?? 'postgres',
    connectionTimeoutMillis: 10000,
  })
  try {
    await client.connect()
    const version = Number(
      (await client.query('SHOW server_version_num')).rows[0].server_version_num
    )
    if (version < 170000 || version >= 180000)
      throw new Error('This release requires PostgreSQL 17.')
    const found = await client.query('SELECT datname FROM pg_database WHERE datname = ANY($1)', [
      [names.database, names.testDatabase],
    ])
    if (found.rowCount)
      throw new Error('Database already exists and will not be modified. Choose a new project.')
    for (const name of [names.database, names.testDatabase])
      await client.query(`CREATE DATABASE "${name}"`)
  } finally {
    await client.end()
  }
}

export function childEnvironment(values = {}) {
  // Calling this from a CI/test shell must not redirect migrations or cached
  // authorization to the caller's database. The new application's .env owns it.
  const env = { ...process.env }
  for (const key of Object.keys(env))
    if (
      /^(?:DB_|REDIS_|APP_|VITE_|ADULA_|COMPOSE_|GITHUB_CLIENT_|GOOGLE_CLIENT_|BACKUP_|AWS_|S3_|SMTP_|MAIL_|SESSION_|LIMITER_|DRIVE_|NODE_ENV$|HOST$|PORT$|LOG_LEVEL$)/i.test(
        key
      )
    )
      delete env[key]
  return { ...env, ...values }
}
