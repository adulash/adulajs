// One process runner for the repository's acceptance harnesses (scripts/test-*.mjs).
// It is repository tooling only and is not part of any published package.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { open, readFile } from 'node:fs/promises'
import { basename, isAbsolute, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = fileURLToPath(new URL('../../', import.meta.url))

/** A command whose exit status was not one of the expected ones. */
export class CommandError extends Error {
  constructor(message, result) {
    super(message)
    this.name = 'CommandError'
    Object.assign(this, result)
  }
}

/**
 * pnpm supplies its executable when invoking package scripts. Running its JS entry with
 * the current Node executable avoids cmd.exe quoting and .cmd spawning on Windows.
 * Returns the argv prefix: [node, pnpm.cjs] or [pnpm executable].
 */
export function pnpmCommand(usage) {
  const entry = process.env.npm_execpath
  assert(entry && basename(entry).includes('pnpm'), usage)
  return /\.(?:c?js|mjs)$/.test(entry) ? [process.execPath, entry] : [entry]
}

const display = (value) => {
  if (value === process.execPath) return 'node'
  if (value === process.env.npm_execpath) return basename(value)
  return /[\s"']/.test(value) ? JSON.stringify(value) : value
}

/** The printable form of a command line (never includes the environment). */
export const commandLine = (command, args = []) => [command, ...args].map(display).join(' ')

const accepts = (expect, code) =>
  typeof expect === 'function' ? expect(code) : [expect].flat().includes(code)

/** Accepts any non-zero exit: a step that must be refused. */
export const nonZero = (code) => code !== 0

/**
 * Runs `command` without a shell (Windows-safe: pass node + a JS entry, see pnpmCommand).
 *
 * Output modes:
 * - `log: path`     stdout and stderr go to that file; `output` is its content afterwards.
 * - `capture: true` stdout and stderr are piped and returned (`stdout`, `stderr`, `output`).
 * - otherwise       stdio is inherited.
 *
 * Options: `cwd` (default: repository root), `env` (default: process.env; pass the whole
 * environment, it replaces rather than merges), `expect` (exit code, list of codes or a
 * predicate; default 0), `check: true` (never throw on the exit code, just return the
 * result), `label` (name used in the failure message), `tail` (number of trailing output
 * lines printed to stderr on failure; 0 for private logs that may hold credentials),
 * `echo` (print the command before running it; default true).
 *
 * A child killed by a signal, or one that cannot start, always throws.
 * Resolves to { code, signal, output, stdout, stderr, logPath, command, args, cwd }.
 */
export async function run(command, args = [], options = {}) {
  const {
    cwd = root,
    env = process.env,
    log,
    capture = false,
    expect = 0,
    check = false,
    label,
    tail = 0,
    echo = true,
  } = options
  const line = commandLine(command, args)
  if (echo) {
    const where = relative(root, cwd)
    const shown = where === '' ? '' : ` (in ${where.startsWith('..') || isAbsolute(where) ? cwd : where})`
    console.log(`$ ${line}${shown}`)
  }
  const file = log ? await open(log, 'w') : undefined
  const chunks = { stdout: [], stderr: [] }
  let status
  try {
    status = await new Promise((done, reject) => {
      const child = spawn(command, args, {
        cwd,
        env,
        stdio: file ? ['ignore', file.fd, file.fd] : capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
        shell: false,
        windowsHide: true,
      })
      if (capture && !file) {
        child.stdout.on('data', (chunk) => chunks.stdout.push(chunk))
        child.stderr.on('data', (chunk) => chunks.stderr.push(chunk))
      }
      child.once('error', reject)
      child.once('close', (code, signal) => done({ code, signal }))
    })
  } finally {
    await file?.close()
  }
  const stdout = Buffer.concat(chunks.stdout).toString('utf8')
  const stderr = Buffer.concat(chunks.stderr).toString('utf8')
  const output = file ? await readFile(log, 'utf8') : stdout + stderr
  const result = { ...status, output, stdout, stderr, logPath: log, command, args, cwd }
  const name = label ?? line
  if (status.signal) throw new CommandError(`${name} stopped by ${status.signal}: ${line}`, result)
  if (check || accepts(expect, status.code)) return result
  if (tail > 0 && output) console.error(output.split(/\r?\n/).slice(-tail).join('\n'))
  throw new CommandError(
    `${name} failed (exit ${status.code}${status.code === 0 ? ', expected a refusal' : ''}): ${line}${log ? `; log: ${log}` : ''}`,
    result
  )
}
