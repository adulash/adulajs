import { readFile, realpath } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { dockerBackend, runCommand, withDockerServices } from './docker-runtime.mjs'

export async function runServices(name, args, execute = runCommand, hold = undefined) {
  const backend = dockerBackend(name)
  const [mode, ...rest] = args
  if (mode === 'up' || mode === 'stop') {
    return execute(backend.command, [
      ...backend.prefix,
      'compose',
      '--env-file',
      '.env',
      mode,
      ...rest,
    ])
  }
  if (!['dev', 'test', 'ace'].includes(mode)) throw new Error('Use dev, test, ace, up or stop.')
  return withDockerServices(
    backend,
    async () => {
      if (mode === 'ace') return execute(process.execPath, ['ace', ...rest])
      // Keep project-owned dev/test commands; pnpm appends the extra arguments to them.
      return execute(process.execPath, [
        'node_modules/pnpm/bin/pnpm.cjs',
        'run',
        `${mode}:app`,
        ...rest,
      ])
    },
    { execute, ...(hold ? { hold } : {}) }
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(await realpath(process.argv[1])).href) {
  const config = JSON.parse(
    await readFile(new URL('./docker-backend.json', import.meta.url), 'utf8')
  )
  await runServices(config.backend, process.argv.slice(2))
}
